const int mq7Pin = A0;
const float RL = 10.0;
const float RO = 26.0;  // Calibrated value

void setup() {
  Serial.begin(9600);
}

void loop() {
  int raw = analogRead(mq7Pin);
  float voltage = raw * (5.0 / 1023.0);
  float RS = RL * ((5.0 / voltage) - 1.0);
  float ppm = 100.0 * pow(RS / RO, -1.5);
  
  Serial.print("CO: ");
  Serial.print(ppm, 1);
  Serial.println(" PPM");
  
  delay(2000);
}
