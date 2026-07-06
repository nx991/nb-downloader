# 🔥 NBDM - High-Speed Auto-Seedbox & Cloud Uploader

<div align="center">

# 🚀 NBDM

**Ultra-Fast VPS Downloader • Auto Seedbox • Cloud Uploader**

Built for **10Gbps+ VPS servers** with an optimized native RAM upload engine.

[![GitHub](https://img.shields.io/badge/GitHub-nx991%2Fnb--downloader-181717?style=for-the-badge&logo=github)](https://github.com/nx991/nb-downloader)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white)]()
[![Ubuntu](https://img.shields.io/badge/Ubuntu-22.04+-E95420?style=for-the-badge&logo=ubuntu&logoColor=white)]()
[![Status](https://img.shields.io/badge/Status-Stable-success?style=for-the-badge)]()

</div>

---

# ✨ Features

- ⚡ Ultra-fast upload engine (Google Drive / Pixeldrain / Gofile)
- 💾 Native RAM streaming (50GB+ uploads using under 50MB RAM)
- 🚀 Designed for 1Gbps–10Gbps VPS servers
- 📂 qBittorrent integration
- 🔄 Auto upload after download
- 🛡 Auto resume & network recovery
- 📦 JDownloader2 Crawljob generator
- 🔔 Discord webhook notifications
- 🎨 Modern Web UI
- 🌙 VueTorrent Dark Theme included

---

# 🚀 One-Command Installation

SSH into your Ubuntu VPS and run:

```bash
curl -sL https://raw.githubusercontent.com/nx991/nb-downloader/main/install.sh | bash
```

The installer automatically installs:

- ✅ Node.js
- ✅ PM2
- ✅ qBittorrent-nox
- ✅ VueTorrent Theme
- ✅ Git
- ✅ Required packages
- ✅ NBDM Web Panel

---

# 📦 Clone Repository

```bash
git clone https://github.com/nx991/nb-downloader.git
```

Repository:

https://github.com/nx991/nb-downloader

---

# 🎛 PM2 Commands

### Restart Panel

```bash
pm2 restart nb-downloader
```

### Stop Panel

```bash
pm2 stop nb-downloader
```

### Start Panel

```bash
pm2 start nb-downloader
```

### View Logs

```bash
pm2 logs nb-downloader
```

### Monitor

```bash
pm2 monit
```

### Save PM2

```bash
pm2 save
```

---

# 🧲 qBittorrent Commands

### Start

```bash
qbittorrent-nox -d
```

### Stop

```bash
killall qbittorrent-nox
```

### Restart

```bash
killall qbittorrent-nox
qbittorrent-nox -d
```

---

# 🌐 Default Ports

| Port | Service |
|------:|----------|
| **5000** | NBDM Web Panel |
| **8080** | qBittorrent WebUI |
| **9666** | JDownloader2 FlashGot *(Optional)* |

Make sure these ports are allowed in your VPS firewall.

---

# 📁 Project Highlights

## 🚀 Native HTTPS RAM Engine

- Upload 50GB+ files
- Under 50MB RAM usage
- Zero buffer bloat
- No ECONNRESET crashes

---

## ☁ Cloud Uploads

Supports:

- Google Drive
- Pixeldrain
- Gofile

---

## 🧲 qBittorrent Integration

Live dashboard showing:

- Download speed
- Upload speed
- ETA
- Progress
- File size
- Torrent status

---

## 📦 JDownloader2 Crawljob Generator

Generate `.crawljob` files from VPS folders.

JDownloader2 automatically recreates the complete VPS folder structure on your local PC.

---

## 🔔 Discord Notifications

Receive instant Discord embeds when:

- Upload finishes
- Folder completes
- Cloud link generated

---

# 📊 Optimized For

- Ubuntu 22.04+
- Ubuntu 24.04+
- 1Gbps VPS
- 2.5Gbps VPS
- 10Gbps VPS
- Seedboxes
- Cloud Storage Automation

---

# ❤️ GitHub

⭐ Star the project if you find it useful.

https://github.com/nx991/nb-downloader
