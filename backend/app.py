from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pathlib import Path
from datetime import datetime
import json
import os
import re
import subprocess
import time
import webbrowser
import urllib.parse
import platform
import threading

try:
    from pynput import mouse as pynput_mouse, keyboard as pynput_keyboard
except Exception:
    pynput_mouse = None
    pynput_keyboard = None

from backend.config import HOST, PORT, DEBUG, ALLOWED_ORIGINS
from backend.tools.pc_control import match_pc_intent, execute_pc_control
from backend.tools.arduino_control import match_arduino_intent, execute_arduino_command

try:
    import pyautogui
except Exception:
    pyautogui = None

app = FastAPI(title="Ronit AI Basic Controller", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ROOT = Path(__file__).resolve().parent.parent
SKILLS_FILE = ROOT / "manual_skills.json"

# Prevent accidental double-clicks, voice re-entry, or overlapping TEST calls
# from launching the same PC workflow multiple times at once.
_workflow_lock = __import__("threading").Lock()
_workflow_last_run: dict[str, float] = {}
_WORKFLOW_COOLDOWN_SECONDS = 1.0

# Global PC recorder state. It lives only while the local backend is running.
_recorder_lock = threading.RLock()
_pc_recording = False
_pc_recorded_actions: list[dict] = []
_pc_recording_started = 0.0
_pc_last_event = 0.0
_pc_listeners_started = False
_pc_mouse_listener = None
_pc_keyboard_listener = None
_pc_pressed_modifiers: set[str] = set()


def _record_elapsed() -> float:
    now = time.monotonic()
    with _recorder_lock:
        return max(0.0, now - _pc_last_event) if _pc_last_event else 0.0


def _record_event(device: str, typ: str, value: str = "", label: str | None = None):
    global _pc_last_event
    with _recorder_lock:
        if not _pc_recording:
            return
        now = time.monotonic()
        delay = max(0.0, now - _pc_last_event) if _pc_last_event else 0.0
        # Ignore ultra-fast duplicate notifications from the OS.
        if delay < 0.005 and _pc_recorded_actions:
            delay = 0.0
        item = {"device": device, "type": typ, "value": str(value or ""), "delay": round(delay, 3)}
        if label:
            item["label"] = label
        _pc_recorded_actions.append(item)
        _pc_last_event = now


def _normal_key(key) -> str:
    try:
        if hasattr(key, "char") and key.char:
            return key.char
    except Exception:
        pass
    name = str(key).replace("Key.", "").lower()
    aliases = {
        "esc":"escape", "return":"enter", "space":"space", "backspace":"backspace",
        "delete":"delete", "tab":"tab", "shift":"shift", "shift_l":"shift", "shift_r":"shift",
        "ctrl":"ctrl", "ctrl_l":"ctrl", "ctrl_r":"ctrl", "alt":"alt", "alt_l":"alt", "alt_r":"alt",
        "cmd":"win", "cmd_l":"win", "cmd_r":"win", "page_up":"pageup", "page_down":"pagedown",
    }
    return aliases.get(name, name)


def _on_record_mouse_click(x, y, button, pressed):
    if not pressed:
        return
    b = str(button).split(".")[-1].lower()
    typ = {"left":"left_click", "right":"right_click", "middle":"middle_click"}.get(b, "left_click")
    _record_event("pc", typ, f"{int(x)},{int(y)}", f"{typ.replace('_',' ').title()} → {int(x)},{int(y)}")


def _on_record_mouse_scroll(x, y, dx, dy):
    typ = "scroll_up" if dy > 0 else "scroll_down"
    _record_event("pc", typ, f"{int(x)},{int(y)}", f"{typ.replace('_',' ').title()} → {int(x)},{int(y)}")


def _on_record_key_press(key):
    name = _normal_key(key)
    with _recorder_lock:
        if not _pc_recording:
            return
        if name in {"ctrl", "alt", "shift", "win"}:
            _pc_pressed_modifiers.add(name)
            return
        mods = sorted(_pc_pressed_modifiers)
    if mods:
        _record_event("pc", "hotkey", "+".join(mods + [name]), f"Hotkey → {'+'.join(mods + [name])}")
    elif len(name) == 1 and name.isprintable():
        _record_event("pc", "press_key", name, f"Press Key → {name}")
    else:
        _record_event("pc", "press_key", name, f"Press Key → {name}")


def _on_record_key_release(key):
    name = _normal_key(key)
    if name in {"ctrl", "alt", "shift", "win"}:
        with _recorder_lock:
            _pc_pressed_modifiers.discard(name)


def _ensure_record_listeners():
    global _pc_listeners_started, _pc_mouse_listener, _pc_keyboard_listener
    with _recorder_lock:
        if _pc_listeners_started:
            return True
        if pynput_mouse is None or pynput_keyboard is None:
            return False
        try:
            _pc_mouse_listener = pynput_mouse.Listener(on_click=_on_record_mouse_click, on_scroll=_on_record_mouse_scroll)
            _pc_keyboard_listener = pynput_keyboard.Listener(on_press=_on_record_key_press, on_release=_on_record_key_release)
            _pc_mouse_listener.daemon = True
            _pc_keyboard_listener.daemon = True
            _pc_mouse_listener.start()
            _pc_keyboard_listener.start()
            _pc_listeners_started = True
            return True
        except Exception:
            _pc_mouse_listener = None
            _pc_keyboard_listener = None
            return False


class Action(BaseModel):
    device: str
    type: str
    value: str = ""


class Skill(BaseModel):
    id: str | None = None
    name: str = Field(..., min_length=1, max_length=120)
    trigger: str = Field(..., min_length=1, max_length=500)
    enabled: bool = True
    actions: list[Action] = Field(default_factory=list)
    # Backward compatibility with the old project format.
    steps: list[str] = Field(default_factory=list)


class SkillPatch(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    trigger: str = Field(..., min_length=1, max_length=500)
    enabled: bool = True
    actions: list[Action] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


def norm(value: str) -> str:
    value = str(value or "").lower()
    value = re.sub(r"[^\w\u0900-\u097f ]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def load() -> list[dict]:
    try:
        data = json.loads(SKILLS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save(data: list[dict]) -> None:
    SKILLS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def skill_actions(item: dict) -> list[dict]:
    actions = item.get("actions")
    if isinstance(actions, list) and actions:
        return actions
    # Migrate old string-only workflows on read.
    return [command_to_action(step) for step in item.get("steps", []) if str(step).strip()]


def command_to_action(command: str) -> dict:
    """Best-effort migration of the project's previous string-step format."""
    low = str(command).strip().lower()
    if low.startswith("open "):
        return {"device": "pc", "type": "open_app", "value": low[5:].strip()}
    if low.startswith("search for "):
        return {"device": "browser", "type": "open_url", "value": "https://www.google.com/search?q=" + urllib.parse.quote_plus(low[11:].strip())}
    if low.startswith("phone type "):
        return {"device": "android", "type": "type_text", "value": command[11:].strip()}
    if low == "phone back":
        return {"device": "android", "type": "back", "value": ""}
    if low == "phone home":
        return {"device": "android", "type": "home", "value": ""}
    return {"device": "command", "type": "natural_command", "value": command}


def adb(args: list[str]) -> tuple[bool, str]:
    try:
        p = subprocess.run(["adb", *args], capture_output=True, text=True, timeout=8, shell=False)
        return p.returncode == 0, (p.stdout.strip() or p.stderr.strip())
    except Exception as exc:
        return False, str(exc)


def android_action(action: dict) -> dict:
    typ = str(action.get("type", "")).lower()
    value = str(action.get("value", ""))
    if typ == "wait":
        time.sleep(max(0.0, min(float(value or 1), 60.0)))
        return {"success": True, "response": "Wait complete.", "kind": "android"}
    if typ in {"home", "press_home"}:
        ok, out = adb(["shell", "input", "keyevent", "3"])
        return {"success": ok, "response": "Phone Home pressed." if ok else out, "kind": "android"}
    if typ in {"back", "press_back"}:
        ok, out = adb(["shell", "input", "keyevent", "4"])
        return {"success": ok, "response": "Phone Back pressed." if ok else out, "kind": "android"}
    if typ == "type_text":
        safe = value.replace(" ", "%s")
        ok, out = adb(["shell", "input", "text", safe])
        return {"success": ok, "response": "Text entered on phone." if ok else out, "kind": "android"}
    if typ == "press_key":
        keymap = {"enter": "66", "tab": "61", "escape": "111", "back": "4", "home": "3"}
        key = keymap.get(value.lower(), value.upper())
        ok, out = adb(["shell", "input", "keyevent", key])
        return {"success": ok, "response": "Phone key pressed." if ok else out, "kind": "android"}
    if typ == "tap":
        parts = re.split(r"\s*[, ]\s*", value.strip())
        if len(parts) != 2 or not all(p.isdigit() for p in parts):
            return {"success": False, "response": "Tap ke liye x,y coordinates chahiye.", "kind": "android"}
        ok, out = adb(["shell", "input", "tap", parts[0], parts[1]])
        return {"success": ok, "response": "Phone tapped." if ok else out, "kind": "android"}
    if typ == "swipe":
        parts = value.replace(",", " ").split()
        if len(parts) not in (4, 5) or not all(p.isdigit() for p in parts):
            return {"success": False, "response": "Swipe ke liye x1,y1,x2,y2[,duration] chahiye.", "kind": "android"}
        if len(parts) == 4:
            parts.append("300")
        ok, out = adb(["shell", "input", "swipe", *parts])
        return {"success": ok, "response": "Phone swipe complete." if ok else out, "kind": "android"}
    if typ == "open_app":
        packages = {
            "youtube": "com.google.android.youtube",
            "chrome": "com.android.chrome",
            "calculator": "com.google.android.calculator",
            "maps": "com.google.android.apps.maps",
        }
        pkg = packages.get(value.lower().strip())
        if not pkg:
            return {"success": False, "response": "Ye Android app configured whitelist me nahi hai.", "kind": "android"}
        ok, out = adb(["shell", "monkey", "-p", pkg, "1"])
        return {"success": ok, "response": f"{value} phone par open kar diya." if ok else out, "kind": "android"}
    if typ == "wait":
        return {"success": True, "response": "Wait complete.", "kind": "android"}
    return {"success": False, "response": f"Android action '{typ}' configured nahi hai.", "kind": "android"}


def browser_action(action: dict) -> dict:
    typ = str(action.get("type", "")).lower()
    value = str(action.get("value", "")).strip()
    if typ in {"open_website", "open_url"}:
        website_aliases = {"youtube":"https://www.youtube.com", "google":"https://www.google.com", "github":"https://www.github.com", "chatgpt":"https://chatgpt.com", "wikipedia":"https://www.wikipedia.org", "arduino":"https://www.arduino.cc"}
        value = website_aliases.get(value.lower(), value)
        if not value:
            return {"success": False, "response": "Website/URL missing hai.", "kind": "browser"}
        url = value if re.match(r"^https?://", value, re.I) else "https://" + value

        # Workflow browser actions are meant to operate on the browser that the
        # user is already controlling.  Using Ctrl+L + typing + Enter is important
        # here: os.startfile()/webbrowser.open_new_tab() can launch a separate
        # window and does not reliably navigate the newly-created tab.
        if pyautogui is not None:
            try:
                time.sleep(0.15)
                pyautogui.hotkey("ctrl", "l")
                time.sleep(0.05)
                pyautogui.write(url, interval=0.005)
                pyautogui.press("enter")
                return {"success": True, "response": f"Website open kar di: {url}", "kind": "browser"}
            except Exception as exc:
                print(f"[Browser] Keyboard URL navigation failed: {exc}")

        # Fallback only when pyautogui is unavailable.
        launched = False
        try:
            if os.name == "nt":
                os.startfile(url)
                launched = True
            elif platform.system() == "Darwin":
                subprocess.Popen(["open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                launched = True
            else:
                subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                launched = True
        except Exception as exc:
            print(f"[Browser] OS URL launch failed: {exc}")
            try:
                launched = bool(webbrowser.open_new_tab(url))
            except Exception as exc2:
                print(f"[Browser] webbrowser fallback failed: {exc2}")
                launched = False
        return {"success": launched, "response": f"Website open kar di: {url}" if launched else "URL open nahi ho saka. Browser control dependency available nahi hai.", "kind": "browser"}
    if pyautogui is None:
        return {"success": False, "response": "Browser keyboard controls ke liye pyautogui dependency missing hai.", "kind": "browser"}
    keys = {"new_tab": ("ctrl", "t"), "close_tab": ("ctrl", "w"), "refresh": ("ctrl", "r"), "back": ("alt", "left"), "forward": ("alt", "right")}
    combo = keys.get(typ)
    if not combo:
        return {"success": False, "response": f"Browser action '{typ}' configured nahi hai.", "kind": "browser"}
    pyautogui.hotkey(*combo)
    return {"success": True, "response": f"Browser {typ.replace('_', ' ')} complete.", "kind": "browser"}


def pc_structured_action(action: dict) -> dict:
    typ = str(action.get("type", "")).lower()
    value = str(action.get("value", ""))
    if typ == "wait":
        try:
            time.sleep(max(0.0, min(float(value or 1), 60.0)))
            return {"success": True, "response": "Wait complete.", "kind": "pc"}
        except ValueError:
            return {"success": False, "response": "Wait value seconds me hona chahiye.", "kind": "pc"}

    # Structured workflow actions must be executed directly. Do NOT send
    # open_file/open_folder through match_pc_intent(), because a Windows path
    # can contain words such as "Videos" and the natural-language matcher can
    # incorrectly classify it as an application/folder command.
    if typ == "open_file":
        raw = value.strip().strip('"')
        p = Path(raw).expanduser()
        try:
            p = p.resolve()
        except Exception:
            pass
        home = Path.home().resolve()
        if home != p and home not in p.parents:
            return {"success": False, "response": "File path user folder ke andar hona chahiye.", "kind": "pc"}
        if not p.exists():
            return {"success": False, "response": f"File nahi mili: {p}", "kind": "pc"}
        if not p.is_file():
            return {"success": False, "response": "Diya gaya path file nahi hai.", "kind": "pc"}
        try:
            if platform.system() == "Windows":
                os.startfile(str(p))
            elif platform.system() == "Darwin":
                subprocess.Popen(["open", str(p)])
            else:
                subprocess.Popen(["xdg-open", str(p)])
            return {"success": True, "response": f"File open kar di: {p.name}", "kind": "pc"}
        except Exception as exc:
            return {"success": False, "response": f"File open nahi ho saki: {exc}", "kind": "pc"}

    if typ == "open_folder":
        raw = value.strip().strip('"')
        folder_aliases = {"downloads":"Downloads", "documents":"Documents", "desktop":"Desktop",
                          "pictures":"Pictures", "videos":"Videos", "music":"Music"}
        if raw.lower() in folder_aliases:
            folder_path = Path.home() / folder_aliases[raw.lower()]
        else:
            folder_path = Path(raw).expanduser()
            try:
                folder_path = folder_path.resolve()
            except Exception:
                pass
        home = Path.home().resolve()
        if home != folder_path and home not in folder_path.parents:
            return {"success": False, "response": "Folder path user folder ke andar hona chahiye.", "kind": "pc"}
        if not folder_path.exists() or not folder_path.is_dir():
            return {"success": False, "response": f"Folder nahi mila: {folder_path}", "kind": "pc"}
        try:
            if platform.system() == "Windows":
                os.startfile(str(folder_path))
            elif platform.system() == "Darwin":
                subprocess.Popen(["open", str(folder_path)])
            else:
                subprocess.Popen(["xdg-open", str(folder_path)])
            return {"success": True, "response": f"Folder open kar diya: {folder_path.name}", "kind": "pc"}
        except Exception as exc:
            return {"success": False, "response": f"Folder open nahi ho saka: {exc}", "kind": "pc"}

    command_map = {
        "open_app": f"open {value}",
        "close_app": f"close {value}",
        "volume_up": "volume up",
        "volume_down": "volume down",
        "media_play_pause": "media play pause",
    }
    if typ in command_map:
        parsed = match_pc_intent(command_map[typ])
        if parsed[0] is None:
            # close_app/open_file are implemented below because the old matcher does not expose them.
            if typ == "close_app":
                aliases = {"chrome":"chrome.exe","google chrome":"chrome.exe","edge":"msedge.exe","microsoft edge":"msedge.exe","vscode":"code.exe","vs code":"code.exe","notepad":"notepad.exe","calculator":"calc.exe","calc":"calc.exe","paint":"mspaint.exe"}
                allowed = set(aliases.values())
                exe = aliases.get(value.lower().strip(), value.lower().strip())
                if exe not in allowed and f"{exe}.exe" not in allowed:
                    return {"success": False, "response": "Sirf approved applications close ki ja sakti hain.", "kind": "pc"}
                exe = exe if exe.endswith(".exe") else exe + ".exe"
                try:
                    r = subprocess.run(["taskkill", "/IM", exe, "/F"], capture_output=True, text=True, timeout=8)
                    return {"success": r.returncode == 0, "response": "Application close kar di." if r.returncode == 0 else (r.stderr.strip() or "Application close nahi ho saki."), "kind": "pc"}
                except Exception as exc:
                    return {"success": False, "response": str(exc), "kind": "pc"}
            if typ == "open_file":
                p = Path(value).expanduser().resolve()
                home = Path.home().resolve()
                if home not in p.parents or not p.exists() or not p.is_file():
                    return {"success": False, "response": "Sirf existing user-home files open ki ja sakti hain.", "kind": "pc"}
                try:
                    if platform.system() == "Windows": os.startfile(str(p))
                    elif platform.system() == "Darwin": subprocess.Popen(["open", str(p)])
                    else: subprocess.Popen(["xdg-open", str(p)])
                    return {"success": True, "response": "File open kar di.", "kind": "pc"}
                except Exception as exc:
                    return {"success": False, "response": str(exc), "kind": "pc"}
            if typ == "open_folder":
                folder = value.lower().strip() or "downloads"
                allowed = {"downloads", "documents", "desktop", "pictures", "videos", "music"}
                if folder not in allowed:
                    return {"success": False, "response": "Sirf approved user folders open kiye ja sakte hain.", "kind": "pc"}
                folder_map = {"downloads":"Downloads","documents":"Documents","desktop":"Desktop","pictures":"Pictures","videos":"Videos","music":"Music"}
                folder_path = Path.home() / folder_map[folder]
                if not folder_path.exists():
                    return {"success": False, "response": "Requested folder available nahi hai.", "kind": "pc"}
                try:
                    if platform.system() == "Windows": os.startfile(str(folder_path))
                    elif platform.system() == "Darwin": subprocess.Popen(["open", str(folder_path)])
                    else: subprocess.Popen(["xdg-open", str(folder_path)])
                    return {"success": True, "response": f"{folder.capitalize()} folder open kar diya.", "kind": "pc"}
                except Exception as exc:
                    return {"success": False, "response": str(exc), "kind": "pc"}
            return {"success": False, "response": f"PC action '{typ}' configured nahi hai.", "kind": "pc"}
        result = execute_pc_control(*parsed[:2])
        return {"success": result.success, "response": result.spoken_response, "kind": "pc", "action": result.action, "target": result.target}

    if pyautogui is None:
        return {"success": False, "response": "Keyboard/mouse actions ke liye pyautogui install karna zaroori hai.", "kind": "pc"}
    try:
        # Keyboard actions are deliberately handled directly here. Do not route
        # them through the natural-language parser: text such as "open notepad"
        # can otherwise be interpreted as a new PC command.
        if typ == "type_text":
            if not value:
                return {"success": False, "response": "Type Text ke liye text dena zaroori hai.", "kind": "pc"}
            # Give a just-launched application a moment to receive focus.
            time.sleep(0.35)
            pyautogui.write(value, interval=0.02)
            return {"success": True, "response": "Text type kar diya.", "kind": "pc"}

        if typ in {"enter", "tab", "escape", "copy", "paste"}:
            key = {"enter": "enter", "tab": "tab", "escape": "esc", "copy": ("ctrl", "c"), "paste": ("ctrl", "v")}
            action_key = key[typ]
            if isinstance(action_key, tuple):
                pyautogui.hotkey(*action_key)
            else:
                pyautogui.press(action_key)
            return {"success": True, "response": f"{typ.replace('_', ' ').title()} complete.", "kind": "pc"}

        if typ == "press_key":
            key_name = value.strip().lower()
            aliases = {
                "return": "enter", "esc": "esc", "escape": "esc", "spacebar": "space",
                "pgup": "pageup", "pgdn": "pagedown", "del": "delete", "ins": "insert",
                "left arrow": "left", "right arrow": "right", "up arrow": "up", "down arrow": "down",
            }
            key_name = aliases.get(key_name, key_name)
            valid_keys = set(pyautogui.KEYBOARD_KEYS)
            if key_name not in valid_keys:
                return {"success": False, "response": f"Press Key '{value}' valid keyboard key nahi hai.", "kind": "pc"}
            pyautogui.press(key_name)
            return {"success": True, "response": f"{key_name} key press kar di.", "kind": "pc"}

        if typ == "hotkey":
            keys = [k.strip().lower() for k in re.split(r"[+, ]+", value) if k.strip()]
            if not keys:
                return {"success": False, "response": "Hotkey missing hai.", "kind": "pc"}
            valid_keys = set(pyautogui.KEYBOARD_KEYS)
            invalid = [k for k in keys if k not in valid_keys]
            if invalid:
                return {"success": False, "response": f"Invalid hotkey key: {', '.join(invalid)}", "kind": "pc"}
            pyautogui.hotkey(*keys)
            return {"success": True, "response": "Hotkey complete.", "kind": "pc"}

        if typ == "move_mouse":
            parts = [v.strip() for v in value.replace(" ", ",").split(",") if v.strip()]
            if len(parts) != 2:
                return {"success": False, "response": "Move Mouse ke liye x,y coordinates chahiye.", "kind": "pc"}
            x, y = int(parts[0]), int(parts[1])
            pyautogui.moveTo(x, y, duration=0.15)
            return {"success": True, "response": "Mouse move kar diya.", "kind": "pc"}

        if typ in {"left_click", "right_click", "double_click"}:
            # Recorded clicks carry their exact screen coordinates. Manual clicks
            # without a value still use the current cursor location.
            if value.strip():
                parts = [v.strip() for v in value.replace(" ", ",").split(",") if v.strip()]
                if len(parts) == 2:
                    pyautogui.moveTo(int(parts[0]), int(parts[1]), duration=0.08)
            pyautogui.click(button="right" if typ == "right_click" else "left", clicks=2 if typ == "double_click" else 1, interval=0.08)
            return {"success": True, "response": f"{typ.replace('_', ' ').title()} complete.", "kind": "pc"}

        if typ in {"scroll_up", "scroll_down"}:
            if value.strip():
                parts = [v.strip() for v in value.replace(" ", ",").split(",") if v.strip()]
                if len(parts) == 2:
                    pyautogui.moveTo(int(parts[0]), int(parts[1]), duration=0.05)
            pyautogui.scroll(5 if typ == "scroll_up" else -5)
            return {"success": True, "response": f"{typ.replace('_', ' ').title()} complete.", "kind": "pc"}

        return {"success": False, "response": f"PC action '{typ}' configured nahi hai.", "kind": "pc"}
    except Exception as exc:
        return {"success": False, "response": f"PC action failed: {exc}", "kind": "pc"}


def arduino_structured_action(action: dict) -> dict:
    typ = str(action.get("type", "")).lower()
    value = str(action.get("value", ""))
    mapping = {
        "digital_on": (value or "light", "ON"),
        "digital_off": (value or "light", "OFF"),
        "motor_on": (value or "fan1", "ON"),
        "motor_off": (value or "fan1", "OFF"),
        "servo_angle": ("servo", value),
        "read_sensor": ("sensor", "READ"),
    }
    if typ in mapping:
        device, act = mapping[typ]
        if typ == "servo_angle":
            try:
                angle = int(value)
                if not 0 <= angle <= 180: raise ValueError
            except ValueError:
                return {"success": False, "response": "Servo angle 0 se 180 ke beech hona chahiye.", "kind": "arduino"}
            return {"success": True, "response": "Servo angle command ready hai.", "kind": "arduino", "serial_command": f"servo:{angle}"}
        if typ == "read_sensor":
            return {"success": True, "response": "Sensor read command ready hai.", "kind": "arduino", "serial_command": "sensor:read"}
        allowed = {"light", "fan1", "fan2", "buzzer", "pump"}
        if device not in allowed:
            return {"success": False, "response": "Arduino device configured nahi hai.", "kind": "arduino"}
        serial = f"{device}:{act}"
        return {"success": True, "response": f"Arduino {device} {act} command ready hai.", "kind": "arduino", "serial_command": serial}
    device_map = {
        "light_on": ("classroom_light", "ON"), "light_off": ("classroom_light", "OFF"),
        "fan1_on": ("fan_1", "ON"), "fan1_off": ("fan_1", "OFF"),
        "fan2_on": ("fan_2", "ON"), "fan2_off": ("fan_2", "OFF"),
        "gate_open": ("gate", "OPEN"), "gate_close": ("gate", "CLOSE"),
        "buzzer_on": ("buzzer", "ON"), "buzzer_off": ("buzzer", "OFF"),
        "pump_on": ("water_pump", "ON"), "pump_off": ("water_pump", "OFF"),
        "counter_reset": ("counter", "RESET"),
    }
    if typ in device_map:
        result = execute_arduino_command(*device_map[typ])
        return {"success": result.success, "response": result.spoken_response, "kind": "arduino", "serial_command": result.serial_command, "device": result.device, "action": result.action}
    return {"success": False, "response": f"Arduino action '{typ}' configured nahi hai.", "kind": "arduino"}


def execute_action(action: dict) -> dict:
    device = str(action.get("device", "")).lower()
    if device == "pc": return pc_structured_action(action)
    if device == "browser": return browser_action(action)
    if device == "android": return android_action(action)
    if device == "arduino": return arduino_structured_action(action)
    if device == "command":
        return execute_step(str(action.get("value", "")))
    return {"success": False, "response": f"Unknown workflow device: {device}", "kind": "unknown"}


def execute_step(step: str) -> dict:
    low = str(step).lower().strip()
    if low.startswith("wait "):
        try: time.sleep(float(low.split(" ", 1)[1])); return {"success": True, "response": "Wait complete.", "kind": "pc"}
        except Exception: return {"success": False, "response": "Wait value invalid.", "kind": "pc"}
    dev, act, amb = match_arduino_intent(step)
    if dev or amb:
        if amb: return {"success": False, "response": "Arduino command clear nahi hai.", "kind": "clarify"}
        result = execute_arduino_command(dev, act)
        return {"success": result.success, "response": result.spoken_response, "kind": "arduino", "serial_command": result.serial_command, "device": result.device, "action": result.action}
    pa, pt, pamb = match_pc_intent(step)
    if pa or pamb:
        if pamb: return {"success": False, "response": "PC command clear nahi hai.", "kind": "clarify"}
        result = execute_pc_control(pa, pt)
        return {"success": result.success, "response": result.spoken_response, "kind": "pc", "action": result.action, "target": result.target}
    return {"success": False, "response": f"Is step ko abhi nahi samajh paya: {step}", "kind": "unknown"}


def run_skill(item: dict) -> dict:
    if not item.get("enabled", True):
        return {"success": False, "response": "Ye workflow disabled hai.", "intent": "WORKFLOW_DISABLED", "steps": []}
    results = [execute_action(a) for a in skill_actions(item)]
    serial = "\n".join(r.get("serial_command", "") for r in results if r.get("serial_command"))
    return {
        "success": bool(results) and all(r.get("success", False) for r in results),
        "message": item.get("trigger", ""),
        "response": " ".join(r.get("response", "") for r in results),
        "intent": "LEARNED_SKILL",
        "tool_used": "workflow_manager",
        "serial_command": serial,
        "is_arduino_command": any(r.get("kind") == "arduino" for r in results),
        "is_pc_command": any(r.get("kind") == "pc" for r in results),
        "is_android_command": any(r.get("kind") == "android" for r in results),
        "steps": results,
    }


def run_message(message: str) -> dict:
    n = norm(message)
    for item in load():
        if not item.get("enabled", True):
            continue
        trigger = norm(item.get("trigger", ""))
        if trigger and (n == trigger or trigger in n):
            return run_skill(item)
    result = execute_step(message)
    if result.get("kind") != "unknown":
        return {
            "success": result.get("success", False),
            "message": message,
            "response": result.get("response", ""),
            "intent": result.get("kind", "COMMAND").upper(),
            "tool_used": "basic_manual_controller",
            "serial_command": result.get("serial_command", ""),
            "is_arduino_command": result.get("kind") == "arduino",
            "is_pc_command": result.get("kind") == "pc",
            "is_android_command": result.get("kind") == "android",
        }
    return {"success": False, "message": message, "response": "Ye kaam abhi mujhe sikhaya nahi gaya hai. AI Customize Mode mein workflow bana sakte ho.", "intent": "UNKNOWN_COMMAND", "tool_used": "manual_only"}


@app.get("/health")
def health():
    return {"status": "ok", "service": "Ronit AI Basic Controller", "external_ai": False, "api_key_configured": False}


@app.get("/api/ai/status")
def status():
    return health()


@app.get("/api/adb/status")
def adb_status():
    ok, out = adb(["devices"])
    devices = []
    if ok:
        for line in out.splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 2 and parts[1] == "device": devices.append(parts[0])
    return {"success": True, "adb_available": ok, "connected": bool(devices), "devices": devices, "message": "Android phone connected via ADB." if devices else "Android phone not detected. USB debugging + ADB required."}


@app.post("/api/chat")
def chat(payload: ChatRequest):
    return run_message(payload.message.strip())


@app.get("/api/recorder/status")
def recorder_status():
    with _recorder_lock:
        return {"success": True, "available": pynput_mouse is not None and pynput_keyboard is not None, "recording": _pc_recording, "count": len(_pc_recorded_actions)}


@app.get("/api/recorder/mouse-position")
def recorder_mouse_position():
    if pyautogui is None:
        return {"success": False, "response": "PyAutoGUI available nahi hai."}
    try:
        x, y = pyautogui.position()
        return {"success": True, "x": int(x), "y": int(y)}
    except Exception as exc:
        return {"success": False, "response": str(exc)}


@app.post("/api/recorder/start")
def recorder_start():
    global _pc_recording, _pc_recorded_actions, _pc_recording_started, _pc_last_event, _pc_pressed_modifiers
    if not _ensure_record_listeners():
        return {"success": False, "response": "PC recorder ke liye 'pynput' install nahi hai ya listener start nahi hua."}
    with _recorder_lock:
        _pc_recorded_actions = []
        _pc_pressed_modifiers = set()
        _pc_recording = True
        _pc_recording_started = time.monotonic()
        _pc_last_event = _pc_recording_started
    return {"success": True, "recording": True, "count": 0}


@app.post("/api/recorder/stop")
def recorder_stop():
    global _pc_recording, _pc_pressed_modifiers
    with _recorder_lock:
        _pc_recording = False
        _pc_pressed_modifiers = set()
        actions = [dict(a) for a in _pc_recorded_actions]
    # Drop an accidental click on the STOP button itself if it is the final event.
    if actions and actions[-1].get("type") in {"left_click", "right_click", "middle_click"}:
        actions.pop()
    # Turn delays into explicit wait actions so replay timing is deterministic.
    final_actions = []
    for a in actions:
        delay = float(a.pop("delay", 0) or 0)
        if delay >= 0.15:
            final_actions.append({"device":"pc", "type":"wait", "value":str(round(min(delay, 60), 2))})
        final_actions.append({k:v for k,v in a.items() if k in {"device","type","value"}})
    return {"success": True, "recording": False, "count": len(final_actions), "actions": final_actions}


@app.post("/api/recorder/cancel")
def recorder_cancel():
    global _pc_recording, _pc_recorded_actions, _pc_pressed_modifiers
    with _recorder_lock:
        _pc_recording = False
        _pc_recorded_actions = []
        _pc_pressed_modifiers = set()
    return {"success": True, "recording": False, "count": 0, "actions": []}


@app.get("/api/skills")
def skills():
    data = load()
    for item in data:
        item["actions"] = skill_actions(item)
        item["steps"] = [a.get("value", "") for a in item["actions"]]
        item.setdefault("enabled", True)
    return {"success": True, "data": data}


@app.post("/api/skills")
def create_skill(skill: Skill):
    actions = [a.model_dump() for a in skill.actions] if skill.actions else [command_to_action(s) for s in skill.steps if s.strip()]
    if not actions:
        raise HTTPException(400, "At least one workflow action is required")
    item = {
        "id": skill.id or os.urandom(5).hex(),
        "name": skill.name.strip(),
        "trigger": skill.trigger.strip(),
        "enabled": skill.enabled,
        "actions": actions,
        "steps": [a.get("value", "") for a in actions],
        "createdAt": datetime.now().isoformat(),
        "updatedAt": datetime.now().isoformat(),
    }
    data = [x for x in load() if norm(x.get("trigger", "")) != norm(item["trigger"])]
    data.insert(0, item)
    save(data)
    return {"success": True, "data": item}


@app.put("/api/skills/{sid}")
def update_skill(sid: str, skill: SkillPatch):
    data = load()
    for item in data:
        if item.get("id") == sid:
            actions = [a.model_dump() for a in skill.actions] if skill.actions else [command_to_action(s) for s in skill.steps if s.strip()]
            if not actions: raise HTTPException(400, "At least one workflow action is required")
            item.update({"name": skill.name.strip(), "trigger": skill.trigger.strip(), "enabled": skill.enabled, "actions": actions, "steps": [a.get("value", "") for a in actions], "updatedAt": datetime.now().isoformat()})
            save(data)
            return {"success": True, "data": item}
    raise HTTPException(404, "Workflow not found")


@app.delete("/api/skills/{sid}")
def delete_skill(sid: str):
    data = load()
    new_data = [x for x in data if x.get("id") != sid]
    if len(new_data) == len(data): raise HTTPException(404, "Workflow not found")
    save(new_data)
    return {"success": True}


@app.post("/api/skills/{sid}/toggle")
def toggle_skill(sid: str):
    data = load()
    for item in data:
        if item.get("id") == sid:
            item["enabled"] = not item.get("enabled", True)
            item["updatedAt"] = datetime.now().isoformat()
            save(data)
            return {"success": True, "data": item}
    raise HTTPException(404, "Workflow not found")


@app.post("/api/skills/{sid}/run")
def run_saved_skill(sid: str):
    item = next((x for x in load() if x.get("id") == sid), None)
    if not item:
        raise HTTPException(404, "Workflow not found")
    if not item.get("enabled", True):
        return {"success": False, "response": "Ye workflow disabled hai.", "intent": "WORKFLOW_DISABLED", "steps": []}

    # A rapid second request can come from a double-click, voice re-entry, or
    # browser event duplication. Never execute the same workflow concurrently.
    now = time.monotonic()
    with _workflow_lock:
        last = _workflow_last_run.get(sid, 0.0)
        if now - last < _WORKFLOW_COOLDOWN_SECONDS:
            return {"success": False, "response": "Workflow abhi execute ho raha hai. Ek second baad dobara try karein.", "intent": "WORKFLOW_BUSY", "steps": []}
        _workflow_last_run[sid] = now
        try:
            return run_skill(item)
        finally:
            # Keep a short cooldown so duplicate browser/voice events cannot
            # immediately launch Notepad or another application again.
            _workflow_last_run[sid] = time.monotonic()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app:app", host=HOST, port=PORT, reload=DEBUG)
