#!/bin/bash
clear
echo -e "\e[1;36m=====================================================\e[0m"
echo -e "\e[1;32m             🔥 NBDM ONE-CLICK INSTALLER 🔥          \e[0m"
echo -e "\e[1;36m=====================================================\e[0m"
echo -e "Starting automated setup...\n"

# 1. System Updates & Node.js
echo -e "\e[1;33m[1/6] Installing Core Engines (Node.js, Git, qBittorrent)...\e[0m"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git qbittorrent-nox ufw curl
npm install pm2 -g

# 2. VueTorrent Theme & qBittorrent Configuration
echo -e "\n\e[1;33m[2/6] Setting up VueTorrent Dark Theme & Anonymous Mode...\e[0m"
cd /root
rm -rf VueTorrent
git clone --single-branch --branch latest-release https://github.com/VueTorrent/VueTorrent.git
mkdir -p ~/.config/qBittorrent
cat << 'INI' > ~/.config/qBittorrent/qBittorrent.conf
[Preferences]
WebUI\AlternativeUIEnabled=true
WebUI\RootFolder=/root/VueTorrent

[BitTorrent]
Session\AnonymousModeEnabled=true
INI

# Start qBittorrent natively as a background daemon (NO PM2 needed)
killall qbittorrent-nox 2>/dev/null
qbittorrent-nox -d

# 3. Pull NBDM App from GitHub
echo -e "\n\e[1;33m[3/6] Downloading NBDM Panel from GitHub...\e[0m"
rm -rf /root/nb-downloader
git clone https://github.com/nx991/nb-downloader.git /root/nb-downloader
mkdir -p /root/Downloads

# 4. Install Packages & Start NB-Downloader via PM2
echo -e "\n\e[1;33m[4/6] Compiling Node Packages & Starting Server...\e[0m"
cd /root/nb-downloader
npm install
pm2 stop nb-downloader 2>/dev/null
pm2 delete nb-downloader 2>/dev/null
pm2 start server.js --name "nb-downloader"
pm2 save
pm2 startup

# 5. Configure Firewall
echo -e "\n\e[1;33m[5/6] Opening Firewall Ports...\e[0m"
ufw allow 5000/tcp
ufw allow 8080/tcp
ufw allow 9666/tcp
ufw --force enable

# 6. Fetch IP and Display Success UI
echo -e "\n\e[1;33m[6/6] Finalizing Setup...\e[0m"
VPS_IP=$(curl -s ifconfig.me)

clear
echo -e "\e[1;32m=====================================================\e[0m"
echo -e "\e[1;32m         🔥 NBDM INSTALLATION COMPLETE! 🔥         \e[0m"
echo -e "\e[1;32m=====================================================\e[0m"
echo -e ""
echo -e "📦 \e[1;36mqBittorrent WebUI:\e[0m \e[1;33mhttp://$VPS_IP:8080\e[0m"
echo -e "   ↳ Default Username: \e[1;31madmin\e[0m"
echo -e "   ↳ Default Password: \e[1;31madminadmin\e[0m"
echo -e ""
echo -e "🚀 \e[1;36mNB Downloader Panel:\e[0m \e[1;33mhttp://$VPS_IP:5000\e[0m"
echo -e ""
echo -e "\e[1;32m=====================================================\e[0m"
echo -e "Note: qBittorrent is running natively in the background."
echo -e "NB Downloader is protected by PM2. Type 'pm2 logs' to view activity."