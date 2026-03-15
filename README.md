# Vocal Pathing

A real-time marine audio monitoring system built for SmathHacks 2026. It streams live microphone audio from multiple devices to a central dashboard, classifies the sounds using a whale species AI model, and triangulates the location of the sound source.

---

## What It Does

1. **Stream audio** from multiple microphone devices to a dashboard over the internet in real time
2. **Classify sounds** using a Google whale species AI model (identifies humpback whales, orcas, blue whales, and more)
3. **Triangulate position** using the time difference between when each microphone hears the sound (TDOA)

---

## Project Structure

```
smathhacks-2026-vocalpathing/
├── vocalpathing-website/       # The website (dashboard + recorder)
│   ├── app/
│   │   ├── page.tsx            # Dashboard: shows connected mics, classifications, position
│   │   └── recorder/page.tsx   # Recorder: captures mic audio and streams it
│   ├── server.ts               # Backend server that routes audio between devices
│   └── public/
│       └── audio-processor.js  # Handles audio capture timing in the browser
└── ml_stuff/                   # Python AI scripts
    ├── classify_stream.py      # Classifies incoming audio as whale species
    ├── triangulate_stream.py   # Calculates XY position of the sound source
    ├── audio_triangle.py       # Core TDOA triangulation math
    ├── audio_segmentation.py   # Separates mixed audio into individual sources
    └── cool_ahh_model.py       # Standalone whale classification script
```

---

## How It Works

### Audio Streaming

Each device that opens `/recorder` in the browser captures microphone audio and sends it to the server over a WebSocket connection. The server labels each chunk with the device ID and forwards it to the dashboard in real time.

### Species Classification

When a recorder connects, the server automatically starts a Python process (`classify_stream.py`) for that device. Audio is piped into it continuously. Every 1 second it runs the Google Multispecies Whale model on the last 5 seconds of audio and sends the result back to the dashboard.

The model can detect 12 types:
- Humpback whale (song and call)
- Orca (call and echolocation)
- Blue whale
- Fin whale
- Minke whale
- Bryde's whale (two call types)
- Narwhal (upcall and gunshot)
- North Pacific right whale

### Triangulation

When 3 or more recorders are connected, the server starts `triangulate_stream.py`. It receives audio from all 3 microphones simultaneously and calculates the XY position of the sound source using TDOA (Time Difference of Arrival). This works by measuring how much earlier or later the sound arrives at each microphone compared to the others, then solving for the position that best explains those timing differences.

---

## Setup

### Requirements

- Node.js
- Python 3 with a virtual environment at `venv/`
- `mkcert` for local HTTPS (required because the browser needs HTTPS to access the microphone)

### Python Dependencies

From the repo root:

```bash
python3 -m venv venv
source venv/bin/activate
pip install numpy scipy librosa tensorflow tensorflow-hub torch asteroid-filterbanks pyroomacoustics soundfile
```

### SSL Certificates

The server requires HTTPS. Generate local certificates inside `vocalpathing-website/`:

```bash
brew install mkcert
mkcert -install
cd vocalpathing-website
mkcert localhost
```

This creates `localhost.pem` and `localhost-key.pem` in that folder.

### Install Node Dependencies

```bash
cd vocalpathing-website
npm install
```

---

## Running the App

```bash
cd vocalpathing-website
npm run dev
```

Then open **https://localhost:3000** in your browser.

- The server restarts automatically when you save `server.ts`
- The browser updates automatically when you save frontend files

---

## Using the Dashboard

1. Open **https://localhost:3000** on the device you want to use as the dashboard
2. Open **https://localhost:3000/recorder** on each device you want to use as a microphone
3. On the recorder page, press **Start Recording** to begin streaming
4. Back on the dashboard, press **Start Listening** to hear the audio
5. Species classifications will appear under each connected device
6. Once 3 recorders are connected, the triangulated XY position will appear at the top

### Setting Microphone Positions

For triangulation to work correctly, you need to enter the physical position of each microphone in meters. Use the **Microphone Positions** section on the dashboard and press **Apply** when done.

Example: if mic 0 is at the origin, mic 1 is 1 meter to the right, and mic 2 is 0.5 meters right and 1 meter forward:
- Mic 0: X=0, Y=0, Z=0
- Mic 1: X=1, Y=0, Z=0
- Mic 2: X=0.5, Y=1, Z=0

---

## WebSocket Message Types

| Message | Direction | Description |
|---------|-----------|-------------|
| `register` | Client to Server | Registers a device as a recorder or dashboard |
| `connect` | Server to Dashboard | A new recorder connected |
| `disconnect` | Server to Dashboard | A recorder disconnected |
| `classification` | Server to Dashboard | Whale species detection result |
| `status` | Server to Dashboard | AI model loading status |
| `triangulation` | Server to Dashboard | XY position of sound source |
| `set_mic_positions` | Dashboard to Server | Update microphone positions |
| Binary PCM | Recorder to Server to Dashboard | Raw audio data |
