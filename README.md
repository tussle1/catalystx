# CatalystX Cloud OS — Real Browser Cloud Desktop (Chromebook Ready)

**CatalystX** is a real, multi-window **Linux Cloud Desktop Operating System** that runs 100% inside a web browser tab—built specifically for **Chromebooks** and browser-only devices where you cannot install local apps.

It boots a full windowed desktop environment in Chrome backed by a **real Linux server** underneath: real interactive `bash` pseudo-terminals (PTY), a real persistent cloud filesystem with Chromebook drag-and-drop upload/download, a live Python 3 / Node.js / Bash code studio & CPU runner, a localhost port reverse-proxy browser, a live Linux kernel process manager, **plus** a built-in **Phaze Remote Bridge** app.

---

## Built-In Cloud Desktop Apps

- **`›_` Linux Terminal (`bash` PTY):** True interactive pseudo-terminal powered by Python `pty` + `@xterm/xterm`—full ANSI TrueColor, Tab completion, `Ctrl+C` job control, `python3` / `node` REPLs, `git`, and dynamic window resize (`TIOCSWINSZ`).
- **`🗂️` Files Explorer:** Browse `~/Desktop`, `~/Documents`, `~/Projects`, and `~/Downloads`. Drag-and-drop upload files straight from your Chromebook, create/rename/delete folders & files, and download outputs back to ChromeOS.
- **`📝` Code Studio & Runner:** Multi-tab code editor (`Ctrl+S` save to real Linux disk) with **1-click `▶ Run on Cloud CPU`** for `.py`, `.js`/`.mjs`, and `.sh` scripts.
- **`🌐` Web & Localhost Port Viewer:** Preview HTML apps inside your workspace (`cloud://Projects/webapp-demo/index.html`) or reverse-proxy any server you start inside Terminal (e.g. `python3 -m http.server 9000` → type `localhost:9000` right in the desktop browser!).
- **`📊` System Monitor:** Live Linux CPU %, RAM usage (`/proc/meminfo`), Cloud Disk free space, and real `ps` process list with `End` (`SIGTERM`) task control.
- **`🖥️` Phaze Remote Bridge:** Built-in desktop client for [Phaze](https://phaze.app/) MCP (`http://127.0.0.1:41010/mcp` or HTTPS tunnel) + Enterprise API (`public-api.phaze.app`), complete with multi-monitor switching and interactive demo workstations.

---

## Launch Your Own Free Persistent Cloud Desktop from a Chromebook

### Option 1: GitHub Codespaces (100% in Chrome · Free 60 hrs/month)
1. Open this repository on **github.com** in Chrome on your Chromebook.
2. Click **Code → Codespaces → Create codespace on current branch**.
3. This repo's `.devcontainer/devcontainer.json` automatically installs dependencies, starts CatalystX Cloud OS on port `8787`, and opens your persistent Cloud Desktop in a browser tab!

### Option 2: Docker (Render, Railway, Fly.io, VPS)
Deploy using the included `Dockerfile` and set `BRIDGE_PASSCODE` in your environment variables so only you can unlock your Cloud Desktop over HTTPS.

### Option 3: Local / Self-Hosted
```bash
npm install
BRIDGE_PASSCODE="your-passcode" npm start
```
Then open `http://localhost:8787` in any browser.

---

## Tests

```bash
npm test
```
