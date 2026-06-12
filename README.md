<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=220&section=header&text=BASIL-MD&fontSize=90&fontColor=ffffff&animation=twinkling&fontAlignY=38&desc=The%20Most%20Powerful%20WhatsApp%20Bot&descAlignY=58&descSize=20&descColor=cccccc" width="100%" />

[![Typing SVG](https://readme-typing-svg.demolab.com?font=Fira+Code&weight=700&size=24&pause=1000&color=25D366&center=true&vCenter=true&random=false&width=600&lines=⚡+Feature-Rich+WhatsApp+Bot;🤖+AI+%7C+Media+%7C+Groups+%7C+Owner+Tools;🌍+Always+Online+%7C+Always+Updated;🔥+Built+with+Node.js+%26+Baileys)](https://git.io/typing-svg)

<br/>

[![Stars](https://img.shields.io/github/stars/SAFEME123/BASIL-MD?style=for-the-badge&logo=github&color=FFD700&labelColor=0d1117)](https://github.com/SAFEME123/BASIL-MD/stargazers)
[![Forks](https://img.shields.io/github/forks/SAFEME123/BASIL-MD?style=for-the-badge&logo=git&color=0969da&labelColor=0d1117)](https://github.com/SAFEME123/BASIL-MD/network/members)
[![License](https://img.shields.io/badge/License-MIT-8957e5?style=for-the-badge&labelColor=0d1117)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-43853d?style=for-the-badge&logo=nodedotjs&labelColor=0d1117)](https://nodejs.org)
[![WhatsApp](https://img.shields.io/badge/Baileys-Powered-25D366?style=for-the-badge&logo=whatsapp&logoColor=white&labelColor=0d1117)](https://github.com/WhiskeySockets/Baileys)

<br/>

[![⭐ Star this repo](https://img.shields.io/badge/⭐%20Star%20this%20Repo-FFD700?style=for-the-badge&logo=github&logoColor=black)](https://github.com/SAFEME123/BASIL-MD/stargazers)

</div>

---

<div align="center">

> ⚠️ **Notice:** The original account **BOTMASTER350/BASIL-MD** is currently unavailable due to a GitHub account issue.
> **[SAFEME123/BASIL-MD](https://github.com/SAFEME123/BASIL-MD)** is the **official active mirror** receiving all updates.

</div>

---

## ✨ Features

<div align="center">

| Category | Highlights |
|:---:|:---|
| 🎬 **Downloaders** | TikTok · Instagram · Facebook · YouTube · Spotify · SoundCloud · Threads · Pinterest · CapCut · Twitter/X |
| 🎥 **Movies** | Search & download via `.movie` · Browse latest via `.latest` · Multi-source fallback |
| 🤖 **AI** | ChatGPT · DALL-E · Flux · Stable Diffusion · Image Upscale · Remove Background |
| 🛠️ **Tools** | Weather · OCR · QR Code · Currency · Wikipedia · Dictionary · Translator · IMDB |
| 🎮 **Fun** | Magic 8-ball · Love Calculator · Truth or Dare · Roast Generator · Horoscope |
| 👥 **Group** | Welcome/Goodbye · Anti-Link · Anti-Tag · Anti-Call · Anti-Demote · Anti-Bot · Polls · Warn |
| ⚙️ **Owner** | Remote Settings (`.set`) · Broadcast · Block/Unblock · Ban System · Sudo |
| 🔧 **Extras** | Sticker Maker · Fancy Text · Password Gen · UUID/Hash · Screenshot · Countdown |

</div>

---

## 🔑 Get Your Session ID

<div align="center">

**Connect your WhatsApp number to the bot in seconds**

<br/>

<a href="https://session.basilmd.app">
  <img src="https://img.shields.io/badge/⚡%20PAIR%20BASIL--MD-GET%20SESSION%20ID%20NOW-25D366?style=for-the-badge&logo=whatsapp&logoColor=white&labelColor=128C7E" height="45" alt="Pair BASIL-MD" />
</a>
&nbsp;&nbsp;
<a href="https://session.basilmd.app">
  <img src="https://img.shields.io/badge/🔗%20OPEN%20PAIRING%20PAGE-session.basilmd.app-0969da?style=for-the-badge&logo=googlechrome&logoColor=white&labelColor=0d1117" height="45" alt="Pairing Page" />
</a>

<br/><br/>

> 1️⃣ Click the button above &nbsp;·&nbsp; 2️⃣ Enter your WhatsApp number &nbsp;·&nbsp; 3️⃣ Copy your `SESSION_ID` &nbsp;·&nbsp; 4️⃣ Paste it in your config

</div>

---

## 🚀 Quick Start

```bash
git clone https://github.com/SAFEME123/BASIL-MD.git
cd BASIL-MD
npm install
cp config.env.example config.env
# Set SESSION_ID and OWNER_NUMBER in config.env
node index.js
```

> **Requirements:** Node.js ≥ 20 · FFmpeg (for media) · PostgreSQL (optional)

---

## 🌐 Deploy

<div align="center">

### Choose your platform

<br/>

<a href="https://railway.app/new/template?template=https://github.com/SAFEME123/BASIL-MD">
  <img src="https://img.shields.io/badge/🚂%20DEPLOY%20ON%20RAILWAY-Deploy%20Now-7B2FBE?style=for-the-badge&logo=railway&logoColor=white&labelColor=0d1117" height="40" alt="Deploy on Railway" />
</a>
&nbsp;
<a href="https://heroku.com/deploy?template=https://github.com/SAFEME123/BASIL-MD">
  <img src="https://img.shields.io/badge/🟣%20DEPLOY%20ON%20HEROKU-Deploy%20Now-430098?style=for-the-badge&logo=heroku&logoColor=white&labelColor=0d1117" height="40" alt="Deploy to Heroku" />
</a>
&nbsp;
<a href="https://render.com">
  <img src="https://img.shields.io/badge/🖥️%20DEPLOY%20ON%20RENDER-Deploy%20Now-46E3B7?style=for-the-badge&logo=render&logoColor=white&labelColor=0d1117" height="40" alt="Deploy on Render" />
</a>

</div>

<br/>

### ☁️ Koyeb *(recommended — always-on free tier)*
```bash
koyeb app init basil-md --config koyeb.yaml
```
Set `SESSION_ID` and `OWNER_NUMBER` in the Koyeb dashboard.

### 🐳 Docker
```bash
docker build -t basil-md .
docker run -d \
  -e SESSION_ID="your-session-id" \
  -e OWNER_NUMBER="2638412345678" \
  -p 3028:3028 \
  basil-md
```

---

## ⚙️ Environment Variables

<div align="center">

| Variable | Required | Default | Description |
|:---|:---:|:---:|:---|
| `SESSION_ID` | ✅ | — | WhatsApp pairing session |
| `OWNER_NUMBER` | ✅ | — | Your number (country code, no `+`) |
| `PREFIX` | ❌ | `.` | Command prefix |
| `MODE` | ❌ | `public` | `public` / `groups` / `private` / `inbox` |
| `TIME_ZONE` | ❌ | auto | e.g. `Africa/Harare` |
| `DATABASE_URL` | ❌ | SQLite | PostgreSQL URI (Neon / Supabase) |
| `CHATBOT_MODE` | ❌ | `false` | `all` / `dm` / `groups` / `me` / `false` |
| `AI_ENDPOINT` | ❌ | — | Custom OpenAI-compatible API URL |
| `AUTO_READ_STATUS` | ❌ | `false` | Auto-view statuses |
| `AUTO_STATUS_LIKE` | ❌ | `off` | Auto-like statuses |
| `WELCOME` | ❌ | `true` | Group welcome messages |
| `ANTI_LINK` | ❌ | `false` | Delete links from non-admins |
| `ANTI_CALL` | ❌ | `false` | Reject incoming calls |

</div>

See [`config.env.example`](config.env.example) for the full list.

---

## 🗄️ Database

| Option | When to use |
|:---|:---|
| **PostgreSQL** *(Neon / Supabase — free tier)* | Production — persistent, multi-instance |
| **SQLite** *(default, zero config)* | Local dev — data lost on container restart |

---

## 🛠️ Dev Scripts

| Command | Purpose |
|:---|:---|
| `node index.js` | Start the bot |
| `npm run verify` | Syntax-check entry points |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |
| `npm run install:lite` | Lean install (no devDeps) |

---

## 🤖 Custom AI Endpoint

By default BASIL-MD connects to a **private AI API** that powers the chatbot out of the box — no configuration needed. For heavier usage or specific models, you can plug in your own OpenAI-compatible endpoint.

```bash
# Via .set command (no restart needed)
.set AI_ENDPOINT https://api.openai.com/v1
.set AI_API_KEY  sk-xxxxxxxxxxxxxxxx
.set AI_MODEL    gpt-4o
```

| Setting | What it does |
|:---|:---|
| `AI_ENDPOINT` | Base URL of any OpenAI-compatible API |
| `AI_API_KEY` | Bearer token sent as `Authorization: Bearer <key>` |
| `AI_MODEL` | Default model to request (e.g. `gpt-4o`, `mistral-7b`) |

> Changes via `.set` take effect **immediately** — no restart required.
> The bot falls back through multiple free providers if your endpoint is unavailable.

**Compatible providers:** OpenAI · Together AI · OpenRouter · Groq · Mistral · Anyscale · Fireworks AI · any `v1/chat/completions`-compatible server

---

## 👥 Credits

<div align="center">

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/SAFEME123">
        <img src="https://github.com/SAFEME123.png" width="80" style="border-radius:50%" /><br/>
        <sub><b>SAFEME123</b></sub>
      </a><br/>
      <sub>Lead Developer · Maintainer</sub>
    </td>
    <td align="center">
      <a href="https://github.com/omoba-tife">
        <img src="https://github.com/omoba-tife.png" width="80" style="border-radius:50%" /><br/>
        <sub><b>omoba-tife</b></sub>
      </a><br/>
      <sub>Contributor · Feature Development</sub>
    </td>
  </tr>
</table>

[![Contributors](https://img.shields.io/github/contributors/SAFEME123/BASIL-MD?style=for-the-badge&color=0969da&labelColor=0d1117)](https://github.com/SAFEME123/BASIL-MD/graphs/contributors)

</div>

---

## ⚠️ Disclaimer

<div align="center">

<table>
  <tr>
    <td>

> **BASIL-MD is an independent open-source project and is NOT affiliated with, endorsed by, or associated with WhatsApp LLC or Meta Platforms, Inc.** WhatsApp is a registered trademark of WhatsApp LLC.
>
> ### 🚫 Account Ban Risk
> Using unofficial WhatsApp bots **violates WhatsApp's Terms of Service** and may result in your WhatsApp account being **temporarily or permanently banned**.
> **You use this software entirely at your own risk.** The developers and contributors accept no liability for any account suspensions, bans, data loss, or any other consequences arising from the use of this bot.
>
> ### 🛡️ Recommended Settings to Reduce Ban Risk
> To lower the chance of your account being flagged, it is **strongly advised** to keep the following settings **disabled**:
>
> | Setting | Recommended Value | Why |
> |:---|:---:|:---|
> | `AUTO_READ_STATUS` | `false` | Mass status reading triggers automated-behaviour flags |
> | `AUTO_STATUS_LIKE` | `off` | Bulk liking statuses is a known ban trigger |
> | `AUTO_REACT` | `false` | High-frequency reactions can appear bot-like to WhatsApp |
> | `AUTO_READ_MSG` | `false` | Auto-reading all messages may flag unusual read patterns |
>
> ℹ️ These features are opt-in and **off by default**. Do not enable them unless you understand the associated risk.

    </td>
  </tr>
</table>

</div>

---

<div align="center">

![Star History](https://api.star-history.com/svg?repos=SAFEME123/BASIL-MD&type=Date)

[![MIT License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge&labelColor=0d1117)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen?style=for-the-badge&logo=github&labelColor=0d1117)](https://github.com/SAFEME123/BASIL-MD/pulls)
[![Made with ❤️](https://img.shields.io/badge/Made%20with-❤️-red?style=for-the-badge&labelColor=0d1117)](https://github.com/SAFEME123/BASIL-MD)

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=120&section=footer" width="100%" />

</div>
