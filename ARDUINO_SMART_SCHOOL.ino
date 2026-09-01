#include <Servo.h>

const int SENSOR_PIN = 7;
const int LIGHT_PIN = 3;
const int FAN1_PIN = 5;
const int BUZZER_PIN = 6;
const int FAN2_PIN = 10;
const int SERVO_PIN = 9;
const int PUMP_PIN = 11;

Servo gate;
unsigned long objectCount = 0;
bool previousDetected = false;

// Classroom light control:
// false = sensor controls the light (default)
// true  = website/AI manual control; sensor is ignored
bool lightManualMode = false;

void applyCommand(String device, String command) {
  device.trim();
  command.trim();
  command.toUpperCase();

  if (device == "light") {
    if (command == "ON") {
      // Website/AI ON: force light ON and disable sensor control.
      lightManualMode = true;
      digitalWrite(LIGHT_PIN, HIGH);
    } else if (command == "OFF") {
      // Website/AI OFF: turn light OFF and return control to the sensor.
      lightManualMode = false;
      digitalWrite(LIGHT_PIN, LOW);
    }
  } else if (device == "fan1") {
    digitalWrite(FAN1_PIN, command == "ON" ? HIGH : LOW);
  } else if (device == "fan2") {
    digitalWrite(FAN2_PIN, command == "ON" ? HIGH : LOW);
  } else if (device == "gate") {
    gate.write(command == "OPEN" ? 90 : 0);
  } else if (device == "buzzer" || device == "bell" || device == "firealarm") {
    digitalWrite(BUZZER_PIN, command == "ON" || command == "RING" ? HIGH : LOW);
  } else if (device == "pump") {
    digitalWrite(PUMP_PIN, command == "ON" ? HIGH : LOW);
  } else if (device == "counter" && command == "RESET") {
    objectCount = 0;
    Serial.println("COUNT:0");
  }
}

// Keeps compatibility with the original website's USB commands.
void applyLegacy(char c) {
  switch (c) {
    // Legacy website commands keep the same behavior:
    // 1 = manual ON (sensor disabled), 0 = OFF + return to sensor mode.
    case '1':
      lightManualMode = true;
      digitalWrite(LIGHT_PIN, HIGH);
      break;
    case '0':
      lightManualMode = false;
      digitalWrite(LIGHT_PIN, LOW);
      break;
    case 'F': digitalWrite(FAN1_PIN, HIGH); break;
    case 'f': digitalWrite(FAN1_PIN, LOW); break;
    case 'G': digitalWrite(FAN2_PIN, HIGH); break;
    case 'g': digitalWrite(FAN2_PIN, LOW); break;
    case '2': gate.write(90); break;
    case '3': gate.write(0); break;
    case 'B': digitalWrite(BUZZER_PIN, HIGH); break;
    case 'b': digitalWrite(BUZZER_PIN, LOW); break;
    case 'R': objectCount = 0; Serial.println("COUNT:0"); break;
  }
}

void handleLine(String line) {
  line.trim();
  if (line.length() == 0) return;

  int colon = line.indexOf(':');
  if (colon >= 0) {
    applyCommand(line.substring(0, colon), line.substring(colon + 1));
  } else {
    applyLegacy(line.charAt(0));
  }
}

void setup() {
  Serial.begin(9600);
  pinMode(SENSOR_PIN, INPUT);
  pinMode(LIGHT_PIN, OUTPUT);
  pinMode(FAN1_PIN, OUTPUT);
  pinMode(FAN2_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(PUMP_PIN, OUTPUT);

  digitalWrite(LIGHT_PIN, LOW);
  digitalWrite(FAN1_PIN, LOW);
  digitalWrite(FAN2_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(PUMP_PIN, LOW);

  gate.attach(SERVO_PIN);
  gate.write(0);
}

void loop() {
  static String line = "";

  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (line.length()) {
        handleLine(line);
        line = "";
      }
    } else {
      line += c;
      if (line.length() > 100) line = "";
    }
  }

  // The sensor always remains available for counting.
  // It controls the classroom light only when manual website/AI mode is OFF.
  bool detected = digitalRead(SENSOR_PIN) == HIGH;

  if (!lightManualMode) {
    digitalWrite(LIGHT_PIN, detected ? HIGH : LOW);
  }

  if (detected && !previousDetected) {
    objectCount++;
    Serial.print("COUNT:");
    Serial.println(objectCount);
  }

  previousDetected = detected;

  delay(5);
}
