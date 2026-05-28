# CloudStream - Premium Cloud Media Player

CloudStream is a premium, glassmorphic single-page web application that allows you to stream large videos directly from public Google Drive, Microsoft OneDrive, and BitTorrent magnet URIs/torrents. 

It uses an advanced backend transcoding proxy powered by WebTorrent and FFmpeg, allowing you to play almost any video codec natively in the browser with full custom player controls.

---

## 💎 Premium Features

### 1. Unified Multi-Source Streaming
*   **Cloud Links:** Parses and streams directly from Google Drive and Microsoft OneDrive sharing links.
*   **BitTorrent & Magnet URIs:** Stream movies and shows directly from magnet links or by dragging-and-dropping `.torrent` files. Video pieces are downloaded sequentially on-demand using WebTorrent.
*   **Bypass Engine:** Includes a Puppeteer-based stream resolver to bypass Google Drive's stream player restrictions and quota limitations.

### 2. Custom Media Player Controls
*   **Glassmorphic Design:** Sleek, modern interface using frosted glass textures, harmonious dark-mode palettes, and modern typography.
*   **Playback Adjustments:** Custom speed selector (0.5x to 2x), aspect-ratio override menu (contain, cover, fill, 16:9, 4:3), video rotation (90°, 180°, 270°), and mirroring (horizontal/vertical).
*   **Smooth Drag-Seek Timeline:** Interactive slider with hover-time tooltips, featuring a conflict-free dragging state that prevents playback updates from snapping the slider thumb.
*   **Theater & Fullscreen Modes:** Double-click video or click controls for custom responsive viewport configurations.

### 3. Dynamic Transcoding & Locked A/V Sync
*   **On-the-Fly FFmpeg Transcoder:** Automatically detects non-browser-compatible codecs (like MKV, AVI, TS, HEVC/x265, AC3 audio) and transcodes them on-the-fly to 8-bit H.264 video (`yuv420p`) and AAC audio.
*   **Locked A/V Sync:** Uses dynamic audio resampling (`aresample=async=1`), presentation timestamp regeneration (`+genpts`), and output zero-shifting (`avoid_negative_ts make_zero`) to prevent audio-video desynchronization during seeks or buffering.
*   **Quality Presets:** Choose stream resolutions (Auto/Original, 720p, 480p) from the controls. Quality settings seamlessly reload the stream and carry over seek times.

### 4. Smart Playback & Personalization
*   **Netflix-Style Resuming:** Progress is synchronized to the user's history file every 5 seconds. If you exit and return, a glassmorphic dialog prompts: *"Resume playback from MM:SS?"*
*   **Ambient Cinema Glow:** Optimized canvas backlight glow that captures color frames at 10fps and applies hardware-accelerated CSS blurs behind the player to create an immersive theater atmosphere with zero CPU overhead.
*   **Custom Subtitles Menu:** Upload local `.srt` or `.vtt` files, or load remote WebVTT URLs. SRT subtitles are converted on-the-fly using regex to patch timestamp notation.

### 5. Production-Grade Security & Admin Dashboard
*   **Secure Sessions:** Cryptographically secure random 32-byte session tokens.
*   **Salted Hashing:** User passwords are encrypted using salted SHA-256 hashing. Legacy user accounts are automatically migrated to salted credentials upon login.
*   **Admin Dialogue Dashboard:** Accessible only to verified administrators. Allows monitoring real-time server statistics (system memory RSS, CPU load, uptime, active sessions), managing registered users, and purges WebTorrent cache items to release system storage.

---

## 🛠️ Installation & Setup

### Prerequisites
*   [Node.js](https://nodejs.org/) (v16+)
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
    Open `http://localhost:3000` (or the port specified by the server) to play.

---

## 📂 Configuration & Permissions

Source cloud links must be shared publicly for CloudStream to pull their streams.

### Google Drive
1. Right-click the video file in Google Drive -> **Share**.
2. Under *General Access*, change from *Restricted* to **Anyone with the link can view**.
3. Copy the link and paste it into CloudStream.

### Microsoft OneDrive
1. Select the file in OneDrive -> Click **Share** at the top.
2. Ensure the setting is set to **"Anyone with the link can view"** (public).
3. Copy the link and paste it into CloudStream.

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
