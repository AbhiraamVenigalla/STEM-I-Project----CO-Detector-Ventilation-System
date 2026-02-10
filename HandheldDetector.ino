/*
 * Sensor Data Recorder for MQ-7 and BME280
 * Records CO gas levels, temperature, humidity, and pressure
 * 
 * Hardware Connections:
 * MQ-7: Analog output to GPIO 14
 * BME280: I2C (SDA to GPIO 32, SCL to GPIO 25)
 */

#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>

// Pin definitions
const int MQ7_PIN = 14;
const int BME_SDA = 32;
const int BME_SCL = 25;

// BME280 sensor object
Adafruit_BME280 bme;

// Variables
float mq7_voltage;
float mq7_ppm;
float temperature;
float humidity;
float pressure;
float altitude;

// Sampling interval
unsigned long previousMillis = 0;
const long interval = 1000; // 1 second between readings

void setup() {
  // Initialize serial communication
  Serial.begin(9600);
  delay(1000);
  
  // Initialize I2C with defined pins
  Wire.begin(BME_SDA, BME_SCL);
  
  // Initialize BME280
  if (!bme.begin(0x76)) {
    if (!bme.begin(0x77)) {
      Serial.println("ERROR: BME280 not found!");
      while (1) delay(1000);
    }
  }
  
  // Configure BME280 settings
  bme.setSampling(Adafruit_BME280::MODE_NORMAL,
                  Adafruit_BME280::SAMPLING_X2,
                  Adafruit_BME280::SAMPLING_X16,
                  Adafruit_BME280::SAMPLING_X1,
                  Adafruit_BME280::FILTER_X16,
                  Adafruit_BME280::STANDBY_MS_500);
  
  // Print formatted header
  Serial.println("\n========================================");
  Serial.println("   MQ-7 & BME280 Sensor Data Logger");
  Serial.println("========================================");
  Serial.println("MQ-7 Range: 0-1V = 0-10,000 PPM");
  Serial.println("========================================\n");
  
  delay(2000);
}

void loop() {
  unsigned long currentMillis = millis();
  
  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;
    
    readMQ7();
    readBME280();
    printData();
    Serial.flush();
  }
}

void readMQ7() {
  int sensorValue = analogRead(MQ7_PIN);
  mq7_voltage = sensorValue * (3.3 / 4095.0);
  
  // Scale voltage to PPM: 0V = 0 PPM, 1V = 10,000 PPM
  mq7_ppm = mq7_voltage * 100.0;
}

void readBME280() {
  temperature = bme.readTemperature();
  humidity = bme.readHumidity();
  pressure = bme.readPressure() / 100.0F;
  altitude = bme.readAltitude(1013.25);
}

void printData() {
  Serial.println("----------------------------------------");
  Serial.print("Time: ");
  Serial.print(millis() / 1000);
  Serial.println(" seconds");
  Serial.println();
  
  Serial.println("MQ-7 CO Sensor:");
  Serial.print("  Voltage: ");
  Serial.print(mq7_voltage, 4);
  Serial.println(" V");
  Serial.print("  CO Level: ");
  Serial.print(mq7_ppm, 2);
  Serial.println(" PPM");
  Serial.println();
  
  Serial.println("BME280 Environmental Sensor:");
  Serial.print("  Temperature: ");
  Serial.print(temperature, 2);
  Serial.println(" °C");
  Serial.print("  Humidity: ");
  Serial.print(humidity, 2);
  Serial.println(" %");
  Serial.print("  Pressure: ");
  Serial.print(pressure, 2);
  Serial.println(" hPa");
  Serial.print("  Altitude: ");
  Serial.print(altitude, 2);
  Serial.println(" m");
  Serial.println();
}
