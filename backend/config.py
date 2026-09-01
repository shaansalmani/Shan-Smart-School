import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR=Path(__file__).resolve().parent
ROOT_DIR=BASE_DIR.parent
load_dotenv(BASE_DIR/'.env')
load_dotenv(ROOT_DIR/'.env')
HOST=os.getenv('HOST','127.0.0.1')
try: PORT=int(os.getenv('PORT','8000'))
except ValueError: PORT=8000
DEBUG=os.getenv('DEBUG','true').lower() in ('true','1','yes')
ALLOWED_ORIGINS=[
    'http://localhost',
    'http://127.0.0.1',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'https://shaansalmani.github.io',
    'null'
]
PC_CONTROL_ENABLED=os.getenv('PC_CONTROL_ENABLED','true').lower() in ('true','1','yes')
PC_CONTROL_SAFE_MODE=os.getenv('PC_CONTROL_SAFE_MODE','true').lower() in ('true','1','yes')
ANDROID_CONTROL_ENABLED=os.getenv('ANDROID_CONTROL_ENABLED','true').lower() in ('true','1','yes')
ANDROID_SAFE_MODE=os.getenv('ANDROID_SAFE_MODE','true').lower() in ('true','1','yes')
PC_CONTROL_TIMEOUT_SECONDS=5.0
ANDROID_COMMAND_TIMEOUT_SECONDS=5.0
