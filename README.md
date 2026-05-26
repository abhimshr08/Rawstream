# CloudStream - Cloud Media Player

CloudStream is a premium, glassmorphic single-page web application that allows you to stream large videos directly from public Google Drive and Microsoft OneDrive links without downloading them. It uses direct stream URL extraction and feeds the stream into a custom HTML5 media player with full playback control.

## Features

- **Link Direct-Streaming:** Parses standard Google Drive and OneDrive links to extract direct streaming endpoints on-the-fly.
- **Custom-Designed Media Player:** Frosted-glass design overlay with custom play/pause, seek track, volume slider, speed dropdown, theater mode, and full-screen controls.
- **Keyboard Navigation Support:** Native shortcuts for a complete desktop-like player experience.
- **Stream History:** Automatically saves recently played streams to `LocalStorage`. Allows renaming, pinning, and removing items.
- **Responsive Layout:** Automatically scales for desktop, tablet, and mobile views.

---

## Installation & Setup

1. Make sure you have [Node.js](https://nodejs.org/) installed.
2. In your terminal, navigate to this project directory:
   ```bash
   cd /Users/abhishekmishra/.gemini/antigravity/scratch/cloudstream
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the local development server:
   ```bash
   npm run dev
   ```
5. Open the local address in your browser (usually `http://localhost:3000`).

---

## Config Cloud File Permissions

For CloudStream to fetch the video stream, the source files **must be shared publicly**. Private links cannot be resolved.

### Google Drive
1. Right-click the video file in Google Drive.
2. Click **Share** -> **Share**.
3. Under *General Access*, change from *Restricted* to **Anyone with the link can view**.
4. Click **Copy link** and paste it into CloudStream.

### Microsoft OneDrive
1. Select the video file in OneDrive.
2. Click **Share** at the top.
3. Ensure the setting is **"Anyone with the link can view"** (public).
4. Click **Copy Link** and paste it into CloudStream.

---

## Keyboard Shortcuts

While the player is focused or active:

- <kbd>Space</kbd> - Play / Pause
- <kbd>←</kbd> / <kbd>→</kbd> - Skip backward / forward 10 seconds
- <kbd>↑</kbd> / <kbd>↓</kbd> - Increase / decrease volume by 10%
- <kbd>M</kbd> - Mute / Unmute audio
- <kbd>F</kbd> - Toggle Fullscreen
- <kbd>T</kbd> - Toggle Theater Mode
