RONIT AI / SMART SCHOOL — LOCAL LAPTOP + ARDUINO
===============================================
This is the existing Ronit AI website project edited in-place. The current hardware scope is LOCAL LAPTOP + ARDUINO. Android/phone control has been removed from the UI, workflow builder, and backend.

RUN
---
1. Install Python 3.10+.
2. Run START_AI_BACKEND.bat.
3. Confirm http://127.0.0.1:8000/health returns status ok.
4. Open the website using the existing local web-server/hosting method.

WORKFLOWS
---------
AI Customize contains 200 ready-made laptop workflows and all currently supported Arduino workflows. Each workflow can be TESTED, EDITED, or DELETED. New workflows are stored as data; source-code editing is not required.

LAPTOP
------
PC actions include application/website opening, URL/search, folders, keyboard, hotkeys, mouse, media, volume, Windows shortcuts, Settings pages, system information and other non-destructive controls. Keyboard/mouse controls use PyAutoGUI locally. Destructive commands such as shutdown/restart/delete are intentionally not exposed.

ARDUINO
-------
The existing Web Serial Arduino control remains local over USB and uses the existing Arduino sketch/protocol.

VOICE
-----
Chrome/Edge SpeechRecognition can recognize a trigger and route it through the same saved-workflow system.

CREATOR
-------
Project by Shan. AI name: Ronit.


CUSTOM TEST WORKFLOWS ADDED (2026-08-30):
- Play Boom Shakala on YouTube
- Open BAV Inter College Info + Map (two separate Chrome tabs)
- Open BAV Inter College Info
- Open BAV Inter College Map
The BAV workflow uses the verified Meerut/Subhash Bazar location.


GITHUB PAGES NOTE
=================
GitHub Pages can host the static frontend (HTML/CSS/JS/assets), but it cannot run the local Python backend. For laptop/Arduino control, START_AI_BACKEND.bat must still be running on the laptop. Keep backend/ out of the browser-only execution path.
