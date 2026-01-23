#include <ESP32Servo.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>

// Servo objects
Servo servo1;
Servo servo2;

// Servo pins
const int servo1Pin = 14;
const int servo2Pin = 27;

// BME280 I2C pins
#define SDA_PIN 33
#define SCL_PIN 26
#define BME280_ADDRESS 0x76

// MQ-7 CO Sensor
#define MQ7_PIN 34
const float RL = 10.0;  // Load resistor in kΩ (check your MQ-7 module)
float R0 = 26;  // Will be calibrated on startup

Adafruit_BME280 bme;

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n=== Dual Servo + BME280 + MQ-7 System ===\n");
  
  // Initialize I2C for BME280
  Wire.begin(SDA_PIN, SCL_PIN);
  
  // Initialize BME280
  if (!bme.begin(BME280_ADDRESS)) {
    Serial.println("Trying alternate address 0x77...");
    if (!bme.begin(0x77)) {
      Serial.println("✗ BME280 not found!");
    } else {
      Serial.println("✓ BME280 initialized at 0x77");
    }
  } else {
    Serial.println("✓ BME280 initialized at 0x76");
  }
  
  // Initialize MQ-7
  pinMode(MQ7_PIN, INPUT);
  Serial.println("\n=== MQ-7 Calibration ===");
  Serial.println("Ensure sensor is in CLEAN AIR!");
  Serial.println("Warming up for 30 seconds...");
  
  // Warm-up period with progress
  for (int i = 0; i < 30; i++) {
    int raw = analogRead(MQ7_PIN);
    float voltage = raw * (3.3 / 4095.0);
    Serial.print("Warm-up ");
    Serial.print(i + 1);
    Serial.print("/30: ");
    Serial.print(voltage, 2);
    Serial.println("V");
    delay(1000);
  }
  
  // Calibrate R0
  Serial.println("\nCalibrating R0...");
  float RO_sum = 0;
  int valid_readings = 0;
  
  for (int i = 0; i < 100; i++) {
    int raw = analogRead(MQ7_PIN);
    float voltage = raw * (3.3 / 4095.0);
    
    if (voltage > 0.1 && voltage < 3.2) {
      float RS = RL * (5.0 - voltage) / voltage;
      if (RS > 0 && RS < 100) {
        RO_sum += RS;
        valid_readings++;
      }
    }
    
    if (i % 20 == 0) Serial.print(".");
    delay(50);
  }
  Serial.println();
  
  if (valid_readings > 50) {
    R0 = RO_sum / valid_readings;
    Serial.print("✓ R0 calibrated: ");
    Serial.print(R0, 2);
    Serial.println(" kΩ");
    Serial.println("*** Save this R0 value for future use! ***");
  } else {
    Serial.println("✗ Calibration failed - using default R0 = 10.0 kΩ");
  }
  
  // Attach servos
  Serial.println("\nAttaching servos...");
  servo1.attach(servo1Pin);
  delay(100);
  servo2.attach(servo2Pin);
  delay(100);
  
  // Test position - servo1 at 90°, servo2 at opposite (90°)
  Serial.println("Testing - moving to center position");
  servo1.write(90);
  servo2.write(90);
  delay(1000);
  
  // Move to start positions - servo1 at 0°, servo2 at 180° (opposite)
  Serial.println("Moving to start position (Servo1: 0°, Servo2: 180°)");
  servo1.write(0);
  servo2.write(180);
  delay(1000);
  
  Serial.println("✓ Servo 1: GPIO 14");
  Serial.println("✓ Servo 2: GPIO 27 (opposite direction)");
  Serial.println("\n=== System Ready ===\n");
}

void loop() {
  // ====== Read BME280 ======
  float temperature = bme.readTemperature();
  float humidity = bme.readHumidity();
  float pressure = bme.readPressure() / 100.0F;
  
  // ====== Read MQ-7 ======
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
  
  // Determine CO status
  String coStatus;
  if (ppm < 9) coStatus = "Safe";
  else if (ppm < 35) coStatus = "Warning";
  else coStatus = "UNSAFE!";
  
  // ====== Print All Readings ======
  Serial.println("=== Sensor Readings ===");
  Serial.print("Temperature: ");
  Serial.print(temperature, 1);
  Serial.println(" °C");
  
  Serial.print("Humidity: ");
  Serial.print(humidity, 1);
  Serial.println(" %");
  
  Serial.print("Pressure: ");
  Serial.print(pressure, 1);
  Serial.println(" hPa");
  
  Serial.print("CO Level: ");
  Serial.print(ppm, 1);
  Serial.print(" PPM - ");
  Serial.println(coStatus);
  
  Serial.print("  (Raw: ");
  Serial.print(raw);
  Serial.print(", V: ");
  Serial.print(voltage, 2);
  Serial.print("V, RS: ");
  Serial.print(RS, 2);
  Serial.print("kΩ, RS/R0: ");
  Serial.print(ratio, 3);
  Serial.println(")");
  
  // ====== CO Alert ======
  if (ppm > 35) {
    Serial.println("\n⚠️⚠️⚠️ HIGH CO DETECTED! ⚠️⚠️⚠️\n");
  }
  
  Serial.println();
  
  // ====== Servo Sweep - OPPOSITE DIRECTIONS ======
  Serial.println("Sweeping (Servo1: 0°->180°, Servo2: 180°->0°)");
  for (int pos = 0; pos <= 30; pos++) {
    servo1.write(pos);          // Servo1 goes 0 to 180
    servo2.write(180 - pos);    // Servo2 goes 180 to 0 (opposite)
    delay(30);
  }
  
  Serial.println("At opposite end positions");
  delay(1000);
  
  Serial.println("Sweeping back (Servo1: 180°->0°, Servo2: 0°->180°)");
  for (int pos = 30; pos >= 0; pos--) {
    servo1.write(pos);          // Servo1 goes 180 to 0
    servo2.write(180 - pos);    // Servo2 goes 0 to 180 (opposite)
    delay(30);
  }
  
  Serial.println("Back at start positions");
  delay(1000);
  
  Serial.println();
}
