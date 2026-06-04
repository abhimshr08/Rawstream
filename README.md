---
title: Rawstream
emoji: 🎥
colorFrom: purple
colorTo: indigo
sdk: docker
app_port: 3000
pinned: false
---

# RawStream - Premium Cloud Media Player (V2 React)

RawStream is a premium, glassmorphic React single-page web application that allows you to stream large videos directly from public Google Drive, Microsoft OneDrive, and BitTorrent magnet URIs/torrents.

It uses an advanced backend transcoding proxy powered by WebTorrent and FFmpeg, coupled with a reactive frontend built on Vite and React for high-performance responsive streaming.

---

## 💎 Premium Features (V2 Upgrades)

### 1. Unified Multi-Source Streaming
*   **Cloud Links:** Parses and streams directly from Google Drive and Microsoft OneDrive sharing links.
*   **BitTorrent & Magnet URIs:** Stream movies and shows directly from magnet links or by dragging-and-dropping `.torrent` files. Video pieces are downloaded sequentially on-demand using WebTorrent.
*   **Bypass Engine:** Includes a Puppeteer-based stream resolver to bypass Google Drive's stream player restrictions and quota limitations.

### 2. Modern React Architecture (New)
*   **Vite + React Integration:** Completely migrated from legacy Vanilla JS spaghetti code to a modular, reactive component architecture (`src/App.jsx`, `Player.jsx`, `Controls.jsx`, `HistorySidebar.jsx`, `AdminDashboard.jsx`, etc.).
*   **Optimized Performance:** Component state boundaries prevent unnecessary layout reflows, ensuring smooth and responsive playback.

### 3. V2 Premium Visual Enhancements
*   **Visual CPU & Memory Meters:** The administrator control center features dynamic, visually styled RSS/heap memory indicators and CPU load progress meters.
*   **Stacked Notification Toast System:** Replaced the single status alert banner with an interactive, floating toast notification stack that transitions smoothly in from the bottom-right corner.
*   **Dynamic Audio Waveform Visualizer:** Renders a neon canvas-based wave or animated visualizer in the player container when playing audio-only formats or while video streams are buffering.
*   **Subtitles & Quality Settings:** Upload local subtitles (`.srt`, `.vtt`) or load remote WebVTT URLs. Choose resolution qualities (Auto, 720p, 480p) from controls, carrying over current player seek points.
*   **Ambient Cinema Glow:** Optimized canvas backlight glow captures video frames and draws hardware-accelerated CSS blur behind the player to create an immersive theater atmosphere.
*   **Torrent Metadata Badges:** Codec tags, quality values, and transcoding status details are dynamically generated and displayed in a badge grid below the player.

### 4. Playback Adjustments & locked A/V Sync
*   **Locked A/V Sync:** Uses dynamic audio resampling (`aresample=async=1`), presentation timestamp regeneration (`+genpts`), and output zero-shifting (`avoid_negative_ts make_zero`) to prevent audio-video desynchronization during seeks or buffering.
*   **Conflict-Free Timeline Scrubber:** Custom slider handles scrubbing without timeline snapback during live transcode streaming.
*   **Netflix-Style Playback Resuming:** Playback progress is updated every 5 seconds. If you return to a half-watched video, a prompt offers to resume from where you left off.

---

## 🛠️ Installation & Setup

### Prerequisites
*   [Node.js](https://nodejs.org/) (v18+)
*   [FFmpeg](https://ffmpeg.org/) and `ffprobe` installed and added to your system's PATH.

### Installation
1. Clone the repository and navigate into it:
    ```bash
    git clone https://github.com/abhimshr08/Rawstream.git
    cd Rawstream
    ```
2. Install the package dependencies:
    ```bash
    npm install
    ```
3. Create a `.env` file in the root directory (optional, for admin settings):
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
1. Right-click the video file in Google Drive -> **Share**.
2. Under *General Access*, change from *Restricted* to **Anyone with the link can view**.
3. Copy the link and paste it into RawStream.

### Microsoft OneDrive
1. Select the file in OneDrive -> Click **Share** at the top.
2. Ensure the setting is set to **"Anyone with the link can view"** (public).
3. Copy the link and paste it into RawStream.

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
