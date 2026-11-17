import { mountTerminalApp } from "/apps/terminal.js";
import { mountFilesApp } from "/apps/files.js";
import { mountEditorApp } from "/apps/editor.js";
import { mountBrowserApp } from "/apps/browser.js";
import { mountMonitorApp } from "/apps/monitor.js";
import { mountPhazeApp } from "/apps/phaze.js";

const PASSCODE_KEY = "catalystx_cloud_os_passcode";
const WALLPAPERS = ["nebula", "aurora", "ember", "carbon"];

const APP_DEFINITIONS = {
  terminal: {
    id: "terminal",
    title: "Linux Terminal (bash)",
    glyph: "›_",
    desc: "Interactive Linux PTY shell",
    badgeClass: "is-term",
    defaultW: 760,
    defaultH: 460,
    multiInstance: true,
    mount: mountTerminalApp,
  },
  files: {
    id: "files",
    title: "Files Explorer",
    glyph: "🗂️",
    desc: "Browse, upload & download cloud files",
    badgeClass: "",
    defaultW: 780,
    defaultH: 490,
    multiInstance: false,
    mount: mountFilesApp,
  },
  editor: {
    id: "editor",
    title: "Code Studio & Runner",
    glyph: "📝",
    desc: "Edit & execute Python, Node.js & Bash",
    badgeClass: "is-code",
    defaultW: 820,
    defaultH: 540,
    multiInstance: false,
    mount: mountEditorApp,
  },
  browser: {
    id: "browser",
    title: "Web & Localhost Port Viewer",
    glyph: "🌐",
    desc: "Preview cloud HTML & localhost ports",
    badgeClass: "",
    defaultW: 820,
    defaultH: 530,
    multiInstance: true,
    mount: mountBrowserApp,
  },
  monitor: {
    id: "monitor",
    title: "System Monitor",
    glyph: "📊",
    desc: "Real Linux CPU, RAM, Disk & Processes",
    badgeClass: "",
    defaultW: 720,
    defaultH: 480,
    multiInstance: false,
    mount: mountMonitorApp,
  },
  phaze: {
    id: "phaze",
    title: "Phaze Remote Bridge",
    glyph: "🖥️",
    desc: "Connect to remote Phaze workstations",
    badgeClass: "",
    defaultW: 840,
    defaultH: 540,
    multiInstance: false,
    mount: mountPhazeApp,
  },
};

const osState = {
  passcode: sessionStorage.getItem(PASSCODE_KEY) || "",
  wallpaper: "nebula",
  desktopItems: [],
  windows: new Map(), // winId -> { id, appId, title, glyph, el, minimized, maximized, z, controller }
  topZ: 20,
  nextWinSeq: 1,
  lastIconLaunchAt: 0,
};

const el = (id) => document.getElementById(id);

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(msg, isBad = false) {
  const node = el("os-toast");
  node.textContent = msg;
  node.classList.toggle("is-bad", Boolean(isBad));
  node.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    node.hidden = true;
  }, 3200);
}

async function apiFetch(url, options = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(osState.passcode ? { "X-Bridge-Passcode": osState.passcode } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.code === "UNAUTHORIZED") {
    el("modal-passcode").hidden = false;
    throw new Error("Passcode required");
  }
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function promptModal(title, desc, defaultValue = "") {
  return new Promise((resolve) => {
    const backdrop = el("modal-prompt");
    const form = el("form-prompt");
    const inp = el("inp-prompt-val");
    el("prompt-title").textContent = title;
    el("prompt-desc").textContent = desc;
    inp.value = defaultValue;
    backdrop.hidden = false;
    setTimeout(() => {
      inp.focus();
      inp.select();
    }, 30);

    function cleanup(val) {
      backdrop.hidden = true;
      form.removeEventListener("submit", onSubmit);
      el("btn-cancel-prompt").removeEventListener("click", onCancel);
      el("btn-prompt-close").removeEventListener("click", onCancel);
      resolve(val);
    }

    function onSubmit(ev) {
      ev.preventDefault();
      cleanup(inp.value.trim() || null);
    }

    function onCancel() {
      cleanup(null);
    }

    form.addEventListener("submit", onSubmit);
    el("btn-cancel-prompt").addEventListener("click", onCancel);
    el("btn-prompt-close").addEventListener("click", onCancel);
  });
}

const appContext = {
  apiFetch,
  escapeHtml,
  toast,
  promptModal,
  getPasscode: () => osState.passcode,
  openApp: (appId, opts) => openAppWindow(appId, opts),
  refreshDesktopIcons: () => refreshDesktopIcons(),
};

/* =========================================================
   WINDOW MANAGER (Drag, Resize, Edge Snap, Focus, Taskbar)
   ========================================================= */
function focusWindow(winId) {
  const target = osState.windows.get(winId);
  if (!target) return;
  if (target.minimized) {
    target.minimized = false;
    target.el.hidden = false;
  }
  osState.topZ += 1;
  target.z = osState.topZ;
  target.el.style.zIndex = String(target.z);

  for (const w of osState.windows.values()) {
    w.el.classList.toggle("is-focused", w.id === winId);
  }
  renderTaskbarWindows();
  target.controller?.onFocus?.();
}

function closeWindow(winId) {
  const win = osState.windows.get(winId);
  if (!win) return;
  try {
    win.controller?.onClose?.();
  } catch {
    // ignore
  }
  win.el.remove();
  osState.windows.delete(winId);
  renderTaskbarWindows();
}

function toggleMaximize(winId) {
  const win = osState.windows.get(winId);
  if (!win) return;
  win.maximized = !win.maximized;
  win.el.classList.toggle("is-maximized", win.maximized);
  focusWindow(winId);
}

function minimizeWindow(winId) {
  const win = osState.windows.get(winId);
  if (!win) return;
  win.minimized = true;
  win.el.hidden = true;
  win.el.classList.remove("is-focused");
  renderTaskbarWindows();
}

export function openAppWindow(appId, options = {}) {
  const def = APP_DEFINITIONS[appId];
  if (!def) return null;

  // Reuse existing single-instance app window when appropriate
  if (!def.multiInstance) {
    for (const existing of osState.windows.values()) {
      if (existing.appId === appId) {
        focusWindow(existing.id);
        if (appId === "editor" && options.path && existing.controller?.openFilePath) {
          existing.controller.openFilePath(options.path, Boolean(options.autoRun));
        }
        return existing;
      }
    }
  }

  const surfaceRect = el("desktop-surface").getBoundingClientRect();
  const availW = surfaceRect.width || window.innerWidth;
  const availH = surfaceRect.height || window.innerHeight - 48;

  const width = Math.min(options.width || def.defaultW, Math.max(340, availW - 24));
  const height = Math.min(options.height || def.defaultH, Math.max(240, availH - 24));

  const cascade = ((osState.nextWinSeq - 1) % 6) * 26;
  const defaultLeft = Math.min(Math.max(18, 224 + cascade), Math.max(18, availW - width - 16));
  const defaultTop = Math.min(Math.max(14, 28 + cascade), Math.max(14, availH - height - 16));

  const left = options.x ?? defaultLeft;
  const top = options.y ?? defaultTop;

  const winId = `win-${osState.nextWinSeq++}`;
  const winTitle = options.title || def.title;

  const winEl = document.createElement("section");
  winEl.className = "os-window";
  winEl.dataset.winId = winId;
  winEl.style.left = `${left}px`;
  winEl.style.top = `${top}px`;
  winEl.style.width = `${width}px`;
  winEl.style.height = `${height}px`;

  winEl.innerHTML = `
    <header class="win-titlebar">
      <div class="win-title-left">
        <span class="win-app-glyph">${def.glyph}</span>
        <span class="win-title-text">${escapeHtml(winTitle)}</span>
      </div>
      <div class="win-controls">
        <button type="button" class="win-ctrl" data-win-act="min" title="Minimize">─</button>
        <button type="button" class="win-ctrl" data-win-act="max" title="Maximize / Restore">□</button>
        <button type="button" class="win-ctrl close" data-win-act="close" title="Close">×</button>
      </div>
    </header>
    <div class="win-body"></div>
    <div class="win-resize-e" data-resize="e"></div>
    <div class="win-resize-s" data-resize="s"></div>
    <div class="win-resize-se" data-resize="se"></div>
  `;

  el("windows-layer").appendChild(winEl);

  const winRecord = {
    id: winId,
    appId,
    title: winTitle,
    glyph: def.glyph,
    el: winEl,
    minimized: false,
    maximized: false,
    z: ++osState.topZ,
    controller: null,
  };
  osState.windows.set(winId, winRecord);

  const bodyEl = winEl.querySelector(".win-body");
  winRecord.controller = def.mount(bodyEl, appContext, options) || {};

  wireWindowInteractions(winRecord);
  focusWindow(winId);
  return winRecord;
}

function wireWindowInteractions(win) {
  const { el: winEl, id: winId } = win;
  const titlebar = winEl.querySelector(".win-titlebar");
  const snapPreview = el("snap-preview");

  winEl.addEventListener("mousedown", () => {
    if (!winEl.classList.contains("is-focused")) {
      focusWindow(winId);
    }
  });

  titlebar.addEventListener("dblclick", (ev) => {
    if (ev.target.closest("[data-win-act]")) return;
    toggleMaximize(winId);
  });

  winEl.querySelector(".win-controls").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-win-act]");
    if (!btn) return;
    const act = btn.dataset.winAct;
    if (act === "min") minimizeWindow(winId);
    if (act === "max") toggleMaximize(winId);
    if (act === "close") closeWindow(winId);
  });

  // Dragging + Edge Snapping
  titlebar.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0 || ev.target.closest("[data-win-act]")) return;
    focusWindow(winId);

    if (win.maximized) {
      // Unmaximize smoothly under cursor
      const surf = el("desktop-surface").getBoundingClientRect();
      win.maximized = false;
      winEl.classList.remove("is-maximized");
      const restoredW = Math.min(760, surf.width - 40);
      winEl.style.width = `${restoredW}px`;
      winEl.style.left = `${Math.max(0, ev.clientX - restoredW / 2)}px`;
      winEl.style.top = `8px`;
    }

    const startX = ev.clientX;
    const startY = ev.clientY;
    const origLeft = parseFloat(winEl.style.left) || 0;
    const origTop = parseFloat(winEl.style.top) || 0;
    let pendingSnap = null;

    document.body.classList.add("is-dragging-window");

    function onMove(me) {
      const surf = el("desktop-surface").getBoundingClientRect();
      const nx = Math.max(-120, Math.min(surf.width - 80, origLeft + (me.clientX - startX)));
      const ny = Math.max(0, Math.min(surf.height - 38, origTop + (me.clientY - startY)));
      winEl.style.left = `${nx}px`;
      winEl.style.top = `${ny}px`;

      // Check edge snap zones
      if (me.clientY <= 10) {
        pendingSnap = "max";
        snapPreview.hidden = false;
        Object.assign(snapPreview.style, { left: "6px", top: "6px", width: `${surf.width - 12}px`, height: `${surf.height - 12}px` });
      } else if (me.clientX <= 12) {
        pendingSnap = "left";
        snapPreview.hidden = false;
        Object.assign(snapPreview.style, { left: "6px", top: "6px", width: `${surf.width / 2 - 9}px`, height: `${surf.height - 12}px` });
      } else if (me.clientX >= surf.width - 12) {
        pendingSnap = "right";
        snapPreview.hidden = false;
        Object.assign(snapPreview.style, { left: `${surf.width / 2 + 3}px`, top: "6px", width: `${surf.width / 2 - 9}px`, height: `${surf.height - 12}px` });
      } else {
        pendingSnap = null;
        snapPreview.hidden = true;
      }
    }

    function onUp() {
      document.body.classList.remove("is-dragging-window");
      snapPreview.hidden = true;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);

      const surf = el("desktop-surface").getBoundingClientRect();
      if (pendingSnap === "max") {
        win.maximized = true;
        winEl.classList.add("is-maximized");
      } else if (pendingSnap === "left") {
        Object.assign(winEl.style, { left: "0px", top: "0px", width: `${Math.round(surf.width / 2)}px`, height: `${surf.height}px` });
      } else if (pendingSnap === "right") {
        Object.assign(winEl.style, { left: `${Math.round(surf.width / 2)}px`, top: "0px", width: `${Math.round(surf.width / 2)}px`, height: `${surf.height}px` });
      }
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  // Resizing (E, S, SE handles)
  for (const handle of winEl.querySelectorAll("[data-resize]")) {
    handle.addEventListener("mousedown", (ev) => {
      if (ev.button !== 0 || win.maximized) return;
      ev.stopPropagation();
      focusWindow(winId);
      const dir = handle.dataset.resize;
      const startX = ev.clientX;
      const startY = ev.clientY;
      const origW = winEl.offsetWidth;
      const origH = winEl.offsetHeight;
      document.body.classList.add("is-dragging-window");

      function onMove(me) {
        if (dir.includes("e")) {
          winEl.style.width = `${Math.max(320, origW + (me.clientX - startX))}px`;
        }
        if (dir.includes("s")) {
          winEl.style.height = `${Math.max(220, origH + (me.clientY - startY))}px`;
        }
      }

      function onUp() {
        document.body.classList.remove("is-dragging-window");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }
}

function renderTaskbarWindows() {
  const bar = el("taskbar-windows");
  const list = Array.from(osState.windows.values());
  bar.innerHTML = list
    .map((w) => {
      const isFocused = w.el.classList.contains("is-focused") && !w.minimized;
      return `
        <button
          type="button"
          class="task-pill ${isFocused ? "is-focused" : ""} ${w.minimized ? "is-minimized" : ""}"
          data-task-win="${w.id}"
        >
          <span>${w.glyph}</span>
          <span>${escapeHtml(w.title)}</span>
        </button>
      `;
    })
    .join("");
}

/* =========================================================
   DESKTOP SHORTCUTS, LAUNCHER, CONTEXT MENU & TRAY
   ========================================================= */
function renderDesktopIcons() {
  const container = el("desktop-icons");
  const sysIcons = Object.values(APP_DEFINITIONS).map(
    (app) => `
      <button type="button" class="desk-icon" data-open-app="${app.id}" title="${escapeHtml(app.desc)}">
        <span class="desk-icon-badge ${app.badgeClass}">${app.glyph}</span>
        <span class="desk-icon-label">${escapeHtml(app.title.replace(/\s*\(.*\)/, ""))}</span>
      </button>
    `
  );

  const fileIcons = (osState.desktopItems || []).map((item) => {
    const glyph = item.isDirectory
      ? "📁"
      : /\.py$/i.test(item.name)
        ? "🐍"
        : /\.(js|mjs)$/i.test(item.name)
          ? "⚡"
          : /\.md$/i.test(item.name)
            ? "📘"
            : "📄";
    return `
      <button
        type="button"
        class="desk-icon"
        data-open-desk-item="${escapeHtml(item.path)}"
        data-item-dir="${item.isDirectory}"
        title="~/${escapeHtml(item.path)}"
      >
        <span class="desk-icon-badge">${glyph}</span>
        <span class="desk-icon-label">${escapeHtml(item.name)}</span>
      </button>
    `;
  });

  container.innerHTML = [...sysIcons, ...fileIcons].join("");
}

function renderLauncherApps(filter = "") {
  const q = filter.trim().toLowerCase();
  const container = el("launcher-apps");
  const appEntries = Object.values(APP_DEFINITIONS).filter(
    (a) => !q || a.title.toLowerCase().includes(q) || a.desc.toLowerCase().includes(q)
  );
  container.innerHTML = appEntries
    .map(
      (a) => `
      <button type="button" class="launcher-item" data-launch-app="${a.id}">
        <span class="launcher-item-icon">${a.glyph}</span>
        <div>
          <strong>${escapeHtml(a.title)}</strong>
          <span>${escapeHtml(a.desc)}</span>
        </div>
      </button>
    `
    )
    .join("");
}

async function setWallpaper(theme, persist = true) {
  if (!WALLPAPERS.includes(theme)) return;
  osState.wallpaper = theme;
  document.body.dataset.wallpaper = theme;
  if (persist) {
    await apiFetch("/api/desktop/settings", {
      method: "POST",
      body: JSON.stringify({ wallpaper: theme }),
    }).catch(() => {});
  }
}

async function refreshDesktopIcons() {
  try {
    const listing = await apiFetch("/api/fs/list?path=Desktop");
    osState.desktopItems = listing.items || [];
    renderDesktopIcons();
  } catch {
    // ignore
  }
}

async function pollTrayTelemetry() {
  try {
    const { telemetry: t } = await apiFetch("/api/sys/telemetry");
    el("tray-cpu").textContent = `CPU ${t.cpuPercent}%`;
    el("tray-ram").textContent = `RAM ${t.memPercent}%`;
    el("launcher-host-info").textContent = `${t.hostname} · ${t.platform}`;
  } catch {
    // ignore
  }
}

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const dateStr = now.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  el("tray-clock").textContent = `${hh}:${mm} · ${dateStr}`;
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
}

function closeMenus() {
  el("start-menu").hidden = true;
  el("btn-start").setAttribute("aria-expanded", "false");
  el("desktop-context-menu").hidden = true;
}

async function bootDesktop() {
  try {
    const boot = await apiFetch("/api/desktop/bootstrap");
    osState.desktopItems = boot.desktopItems || [];
    if (boot.settings?.wallpaper) {
      await setWallpaper(boot.settings.wallpaper, false);
    }
    if (boot.telemetry) {
      el("tray-cpu").textContent = `CPU ${boot.telemetry.cpuPercent}%`;
      el("tray-ram").textContent = `RAM ${boot.telemetry.memPercent}%`;
      el("launcher-host-info").textContent = `${boot.telemetry.hostname} · ${boot.telemetry.platform}`;
    }
    renderDesktopIcons();
    renderLauncherApps();

    // Open a live Linux Terminal on boot if no windows are open yet
    if (osState.windows.size === 0) {
      openAppWindow("terminal", { x: 228, y: 28 });
    }
  } catch (err) {
    if (!String(err.message).includes("Passcode")) {
      toast(err.message, true);
    }
  }
}

function wireShellEvents() {
  updateClock();
  setInterval(updateClock, 15000);
  setInterval(pollTrayTelemetry, 5000);

  // Desktop Icons Click (debounced so single-tap AND double-click on Chromebook touchpad open cleanly once)
  el("desktop-icons").addEventListener("click", (ev) => {
    const now = Date.now();
    if (now - osState.lastIconLaunchAt < 320) return;
    const appBtn = ev.target.closest("[data-open-app]");
    if (appBtn) {
      osState.lastIconLaunchAt = now;
      closeMenus();
      openAppWindow(appBtn.dataset.openApp);
      return;
    }
    const itemBtn = ev.target.closest("[data-open-desk-item]");
    if (itemBtn) {
      osState.lastIconLaunchAt = now;
      closeMenus();
      const rel = itemBtn.dataset.openDeskItem;
      if (itemBtn.dataset.itemDir === "true") {
        openAppWindow("files", { path: rel });
      } else {
        openAppWindow("editor", { path: rel });
      }
    }
  });

  // Desktop Surface Background Click & Right-Click Context Menu
  const surface = el("desktop-surface");
  const ctxMenu = el("desktop-context-menu");

  surface.addEventListener("mousedown", (ev) => {
    if (!ev.target.closest(".start-menu") && !ev.target.closest(".context-menu")) {
      closeMenus();
    }
  });

  surface.addEventListener("contextmenu", (ev) => {
    if (ev.target.closest(".os-window")) return;
    ev.preventDefault();
    closeMenus();
    const rect = surface.getBoundingClientRect();
    const x = Math.min(ev.clientX - rect.left, rect.width - 230);
    const y = Math.min(ev.clientY - rect.top, rect.height - 250);
    ctxMenu.style.left = `${Math.max(8, x)}px`;
    ctxMenu.style.top = `${Math.max(8, y)}px`;
    ctxMenu.hidden = false;
  });

  ctxMenu.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-ctx]");
    if (!btn) return;
    const act = btn.dataset.ctx;
    closeMenus();
    if (act === "open-terminal") {
      openAppWindow("terminal", { cwd: "Desktop" });
    } else if (act === "open-files") {
      openAppWindow("files", { path: "Desktop" });
    } else if (act === "open-monitor") {
      openAppWindow("monitor");
    } else if (act === "cycle-wallpaper") {
      const next = WALLPAPERS[(WALLPAPERS.indexOf(osState.wallpaper) + 1) % WALLPAPERS.length];
      setWallpaper(next, true);
    } else if (act === "refresh") {
      refreshDesktopIcons();
    } else if (act === "new-file") {
      const name = await promptModal("New Desktop File", "Enter filename to create on ~/Desktop:", "notes.py");
      if (!name) return;
      const rel = `Desktop/${name}`;
      await apiFetch("/api/fs/write", {
        method: "POST",
        body: JSON.stringify({ path: rel, content: "" }),
      });
      await refreshDesktopIcons();
      openAppWindow("editor", { path: rel });
    } else if (act === "new-folder") {
      const name = await promptModal("New Desktop Folder", "Enter folder name:", "MyProject");
      if (!name) return;
      await apiFetch("/api/fs/mkdir", {
        method: "POST",
        body: JSON.stringify({ path: `Desktop/${name}` }),
      });
      await refreshDesktopIcons();
    }
  });

  // Start Menu & Pinned Dock
  el("btn-start").addEventListener("click", () => {
    const menu = el("start-menu");
    const willShow = menu.hidden;
    closeMenus();
    menu.hidden = !willShow;
    el("btn-start").setAttribute("aria-expanded", willShow ? "true" : "false");
    if (willShow) {
      el("launcher-search").value = "";
      renderLauncherApps("");
      setTimeout(() => el("launcher-search").focus(), 20);
    }
  });

  el("launcher-search").addEventListener("input", (ev) => {
    renderLauncherApps(ev.target.value);
  });

  el("launcher-apps").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-launch-app]");
    if (!btn) return;
    closeMenus();
    openAppWindow(btn.dataset.launchApp);
  });

  for (const wpBtn of document.querySelectorAll("[data-wp]")) {
    wpBtn.addEventListener("click", () => setWallpaper(wpBtn.dataset.wp, true));
  }

  el("btn-launcher-fullscreen").addEventListener("click", () => {
    closeMenus();
    toggleFullscreen();
  });

  el("btn-cloud-guide").addEventListener("click", () => {
    closeMenus();
    el("modal-cloud-guide").hidden = false;
  });

  el("btn-close-cloud-guide").addEventListener("click", () => {
    el("modal-cloud-guide").hidden = true;
  });

  el("pinned-dock").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-launch]");
    if (!btn) return;
    closeMenus();
    openAppWindow(btn.dataset.launch);
  });

  el("taskbar-windows").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-task-win]");
    if (!btn) return;
    const win = osState.windows.get(btn.dataset.taskWin);
    if (!win) return;
    if (!win.minimized && win.el.classList.contains("is-focused")) {
      minimizeWindow(win.id);
    } else {
      focusWindow(win.id);
    }
  });

  el("tray-telemetry").addEventListener("click", () => openAppWindow("monitor"));
  el("btn-tray-fullscreen").addEventListener("click", toggleFullscreen);

  // Passcode Unlock
  el("form-passcode").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    osState.passcode = el("inp-passcode").value;
    sessionStorage.setItem(PASSCODE_KEY, osState.passcode);
    try {
      await bootDesktop();
      el("passcode-err").hidden = true;
      el("modal-passcode").hidden = true;
    } catch {
      const errNode = el("passcode-err");
      errNode.hidden = false;
      errNode.textContent = "Invalid passcode.";
    }
  });
}

wireShellEvents();
bootDesktop();
