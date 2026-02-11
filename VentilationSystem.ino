#include <ESP32Servo.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ================= BLE UUIDs =================
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

// ================= Servo Objects =================
Servo servo1;
Servo servo2;

// ================= Pins =================
const int servo1Pin = 14;
const int servo2Pin = 27;
const int FAN_PIN   = 13;
#define MQ7_PIN 34

// ================= BME280 =================
#define SDA_PIN 33
#define SCL_PIN 26
#define BME280_ADDRESS 0x76

Adafruit_BME280 bme;

// ================= MQ-7 =================
const float RL = 10.0;
float R0 = 26.0;

// ================= BLE =================
BLECharacteristic *pCharacteristic;
bool deviceConnected = false;

unsigned long previousMillis = 0;
const long interval = 1000;

// ================= BLE Callbacks =================
class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("BLE: Device connected");
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println("BLE: Device disconnected");
    BLEDevice::startAdvertising();
  }
};

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(1000);

  // Fan
  pinMode(FAN_PIN, OUTPUT);
  digitalWrite(FAN_PIN, LOW);

  // I2C
  Wire.begin(SDA_PIN, SCL_PIN);

  // BME280
  if (!bme.begin(BME280_ADDRESS)) {
    if (!bme.begin(0x77)) {
      Serial.println("BME280 not found!");
      while (1);
    }
  }

  // MQ-7
  pinMode(MQ7_PIN, INPUT);

  // ===== BLE Setup =====
  BLEDevice::init("VentilationSystem");
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );

  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setValue("System Ready");
  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  // Servos
  servo1.attach(servo1Pin);
  servo2.attach(servo2Pin);

  servo1.write(120);
  servo2.write(120);

  Serial.println("=== Ventilation System Ready ===");
}

// ================= LOOP =================
void loop() {

  unsigned long currentMillis = millis();

  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;

    // ===== Read BME280 =====
    float temperature = bme.readTemperature();
    float humidity = bme.readHumidity();
    float pressure = bme.readPressure() / 100.0F;

    // ===== Read MQ-7 =====
    int raw = analogRead(MQ7_PIN);
    float voltage = raw * (3.3 / 4095.0);
    if (voltage < 0.01) voltage = 0.01;

    float RS = RL * (5.0 - voltage) / voltage;
    if (RS <= 0) RS = 0.1;

    float ratio = RS / R0;
    float ppm = 0;

    if (ratio <= 0.95) {
      ppm = 100.0 * pow((1.0 / ratio) - 1.0, 1.5);
    }

    if (ppm < 0) ppm = 0;
    if (ppm > 1000) ppm = 1000;

    // ===== Fan Control =====
    bool fanShouldRun = (ppm > 35 || temperature > 30.0);
    digitalWrite(FAN_PIN, fanShouldRun ? HIGH : LOW);

    // ===== Servo Movement =====
    for (int i = 120; i <= 150; i++) {
      servo1.write(i);
      servo2.write(i);
      delay(10);
    }

    for (int i = 150; i >= 120; i--) {
      servo1.write(i);
      servo2.write(i);
      delay(10);
    }

    // ===== Serial Debug =====
    Serial.print("Temp: "); Serial.print(temperature);
    Serial.print(" C | Hum: "); Serial.print(humidity);
    Serial.print(" % | CO: "); Serial.print(ppm);
    Serial.print(" PPM | Fan: ");
    Serial.println(fanShouldRun ? "ON" : "OFF");

    // ===== Send BLE JSON =====
    if (deviceConnected) {
      String json = "{\"temp\":" + String(temperature,1) +
                    ",\"humidity\":" + String(humidity,1) +
                    ",\"pressure\":" + String(pressure,1) +
                    ",\"co\":" + String(ppm,1) +
                    ",\"fan\":" + String(fanShouldRun ? 1 : 0) +
                    "}";

      pCharacteristic->setValue(json.c_str());
      pCharacteristic->notify();

      Serial.print("BLE Sent: ");
      Serial.println(json);
    }
  }
}
