# 🔥 NBDM: High-Speed Auto-Seedbox & Cloud Uploader

A custom-built, ultra-fast Node.js web panel designed to seamlessly bridge local VPS storage with cloud providers. Includes an optimized native RAM pipeline for Google Drive, Pixeldrain, and Gofile, entirely bypassing Node.js bufferbloat to max out 10Gbps+ VPS network cards without crashing.

![NBDM Interface](https://img.shields.io/badge/UI-Dark_Glassmorphism-emerald?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Stable_v1.0-blue?style=for-the-badge)

## ✨ Core Features
* **qBittorrent Integration:** Auto-syncs with qBittorrent to read live download speeds, ETAs, and file sizes directly from the web panel.
* **Native HTTPS RAM Engine:** Uploads 50GB+ files using less than 50MB of VPS RAM. Uses pure OS-level TCP pipes to prevent `ECONNRESET` and memory crashes.
* **Auto-Healer Network Protection:** Automatically detects dropped Google Drive connections, pauses for Google firewall cool-downs, and seamlessly resumes chunks without restarting the upload.
* **Smart JD2 Crawler:** Select multiple folders on your VPS and instantly generate a `.crawljob` file. JDownloader 2 reads this file and flawlessly rebuilds your server's folder structure locally on your home PC.
* **Live Discord Webhooks:** Sends an embedded message to your Discord server the microsecond a folder successfully finishes uploading, complete with direct URLs.

## 🚀 One-Click Installation (Ubuntu VPS)
Log into your fresh Ubuntu VPS via SSH and run this single command. It will automatically install Node.js, qBittorrent-nox, the VueTorrent Dark Theme, PM2, and deploy the panel.

```bash
curl -sL [https://raw.githubusercontent.com/nx991/nb-downloader/main/install.sh](https://raw.githubusercontent.com/nx991/nb-downloader/main/install.sh) | bash

🛠 Manual Start/Stop Commands
NB Downloader Panel (Managed by PM2):

Restart panel: pm2 restart nb-downloader

Stop panel: pm2 stop nb-downloader

View live logs: pm2 logs nb-downloader

qBittorrent (Native Daemon):

Start engine: qbittorrent-nox -d

Kill engine: killall qbittorrent-nox

🌐 Default Ports
Ensure these ports are allowed on your Cloud Firewall:

8080 - qBittorrent WebUI (VueTorrent Theme)

5000 - NBDM Web Panel

9666 - JDownloader 2 FlashGot (Optional)