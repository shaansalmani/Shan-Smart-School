"""
Safe Arduino Hardware Control Registry and Tool.
Maintains a strict whitelist of approved devices, actions, and predefined serial commands.
NEVER allows arbitrary command execution or unverified serial writes.
"""

from enum import Enum
from pydantic import BaseModel, Field
from backend.utils.logger import logger


class ArduinoDevice(str, Enum):
    CLASSROOM_LIGHT = "classroom_light"
    FAN_1 = "fan_1"
    FAN_2 = "fan_2"
    FANS = "fans"
    WATER_PUMP = "water_pump"
    GATE = "gate"
    BUZZER = "buzzer"
    COUNTER = "counter"


class ArduinoAction(str, Enum):
    ON = "ON"
    OFF = "OFF"
    OPEN = "OPEN"
    CLOSE = "CLOSE"
    RING = "RING"
    STOP = "STOP"
    RESET = "RESET"


class ArduinoCommandSpec(BaseModel):
    device: str
    action: str
    serial_command: str
    description: str
    response_phrase_en: str
    response_phrase_hi: str


# Safe predefined command registry matching ARDUINO_SMART_SCHOOL.ino protocol
ARDUINO_COMMAND_REGISTRY: dict[str, ArduinoCommandSpec] = {
    # Classroom Light (D3)
    "CLASSROOM_LIGHT_ON": ArduinoCommandSpec(
        device="classroom_light",
        action="ON",
        serial_command="light:ON",
        description="Turn ON smart classroom light (disables sensor override)",
        response_phrase_en="Classroom light is now turned ON.",
        response_phrase_hi="Classroom light ON kar di gayi hai.",
    ),
    "CLASSROOM_LIGHT_OFF": ArduinoCommandSpec(
        device="classroom_light",
        action="OFF",
        serial_command="light:OFF",
        description="Turn OFF smart classroom light (restores sensor mode)",
        response_phrase_en="Classroom light is now turned OFF.",
        response_phrase_hi="Classroom light OFF kar di gayi hai.",
    ),

    # Classroom Fan 1 (D5)
    "FAN_1_ON": ArduinoCommandSpec(
        device="fan_1",
        action="ON",
        serial_command="fan1:ON",
        description="Turn ON classroom fan 1",
        response_phrase_en="Classroom Fan 1 is now running.",
        response_phrase_hi="Classroom Fan 1 chalu ho gaya hai.",
    ),
    "FAN_1_OFF": ArduinoCommandSpec(
        device="fan_1",
        action="OFF",
        serial_command="fan1:OFF",
        description="Turn OFF classroom fan 1",
        response_phrase_en="Classroom Fan 1 is now turned OFF.",
        response_phrase_hi="Classroom Fan 1 band kar diya gaya hai.",
    ),

    # Classroom Fan 2 (D10)
    "FAN_2_ON": ArduinoCommandSpec(
        device="fan_2",
        action="ON",
        serial_command="fan2:ON",
        description="Turn ON classroom fan 2",
        response_phrase_en="Classroom Fan 2 is now running.",
        response_phrase_hi="Classroom Fan 2 chalu ho gaya hai.",
    ),
    "FAN_2_OFF": ArduinoCommandSpec(
        device="fan_2",
        action="OFF",
        serial_command="fan2:OFF",
        description="Turn OFF classroom fan 2",
        response_phrase_en="Classroom Fan 2 is now turned OFF.",
        response_phrase_hi="Classroom Fan 2 band kar diya gaya hai.",
    ),

    # All Fans (Fan 1 + Fan 2)
    "FANS_ALL_ON": ArduinoCommandSpec(
        device="fans",
        action="ON",
        serial_command="fan1:ON\nfan2:ON",
        description="Turn ON both classroom fans",
        response_phrase_en="All classroom fans are now turned ON.",
        response_phrase_hi="Dono classroom fans chalu kar diye gaye hain.",
    ),
    "FANS_ALL_OFF": ArduinoCommandSpec(
        device="fans",
        action="OFF",
        serial_command="fan1:OFF\nfan2:OFF",
        description="Turn OFF both classroom fans",
        response_phrase_en="All classroom fans are now turned OFF.",
        response_phrase_hi="Dono classroom fans band kar diye gaye hain.",
    ),

    # Water Pump (D11)
    "WATER_PUMP_ON": ArduinoCommandSpec(
        device="water_pump",
        action="ON",
        serial_command="pump:ON",
        description="Turn ON science model water pump",
        response_phrase_en="Water pump is now turned ON.",
        response_phrase_hi="Water pump chalu kar diya gaya hai.",
    ),
    "WATER_PUMP_OFF": ArduinoCommandSpec(
        device="water_pump",
        action="OFF",
        serial_command="pump:OFF",
        description="Turn OFF science model water pump",
        response_phrase_en="Water pump is now turned OFF.",
        response_phrase_hi="Water pump band kar diya gaya hai.",
    ),

    # Automatic School Gate (D9 Servo)
    "GATE_OPEN": ArduinoCommandSpec(
        device="gate",
        action="OPEN",
        serial_command="gate:OPEN",
        description="Open automatic school gate servo",
        response_phrase_en="The school gate is now OPEN.",
        response_phrase_hi="School gate khol diya gaya hai.",
    ),
    "GATE_CLOSE": ArduinoCommandSpec(
        device="gate",
        action="CLOSE",
        serial_command="gate:CLOSE",
        description="Close automatic school gate servo",
        response_phrase_en="The school gate is now CLOSED.",
        response_phrase_hi="School gate band kar diya gaya hai.",
    ),

    # School Bell / Buzzer (D6)
    "BUZZER_ON": ArduinoCommandSpec(
        device="buzzer",
        action="ON",
        serial_command="buzzer:ON",
        description="Sound the school bell / buzzer",
        response_phrase_en="The school buzzer is now ringing.",
        response_phrase_hi="School buzzer ring ho raha hai.",
    ),
    "BUZZER_OFF": ArduinoCommandSpec(
        device="buzzer",
        action="OFF",
        serial_command="buzzer:OFF",
        description="Stop the school bell / buzzer",
        response_phrase_en="The school buzzer has been stopped.",
        response_phrase_hi="School buzzer band kar diya gaya hai.",
    ),

    # Object Counter Reset (D7 IR Sensor)
    "COUNTER_RESET": ArduinoCommandSpec(
        device="counter",
        action="RESET",
        serial_command="counter:RESET",
        description="Reset visitor object counter",
        response_phrase_en="Visitor counter has been reset to zero.",
        response_phrase_hi="Object counter zero par reset ho gaya hai.",
    ),
}


class ArduinoCommandResult(BaseModel):
    success: bool
    device: str
    action: str
    serial_command: str
    spoken_response: str
    error: str | None = None
    is_clarification: bool = False


def match_arduino_intent(message: str) -> tuple[str | None, str | None, bool]:
    """
    Parse natural language message into (device, action, is_ambiguous).
    Supports English, Hindi, and Hinglish.
    Strictly avoids false matches for theoretical/definitional questions.
    """
    low = message.lower().strip()

    # Rule out theoretical questions like "what is arduino", "how does a light work", etc.
    if any(low.startswith(p) for p in ["what is", "explain", "kaise kaam", "kya hota", "define", "history"]):
        return None, None, False

    # Detect requested Action
    action = None
    if any(kw in low for kw in ["on", "chalu", "jala", "start", "open", "kholo", "khul", "ring", "bajao", "baja"]):
        if any(kw in low for kw in ["open", "kholo", "khul"]):
            action = "OPEN"
        elif any(kw in low for kw in ["ring", "bajao", "baja"]):
            action = "ON"
        else:
            action = "ON"
    elif any(kw in low for kw in ["off", "band", "bujhao", "stop", "close", "roko"]):
        if any(kw in low for kw in ["close"]):
            action = "CLOSE"
        elif any(kw in low for kw in ["stop", "roko"]):
            action = "OFF"
        else:
            action = "OFF"
    elif any(kw in low for kw in ["reset", "zero", "clear"]):
        action = "RESET"

    if not action:
        return None, None, False

    # Detect requested Device
    # 1. Lights
    if any(kw in low for kw in ["light", "roshni", "bulb", "classroom light"]):
        if "kitchen" in low or "bedroom" in low or "hall" in low:
            # Unconfigured device
            return "unknown_light", action, False
        return "classroom_light", action, False

    # 2. Specific Fans
    if any(kw in low for kw in ["fan 1", "fan1", "pankha 1", "motor 1", "motor1"]):
        return "fan_1", action, False
    if any(kw in low for kw in ["fan 2", "fan2", "pankha 2", "motor 2", "motor2"]):
        return "fan_2", action, False

    # 3. General Fans (Ambiguity / All Fans handling)
    if any(kw in low for kw in ["all fan", "both fan", "fans", "dono fan", "sab fan", "all fans", "dono pankhe"]):
        return "fans", action, False
    if any(kw in low for kw in ["fan", "pankha", "motor"]):
        # Ambiguous singular "fan on karo" -> ask clarification
        return "ambiguous_fan", action, True

    # 4. Water Pump
    if any(kw in low for kw in ["pump", "water", "pani", "water pump"]):
        return "water_pump", action, False

    # 5. School Gate
    if any(kw in low for kw in ["gate", "darwaza", "school gate"]):
        act = "OPEN" if action in ["ON", "OPEN"] else "CLOSE"
        return "gate", act, False

    # 6. Buzzer / Bell
    if any(kw in low for kw in ["buzzer", "bell", "ghanti", "alarm"]):
        return "buzzer", action, False

    # 7. Counter
    if any(kw in low for kw in ["counter", "count", "ginti", "visitor"]):
        return "counter", "RESET", False

    return None, None, False


def execute_arduino_command(device: str, action: str) -> ArduinoCommandResult:
    """
    Validate device and action against the whitelist registry and format serial output.
    """
    lookup_key = f"{device.upper()}_{action.upper()}"
    spec = ARDUINO_COMMAND_REGISTRY.get(lookup_key)

    if not spec:
        logger.warning(f"Rejected unwhitelisted Arduino command: {device} -> {action}")
        return ArduinoCommandResult(
            success=False,
            device=device,
            action=action,
            serial_command="",
            spoken_response="Sorry, that device command is not permitted or configured.",
            error="Command not found in safe whitelist registry.",
        )

    logger.info(f"Safe Arduino Command resolved: {lookup_key} -> serial: '{spec.serial_command}'")
    return ArduinoCommandResult(
        success=True,
        device=spec.device,
        action=spec.action,
        serial_command=spec.serial_command,
        spoken_response=spec.response_phrase_en,
        error=None,
    )
