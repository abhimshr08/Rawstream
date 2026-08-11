---
title: Rawstream
emoji: 🎥
colorFrom: purple
colorTo: indigo
sdk: docker
app_port: 3000
pinned: false
---

# 🎥 RawStream — Premium Cloud Media Player

[![Deploy to GitHub Pages](https://github.com/abhimshr08/Rawstream/actions/workflows/deploy.yml/badge.svg)](https://github.com/abhimshr08/Rawstream/actions/workflows/deploy.yml)
[![Sync to Hugging Face Hub](https://github.com/abhimshr08/Rawstream/actions/workflows/hf_sync.yml/badge.svg)](https://github.com/abhimshr08/Rawstream/actions/workflows/hf_sync.yml)
[![React Version](https://img.shields.io/badge/React-19.2-blue.svg?logo=react)](https://react.dev/)
[![Vite Version](https://img.shields.io/badge/Vite-5.0-6474f2.svg?logo=vite)](https://vite.dev/)

RawStream is a premium, glassmorphic React single-page web application that allows you to stream large video files directly from public Google Drive, Microsoft OneDrive, and BitTorrent magnet URIs/torrents.

It utilizes a high-performance backend transcoding proxy powered by **WebTorrent** and **FFmpeg**, coupled with a modern reactive frontend built on **Vite** and **React** for responsive, low-latency streaming.

---

## 🌐 Live Deployments

*   **Primary Web Application (Frontend)**: [https://abhimshr08.github.io/Rawstream/](https://abhimshr08.github.io/Rawstream/)
    *   *Hosted on GitHub Pages.* This static client features a responsive glassmorphic interface and automatically connects directly to the backend transcoding space without requiring manual connection configuration.
*   **Transcoding & Streaming Server (Backend)**: `https://maverick9876-rawstream.hf.space`
    *   *Hosted on Hugging Face Spaces (Docker).* Serves as the primary cloud proxy executing FFmpeg video transcoding, stream resolution, and WebTorrent operations.

---

## 💎 Key Features (V2 React)

### 1. Unified Multi-Source Streaming
*   **Cloud Links:** Parse and stream directly from public Google Drive and Microsoft OneDrive sharing links.
*   **BitTorrent & Magnet URIs:** Stream movies and shows directly from magnet links or by dragging-and-dropping `.torrent` files. Video pieces are downloaded sequentially on-demand using WebTorrent.
*   **Bypass Engine:** Includes a Puppeteer-based stream resolver to bypass Google Drive's stream player restrictions and quota limitations.

### 2. Modern React Architecture
*   **Vite + React Integration:** Built with a modular, reactive component architecture (`src/App.jsx`, `Player.jsx`, `Controls.jsx`, `HistorySidebar.jsx`, `AdminDashboard.jsx`, etc.).
*   **Optimized Performance:** Component state boundaries prevent unnecessary layout reflows, ensuring smooth and responsive playback.

### 3. V2 Premium Visual Enhancements
*   **Ambient Cinema Glow:** Optimized canvas backlight glow captures video frames and draws hardware-accelerated CSS blur behind the player to create an immersive theater atmosphere.
*   **Stacked Notification Toast System:** An interactive, floating toast notification stack that transitions smoothly in from the bottom-right corner.
*   **Dynamic Audio Waveform Visualizer:** Renders a neon canvas-based wave or animated visualizer in the player container when playing audio-only formats or while video streams are buffering.
*   **Visual CPU & Memory Meters:** The administrator control center features dynamic, visually styled RSS/heap memory indicators and CPU load progress meters.
*   **Torrent Metadata Badges:** Codec tags, quality values, and transcoding status details are dynamically generated and displayed in a badge grid below the player.
*   **Subtitles & Quality Settings:** Upload local subtitles (`.srt`, `.vtt`) or load remote WebVTT URLs. Choose resolution qualities (Auto, 720p, 480p) from controls, carrying over current player seek points.

### 4. Playback Adjustments & Locked A/V Sync
*   **Locked A/V Sync:** Uses dynamic audio resampling (`aresample=async=1`), presentation timestamp regeneration (`+genpts`), and output zero-shifting (`avoid_negative_ts make_zero`) to prevent audio-video desynchronization during seeks or buffering.
*   **Conflict-Free Timeline Scrubber:** Custom slider handles scrubbing without timeline snapback during live transcode streaming.
*   **Netflix-Style Playback Resuming:** Playback progress is updated every 5 seconds. If you return to a half-watched video, a prompt offers to resume from where you left off.

---

## 🛠️ Installation & Setup (Local Development)

### Prerequisites
*   [Node.js](https://nodejs.org/) (v18+)
*   [FFmpeg](https://ffmpeg.org/) and `ffprobe` installed and added to your system's PATH.

### Installation
1.  Clone the repository and navigate into it:
    ```bash
    git clone https://github.com/abhimshr08/Rawstream.git
    cd Rawstream
    ```
2.  Install the package dependencies:
    ```bash
    npm install
    ```
3.  Create a `.env` file in the root directory (optional, for admin settings):
    ```env
    ADMIN_USERNAME=owner
    ADMIN_PASSWORD=your_secure_password
    ```

### Running Locally
*   **Development Server (Vite + Dev Middleware):**
    ```bash
    npm run dev
    ```
*   **Production Build & Node Server:**
    ```bash
    npm run build
    npm start
    ```
    Open `http://localhost:3000` to stream.

---

## 📂 Configuration & Permissions

Source cloud links must be shared publicly for RawStream to pull their streams.

### Google Drive
1.  Right-click the video file in Google Drive -> **Share**.
2.  Under *General Access*, change from *Restricted* to **Anyone with the link can view**.
3.  Copy the link and paste it into RawStream.

### Microsoft OneDrive
1.  Select the file in OneDrive -> Click **Share** at the top.
2.  Ensure the setting is set to **"Anyone with the link can view"** (public).
3.  Copy the link and paste it into RawStream.

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
| --- | --- |
| <kbd>Space</kbd> / <kbd>K</kbd> | Play / Pause |
| <kbd>←</kbd> / <kbd>→</kbd> | Skip backward / forward 10 seconds |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Increase / decrease volume by 10% |
| <kbd>M</kbd> | Mute / Unmute audio |
| <kbd>F</kbd> | Toggle Fullscreen |
| <kbd>T</kbd> | Toggle Theater Mode |
