# Ronit AI Local Controller

Local-only FastAPI controller for the existing Ronit AI website. No OpenRouter, Blackbox, cloud AI, or API key is required.

- PC/laptop control
- Existing Arduino Web Serial control remains in the website
- User-created laptop + Arduino workflows are stored in manual_skills.json; no demo/test workflows are seeded.
- Keyboard/mouse PC actions use PyAutoGUI
- Destructive system operations are intentionally blocked
