/**
 * Lon Download — Frontend
 * Apple-style YouTube downloader
 */

(() => {
  'use strict';

  // ─── DOM refs ──────────────────────────────────────────────────────────────
  const form            = document.getElementById('form');
  const urlInput        = document.getElementById('urlInput');
  const clearBtn        = document.getElementById('clearBtn');
  const downloadBtn     = document.getElementById('downloadBtn');
  const urlPreview      = document.getElementById('urlPreview');
  const previewTitle    = document.getElementById('previewTitle');
  const previewSub      = document.getElementById('previewSub');
  const previewThumb    = document.getElementById('previewThumb');
  const previewBadge    = document.getElementById('previewBadge');
  const progressSection = document.getElementById('progressSection');
  const stateInfo       = document.getElementById('stateInfo');
  const stateDownloading= document.getElementById('stateDownloading');
  const stateSuccess    = document.getElementById('stateSuccess');
  const stateError      = document.getElementById('stateError');
  const progressBar     = document.getElementById('progressBar');
  const progressPct     = document.getElementById('progressPct');
  const progressFilename= document.getElementById('progressFilename');
  const progressSpeed   = document.getElementById('progressSpeed');
  const progressEta     = document.getElementById('progressEta');
  const progressSize    = document.getElementById('progressSize');
  const successFilename = document.getElementById('successFilename');
  const errorMessage    = document.getElementById('errorMessage');

  // ─── State ────────────────────────────────────────────────────────────────
  let infoDebounce = null;
  let activeSSE    = null;
  let isDownloading= false;

  // ─── YouTube URL validation ───────────────────────────────────────────────
  function isYouTubeUrl(str) {
    try {
      const u = new URL(str);
      return /^(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)$/.test(u.hostname);
    } catch {
      return false;
    }
  }

  // ─── Show/hide states ─────────────────────────────────────────────────────
  function showState(which) {
    [stateInfo, stateDownloading, stateSuccess, stateError].forEach(el => {
      el.hidden = true;
    });
    progressSection.hidden = false;
    if (which) which.hidden = false;
  }

  function hideProgress() {
    progressSection.hidden = true;
  }

  // ─── Input clear button ───────────────────────────────────────────────────
  urlInput.addEventListener('input', () => {
    const val = urlInput.value.trim();
    clearBtn.hidden = val.length === 0;

    if (!val) {
      urlPreview.hidden = true;
      hideProgress();
      clearTimeout(infoDebounce);
      return;
    }

    if (isYouTubeUrl(val)) {
      clearTimeout(infoDebounce);
      infoDebounce = setTimeout(() => fetchInfo(val), 600);
    } else {
      urlPreview.hidden = true;
    }
  });

  clearBtn.addEventListener('click', () => {
    urlInput.value = '';
    clearBtn.hidden = true;
    urlPreview.hidden = true;
    hideProgress();
    urlInput.focus();
    clearTimeout(infoDebounce);
  });

  // ─── Paste shortcut ───────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      if (document.activeElement !== urlInput) {
        urlInput.focus();
      }
    }
  });

  // ─── Fetch video info (preview) ───────────────────────────────────────────
  async function fetchInfo(url) {
    // Show skeleton preview
    urlPreview.hidden = false;
    previewTitle.textContent = 'Carregando…';
    previewSub.textContent   = '';
    previewBadge.textContent = 'HD';

    // Reset thumb
    previewThumb.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>`;

    try {
      const res  = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
      const data = await res.json();

      if (!res.ok) {
        urlPreview.hidden = true;
        return;
      }

      previewTitle.textContent = data.title || 'Sem título';
      previewSub.textContent   = [
        data.channel,
        data.duration,
        data.views ? `${formatViews(data.views)} views` : '',
      ].filter(Boolean).join(' · ');
      previewBadge.textContent = 'HD';

      if (data.thumbnail) {
        const img = new Image();
        img.onload = () => {
          previewThumb.innerHTML = '';
          previewThumb.appendChild(img);
        };
        img.src = data.thumbnail;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:8px;';
      }

    } catch {
      urlPreview.hidden = true;
    }
  }

  function formatViews(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
  }

  // ─── Download ─────────────────────────────────────────────────────────────
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (isDownloading) return;

    const url = urlInput.value.trim();

    if (!url) {
      shakInput();
      return;
    }
    if (!isYouTubeUrl(url)) {
      showErrorInline('Insira um link válido do YouTube.');
      shakInput();
      return;
    }

    startDownload(url);
  });

  function startDownload(url) {
    isDownloading = true;

    // Button loading state
    downloadBtn.disabled = true;
    downloadBtn.classList.add('btn-download--loading');
    downloadBtn.querySelector('.btn-download__icon').innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>`;
    downloadBtn.querySelector('.btn-download__label').textContent = 'Processando…';

    showState(stateInfo);

    // Close any previous SSE
    if (activeSSE) {
      activeSSE.close();
      activeSSE = null;
    }

    const evtSource = new EventSource(`/api/download?url=${encodeURIComponent(url)}`);
    activeSSE = evtSource;

    evtSource.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      switch (msg.type) {

        case 'info':
          progressFilename.textContent = msg.title;
          showState(stateDownloading);
          break;

        case 'progress': {
          const pct = Math.min(100, Math.max(0, msg.percent || 0));
          progressBar.style.width = `${pct}%`;
          progressPct.textContent = `${pct.toFixed(1)}%`;
          if (msg.speed) progressSpeed.textContent = msg.speed;
          if (msg.eta)   progressEta.textContent   = `ETA ${msg.eta}`;
          if (msg.size)  progressSize.textContent  = msg.size;
          break;
        }

        case 'complete':
          evtSource.close();
          activeSSE = null;
          progressBar.style.width = '100%';
          progressPct.textContent = '100%';

          setTimeout(() => {
            // Trigger browser download
            const a = document.createElement('a');
            a.href = `/api/file/${msg.sessionId}`;
            a.download = msg.filename || 'video.mp4';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            // Show success state
            successFilename.textContent = msg.filename || 'video.mp4';
            showState(stateSuccess);
            resetButton(true);
            isDownloading = false;
          }, 300);
          break;

        case 'error':
          evtSource.close();
          activeSSE = null;
          showErrorInline(msg.message || 'Erro desconhecido no download.');
          resetButton(false);
          isDownloading = false;
          break;

        case 'warning':
          // silent — yt-dlp warnings
          break;
      }
    };

    evtSource.onerror = () => {
      evtSource.close();
      activeSSE = null;
      if (isDownloading) {
        showErrorInline('Conexão perdida com o servidor. Verifique se o servidor está rodando.');
        resetButton(false);
        isDownloading = false;
      }
    };
  }

  // ─── UI helpers ───────────────────────────────────────────────────────────
  function resetButton(success) {
    downloadBtn.disabled = false;
    downloadBtn.classList.remove('btn-download--loading');
    downloadBtn.querySelector('.btn-download__icon').innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>`;
    downloadBtn.querySelector('.btn-download__label').textContent = success
      ? 'Baixar outro'
      : 'Tentar novamente';
  }

  function showErrorInline(msg) {
    errorMessage.textContent = msg;
    showState(stateError);
  }

  function shakInput() {
    urlInput.style.animation = 'none';
    urlInput.offsetHeight; // reflow
    urlInput.style.animation = 'shakeX 0.35s ease';
    urlInput.addEventListener('animationend', () => {
      urlInput.style.animation = '';
    }, { once: true });
  }

  // ─── Add shakeX to styles dynamically ────────────────────────────────────
  const shakeStyle = document.createElement('style');
  shakeStyle.textContent = `
    @keyframes shakeX {
      0%,100%{ transform:translateX(0) }
      20%    { transform:translateX(-6px) }
      40%    { transform:translateX(6px) }
      60%    { transform:translateX(-4px) }
      80%    { transform:translateX(4px) }
    }
  `;
  document.head.appendChild(shakeStyle);

})();
