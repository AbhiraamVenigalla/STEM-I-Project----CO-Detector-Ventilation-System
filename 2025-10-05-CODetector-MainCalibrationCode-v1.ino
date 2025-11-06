// MQ-7 Sensor Verification Program

const int mq7AnalogPin = A0;

void setup() {
  Serial.begin(9600);
  delay(2000);
  
  Serial.println("========================================");
  Serial.println("     MQ-7 Sensor Verification Test");
  Serial.println("========================================");
  Serial.println();
  Serial.println("This will help identify your sensor type");
  Serial.println();
  
  pinMode(mq7AnalogPin, INPUT);
}

void loop() {
  Serial.println("========================================");
  Serial.println("          SENSOR READINGS");
  Serial.println("========================================");
  Serial.println();
  
  // Take multiple readings
  int reading1 = analogRead(mq7AnalogPin);
  delay(100);
  int reading2 = analogRead(mq7AnalogPin);
  delay(100);
  int reading3 = analogRead(mq7AnalogPin);
  
  float voltage = reading1 * (5.0 / 1023.0);
  
  Serial.print("Raw Analog Value: ");
  Serial.println(reading1);
  
  Serial.print("Voltage:          ");
  Serial.print(voltage, 3);
  Serial.println(" V");
  
  Serial.print("Stability:        ");
  int variance = abs(reading1 - reading2) + abs(reading2 - reading3);
  if (variance < 10) {
    Serial.println("Stable ✓");
  } else {
    Serial.println("Fluctuating (variance: " + String(variance) + ")");
  }
  
  Serial.println();
  Serial.println("DIAGNOSTIC CHECKS:");
  Serial.println("------------------");
  
  // Check 1: Voltage range
  Serial.print("1. Voltage Range:     ");
  if (voltage > 0.5 && voltage < 4.5) {
    Serial.println("✓ PASS (Valid range)");
  } else if (voltage < 0.1) {
    Serial.println("✗ FAIL (Too low - possible short circuit)");
  } else if (voltage > 4.9) {
    Serial.println("✗ FAIL (Too high - possible open circuit)");
  } else {
    Serial.println("? Marginal");
  }
  
  // Check 2: Response test
  Serial.println();
  Serial.println("2. Response Test:");
  Serial.println("   >> Breathe on the sensor NOW <<");
  Serial.println("   Monitoring for 10 seconds...");
  
  int baselineReading = analogRead(mq7AnalogPin);
  delay(1000);
  
  int maxChange = 0;
  int minReading = baselineReading;
  int maxReading = baselineReading;
  
  for (int i = 0; i < 10; i++) {
    int currentReading = analogRead(mq7AnalogPin);
    
    if (currentReading < minReading) minReading = currentReading;
    if (currentReading > maxReading) maxReading = currentReading;
    
    Serial.print("   ");
    Serial.print(i + 1);
    Serial.print("s: ");
    Serial.print(currentReading);
    
    int change = abs(currentReading - baselineReading);
    if (change > maxChange) maxChange = change;
    
    if (change > 20) {
      Serial.println(" << CHANGE DETECTED!");
    } else {
      Serial.println();
    }
    
    delay(1000);
  }
  
  Serial.println();
  Serial.print("   Baseline:       ");
  Serial.println(baselineReading);
  Serial.print("   Min Reading:    ");
  Serial.println(minReading);
  Serial.print("   Max Reading:    ");
  Serial.println(maxReading);
  Serial.print("   Max Change:     ");
  Serial.println(maxChange);
  Serial.println();
  
  if (maxChange > 30) {
    Serial.println("   ✓ Sensor responds to breath (likely MQ-7 or similar)");
  } else if (maxChange > 10) {
    Serial.println("   ? Weak response (might be MQ-7 or faulty)");
  } else {
    Serial.println("   ✗ No response (NOT working as MQ-7)");
  }
  
  Serial.println();
  Serial.println("IDENTIFICATION:");
  Serial.println("---------------");
  
  // Analyze behavior
  if (voltage > 0.5 && voltage < 4.5 && maxChange > 30) {
    Serial.println("✓ This APPEARS to be a working MQ-7 sensor");
    Serial.println("  - Responds to breath");
    Serial.println("  - Voltage in normal range");
    
    if (reading1 > 900) {
      Serial.println("  - High resistance (clean air - GOOD)");
    } else if (reading1 < 200) {
      Serial.println("  - Low resistance (detecting gas)");
    } else {
      Serial.println("  - Medium resistance");
    }
    
  } else if (maxChange < 10) {
    Serial.println("✗ Sensor NOT responding properly");
    Serial.println("  Possible issues:");
    Serial.println("  - Not an MQ-7 (wrong sensor)");
    Serial.println("  - Damaged sensor");
    Serial.println("  - Needs longer warmup time");
    Serial.println("  - Wrong wiring");
    
  } else {
    Serial.println("? Unclear - sensor may need more warmup time");
    Serial.println(maxChange);
  }
  
  Serial.println();
  Serial.println("========================================");
  Serial.println("Test complete. Waiting 30 seconds...");
  Serial.println("Reset Arduino to test again");
  Serial.println("========================================");
  Serial.println();
  
  delay(3000);
}
