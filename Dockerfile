# syntax=docker/dockerfile:1

# ─── Stage 1: Build frontend ─────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ─── Stage 2: Production runtime ─────────────────────────────────────────────
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp — try multiple methods for compatibility across distros
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Production Node deps only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built frontend and production server
COPY --from=builder /app/dist ./dist
COPY server.js ./

# Verify tools are available
RUN yt-dlp --version && ffmpeg -version | head -1 && ffprobe -version | head -1

EXPOSE 3000

CMD ["node", "server.js"]
