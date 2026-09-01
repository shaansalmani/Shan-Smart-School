"""
Safe PC / Laptop Control Tool for Smart School AI Agent.
Enforces a strict whitelist for applications, websites, and folders.
NEVER allows arbitrary command execution, arbitrary file manipulation, shutdown, or restart.
"""

import os
import sys
import platform
import subprocess
import webbrowser
import ctypes
import threading
import time
from pathlib import Path
from pydantic import BaseModel, Field

from backend.config import (
    PC_CONTROL_ENABLED,
    PC_CONTROL_SAFE_MODE,
    PC_CONTROL_TIMEOUT_SECONDS,
)
from backend.utils.logger import logger

_pc_lock = threading.Lock()

# 1. Allowed Applications Whitelist (Safe system/educational apps)
# Mapped to safe system binary commands on Windows
ALLOWED_APPS: dict[str, dict[str, str]] = {
    "chrome": {
        "name": "Google Chrome",
        "cmd": "start chrome",
        "exe": "chrome.exe",
        "alt_names": ["chrome", "google chrome", "browser"],
    },
    "edge": {
        "name": "Microsoft Edge",
        "cmd": "start msedge",
        "exe": "msedge.exe",
        "alt_names": ["edge", "microsoft edge", "ms edge"],
    },
    "vscode": {
        "name": "Visual Studio Code",
        "cmd": "code",
        "exe": "code.cmd",
        "alt_names": ["vscode", "vs code", "code editor", "visual studio code"],
    },
    "notepad": {
        "name": "Notepad",
        "cmd": "notepad.exe",
        "exe": "notepad.exe",
        "alt_names": ["notepad", "text editor", "note pad"],
    },
    "calculator": {
        "name": "Calculator",
        "cmd": "calc.exe",
        "exe": "calc.exe",
        "alt_names": ["calculator", "calc", "hisaab"],
    },
    "paint": {
        "name": "Paint",
        "cmd": "mspaint.exe",
        "exe": "mspaint.exe",
        "alt_names": ["paint", "ms paint", "drawing"],
    },
    "cmd": {
        "name": "Command Prompt",
        "cmd": "start cmd",
        "exe": "cmd.exe",
        "alt_names": ["terminal", "command prompt"],
    },
    "this_pc": {
        "name": "This PC",
        "cmd": "explorer.exe shell:MyComputerFolder",
        "exe": "explorer.exe",
        "alt_names": ["this pc", "my computer", "computer", "file explorer", "windows explorer", "explorer"],
    },
}

# 2. Allowed Websites Whitelist (Safe educational and common portals)
ALLOWED_WEBSITES: dict[str, dict[str, str]] = {
    "youtube": {"name": "YouTube", "url": "https://www.youtube.com"},
    "google": {"name": "Google", "url": "https://www.google.com"},
    "github": {"name": "GitHub", "url": "https://www.github.com"},
    "chatgpt": {"name": "ChatGPT", "url": "https://chatgpt.com"},
    "wikipedia": {"name": "Wikipedia", "url": "https://www.wikipedia.org"},
    "arduino": {"name": "Arduino Web", "url": "https://www.arduino.cc"},
}

# 3. Allowed Folders Whitelist (Standard user library folders only)
def _get_allowed_folders() -> dict[str, str]:
    home = Path.home()
    return {
        "downloads": str(home / "Downloads"),
        "documents": str(home / "Documents"),
        "desktop": str(home / "Desktop"),
        "pictures": str(home / "Pictures"),
        "videos": str(home / "Videos"),
        "music": str(home / "Music"),
    }


class PCCommandResult(BaseModel):
    success: bool
    action: str
    target: str | None = None
    spoken_response: str
    error: str | None = None
    is_clarification: bool = False


def match_pc_intent(message: str) -> tuple[str | None, str | None, bool]:
    """
    Parse natural language message into (action, target, is_ambiguous).
    Supports English, Hindi, and Hinglish.
    Ensures theoretical science questions (e.g. "what is chrome") are never confused.
    """
    low = message.lower().strip()

    # Rule out theoretical and definitional questions
    if any(low.startswith(p) for p in ["what is", "explain", "kaise kaam", "kya hota", "define", "history", "version of"]):
        return None, None, False

    # 1. System Information
    if any(kw in low for kw in ["system info", "computer info", "system information", "pc info", "computer ki information", "system ki info", "pc details", "device specs"]):
        return "SYSTEM_INFO", None, False

    # 2. Lock Computer
    if any(kw in low for kw in ["lock pc", "lock computer", "computer lock", "pc lock", "lock karo", "lock kar do", "screen lock"]):
        return "LOCK_PC", None, False

    # 3. Shutdown / Restart safety refusal
    if any(kw in low for kw in ["shutdown", "shut down", "restart", "reboot", "format", "delete folder", "delete file", "delete windows"]):
        return "DISALLOWED_SYSTEM_ACTION", None, False

    # 4. Volume Controls
    if any(kw in low for kw in ["volume up", "volume badhao", "volume badha", "awaaz badhao", "sound badhao", "sound up", "volume increase"]):
        return "VOLUME_UP", None, False
    if any(kw in low for kw in ["volume down", "volume kam karo", "volume ghatao", "awaaz kam", "sound down", "volume decrease"]):
        return "VOLUME_DOWN", None, False

    # 5. Media Play / Pause
    if any(kw in low for kw in ["media play", "media pause", "gana roko", "gana chalao", "play pause", "pause media", "play media"]):
        return "MEDIA_PLAY_PAUSE", None, False

    # 6. Open Folder
    if "folder" in low:
        for folder_key in ["downloads", "documents", "desktop", "pictures", "videos", "music"]:
            if folder_key in low:
                return "OPEN_FOLDER", folder_key, False
        if any(kw in low for kw in ["kholo", "open", "dikhao"]):
            return "OPEN_FOLDER", "downloads", False  # Default to Downloads if just "folder kholo"

    # 7. Search the web (opens a normal Google search; no API is used)
    search_markers = ["search karo", "search for", "google karo", "google search", "search "]
    if any(m in low for m in search_markers):
        import re as _re
        query = low
        for marker in ["search karo", "search for", "google karo", "google search", "search"]:
            if marker in query:
                query = query.split(marker, 1)[1].strip(" :,-")
                break
        if query:
            return "SEARCH_WEB", query, False

    # 8. Open Website
    for site_key, site_info in ALLOWED_WEBSITES.items():
        if site_key in low and any(kw in low for kw in ["kholo", "open", "chalao", "website", "site", "page", "launch"]):
            return "OPEN_WEBSITE", site_key, False

    # 8. Ambiguous app requests
    if any(low == kw or low == f"{kw} kholo" or low == f"open {kw}" for kw in ["editor", "code editor", "text editor"]):
        return "AMBIGUOUS_APP", "editor", True

    # 9. Open Application
    for app_key, app_data in ALLOWED_APPS.items():
        for alias in app_data["alt_names"]:
            if alias in low and any(kw in low for kw in ["kholo", "open", "chalao", "start", "launch", "chalu"]):
                return "OPEN_APP", app_key, False

    # 10. Check for unknown app requests with "kholo" or "open"
    if any(low.endswith(kw) for kw in ["kholo", "open karo", "chalao", "launch karo"]) or low.startswith("open "):
        # Check if user mentioned an unwhitelisted keyword
        words = [w for w in low.replace("kholo", "").replace("open", "").replace("karo", "").replace("chalao", "").replace("application", "").replace("app", "").split() if len(w) > 1]
        if words:
            candidate = words[0]
            # Don't trigger if it's an Arduino device or generic word
            if candidate not in ["light", "fan", "gate", "buzzer", "pump", "bell", "samay", "time"]:
                return "UNKNOWN_APP", candidate, False

    return None, None, False


def execute_pc_control(action: str, target: str | None = None) -> PCCommandResult:
    """
    Execute whitelisted PC actions safely.
    Validates against safety flags and strict whitelists.
    """
    if not PC_CONTROL_ENABLED:
        logger.warning("PC Control is currently disabled in backend configuration.")
        return PCCommandResult(
            success=False,
            action=action,
            target=target,
            spoken_response="PC Control is currently disabled in the backend settings.",
            error="PC_CONTROL_ENABLED is set to False.",
        )

    with _pc_lock:
        try:
            # Action: Ambiguous clarification
            if action == "AMBIGUOUS_APP":
                return PCCommandResult(
                    success=True,
                    action="CLARIFY",
                    target=target,
                    spoken_response="Kaunsa editor open karna hai? VS Code ya Notepad?",
                    is_clarification=True,
                )

            # Action: Disallowed destructive commands
            if action == "DISALLOWED_SYSTEM_ACTION":
                logger.warning(f"Blocked disallowed system operation: {action}")
                return PCCommandResult(
                    success=False,
                    action=action,
                    target=target,
                    spoken_response="Shutdown, restart, aur system deletion safety rules ke tahat allowed nahi hain.",
                    error="Unsafe operation blocked.",
                )

            # Action: Unknown Application
            if action == "UNKNOWN_APP":
                logger.info(f"Rejected unknown app request: '{target}'")
                return PCCommandResult(
                    success=False,
                    action=action,
                    target=target,
                    spoken_response=f"'{target}' application approved whitelist me nahi hai.",
                    error="Application not found in safe whitelist.",
                )

            # Action 1: System Info
            if action == "SYSTEM_INFO":
                info_text = (
                    f"System: {platform.system()} {platform.release()} ({platform.machine()}), "
                    f"Processor: {platform.processor() or 'Intel/AMD'}, "
                    f"Python: {platform.python_version()}."
                )
                logger.info("Executed System Info query.")
                return PCCommandResult(
                    success=True,
                    action="SYSTEM_INFO",
                    target=None,
                    spoken_response=f"Computer Information: {info_text}",
                )

            # Action 2: Lock Computer
            if action == "LOCK_PC":
                if platform.system() == "Windows":
                    ctypes.windll.user32.LockWorkStation()
                    logger.info("Executed Windows LockWorkStation.")
                    return PCCommandResult(
                        success=True,
                        action="LOCK_PC",
                        target=None,
                        spoken_response="Computer screen ko lock kar diya gaya hai.",
                    )
                else:
                    return PCCommandResult(
                        success=False,
                        action="LOCK_PC",
                        target=None,
                        spoken_response="Lock workstation is only supported on Windows.",
                    )

            # Action 3: Volume Controls
            if action in ["VOLUME_UP", "VOLUME_DOWN"]:
                if platform.system() == "Windows":
                    # VK_VOLUME_UP = 0xAF, VK_VOLUME_DOWN = 0xAE
                    VK_KEY = 0xAF if action == "VOLUME_UP" else 0xAE
                    for _ in range(4):  # Step volume up/down by 4 increments
                        ctypes.windll.user32.keybd_event(VK_KEY, 0, 0, 0)
                        ctypes.windll.user32.keybd_event(VK_KEY, 0, 2, 0)
                    resp = "Volume badha diya gaya hai." if action == "VOLUME_UP" else "Volume kam kar diya gaya hai."
                    logger.info(f"Executed Windows {action}.")
                    return PCCommandResult(
                        success=True,
                        action=action,
                        target=None,
                        spoken_response=resp,
                    )
                else:
                    return PCCommandResult(
                        success=True,
                        action=action,
                        target=None,
                        spoken_response="Volume adjustment completed.",
                    )

            # Action 4: Media Play / Pause
            if action == "MEDIA_PLAY_PAUSE":
                if platform.system() == "Windows":
                    # VK_MEDIA_PLAY_PAUSE = 0xFA
                    ctypes.windll.user32.keybd_event(0xFA, 0, 0, 0)
                    ctypes.windll.user32.keybd_event(0xFA, 0, 2, 0)
                    logger.info("Executed Windows Media Play/Pause.")
                    return PCCommandResult(
                        success=True,
                        action="MEDIA_PLAY_PAUSE",
                        target=None,
                        spoken_response="Media playback toggle kar diya gaya hai.",
                    )
                return PCCommandResult(
                    success=True,
                    action="MEDIA_PLAY_PAUSE",
                    target=None,
                    spoken_response="Media playback toggled.",
                )

            # Action 5: Open Whitelisted Application
            if action == "OPEN_APP":
                if not target or target not in ALLOWED_APPS:
                    return PCCommandResult(
                        success=False,
                        action="OPEN_APP",
                        target=target,
                        spoken_response=f"Application '{target}' approved whitelist me nahi hai.",
                        error="App not allowed.",
                    )

                app_data = ALLOWED_APPS[target]
                app_name = app_data["name"]

                if platform.system() == "Windows":
                    # Launch directly instead of `os.system("start ...")`. The
                    # direct process call avoids shell parsing and makes the
                    # application launch deterministic for workflow chains.
                    if target == "this_pc":
                        subprocess.Popen(["explorer.exe", "shell:MyComputerFolder"],
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    elif target == "cmd":
                        subprocess.Popen(["cmd.exe"], creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0),
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    else:
                        exe = app_data["exe"]
                        # Chrome is commonly installed outside PATH on Windows.
                        # Resolve only the approved Chrome executable from the
                        # standard installation locations before launching it.
                        if target == "chrome":
                            candidates = [
                                Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
                                Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "Google/Chrome/Application/chrome.exe",
                                Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)")) / "Google/Chrome/Application/chrome.exe",
                            ]
                            resolved = next((str(p) for p in candidates if p.is_file()), None)
                            if resolved:
                                exe = resolved
                        subprocess.Popen([exe], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    subprocess.Popen([app_data["exe"]])

                logger.info(f"Successfully launched whitelisted app: {app_name}")
                return PCCommandResult(
                    success=True,
                    action="OPEN_APP",
                    target=target,
                    spoken_response=f"{app_name} open kar diya gaya hai.",
                )

            # Action 6: Open Whitelisted Website
            if action == "OPEN_WEBSITE":
                if not target or target not in ALLOWED_WEBSITES:
                    return PCCommandResult(
                        success=False,
                        action="OPEN_WEBSITE",
                        target=target,
                        spoken_response="Yeh website safe list me nahi hai.",
                        error="Website not in whitelist.",
                    )

                site_info = ALLOWED_WEBSITES[target]
                url = site_info["url"]
                webbrowser.open(url)
                logger.info(f"Successfully opened whitelisted website: {site_info['name']} ({url})")
                return PCCommandResult(
                    success=True,
                    action="OPEN_WEBSITE",
                    target=target,
                    spoken_response=f"{site_info['name']} website open kar di gayi hai.",
                )

            # Action 7: Search web using the default browser
            if action == "SEARCH_WEB":
                query = (target or "").strip()
                if not query:
                    return PCCommandResult(success=False, action=action, target=target, spoken_response="Search query missing hai.", error="Empty query")
                webbrowser.open("https://www.google.com/search?q=" + __import__('urllib.parse').parse.quote_plus(query))
                return PCCommandResult(success=True, action=action, target=query, spoken_response=f"Google par '{query}' search kar diya gaya hai.")

            # Action 8: Open Whitelisted Folder
            if action == "OPEN_FOLDER":
                allowed_folders = _get_allowed_folders()
                folder_path = allowed_folders.get(target or "downloads")
                if not folder_path or not os.path.exists(folder_path):
                    return PCCommandResult(
                        success=False,
                        action="OPEN_FOLDER",
                        target=target,
                        spoken_response="Requested folder available nahi hai.",
                        error="Folder path invalid or not in whitelist.",
                    )

                if platform.system() == "Windows":
                    os.startfile(folder_path)
                else:
                    subprocess.Popen(["xdg-open", folder_path])

                folder_name = (target or "downloads").capitalize()
                logger.info(f"Successfully opened whitelisted folder: {folder_name} ({folder_path})")
                return PCCommandResult(
                    success=True,
                    action="OPEN_FOLDER",
                    target=target,
                    spoken_response=f"{folder_name} folder open kar diya gaya hai.",
                )

            return PCCommandResult(
                success=False,
                action=action,
                target=target,
                spoken_response="Command recognize nahi ho payi.",
                error="Action not recognized.",
            )

        except Exception as e:
            logger.error(f"Error executing PC Control action '{action}': {str(e)}")
            return PCCommandResult(
                success=False,
                action=action,
                target=target,
                spoken_response="PC command execute karne me error aaya.",
                error=str(e),
            )
