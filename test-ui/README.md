# Phase 8 Test Harness — Simple HTML Frontend

A lightweight browser UI designed for testing the As2el Semi backend before production hardening. This is **not** the final frontend.

## Features Supported
- Text questions
- Persistent conversation by `userId` (via localStorage)
- Clarification continuation (clickable buttons)
- Out of scope & no verified info behavior badges
- Retrieved sources (collapsible)
- Debug timings panel
- Microphone recording (audio/webm)
- STT + assistant via `/api/voice/ask`
- Provider/Backend error handling

## Requirements
- Browser with `getUserMedia` support for microphone.
- Backend running locally on port `3001`.

## How to Run

1. **Start the Backend**
   In the `backend` directory, run:
   ```bash
   npm run start:dev
   ```

2. **Start the Test UI**
   From this `test-ui` directory, start a simple HTTP server:
   ```bash
   python3 -m http.server 8080
   ```

3. **Open the Browser**
   Go to: http://localhost:8080
