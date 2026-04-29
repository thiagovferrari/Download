/**
 * Lon Download — Server (Vercel Entry Point)
 */

const express = require('express');
const { spawn } = require('child_process');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const crypto  = require('crypto');

const app  = express();
const PORT = 3000;

// ─── Binary paths ─────────────────────────────────────────────────────────────
let YTDLP_BIN = 'yt-dlp';
let FFMPEG_BIN = 'ffmpeg';

try {
  const ffmpeg = require('@ffmpeg-installer/ffmpeg');
  FFMPEG_BIN = ffmpeg.path;
  
  const ytPkgPath = require.resolve('yt-dlp-exec/package.json');
  const ytBaseDir = path.dirname(ytPkgPath);
  const ext = os.platform() === 'win32' ? '.exe' : '';
  const resolvedPath = path.join(ytBaseDir, 'bin', `yt-dlp${ext}`);
  
  if (fs.existsSync(resolvedPath)) {
    YTDLP_BIN = resolvedPath;
    if (os.platform() !== 'win32') {
      try { fs.chmodSync(YTDLP_BIN, 0o755); } catch (e) { console.error('Chmod failed:', e); }
    }
  }
} catch (e) {
  console.warn('Binary resolution failed, using fallbacks:', e.message);
  YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
  FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// In-memory store
const pendingFiles = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isValidYouTubeUrl(url) {
  try {
    const u = new URL(url);
    return /^(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)$/.test(u.hostname);
  } catch { return false; }
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ─── Route: Video Info ────────────────────────────────────────────────────────
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url || !isValidYouTubeUrl(url)) return res.status(400).json({ error: 'URL inválida.' });

  const proc = spawn(YTDLP_BIN, [
    '--cache-dir', path.join(os.tmpdir(), 'yt-dlp-cache'),
    '--dump-json', '--no-playlist', '--no-warnings',
    '--ffmpeg-location', FFMPEG_BIN,
    url,
  ]);

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', d => stdout += d.toString());
  proc.stderr.on('data', d => stderr += d.toString());

  proc.on('close', code => {
    if (code !== 0) return res.status(400).json({ error: 'Erro ao obter info.' });
    try {
      const info = JSON.parse(stdout.trim().split('\n').pop());
      res.json({
        title: info.title || 'Vídeo',
        duration: info.duration_string || '',
        thumbnail: info.thumbnail || '',
        channel: info.uploader || '',
      });
    } catch { res.status(500).json({ error: 'Erro no parse.' }); }
  });
});

// ─── Route: Download (SSE) ────────────────────────────────────────────────────
app.get('/api/download', (req, res) => {
  const { url } = req.query;
  if (!url || !isValidYouTubeUrl(url)) return res.status(400).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 5000);
  const sessionId = crypto.randomUUID();
  const tmpDir = os.tmpdir();

  const cleanup = () => {
    clearInterval(heartbeat);
    res.end();
  };

  // Run everything in a block to allow async/await for Cobalt
  (async () => {
    try {
      const cobaltRes = await fetch('https://api.cobalt.tools/api/json', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, vQuality: '1080' })
      });
      const cobaltData = await cobaltRes.json();
      if (cobaltData && cobaltData.url) {
        sendSSE(res, { type: 'info', title: 'Processado via Nuvem' });
        sendSSE(res, { type: 'progress', percent: 100 });
        sendSSE(res, { type: 'complete', externalUrl: cobaltData.url, filename: `video_${sessionId}.mp4` });
        return cleanup();
      }
    } catch (e) { console.warn('Cobalt failed:', e.message); }

    // Fallback to local yt-dlp
    const infoProc = spawn(YTDLP_BIN, [
      '--cache-dir', path.join(tmpDir, 'yt-dlp-cache'),
      '--dump-json', '--no-playlist', '--no-warnings',
      '--ffmpeg-location', FFMPEG_BIN,
      url,
    ]);

    let infoOut = '';
    let infoErr = '';
    infoProc.stdout.on('data', d => infoOut += d.toString());
    infoProc.stderr.on('data', d => infoErr += d.toString());

    infoProc.on('close', code => {
      if (code !== 0) {
        sendSSE(res, { type: 'error', message: 'Erro ao obter informações locais.' });
        return cleanup();
      }

      let title = 'video';
      try { title = JSON.parse(infoOut.trim().split('\n').pop()).title || 'video'; } catch(e) {}
      const safeTitle = sanitizeFilename(title);
      const outputPath = path.join(tmpDir, `lon_${sessionId}.mp4`);

      sendSSE(res, { type: 'info', title: safeTitle });

      const dlProc = spawn(YTDLP_BIN, [
        '--cache-dir', path.join(tmpDir, 'yt-dlp-cache'),
        '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '--newline', '--no-playlist', '--no-warnings',
        '--ffmpeg-location', FFMPEG_BIN,
        '-o', outputPath,
        url,
      ]);

      dlProc.stdout.on('data', data => {
        const line = data.toString();
        const pctMatch = line.match(/\[download\]\s+([\d.]+)%/);
        if (pctMatch) sendSSE(res, { type: 'progress', percent: parseFloat(pctMatch[1]) });
      });

      dlProc.on('close', dlCode => {
        if (dlCode !== 0) {
          sendSSE(res, { type: 'error', message: 'Falha no download local.' });
          return cleanup();
        }
        pendingFiles.set(sessionId, {
          path: outputPath,
          filename: `${safeTitle}.mp4`,
          expires: Date.now() + 10 * 60 * 1000
        });
        sendSSE(res, { type: 'complete', sessionId, filename: `${safeTitle}.mp4` });
        cleanup();
      });
    });
  })();

  req.on('close', () => clearInterval(heartbeat));
});

// ─── Route: Serve File ────────────────────────────────────────────────────────
app.get('/api/file/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const entry = pendingFiles.get(sessionId);
  if (!entry || !fs.existsSync(entry.path)) return res.status(404).end();

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(entry.filename)}"`);
  res.setHeader('Content-Type', 'video/mp4');
  fs.createReadStream(entry.path).pipe(res);
});

// ─── Start ─────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`Rodando em http://localhost:${PORT}`));
}

module.exports = app;
