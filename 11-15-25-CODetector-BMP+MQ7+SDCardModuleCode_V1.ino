#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BMP280.h>
#include <SPI.h>
#include <SD.h>

#define SEALEVELPRESSURE_HPA (1013.25)

Adafruit_BMP280 bmp;

const int mq7Pin = A0;
const float RL = 10.0;
const float RO = 26.0;

const int SD_CS = 10;

bool bmpWorking = false;
bool sdWorking = false;

void setup() {
  Serial.begin(9600);
  delay(3000);
  
  Serial.println("===================================");
  Serial.println("Starting Environmental Monitor");
  Serial.println("===================================");
  Serial.println();
  
  // Test 1: BMP280
  Serial.println("[1/2] Testing BMP280...");
  if (!bmp.begin(0x76)) {
    Serial.println("  ✗ BMP280 FAILED - Check wiring!");
    Serial.println("  Continuing without BMP280...");
    bmpWorking = false;
  } else {
    Serial.println("  ✓ BMP280 OK");
    bmpWorking = true;
    
    bmp.setSampling(Adafruit_BMP280::MODE_NORMAL,
                    Adafruit_BMP280::SAMPLING_X2,
                    Adafruit_BMP280::SAMPLING_X16,
                    Adafruit_BMP280::FILTER_X16,
                    Adafruit_BMP280::STANDBY_MS_500);
  }
  
  // Test 2: SD Card
  Serial.println("[2/2] Testing SD card...");
  if (!SD.begin(SD_CS)) {
    Serial.println("  ✗ SD Card FAILED - Check card/wiring!");
    Serial.println("  Continuing without SD logging...");
    sdWorking = false;
  } else {
    Serial.println("  ✓ SD Card OK");
    sdWorking = true;
    
    // Check if file exists
    if (!SD.exists("data.csv")) {
      // File doesn't exist, create it with header
      File dataFile = SD.open("data.csv", FILE_WRITE);
      if (dataFile) {
        dataFile.println("Timestamp(ms),CO_PPM,Temperature(C),Pressure(hPa),Altitude(m),Status");
        dataFile.close();
        Serial.println("  ✓ Created new data.csv");
      } else {
        Serial.println("  ✗ Could not create file!");
        sdWorking = false;
      }
    } else {
      // File exists, will append to it
      Serial.println("  ✓ Found existing data.csv, will append");
    }
  }
  
  Serial.println();
  Serial.println("===================================");
  Serial.println("System Ready!");
  if (!bmpWorking) Serial.println("Warning: BMP280 disabled");
  if (!sdWorking) Serial.println("Warning: SD logging disabled");
  Serial.println("===================================");
  Serial.println();
}

void loop() {
  // Read MQ-7
  int raw = analogRead(mq7Pin);
  float voltage = raw * (5.0 / 1023.0);
  
  if (voltage < 0.01) voltage = 0.01;
  
  float RS = RL * ((5.0 / voltage) - 1.0);
  if (RS <= 0) RS = 0.1;
  
  float ppm = 100.0 * pow(RS / RO, -1.5);
  if (ppm < 0) ppm = 0;
  if (ppm > 1000) ppm = 1000;
  
  // Determine status
  String status;
  if (ppm < 5) {
    status = "Safe";
  } else if (ppm > 30) {
    status = "Unsafe";
  } else {
    status = "Warning";
  }
  
  // Print to Serial
  Serial.println("=== Readings ===");
  
  Serial.print("CO: ");
  Serial.print(ppm, 1);
  Serial.print(" PPM - ");
  Serial.println(status);
  
  // Read BMP280 if available
  if (bmpWorking) {
    float temperature = bmp.readTemperature();
    float pressure = bmp.readPressure() / 100.0F;
    float altitude = bmp.readAltitude(SEALEVELPRESSURE_HPA);
    
    Serial.print("Temperature: ");
    Serial.print(temperature, 1);
    Serial.println(" °C");
    
    Serial.print("Pressure: ");
    Serial.print(pressure, 1);
    Serial.println(" hPa");
    
    Serial.print("Altitude: ");
    Serial.print(altitude, 1);
    Serial.println(" m");
    
    // Log to SD if available - ALWAYS APPEND
    if (sdWorking) {
      File dataFile = SD.open("data.csv", FILE_WRITE);  // Opens in append mode
      if (dataFile) {
        dataFile.print(millis());
        dataFile.print(",");
        dataFile.print(ppm, 2);
        dataFile.print(",");
        dataFile.print(temperature, 2);
        dataFile.print(",");
        dataFile.print(pressure, 2);
        dataFile.print(",");
        dataFile.print(altitude, 2);
        dataFile.print(",");
        dataFile.println(status);
        dataFile.close();
        
        Serial.println("✓ Logged to SD");
      } else {
        Serial.println("✗ SD write error");
      }
    }
  } else {
    Serial.println("(BMP280 not available)");
  }
  
  Serial.println();
  
  delay(2000);
}
