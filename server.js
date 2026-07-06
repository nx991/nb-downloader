import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import https from 'https';
import { Server } from 'socket.io';
import axios from 'axios';
import FormData from 'form-data';
import os from 'os';
import { google } from 'googleapis';
import { PassThrough } from 'stream'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 5000;
const DOWNLOADS_DIR = '/root/Downloads';

// ==========================================
// CONFIGURATIONS 
// ==========================================
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });
const QBIT_API_URL = 'http://127.0.0.1:8080';
const QBIT_USER = 'admin';
const QBIT_PASS = '8rChWuM9B'; 
let qbitAuthCookie = '';

const GOFILE_DB_PATH = path.join(__dirname, 'gofile_db.json');
const PIXELDRAIN_DB_PATH = path.join(__dirname, 'pixeldrain_db.json');
const DRIVE_DB_PATH = path.join(__dirname, 'drive_db.json');
const activeUploads = {}; 

function getDb(dbPath) { 
    try { 
        if (!fs.existsSync(dbPath)) { fs.writeJsonSync(dbPath, {}); return {}; }
        return fs.readJsonSync(dbPath); 
    } catch(e) { fs.writeJsonSync(dbPath, {}); return {}; } 
}
function saveDb(dbPath, data) { fs.writeJsonSync(dbPath, data, { spaces: 2 }); }

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/stream', express.static(DOWNLOADS_DIR, { acceptRanges: true, dotfiles: 'allow' }));

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

function formatBytes(bytes) {
    if (!bytes || bytes === 0 || isNaN(bytes)) return '0 B';
    const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ==========================================
// SYSTEM & NETWORK STATS
// ==========================================
let previousCpu = os.cpus();
function getCpuUsage() {
    try {
        let startIdle = 0, startTotal = 0, endIdle = 0, endTotal = 0;
        const currentCpu = os.cpus();
        previousCpu.forEach(core => { startIdle += core.times.idle; for (let type in core.times) startTotal += core.times[type]; });
        currentCpu.forEach(core => { endIdle += core.times.idle; for (let type in core.times) endTotal += core.times[type]; });
        const idleDiff = endIdle - startIdle; const totalDiff = endTotal - startTotal;
        previousCpu = currentCpu;
        return totalDiff === 0 ? 0 : 100 - Math.floor((idleDiff / totalDiff) * 100);
    } catch(e) { return 0; }
}

function getNetworkStats() {
    try {
        const data = fs.readFileSync('/proc/net/dev', 'utf8');
        const lines = data.split('\n');
        let totalRx = 0; let totalTx = 0;
        for (let i = 2; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith('lo:')) continue; 
            const parts = line.split(/:|\s+/).filter(Boolean);
            if (parts.length >= 10) {
                totalRx += parseInt(parts[1], 10) || 0;
                totalTx += parseInt(parts[9], 10) || 0;
            }
        }
        return { rx: totalRx, tx: totalTx };
    } catch(e) { return { rx: 0, tx: 0 }; }
}

let lastNetStats = getNetworkStats();
let lastNetTime = Date.now();

setInterval(() => {
    try {
        const freeMem = os.freemem(); const totalMem = os.totalmem(); const usedMem = totalMem - freeMem;
        const ramPercent = Math.round((usedMem / totalMem) * 100); const cpuPercent = getCpuUsage();
        
        const currentNetStats = getNetworkStats();
        const now = Date.now();
        const timeDiff = (now - lastNetTime) / 1000;
        
        let dlSpeed = 0; let ulSpeed = 0;
        if (timeDiff > 0) {
            dlSpeed = Math.max(0, (currentNetStats.rx - lastNetStats.rx) / timeDiff);
            ulSpeed = Math.max(0, (currentNetStats.tx - lastNetStats.tx) / timeDiff);
        }
        lastNetStats = currentNetStats; lastNetTime = now;

        io.emit('system_stats', { 
            cpu: cpuPercent, ram: ramPercent, 
            ramUsed: formatBytes(usedMem), ramTotal: formatBytes(totalMem),
            dlSpeed: formatBytes(dlSpeed) + '/s', ulSpeed: formatBytes(ulSpeed) + '/s'
        });
    } catch(e) {}
}, 2000);

// ==========================================
// DISCORD WEBHOOK ENGINE
// ==========================================
async function sendDiscordWebhook(webhook, provider, dir, dbData) {
    if (!webhook) return;
    try {
        const folderName = dir.split('/').pop() || dir;
        let color = 15105570; 
        if (provider === 'Gofile') color = 3447003;
        if (provider === 'Drive') color = 3450963;
        
        let description = `**Master Folder:**\n[📁 Open Directory](${dbData.rootLink})\n\n**Direct Links (Hover to copy all):**\n`;
        let rawLinks = dbData.fileLinks.map(f => f.link).join('\n');
        let linksText = `\`\`\`\n${rawLinks}\n\`\`\``;
        
        if (description.length + linksText.length > 4000) {
            let truncatedLinks = rawLinks.substring(0, 3800);
            truncatedLinks = truncatedLinks.substring(0, truncatedLinks.lastIndexOf('\n'));
            linksText = `\`\`\`\n${truncatedLinks}\n\`\`\`\n*... (Too many links to fit. Open Master Folder!)*`;
        }
        description += linksText;

        const payload = {
            username: "NB Auto-Seedbox",
            avatar_url: "https://cdn-icons-png.flaticon.com/512/732/732221.png",
            embeds: [{
                title: `✅ Upload Complete - ${provider}`,
                color: color,
                fields: [{ name: "Stored Directory", value: `\`${folderName}\`` }],
                description: description,
                timestamp: new Date().toISOString()
            }]
        };
        await axios.post(webhook, payload);
    } catch(e) { console.error("Discord Webhook Background Error:", e.message); }
}

// ==========================================
// GOOGLE DRIVE AUTH 
// ==========================================
app.post('/api/drive/generate-url', (req, res) => {
    try {
        const { clientId, clientSecret } = req.body;
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost');
        const authUrl = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: ['https://www.googleapis.com/auth/drive'] });
        res.json({ success: true, url: authUrl });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post('/api/drive/get-token', async (req, res) => {
    try {
        const { clientId, clientSecret, code } = req.body;
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost');
        const { tokens } = await oauth2Client.getToken(code);
        res.json({ success: true, refreshToken: tokens.refresh_token });
    } catch (err) { res.json({ success: false, error: err.message }); }
});

app.post('/api/drive/status', async (req, res) => {
    try {
        const { clientId, clientSecret, refreshToken } = req.body;
        if (!clientId || !clientSecret || !refreshToken) return res.json({ connected: false });
        
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost');
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        const drive = google.drive({ version: 'v3', auth: oauth2Client });
        
        const about = await drive.about.get({ fields: 'storageQuota, user' });
        res.json({ connected: true, usage: about.data.storageQuota, user: about.data.user });
    } catch (e) { res.json({ connected: false, error: e.message }); }
});

// ==========================================
// API ROUTES & DATABASES
// ==========================================
app.get('/api/databases', (req, res) => { 
    res.json({ gofile: getDb(GOFILE_DB_PATH), pixeldrain: getDb(PIXELDRAIN_DB_PATH), drive: getDb(DRIVE_DB_PATH) }); 
});

app.get('/api/archive', (req, res) => {
    const goDb = getDb(GOFILE_DB_PATH); const pdDb = getDb(PIXELDRAIN_DB_PATH); const drDb = getDb(DRIVE_DB_PATH);
    const archived = []; const allKeys = new Set([...Object.keys(goDb), ...Object.keys(pdDb), ...Object.keys(drDb)]);

    allKeys.forEach(dir => {
        const localPath = path.join(DOWNLOADS_DIR, dir);
        if (!fs.existsSync(localPath)) {
            archived.push({ name: dir.split('/').pop() || dir, relativePath: dir, gofile: goDb[dir] || null, pixeldrain: pdDb[dir] || null, drive: drDb[dir] || null });
        }
    });
    res.json(archived);
});

app.post('/api/gofile/reset', async (req, res) => {
    const { dir, token } = req.body; const db = getDb(GOFILE_DB_PATH);
    if (db[dir] && db[dir].folderId) {
        try { await axios.delete('https://api.gofile.io/contents', { headers: { 'Authorization': `Bearer ${token}` }, data: { contentsId: db[dir].folderId } }); } catch(e) {}
        delete db[dir]; saveDb(GOFILE_DB_PATH, db);
    }
    res.json({ success: true });
});

app.post('/api/pixeldrain/reset', async (req, res) => {
    const { dir, token } = req.body; const db = getDb(PIXELDRAIN_DB_PATH);
    if (db[dir]) { 
        try {
            const rootPdPath = `/me/${dir.split('/').map(encodeURIComponent).join('/')}`;
            const authHeader = 'Basic ' + Buffer.from(':' + token).toString('base64');
            await axios.delete(`https://pixeldrain.com/api/filesystem${rootPdPath}`, { params: { recursive: 'true' }, headers: { 'Authorization': authHeader } });
        } catch(e) {}
        delete db[dir]; saveDb(PIXELDRAIN_DB_PATH, db); 
    }
    res.json({ success: true });
});

app.post('/api/drive/reset', async (req, res) => {
    const { dir, token } = req.body; const db = getDb(DRIVE_DB_PATH);
    if (db[dir] && db[dir].folderId) {
        try {
            const oauth2Client = new google.auth.OAuth2(token.clientId, token.clientSecret, 'http://localhost');
            oauth2Client.setCredentials({ refresh_token: token.refreshToken });
            const drive = google.drive({ version: 'v3', auth: oauth2Client });
            await drive.files.delete({ fileId: db[dir].folderId });
        } catch(e) {}
        delete db[dir]; saveDb(DRIVE_DB_PATH, db); 
    }
    res.json({ success: true });
});

app.post('/api/archive/delete', (req, res) => {
    const { dir } = req.body;
    const goDb = getDb(GOFILE_DB_PATH); const pdDb = getDb(PIXELDRAIN_DB_PATH); const drDb = getDb(DRIVE_DB_PATH);
    if (goDb[dir]) { delete goDb[dir]; saveDb(GOFILE_DB_PATH, goDb); }
    if (pdDb[dir]) { delete pdDb[dir]; saveDb(PIXELDRAIN_DB_PATH, pdDb); }
    if (drDb[dir]) { delete drDb[dir]; saveDb(DRIVE_DB_PATH, drDb); }
    res.json({ success: true });
});

// --- NEW MULTI-SELECT CRAWLER API ---
app.post('/api/deep-extract', (req, res) => {
    try {
        const { paths } = req.body;
        const host = req.get('host');
        let results = [];
        
        for (let p of paths) {
            const resolvedPath = path.join(DOWNLOADS_DIR, p);
            if (!resolvedPath.startsWith(DOWNLOADS_DIR) || !fs.existsSync(resolvedPath)) continue;
            
            if (fs.statSync(resolvedPath).isDirectory()) {
                const deepFiles = getAllDeepFiles(resolvedPath, p);
                deepFiles.forEach(f => {
                    results.push({ url: `http://${host}/stream/${f.split('/').map(encodeURIComponent).join('/')}`, path: f });
                });
            } else {
                results.push({ url: `http://${host}/stream/${p.split('/').map(encodeURIComponent).join('/')}`, path: p });
            }
        }
        res.json(results);
    } catch(e) { res.status(500).json([]); }
});

async function authenticateWithQBittorrent() {
    try {
        const params = new URLSearchParams(); params.append('username', QBIT_USER); params.append('password', QBIT_PASS);
        const res = await fetch(`${QBIT_API_URL}/api/v2/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
        const setCookieHeader = res.headers.get('set-cookie');
        if (setCookieHeader) { const match = setCookieHeader.match(/SID=([^;]+)/); if (match) { qbitAuthCookie = match[0]; return true; } }
        return false;
    } catch (e) { return false; }
}

async function fetchQBittorrentList() {
    try {
        if (!qbitAuthCookie) await authenticateWithQBittorrent();
        let res = await fetch(`${QBIT_API_URL}/api/v2/torrents/info`, { headers: { 'Cookie': qbitAuthCookie } });
        if (res.status === 403) { await authenticateWithQBittorrent(); res = await fetch(`${QBIT_API_URL}/api/v2/torrents/info`, { headers: { 'Cookie': qbitAuthCookie } }); }
        const data = await res.json(); return Array.isArray(data) ? data : [];
    } catch (e) { return []; }
}

const QBIT_STATES = { 'downloading': 'Downloading', 'metaDL': 'Fetching Meta', 'stalledDL': 'Stalled', 'checkingDL': 'Checking', 'forcedDL': 'Forced DL', 'queuedDL': 'Queued', 'allocating': 'Allocating Space', 'uploading': 'Finished', 'stalledUP': 'Finished', 'checkingUP': 'Checking Files', 'forcedUP': 'Finished', 'queuedUP': 'Finished', 'pausedDL': 'Paused', 'pausedUP': 'Finished', 'error': 'Error', 'missingFiles': 'Missing Files', 'checkingResumeData': 'Checking Data', 'moving': 'Moving' };

function getAllDeepFiles(dirPath, baseRoute) {
    let results = []; const items = fs.readdirSync(dirPath);
    for (const item of items) {
        const fullPath = path.join(dirPath, item);
        if (fs.statSync(fullPath).isDirectory()) { results = results.concat(getAllDeepFiles(fullPath, baseRoute ? `${baseRoute}/${item}` : item)); } 
        else { results.push(baseRoute ? `${baseRoute}/${item}` : item); }
    }
    return results;
}

app.get('/api/export-links', (req, res) => {
    try {
        const targetDir = req.query.dir || ''; const resolvedPath = path.join(DOWNLOADS_DIR, targetDir);
        if (!resolvedPath.startsWith(DOWNLOADS_DIR) || !fs.existsSync(resolvedPath)) return res.json([]);
        let links = []; const host = req.get('host');
        if (fs.statSync(resolvedPath).isDirectory()) {
            const rawLinks = getAllDeepFiles(resolvedPath, targetDir);
            links = rawLinks.map(l => `http://${host}/stream/${l.split('/').map(encodeURIComponent).join('/')}`);
        } else { links = [`http://${host}/stream/${targetDir.split('/').map(encodeURIComponent).join('/')}`]; }
        res.json(links);
    } catch(e) { res.status(500).json([]); }
});

app.get('/api/files', async (req, res) => {
    try {
        const targetSubDir = req.query.dir || ''; const resolvedPath = path.join(DOWNLOADS_DIR, targetSubDir);
        if (!resolvedPath.startsWith(DOWNLOADS_DIR)) return res.status(403).json({ error: 'Access Denied' });
        if (!fs.existsSync(resolvedPath)) return res.json([]);

        const diskItems = await fs.readdir(resolvedPath);
        const qbitTorrents = await fetchQBittorrentList();

        const payload = diskItems.map(name => {
            const fullPath = path.join(resolvedPath, name);
            let stat; try { stat = fs.statSync(fullPath); } catch(e) { return null; }

            const isFolder = stat.isDirectory();
            const relativePath = targetSubDir ? `${targetSubDir}/${name}` : name;
            const topLevelParent = targetSubDir ? targetSubDir.split('/')[0] : name;
            const activeTorrentMatch = qbitTorrents.find(t => t.name === topLevelParent);

            let status = 'Syncing...'; let progress = 0; let currentSpeed = ''; let totalBytes = stat.size;

            if (activeTorrentMatch) {
                progress = Math.round(activeTorrentMatch.progress * 100);
                if (relativePath === topLevelParent) totalBytes = activeTorrentMatch.total_size;
                const rawState = activeTorrentMatch.state; status = QBIT_STATES[rawState] || rawState; 
                if (rawState.includes('DL') || rawState === 'allocating') { currentSpeed = `↓ ${(activeTorrentMatch.dlspeed / 1024 / 1024).toFixed(2)} MB/s`; } 
                else if (rawState.includes('UP') && activeTorrentMatch.upspeed > 0) { currentSpeed = `▲ ${(activeTorrentMatch.upspeed / 1024 / 1024).toFixed(2)} MB/s`; }
            }

            let hasVideo = false;
            if (isFolder) { try { const deepestFiles = fs.readdirSync(fullPath); hasVideo = deepestFiles.some(f => /\.(mp4|mkv|avi|mov|webm)$/i.test(f)); } catch(e){} } 
            else { hasVideo = /\.(mp4|mkv|avi|mov|webm)$/i.test(name); }

            return { name, relativePath: relativePath.replace(/\\/g, '/'), isFolder, size: formatBytes(totalBytes), status, progress, speed: currentSpeed, hasVideo, url: `/stream/${relativePath.split('/').map(encodeURIComponent).join('/')}` };
        }).filter(Boolean);

        res.json(payload);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// BACKGROUND UPLOAD ENGINES 
// ==========================================
io.on('connection', (socket) => {
    socket.emit('sync_active_uploads', activeUploads);
    socket.emit('sync_databases', { gofile: getDb(GOFILE_DB_PATH), pixeldrain: getDb(PIXELDRAIN_DB_PATH), drive: getDb(DRIVE_DB_PATH) });

    socket.on('start_upload', ({ provider, dir, token, webhook }) => {
        const taskId = `${provider}_${dir}`;
        if (activeUploads[taskId]) { return socket.emit('upload_error', `This folder is already uploading to ${provider}.`); }
        activeUploads[taskId] = { taskId, provider, dir, currentFile: 'Initializing...', currentNum: 0, totalFiles: 0, percent: 0, speed: '0 MB/s' };
        io.emit('sync_active_uploads', activeUploads);

        if (provider === 'Gofile') { runGofileUpload(taskId, dir, token, webhook); } 
        else if (provider === 'Pixeldrain') { runPixeldrainUpload(taskId, dir, token, webhook); }
        else if (provider === 'Drive') { runDriveUpload(taskId, dir, token, webhook); }
    });
});

async function runGofileUpload(taskId, dir, token, webhook) {
    const resolvedPath = path.join(DOWNLOADS_DIR, dir);
    const allFiles = getAllDeepFiles(resolvedPath, dir);
    if (allFiles.length === 0) { delete activeUploads[taskId]; io.emit('sync_active_uploads', activeUploads); return; }

    const db = getDb(GOFILE_DB_PATH);
    let parentFolderId = null; let rootLink = null; let fileLinks = [];
    activeUploads[taskId].totalFiles = allFiles.length;

    try {
        let bestServer = 'store1';
        try {
            const serverRes = await axios.get('https://api.gofile.io/servers');
            if (serverRes.data.status === 'ok') bestServer = serverRes.data.data.servers[0].name;
        } catch(e) {}

        const uploadEndpoint = `https://${bestServer}.gofile.io/contents/uploadfile`;

        for (let i = 0; i < allFiles.length; i++) {
            const relativeFilePath = allFiles[i].replace(/\\/g, '/'); const fullFilePath = path.join(DOWNLOADS_DIR, relativeFilePath);
            const fileName = path.basename(fullFilePath); const fileStat = fs.statSync(fullFilePath);

            activeUploads[taskId].currentFile = relativeFilePath; activeUploads[taskId].currentNum = i + 1;
            io.emit('sync_active_uploads', activeUploads);

            try {
                const form = new FormData();
                form.append('file', fs.createReadStream(fullFilePath, { highWaterMark: 1024 * 1024 }), { knownLength: fileStat.size });
                if (parentFolderId) form.append('folderId', parentFolderId);

                let lastLoaded = 0; let lastTime = Date.now();
                const response = await axios.post(uploadEndpoint, form, {
                    httpsAgent, headers: { ...form.getHeaders(), 'Authorization': `Bearer ${token}` },
                    maxContentLength: Infinity, maxBodyLength: Infinity,
                    onUploadProgress: (pEvent) => {
                        const total = fileStat.size; const percent = Math.round((pEvent.loaded * 100) / total);
                        const timeDiff = (Date.now() - lastTime) / 1000;
                        if (timeDiff > 0.5 || percent === 100) {
                            const speedBps = (pEvent.loaded - lastLoaded) / timeDiff;
                            activeUploads[taskId].percent = percent; activeUploads[taskId].speed = formatBytes(speedBps) + '/s';
                            io.emit('sync_active_uploads', activeUploads); lastLoaded = pEvent.loaded; lastTime = Date.now();
                        }
                    }
                });

                const data = response.data?.data;
                if (!data) throw new Error("Gofile API rejected the file.");

                if (!parentFolderId) { parentFolderId = data.parentFolder; rootLink = `https://gofile.io/d/${parentFolderId}`; }
                
                const directLink = data.downloadPage || data.guestLink || `https://gofile.io/d/${parentFolderId}`;
                fileLinks.push({ name: relativeFilePath, link: directLink });

            } catch (fileErr) { console.error(`Gofile skipped ${fileName}:`, fileErr.message); }
        }

        db[dir] = { folderId: parentFolderId, rootLink, fileLinks };
        saveDb(GOFILE_DB_PATH, db);
        io.emit('upload_complete', { provider: 'Gofile', path: dir, data: db[dir], taskId });
        io.emit('sync_databases', { gofile: db, pixeldrain: getDb(PIXELDRAIN_DB_PATH), drive: getDb(DRIVE_DB_PATH) });
        if (webhook) await sendDiscordWebhook(webhook, 'Gofile', dir, db[dir]);

    } catch (err) { io.emit('upload_error', `Gofile Error: ${err.message}`); } 
    delete activeUploads[taskId]; io.emit('sync_active_uploads', activeUploads);
}

function uploadStreamToDrive(uploadUrl, filePath, fileSize, onProgress) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(uploadUrl);
        const options = {
            hostname: urlObj.hostname, port: urlObj.port || 443, path: urlObj.pathname + urlObj.search, method: 'PUT',
            headers: { 'Content-Length': fileSize.toString(), 'Connection': 'close' }
        };

        const req = https.request(options, (res) => {
            let responseBody = ''; res.on('data', (chunk) => responseBody += chunk.toString());
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(responseBody)); } catch(e) { resolve({}); }
                } else { reject(new Error(`API Error ${res.statusCode}: ${responseBody}`)); }
            });
        });

        req.on('error', (e) => reject(e));

        const readStream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 }); 
        let uploaded = 0; let lastTime = Date.now(); let lastLoaded = 0;

        readStream.on('data', (chunk) => {
            uploaded += chunk.length; const timeDiff = (Date.now() - lastTime) / 1000;
            if (timeDiff > 0.5 || uploaded === fileSize) {
                const speedBps = (uploaded - lastLoaded) / timeDiff;
                onProgress(uploaded, fileSize, speedBps);
                lastLoaded = uploaded; lastTime = Date.now();
            }
        });
        readStream.pipe(req); 
    });
}

async function runDriveUpload(taskId, dir, authData, webhook) {
    const resolvedPath = path.join(DOWNLOADS_DIR, dir);
    const allFiles = getAllDeepFiles(resolvedPath, dir);
    if (allFiles.length === 0) { delete activeUploads[taskId]; io.emit('sync_active_uploads', activeUploads); return; }

    const db = getDb(DRIVE_DB_PATH);
    let fileLinks = [];
    activeUploads[taskId].totalFiles = allFiles.length;

    try {
        const oauth2Client = new google.auth.OAuth2(authData.clientId, authData.clientSecret, 'http://localhost');
        oauth2Client.setCredentials({ refresh_token: authData.refreshToken });
        const drive = google.drive({ version: 'v3', auth: oauth2Client });
        
        const tokenRes = await oauth2Client.getAccessToken();
        const accessToken = tokenRes.token;

        activeUploads[taskId].currentFile = 'Creating Drive Folder...'; io.emit('sync_active_uploads', activeUploads);

        const folderName = dir.split('/').pop() || dir;
        const folderRes = await drive.files.create({
            requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
            fields: 'id, webViewLink'
        });
        const parentId = folderRes.data.id;
        const rootLink = folderRes.data.webViewLink;

        await drive.permissions.create({ fileId: parentId, requestBody: { role: 'reader', type: 'anyone' } });

        let totalFolderSize = 0;
        const fileStats = [];
        for (let i = 0; i < allFiles.length; i++) {
            const relativeFilePath = allFiles[i].replace(/\\/g, '/'); 
            const fullFilePath = path.join(DOWNLOADS_DIR, relativeFilePath);
            const fileStat = fs.statSync(fullFilePath);
            totalFolderSize += fileStat.size;
            fileStats.push({ relativeFilePath, fullFilePath, fileName: path.basename(fullFilePath), size: fileStat.size });
        }

        let globalUploadedBytes = 0; let lastLoaded = 0; let lastTime = Date.now(); let completedFiles = 0;
        const MAX_CONCURRENT = 2; let currentIndex = 0;

        await new Promise((resolve, reject) => {
            let activeWorkers = 0; let hasError = false;

            function startWorker() {
                if (hasError) return;
                if (currentIndex >= fileStats.length) {
                    if (activeWorkers === 0) resolve();
                    return;
                }

                const fileObj = fileStats[currentIndex++];
                activeWorkers++;
                
                activeUploads[taskId].currentFile = `[High-Speed Pipe] Uploading...`;
                io.emit('sync_active_uploads', activeUploads);

                uploadSingleFileWithRetry(fileObj).then(() => {
                    completedFiles++;
                    activeUploads[taskId].currentNum = completedFiles;
                    activeWorkers--;
                    startWorker();
                }).catch(err => {
                    hasError = true;
                    reject(err);
                });
            }

            async function uploadSingleFileWithRetry(fileObj) {
                let attempts = 0; const maxAttempts = 3;

                while (attempts < maxAttempts) {
                    let localUploaded = 0;
                    try {
                        const initRes = await axios.post(
                            'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
                            { name: fileObj.fileName, parents: [parentId] },
                            { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-Upload-Content-Length': fileObj.size } }
                        );
                        
                        const uploadUrl = initRes.headers.location;

                        const uploadRes = await uploadStreamToDrive(uploadUrl, fileObj.fullFilePath, fileObj.size, (loaded, total, speedBps) => {
                            const chunk = loaded - localUploaded;
                            localUploaded = loaded;
                            globalUploadedBytes += chunk;
                            
                            const percent = Math.min(100, Math.round((globalUploadedBytes * 100) / totalFolderSize));
                            const timeDiff = (Date.now() - lastTime) / 1000;
                            
                            if (timeDiff > 0.5 || globalUploadedBytes === totalFolderSize) {
                                const globalSpeed = (globalUploadedBytes - lastLoaded) / timeDiff;
                                activeUploads[taskId].percent = percent; 
                                activeUploads[taskId].speed = percent === 100 ? 'Processing...' : formatBytes(globalSpeed) + '/s';
                                io.emit('sync_active_uploads', activeUploads); 
                                lastLoaded = globalUploadedBytes; lastTime = Date.now();
                            }
                        });
                        
                        fileLinks.push({ name: fileObj.relativeFilePath, link: `https://drive.google.com/file/d/${uploadRes.id}/view` });
                        break; 
                    } catch (err) {
                        attempts++;
                        globalUploadedBytes -= localUploaded; 
                        if (attempts >= maxAttempts) throw err;
                        activeUploads[taskId].currentFile = `[Network Drop] Retrying ${fileObj.fileName} (${attempts}/3)...`;
                        io.emit('sync_active_uploads', activeUploads);
                        await new Promise(r => setTimeout(r, 4000)); 
                    }
                }
            }
            for (let i = 0; i < MAX_CONCURRENT && i < fileStats.length; i++) { startWorker(); }
        });

        db[dir] = { folderId: parentId, rootLink, fileLinks };
        saveDb(DRIVE_DB_PATH, db);
        io.emit('upload_complete', { provider: 'Drive', path: dir, data: db[dir], taskId });
        io.emit('sync_databases', { gofile: getDb(GOFILE_DB_PATH), pixeldrain: getDb(PIXELDRAIN_DB_PATH), drive: db });
        if (webhook) await sendDiscordWebhook(webhook, 'Drive', dir, db[dir]);

    } catch (err) { io.emit('upload_error', `Google Drive Error: ${err.message}.`); }
    delete activeUploads[taskId]; io.emit('sync_active_uploads', activeUploads);
}

function uploadStreamToPixeldrain(url, authHeader, filePath, fileSize, onProgress) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname, port: urlObj.port || 443, path: urlObj.pathname + urlObj.search, method: 'PUT',
            headers: { 'Authorization': authHeader, 'Content-Length': fileSize.toString(), 'Content-Type': 'application/octet-stream', 'Connection': 'close' }
        };
        const req = https.request(options, (res) => {
            let responseBody = ''; res.on('data', (chunk) => responseBody += chunk.toString());
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) { try { resolve(JSON.parse(responseBody)); } catch(e) { reject(new Error("Invalid JSON")); } } 
                else { reject(new Error(`API Error ${res.statusCode}: ${responseBody}`)); }
            });
        });
        req.on('error', (e) => reject(e));
        const readStream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 }); 
        let uploaded = 0; let lastTime = Date.now(); let lastLoaded = 0;
        readStream.on('data', (chunk) => {
            uploaded += chunk.length; const timeDiff = (Date.now() - lastTime) / 1000;
            if (timeDiff > 0.5 || uploaded === fileSize) {
                const speedBps = (uploaded - lastLoaded) / timeDiff;
                onProgress(uploaded, fileSize, speedBps);
                lastLoaded = uploaded; lastTime = Date.now();
            }
        });
        readStream.pipe(req); 
    });
}

async function runPixeldrainUpload(taskId, dir, apiKey, webhook) {
    const resolvedPath = path.join(DOWNLOADS_DIR, dir);
    const allFiles = getAllDeepFiles(resolvedPath, dir);
    if (allFiles.length === 0) { delete activeUploads[taskId]; io.emit('sync_active_uploads', activeUploads); return; }

    const db = getDb(PIXELDRAIN_DB_PATH);
    const authHeader = 'Basic ' + Buffer.from(':' + apiKey).toString('base64');
    let uploadedFiles = []; let fileLinks = [];

    activeUploads[taskId].totalFiles = allFiles.length;
    let useFilesystem = true; let rootLink = '';
    const rootPdPath = `/me/${dir.split('/').map(encodeURIComponent).join('/')}`;

    try {
        activeUploads[taskId].currentFile = 'Building Exact Folder Structure...'; io.emit('sync_active_uploads', activeUploads);
        try {
            const mkdirParams = new URLSearchParams(); mkdirParams.append('action', 'mkdirall');
            await axios.post(`https://pixeldrain.com/api/filesystem${rootPdPath}`, mkdirParams.toString(), { headers: { 'Authorization': authHeader, 'Content-Type': 'application/x-www-form-urlencoded' } });
        } catch (mkdirErr) {
            if (mkdirErr.response && mkdirErr.response.data && mkdirErr.response.data.value !== 'node_already_exists') throw mkdirErr;
        }
        const shareParams = new URLSearchParams(); shareParams.append('action', 'update'); shareParams.append('shared', 'true');
        const shareRes = await axios.post(`https://pixeldrain.com/api/filesystem${rootPdPath}`, shareParams.toString(), { headers: { 'Authorization': authHeader, 'Content-Type': 'application/x-www-form-urlencoded' } });
        rootLink = `https://pixeldrain.com/d/${shareRes.data.id}`;
    } catch (err) { useFilesystem = false; }

    try {
        for (let i = 0; i < allFiles.length; i++) {
            const relativeFilePath = allFiles[i].replace(/\\/g, '/'); const fullFilePath = path.join(DOWNLOADS_DIR, relativeFilePath);
            const fileName = path.basename(fullFilePath); const fileStat = fs.statSync(fullFilePath);

            activeUploads[taskId].currentFile = relativeFilePath; activeUploads[taskId].currentNum = i + 1;
            io.emit('sync_active_uploads', activeUploads);

            try {
                let fileId;
                if (useFilesystem) {
                    const fileDir = relativeFilePath.split('/').slice(0, -1).join('/');
                    if (fileDir) {
                        const dirPdPath = `/me/${fileDir.split('/').map(encodeURIComponent).join('/')}`;
                        const mkdirParams = new URLSearchParams(); mkdirParams.append('action', 'mkdirall');
                        await axios.post(`https://pixeldrain.com/api/filesystem${dirPdPath}`, mkdirParams.toString(), { headers: { 'Authorization': authHeader, 'Content-Type': 'application/x-www-form-urlencoded' } }).catch(() => {});
                    }

                    const pdPath = `/me/${relativeFilePath.split('/').map(encodeURIComponent).join('/')}`;
                    const url = `https://pixeldrain.com/api/filesystem${pdPath}?make_parents=true`;

                    const response = await uploadStreamToPixeldrain(url, authHeader, fullFilePath, fileStat.size, (loaded, total, speedBps) => {
                        const percent = Math.round((loaded * 100) / total);
                        activeUploads[taskId].percent = percent; 
                        activeUploads[taskId].speed = percent === 100 ? 'Processing on Server...' : formatBytes(speedBps) + '/s';
                        io.emit('sync_active_uploads', activeUploads);
                    });
                    
                    fileId = response.id;
                    if (!fileId) {
                        const statRes = await axios.get(`https://pixeldrain.com/api/filesystem${pdPath}?stat`, { headers: { 'Authorization': authHeader } });
                        fileId = statRes.data.id;
                    }
                } else {
                    activeUploads[taskId].currentFile = `[FREE TIER - FLATTENING] ${fileName}`;
                    const url = `https://pixeldrain.com/api/file/${encodeURIComponent(fileName)}`;

                    const response = await uploadStreamToPixeldrain(url, authHeader, fullFilePath, fileStat.size, (loaded, total, speedBps) => {
                        const percent = Math.round((loaded * 100) / total);
                        activeUploads[taskId].percent = percent; 
                        activeUploads[taskId].speed = percent === 100 ? 'Processing on Server...' : formatBytes(speedBps) + '/s';
                        io.emit('sync_active_uploads', activeUploads);
                    });
                    fileId = response.id; uploadedFiles.push({ id: fileId });
                }
                if (fileId) fileLinks.push({ name: relativeFilePath, link: `https://pixeldrain.com/api/file/${fileId}?download` });
            } catch (fileErr) { console.error(`Pixeldrain skipped ${fileName}:`, fileErr.message); }
        }

        if (!useFilesystem) {
            activeUploads[taskId].currentFile = 'Grouping into Pixeldrain List...'; io.emit('sync_active_uploads', activeUploads);
            const listRes = await axios.post('https://pixeldrain.com/api/list', { title: dir.split('/').pop(), anonymous: false, files: uploadedFiles }, { headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' } });
            rootLink = `https://pixeldrain.com/l/${listRes.data.id}`;
        }
        
        db[dir] = { listId: useFilesystem ? 'filesystem' : 'list', rootLink, fileLinks };
        saveDb(PIXELDRAIN_DB_PATH, db);
        io.emit('upload_complete', { provider: 'Pixeldrain', path: dir, data: db[dir], taskId });
        io.emit('sync_databases', { gofile: getDb(GOFILE_DB_PATH), pixeldrain: db, drive: getDb(DRIVE_DB_PATH) });

        if (webhook) await sendDiscordWebhook(webhook, 'Pixeldrain', dir, db[dir]);

    } catch (err) { io.emit('upload_error', `Pixeldrain Error: ${err.message}`); }
    delete activeUploads[taskId]; io.emit('sync_active_uploads', activeUploads);
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`NB Downloader Smart Crawler Engine Live on Port ${PORT}`);
    authenticateWithQBittorrent();
});