#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <SPI.h>
#include <SD.h>

#define SEALEVELPRESSURE_HPA (1013.25)

// ======================
// BME280 PIN CONFIGURATION
// ======================
#define BME_SCK  5   // SCK
#define BME_MISO 4   // SDO
#define BME_MOSI 3   // SDI
#define BME_CS   2   // CS
Adafruit_BME280 bme(BME_CS, BME_MOSI, BME_MISO, BME_SCK); // Software SPI

// ======================
// MQ-7 CO SENSOR
// ======================
const int mq7Pin = A0;
const float RL = 10.0;
const float RO = 26.0;

// ======================
// SD CARD
// ======================
const int SD_CS = 10;
bool sdWorking = false;
String filename;

// ======================
bool bmeWorking = false;

void setup() {
  Serial.begin(9600);
  delay(3000);

  Serial.println("===================================");
  Serial.println("Starting Environmental Monitor");
  Serial.println("===================================");

  // ====== Create new filename every run ======
  filename = "data_" + String(millis()) + ".csv";
  Serial.print("Logging to file: ");
  Serial.println(filename);

  // ====== BME280 ======
  Serial.println("[1/2] Testing BME280...");
  if (!bme.begin()) {
    Serial.println("✗ BME280 FAILED - Check wiring!");
    bmeWorking = false;
  } else {
    Serial.println("✓ BME280 OK (SPI)");
    bmeWorking = true;
    bme.setSampling(Adafruit_BME280::MODE_NORMAL,
                    Adafruit_BME280::SAMPLING_X2,   // Temperature
                    Adafruit_BME280::SAMPLING_X16,  // Pressure
                    Adafruit_BME280::SAMPLING_X1,   // Humidity
                    Adafruit_BME280::FILTER_X16,
                    Adafruit_BME280::STANDBY_MS_500);
  }

  // ====== SD Card ======
  Serial.println("[2/2] Testing SD card...");
  if (!SD.begin(SD_CS)) {
    Serial.println("✗ SD Card FAILED - Check card/wiring!");
    sdWorking = false;
  } else {
    Serial.println("✓ SD Card OK");
    sdWorking = true;

 filename = "d" + String(millis() % 100000) + ".csv";
    // Create file and write header
    File dataFile = SD.open(filename.c_str(), FILE_WRITE);
    if (dataFile) {
      dataFile.println("Timestamp(ms),CO_PPM,Temperature(C),Pressure(hPa),Humidity(%),Altitude(m),Status");
      dataFile.close();
      Serial.println("✓ CSV file created");
    } else {
      Serial.println("✗ Could not create file!");
      sdWorking = false;
    }
  }

  Serial.println("===================================");
  Serial.println("System Ready!");
  if (!bmeWorking) Serial.println("Warning: BME280 disabled");
  if (!sdWorking) Serial.println("Warning: SD logging disabled");
  Serial.println("===================================");
}

void loop() {
  // ====== MQ-7 Reading ======
  int raw = analogRead(mq7Pin);
  float voltage = raw * (5.0 / 1023.0);
  if (voltage < 0.01) voltage = 0.01;

  float RS = RL * ((5.0 / voltage) - 1.0);
  if (RS <= 0) RS = 0.1;

  float ppm = 100.0 * pow(RS / RO, -1.5);
  if (ppm < 0) ppm = 0;
  if (ppm > 1000) ppm = 1000;

  // ====== Status ======
  String status;
  if (ppm < 5) status = "Safe";
  else if (ppm > 30) status = "Unsafe";
  else status = "Warning";

  // ====== BME280 Reading ======
  float temperature = 0, pressure = 0, humidity = 0, altitude = 0;
  if (bmeWorking) {
    temperature = bme.readTemperature() - 3;
    pressure = bme.readPressure() / 100.0F;
    humidity = bme.readHumidity();
    altitude = bme.readAltitude(SEALEVELPRESSURE_HPA);
  }

  // ====== Print to Serial ======
  Serial.println("=== Readings ===");
  Serial.print("CO: "); Serial.print(ppm, 1); Serial.print(" PPM - "); Serial.println(status);
  if (bmeWorking) {
    Serial.print("Temp: "); Serial.print(temperature, 1); Serial.println(" °C");
    Serial.print("Pressure: "); Serial.print(pressure, 1); Serial.println(" hPa");
    Serial.print("Humidity: "); Serial.print(humidity, 1); Serial.println(" %");
    Serial.print("Altitude: "); Serial.print(altitude, 1); Serial.println(" m");
  } else {
    Serial.println("(BME280 not available)");
  }

  // ====== Log to SD ======
  if (sdWorking) {
    File dataFile = SD.open(filename.c_str(), FILE_WRITE);
    if (dataFile) {
      dataFile.print(millis()); dataFile.print(",");
      dataFile.print(ppm, 2); dataFile.print(",");
      dataFile.print(temperature, 2); dataFile.print(",");
      dataFile.print(pressure, 2); dataFile.print(",");
      dataFile.print(humidity, 2); dataFile.print(",");
      dataFile.print(altitude, 2); dataFile.print(",");
      dataFile.println(status);
      dataFile.close();
      Serial.println("✓ Logged to SD");
    } else {
      Serial.println("✗ SD write error");
    }
  }

  Serial.println();
  delay(2000); // wait 2 seconds
}
