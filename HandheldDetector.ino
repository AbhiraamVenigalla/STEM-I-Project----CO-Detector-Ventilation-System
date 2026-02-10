#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

const int MQ7_PIN = 14;
const int BME_SDA = 32;
const int BME_SCL = 25;

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

Adafruit_BME280 bme;

float mq7_voltage, mq7_ppm, temperature, humidity, pressure;

BLECharacteristic *pCharacteristic;
bool deviceConnected = false;

unsigned long previousMillis = 0;
const long interval = 1000;

class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("BLE: Device connected");
  }
  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println("BLE: Device disconnected, restarting advertising...");
    BLEDevice::startAdvertising();
  }
};

void setup() {
  Serial.begin(9600);
  delay(1000);

  Wire.begin(BME_SDA, BME_SCL);

  if (!bme.begin(0x76)) {
    if (!bme.begin(0x77)) {
      Serial.println("ERROR: BME280 not found!");
      while (1) delay(1000);
    }
  }

  bme.setSampling(Adafruit_BME280::MODE_NORMAL,
                  Adafruit_BME280::SAMPLING_X2,
                  Adafruit_BME280::SAMPLING_X16,
                  Adafruit_BME280::SAMPLING_X1,
                  Adafruit_BME280::FILTER_X16,
                  Adafruit_BME280::STANDBY_MS_500);

  BLEDevice::init("CODetect");
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_NOTIFY
  );

  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setValue("ready");

  pService->start();

  // Advertise service UUID so apps can discover it
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("BLE Server running - device name: CODetect");
}

void loop() {
  unsigned long currentMillis = millis();

  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;

    // Read MQ-7
    int sensorValue = analogRead(MQ7_PIN);
    mq7_voltage = sensorValue * (3.3 / 4095.0);
    mq7_ppm = mq7_voltage * 100.0;

    // Read BME280
    temperature = bme.readTemperature();
    humidity = bme.readHumidity();
    pressure = bme.readPressure() / 100.0F;

    // Serial debug
    Serial.print("CO: "); Serial.print(mq7_ppm); Serial.print(" PPM | ");
    Serial.print("Temp: "); Serial.print(temperature); Serial.print(" C | ");
    Serial.print("Hum: "); Serial.print(humidity); Serial.println(" %");

    // Send over BLE
    if (deviceConnected) {
      String json = "{\"temp\":" + String(temperature, 1) +
                    ",\"humidity\":" + String(humidity, 1) +
                    ",\"co\":" + String(mq7_ppm, 1) + "}";
      pCharacteristic->setValue(json.c_str());
      pCharacteristic->notify();
      Serial.print("BLE Sent: "); Serial.println(json);
    }
  }
}
