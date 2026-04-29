/**
 * Lon Download — Server
 * YouTube video downloader via yt-dlp
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
// yt-dlp installed via pip (not on system PATH — use full path)
const YTDLP_BIN  = 'C:\\Users\\profi\\AppData\\Roaming\\Python\\Python314\\Scripts\\yt-dlp.exe';
// ffmpeg bundled in project /bin
const FFMPEG_BIN = path.join(__dirname, 'bin', 'ffmpeg.exe');

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store for completed downloads (cleared after serve)
const pendingFiles = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isValidYouTubeUrl(url) {
  try {
    const u = new URL(url);
    return (
      /^(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)$/.test(u.hostname)
    );
  } catch {
    return false;
  }
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ─── Route: Video Info ────────────────────────────────────────────────────────
app.get('/api/info', (req, res) => {
  const { url } = req.query;

  if (!url || !isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'URL do YouTube inválida.' });
  }

  const proc = spawn(YTDLP_BIN, [
    '--dump-json',
    '--no-playlist',
    '--no-warnings',
    '--ffmpeg-location', FFMPEG_BIN,
    url,
  ]);

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', d => { stdout += d.toString(); });
  proc.stderr.on('data', d => { stderr += d.toString(); });

  proc.on('close', code => {
    if (code !== 0) {
      const msg = stderr.includes('Video unavailable')
        ? 'Vídeo indisponível ou privado.'
        : 'Não foi possível obter informações do vídeo. Verifique se yt-dlp está instalado.';
      return res.status(400).json({ error: msg });
    }
    try {
      const info = JSON.parse(stdout.trim().split('\n').pop());
      res.json({
        title:     info.title        || 'Vídeo sem título',
        duration:  info.duration_string || '',
        thumbnail: info.thumbnail    || '',
        channel:   info.uploader     || '',
        views:     info.view_count   || 0,
      });
    } catch {
      res.status(500).json({ error: 'Falha ao processar informações do vídeo.' });
    }
  });
});

// ─── Route: Download (SSE) ────────────────────────────────────────────────────
app.get('/api/download', (req, res) => {
  const { url } = req.query;

  if (!url || !isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'URL do YouTube inválida.' });
  }

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sessionId = crypto.randomUUID();
  const tmpDir    = os.tmpdir();

  // ── Step 1: Get title ──
  const infoProc = spawn(YTDLP_BIN, [
    '--dump-json', '--no-playlist', '--no-warnings',
    '--ffmpeg-location', FFMPEG_BIN,
    url,
  ]);

  let infoOut = '';
  infoProc.stdout.on('data', d => { infoOut += d.toString(); });

  infoProc.on('close', infoCode => {
    let title = 'video';

    if (infoCode === 0) {
      try {
        const info = JSON.parse(infoOut.trim().split('\n').pop());
        title = info.title || 'video';
      } catch { /* use fallback */ }
    }

    const safeTitle  = sanitizeFilename(title);
    const outputPath = path.join(tmpDir, `lon_${sessionId}.mp4`);

    sendSSE(res, { type: 'info', title: safeTitle });

    // ── Step 2: Download ──
    const dlProc = spawn(YTDLP_BIN, [
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--newline',
      '--no-playlist',
      '--no-warnings',
      '--ffmpeg-location', FFMPEG_BIN,
      '-o', outputPath,
      url,
    ]);

    dlProc.stdout.on('data', data => {
      const line = data.toString();

      // Parse yt-dlp progress lines:
      // [download]  45.3% of 123.45MiB at 2.34MiB/s ETA 00:23
      const pctMatch   = line.match(/\[download\]\s+([\d.]+)%/);
      const sizeMatch  = line.match(/of\s+([\d.]+\s*\w+iB)/);
      const speedMatch = line.match(/at\s+([\d.]+\s*\w+iB\/s)/);
      const etaMatch   = line.match(/ETA\s+([\d:]+)/);

      if (pctMatch) {
        sendSSE(res, {
          type:    'progress',
          percent: parseFloat(pctMatch[1]),
          size:    sizeMatch  ? sizeMatch[1]  : null,
          speed:   speedMatch ? speedMatch[1] : null,
          eta:     etaMatch   ? etaMatch[1]   : null,
        });
      }
    });

    dlProc.stderr.on('data', data => {
      const line = data.toString();
      if (line.includes('ERROR') || line.includes('error')) {
        sendSSE(res, { type: 'warning', message: line.trim() });
      }
    });

    dlProc.on('close', dlCode => {
      if (dlCode !== 0) {
        sendSSE(res, { type: 'error', message: 'Falha no download. Verifique se yt-dlp e ffmpeg estão instalados.' });
        res.end();
        return;
      }

      // Resolve final file (yt-dlp may rename)
      let finalPath = outputPath;
      if (!fs.existsSync(finalPath)) {
        const candidates = fs.readdirSync(tmpDir)
          .filter(f => f.startsWith(`lon_${sessionId}`))
          .map(f => path.join(tmpDir, f));
        if (candidates.length === 0) {
          sendSSE(res, { type: 'error', message: 'Arquivo não encontrado após download.' });
          res.end();
          return;
        }
        finalPath = candidates[0];
      }

      // Register for pickup
      pendingFiles.set(sessionId, {
        path:     finalPath,
        filename: `${safeTitle}.mp4`,
        expires:  Date.now() + 10 * 60 * 1000, // 10 min
      });

      sendSSE(res, { type: 'complete', sessionId, filename: `${safeTitle}.mp4` });
      res.end();
    });
  });

  // Handle client disconnect
  req.on('close', () => {
    infoProc.kill?.('SIGTERM');
  });
});

// ─── Route: Serve File ────────────────────────────────────────────────────────
app.get('/api/file/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const entry = pendingFiles.get(sessionId);

  if (!entry) {
    return res.status(404).json({ error: 'Arquivo não encontrado ou expirado.' });
  }
  if (Date.now() > entry.expires) {
    pendingFiles.delete(sessionId);
    return res.status(410).json({ error: 'Link expirado. Faça o download novamente.' });
  }
  if (!fs.existsSync(entry.path)) {
    pendingFiles.delete(sessionId);
    return res.status(404).json({ error: 'Arquivo não encontrado no disco.' });
  }

  const stat = fs.statSync(entry.path);
  const encodedName = encodeURIComponent(entry.filename);

  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', stat.size);

  const stream = fs.createReadStream(entry.path);
  stream.pipe(res);

  stream.on('close', () => {
    setTimeout(() => {
      try { fs.unlinkSync(entry.path); } catch { /* ignore */ }
      pendingFiles.delete(sessionId);
    }, 3000);
  });

  res.on('close', () => {
    stream.destroy();
  });
});

// ─── Cleanup expired files (every 5 min) ────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of pendingFiles.entries()) {
    if (now > entry.expires) {
      try { fs.unlinkSync(entry.path); } catch { /* ignore */ }
      pendingFiles.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n  ╭─────────────────────────────────╮');
  console.log(`  │   Lon Download                  │`);
  console.log(`  │   http://localhost:${PORT}          │`);
  console.log('  ╰─────────────────────────────────╯\n');
});
