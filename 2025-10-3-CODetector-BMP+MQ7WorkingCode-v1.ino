#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BMP280.h>

#define SEALEVELPRESSURE_HPA (1013.25)

Adafruit_BMP280 bmp;

const int mq7AnalogPin = A0;
const int mq7DigitalPin = 2;

// Calibration values
const float RL_VALUE = 10.0;
float RO_CLEAN_AIR = 3.0;  // Will calibrate in setup

unsigned long delayTime;
bool calibrated = false;

void setup() {
  Serial.begin(9600);
  delay(2000);
  
  Serial.println("========================================");
  Serial.println("   BMP280 + MQ-7 Environmental Monitor");
  Serial.println("========================================");
  Serial.println();
  
  // Initialize BMP280
  Serial.print("Initializing BMP280... ");
  if (!bmp.begin(0x76)) {
    Serial.println("FAILED!");
    Serial.println("Could not find BMP280 sensor!");
    while (1);
  }
  Serial.println("SUCCESS!");
  
  bmp.setSampling(Adafruit_BMP280::MODE_NORMAL,
                  Adafruit_BMP280::SAMPLING_X2,
                  Adafruit_BMP280::SAMPLING_X16,
                  Adafruit_BMP280::FILTER_X16,
                  Adafruit_BMP280::STANDBY_MS_500);
  
  pinMode(mq7DigitalPin, INPUT);
  
  Serial.println();
  Serial.println("Warming up MQ-7 sensor...");
  Serial.println("Please wait 3 minutes for stable readings...");


  Serial.println(" minute(s) remaining...");
  delay(600);

  
  // Auto-calibrate in clean air
  Serial.println();
  Serial.println("Calibrating in clean air...");
  Serial.println("Make sure sensor is in fresh air!");
  delay(5000);
  
  float sumRS = 0;
  for (int i = 0; i < 50; i++) {
    int rawValue = analogRead(mq7AnalogPin);
    float voltage = rawValue * (5.0 / 1023.0);
    float RS = ((5.0 * RL_VALUE) / voltage) - RL_VALUE;
    if (RS > 0) sumRS += RS;
    delay(100);
  }
  
  RO_CLEAN_AIR = sumRS / 50.0;
  calibrated = true;
  
  Serial.print("Calibration complete! RO = ");
  Serial.print(RO_CLEAN_AIR);
  Serial.println(" kOhms");
  
  Serial.println();
  Serial.println("========================================");
  Serial.println("         System Ready!");
  Serial.println("========================================");
  Serial.println();
  
  delayTime = 2000;
}

void loop() { 
  printAllValues();
  delay(delayTime);
}

float calculateCO_PPM(int rawValue) {
  // Convert ADC value to voltage
  float voltage = rawValue * (5.0 / 1023.0);
  
  // Prevent division by zero
  if (voltage < 0.1) voltage = 0.1;
  
  // Calculate sensor resistance
  float RS = ((5.0 * RL_VALUE) / voltage) - RL_VALUE;
  
  if (RS <= 0) RS = 0.1;
  
  // Calculate RS/RO ratio
  float ratio = RS / RO_CLEAN_AIR;
  
  // Prevent invalid ratios
  if (ratio <= 0) ratio = 0.01;
  
  // MQ-7 datasheet formula: PPM = 100 * (RS/RO)^-1.5
  // This means: as RS decreases (more CO), PPM increases
  float ppm = 100.0 * pow(ratio, -1.5);
  
  // Reasonable limits
  if (ppm < 0) ppm = 0;
  if (ppm > 1000) ppm = 1000;
  
  return ppm;
}

void printAllValues() {
  float temperature = bmp.readTemperature();
  float pressure = bmp.readPressure() / 100.0F;
  float altitude = bmp.readAltitude(SEALEVELPRESSURE_HPA);
  
  int coAnalog = analogRead(mq7AnalogPin);
  float coVoltage = coAnalog * (5.0 / 1023.0);
  float coPPM = calculateCO_PPM(coAnalog);
  int coDigital = digitalRead(mq7DigitalPin);
  
  Serial.println("╔════════════════════════════════════════╗");
  Serial.println("║        ENVIRONMENTAL READINGS          ║");
  Serial.println("╠════════════════════════════════════════╣");
  
  Serial.print("║ Temperature:      ");
  Serial.print(temperature, 1);
  Serial.println(" °C");
  
  Serial.print("║ Pressure:         ");
  Serial.print(pressure, 1);
  Serial.println(" hPa");
  
  Serial.print("║ Altitude:         ");
  Serial.print(altitude, 1);
  Serial.println(" m");
  
  Serial.println("╠════════════════════════════════════════╣");
  
  Serial.print("║ CO Raw Value:     ");
  Serial.print(coAnalog);
  Serial.print(" (");
  Serial.print(coVoltage, 2);
  Serial.println(" V)");
  
  Serial.print("║ CO Level:         ");
  if (calibrated) {
    Serial.print(coPPM, 1);
    Serial.println(" PPM");
  } else {
    Serial.println("Not calibrated");
  }
  
  Serial.print("║ CO Alert:         ");
  if (coDigital == HIGH) {
    Serial.println("DETECTED!");
  } else {
    Serial.println("✓ Normal");
  }
  
  // Safety interpretation
  if (calibrated) {
    Serial.println("╠════════════════════════════════════════╣");
    Serial.print("║ Status:           ");
    if (coPPM < 9) {
      Serial.println("✓ Safe");
    } else if (coPPM < 35) {
      Serial.println("Caution");
    } else if (coPPM < 100) {
      Serial.println("Warning!");
    } else {
      Serial.println("DANGER!");
    }
  }
  
  Serial.println("╚════════════════════════════════════════╝");
  Serial.println();
}
