/**
 * Lon Download — Server (Vercel Ultra-Light Version)
 * Uses Cobalt API to bypass Vercel size and timeout limits.
 */

const express = require('express');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function isValidYouTubeUrl(url) {
  try {
    const u = new URL(url);
    return /^(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)$/.test(u.hostname);
  } catch { return false; }
}

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ─── Route: Video Info (Cloud Powered) ────────────────────────────────────────
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url || !isValidYouTubeUrl(url)) return res.status(400).json({ error: 'URL inválida.' });

  try {
    // We use Cobalt to get info too, or just return a placeholder for the UI
    // To be fast, we just return basic info and let the download handle the rest
    res.json({
      title: 'Vídeo do YouTube',
      duration: 'Pronto para baixar',
      thumbnail: 'https://img.youtube.com/vi/' + (url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/)?.[1] || '') + '/mqdefault.jpg',
      channel: 'YouTube',
    });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao processar.' });
  }
});

// ─── Route: Download (SSE - Cloud Engine) ─────────────────────────────────────
app.get('/api/download', async (req, res) => {
  const { url } = req.query;
  if (!url || !isValidYouTubeUrl(url)) return res.status(400).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 5000);

  try {
    const cobaltRes = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, vQuality: '1080' })
    });
    const cobaltData = await cobaltRes.json();
    
    clearInterval(heartbeat);

    if (cobaltData && cobaltData.url) {
      sendSSE(res, { type: 'info', title: 'Processando na Nuvem...' });
      sendSSE(res, { type: 'progress', percent: 100 });
      sendSSE(res, { 
        type: 'complete', 
        externalUrl: cobaltData.url, 
        filename: `video_${crypto.randomUUID().slice(0,8)}.mp4` 
      });
      res.end();
    } else {
      sendSSE(res, { type: 'error', message: 'O motor de download está ocupado. Tente novamente em instantes.' });
      res.end();
    }
  } catch (e) {
    clearInterval(heartbeat);
    sendSSE(res, { type: 'error', message: 'Erro na conexão com o motor de nuvem.' });
    res.end();
  }

  req.on('close', () => clearInterval(heartbeat));
});

// ─── Route: Local File (Fallback) ─────────────────────────────────────────────
app.get('/api/file/:sessionId', (req, res) => {
  res.status(410).json({ error: 'Use o link direto fornecido pelo motor de nuvem.' });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`Rodando em http://localhost:${PORT}`));
}

module.exports = app;
