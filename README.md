# BASIL-MD

> A powerful, feature-rich WhatsApp Bot built with Node.js & Baileys

[![GitHub Repo stars](https://img.shields.io/github/stars/SAFEME123/BASIL-MD?style=social)](https://github.com/SAFEME123/BASIL-MD/stargazers)
[![License](https://img.shields.io/github/license/SAFEME123/BASIL-MD)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

<p align="center">
  <a href="https://basil-pair.onrender.com">
    <img src="https://img.shields.io/badge/PAIR%20BASIL--MD-GET%20SESSION%20ID-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="PAIR BASIL-MD" />
  </a>
</p>

> ⚠️ **Notice:** The original repository ([BOTMASTER350/BASIL-MD](https://github.com/BOTMASTER350/BASIL-MD)) is currently unavailable due to a GitHub account issue.
> This repository ([SAFEME123/BASIL-MD](https://github.com/SAFEME123/BASIL-MD)) is the **official active mirror** and will receive all updates while the original account is being restored.
> Please use this repo and star it to stay up to date.

![Star History Chart](https://api.star-history.com/svg?repos=SAFEME123/BASIL-MD&type=Date)

---

## ✨ Features

| Category | Commands |
|---|---|
| 🎬 **Downloaders** | TikTok, Instagram, Facebook, YouTube, Spotify, SoundCloud, Threads, Pinterest, CapCut, Likee, Twitter/X |
| 🎥 **Movies** | Search & download movies via `.movie`, browse latest via `.latest` |
| 🤖 **AI** | ChatGPT, image generation (DALL-E, Flux, Stable Diffusion), image upscale, remove background |
| 🛠️ **Tools** | Weather, OCR, QR code, currency converter, Wikipedia, dictionary, translator, IMDB |
| 🎮 **Fun** | Magic 8-ball, love calculator, truth or dare, roast generator, horoscope, morse code |
| 👥 **Group** | Welcome/goodbye, anti-link, anti-tag, anti-call, anti-demote, anti-bot, polls, warn system |
| ⚙️ **Owner** | Remote settings (`.set`), broadcast, block/unblock, ban, sudo management |
| 🔧 **Extras** | Sticker maker, fancy text, password generator, UUID/hash, countdown timer, screenshot |

---

## 🚀 Quick Start (Local / VPS)

```bash
git clone https://github.com/SAFEME123/BASIL-MD.git
cd BASIL-MD
npm install
cp config.env.example config.env
# Edit config.env — set SESSION_ID and OWNER_NUMBER at minimum
node index.js
```

**Requirements:** Node.js 20+, FFmpeg (for media), optional PostgreSQL

---

## 🌐 Deploy

### ☁️ Koyeb *(recommended — always-on free tier)*
```bash
koyeb app init basil-md --config koyeb.yaml
```
Set `SESSION_ID` and `OWNER_NUMBER` in the Koyeb dashboard environment variables.

### 🚂 Railway
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/SAFEME123/BASIL-MD)

### 🟣 Heroku
[![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/SAFEME123/BASIL-MD)

> **Note:** Heroku free dynos are discontinued. Use the **eco** plan (~$5/mo) or choose Koyeb/Railway instead.

### 🐳 Docker
```bash
docker build -t basil-md .
docker run -d \
  -e SESSION_ID="your-session-id" \
  -e OWNER_NUMBER="2638412345678" \
  -p 3028:3028 \
  basil-md
```

### �️ Render
Import this repo on [render.com](https://render.com) — `render.yaml` is auto-detected.

---

## 🔑 Session ID

Get your session ID (pairing code) from the bot's pairing page, then set it as `SESSION_ID` in your environment.

---

## ⚙️ Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SESSION_ID` | ✅ | — | WhatsApp pairing session |
| `OWNER_NUMBER` | ✅ | — | Your number (country code, no +) |
| `PREFIX` | ❌ | `.` | Command prefix |
| `MODE` | ❌ | `public` | `public` / `groups` / `private` / `inbox` |
| `TIME_ZONE` | ❌ | auto-detect | e.g. `Africa/Harare` |
| `DATABASE_URL` | ❌ | SQLite | PostgreSQL URI (Neon/Supabase) |
| `CHATBOT_MODE` | ❌ | `false` | Enable AI chatbot replies |
| `AI_ENDPOINT` | ❌ | — | Custom OpenAI-compatible API URL |
| `AUTO_READ_STATUS` | ❌ | `false` | Auto-view statuses |
| `AUTO_STATUS_LIKE` | ❌ | `off` | Auto-like statuses |
| `WELCOME` | ❌ | `true` | Group welcome messages |
| `ANTI_LINK` | ❌ | `false` | Delete links from non-admins |
| `ANTI_CALL` | ❌ | `false` | Reject incoming calls |

See [`config.env.example`](config.env.example) for the full list.

---

## 🗄️ Database

- **PostgreSQL** (recommended for production) — set `DATABASE_URL` to a [Neon](https://neon.tech) or [Supabase](https://supabase.com) URI. Both have free tiers.
- **SQLite** (default) — works out of the box locally. Data is lost on container/dyno restarts.

---

## 🛠️ Dev Scripts

| Script | Purpose |
|---|---|
| `node index.js` | Start the bot |
| `npm run verify` | Syntax-check entry points |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |
| `npm run install:lite` | Lean install (no devDeps) |

---

## 📝 License

MIT — see [LICENSE](LICENSE) for details.

## 🤝 Contributing

Pull requests are welcome! Please run `npm run lint` before submitting.
