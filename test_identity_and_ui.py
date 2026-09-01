import json
import time
import subprocess
import sys
import urllib.request

# Start server using module execution
proc = subprocess.Popen([sys.executable, '-m', 'backend.app'])

# Wait for server ready
for _ in range(20):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=1) as r:
            if r.status == 200:
                break
    except Exception:
        time.sleep(0.5)



base_url = "http://127.0.0.1:8000"

def post_chat(msg):
    data = json.dumps({"message": msg}).encode("utf-8")
    req = urllib.request.Request(f"{base_url}/api/chat", data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

try:
    # Test 1: Ask who are you
    res1 = post_chat("Who are you?")
    print("Test 1 (Who are you?):", res1.get("response"))

    # Test 2: Natural language name change to Ronit
    res2 = post_chat("Tumhara name aaj se Ronit hai.")
    print("Test 2 (Name change):", res2.get("response"))

    # Test 3: Ask name in Hindi
    res3 = post_chat("Tumhara naam kya hai?")
    print("Test 3 (Tumhara naam kya hai?):", res3.get("response"))

    # Test 4: Ask who are you again
    res4 = post_chat("Who are you?")
    print("Test 4 (Who are you after rename):", res4.get("response"))

    assert "Ronit" in res2.get("response")
    assert "Ronit" in res3.get("response")
    assert "Ronit" in res4.get("response")
    print("\n>>> ALL IDENTITY & NAME CHANGE TESTS PASSED! <<<")
finally:
    proc.terminate()

