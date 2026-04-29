# Lon Download — Setup

## Pré-requisitos

### 1. Node.js (v18+)
https://nodejs.org

### 2. yt-dlp
```bash
# Windows (com pip)
pip install yt-dlp

# Ou baixar o executável direto
# https://github.com/yt-dlp/yt-dlp/releases
# Coloque yt-dlp.exe em C:\Windows ou em qualquer pasta do PATH
```

### 3. ffmpeg (necessário para merge de vídeo+áudio HD)
```bash
# Windows — via winget
winget install ffmpeg

# Ou via Chocolatey
choco install ffmpeg

# Ou baixar manualmente:
# https://ffmpeg.org/download.html
# Extrair e adicionar ao PATH
```

## Instalação

```bash
cd "Lon Download"
npm install
```

## Rodar

```bash
npm start
```

Acesse: http://localhost:3000

## Como usar

1. Cole o link do YouTube no campo
2. Aguarde o preview do vídeo aparecer
3. Clique em **Download**
4. Acompanhe o progresso
5. O arquivo MP4 será salvo automaticamente

## Estrutura

```
Lon Download/
├── server.js        # Backend Express + yt-dlp
├── package.json
├── public/
│   ├── index.html   # Interface
│   ├── style.css    # Design Apple/iOS
│   └── app.js       # Lógica frontend
└── SETUP.md
```
