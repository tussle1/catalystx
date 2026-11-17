import { Terminal } from "/vendor/xterm/lib/xterm.mjs";
import { FitAddon } from "/vendor/xterm-fit/lib/addon-fit.mjs";

export function mountTerminalApp(winBody, ctx, options = {}) {
  const cwd = options.cwd || "";
  winBody.innerHTML = `
    <div class="app-toolbar">
      <div class="app-toolbar-group">
        <span class="muted mono" style="font-size:12px">bash · ~/${ctx.escapeHtml(cwd)}</span>
      </div>
      <div class="app-toolbar-group">
        <button type="button" class="os-btn" data-act="ctrlc" title="Send SIGINT (Ctrl+C)">Ctrl+C</button>
        <button type="button" class="os-btn" data-act="clear" title="Clear terminal">Clear</button>
        <button type="button" class="os-btn" data-act="new-win" title="Open another Terminal window">+ Window</button>
      </div>
    </div>
    <div class="term-wrap" data-role="term-host"></div>
  `;

  const hostEl = winBody.querySelector('[data-role="term-host"]');
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13.5,
    fontFamily: 'ui-monospace, "Cascadia Mono", "JetBrains Mono", Consolas, monospace',
    scrollback: 3000,
    theme: {
      background: "#090a14",
      foreground: "#eef0ff",
      cursor: "#7784fc",
      selectionBackground: "rgba(119, 132, 252, 0.35)",
      black: "#15162b",
      red: "#f0736f",
      green: "#6bd47a",
      yellow: "#ffc93f",
      blue: "#7784fc",
      magenta: "#c084fc",
      cyan: "#38bdf8",
      white: "#f7f7fd",
    },
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(hostEl);

  let ws = null;
  let closed = false;

  function fitAndNotify() {
    if (closed) return;
    try {
      fitAddon.fit();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    } catch {
      // ignore if hidden/minimized
    }
  }

  requestAnimationFrame(() => {
    fitAndNotify();
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const qs = new URLSearchParams({
      cwd,
      cols: String(term.cols || 96),
      rows: String(term.rows || 26),
    });
    if (ctx.getPasscode()) qs.set("token", ctx.getPasscode());
    ws = new WebSocket(`${proto}//${window.location.host}/ws/pty?${qs.toString()}`);

    ws.addEventListener("open", () => {
      fitAndNotify();
      if (options.initialCommand) {
        ws.send(JSON.stringify({ type: "input", data: `${options.initialCommand}\n` }));
      }
      term.focus();
    });

    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "output" && msg.data) {
          term.write(msg.data);
        } else if (msg.type === "exit") {
          term.writeln(`\r\n\x1b[33m[Shell exited with code ${msg.code}]\x1b[0m`);
        }
      } catch {
        // ignore
      }
    });

    ws.addEventListener("close", () => {
      if (!closed) {
        term.writeln("\r\n\x1b[90m[Terminal session closed]\x1b[0m");
      }
    });
  });

  term.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data }));
    }
  });

  const ro = new ResizeObserver(() => fitAndNotify());
  ro.observe(hostEl);

  winBody.querySelector(".app-toolbar").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "ctrlc" && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data: "\x03" }));
      term.focus();
    } else if (act === "clear") {
      term.clear();
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data: "\x0c" }));
      }
      term.focus();
    } else if (act === "new-win") {
      ctx.openApp("terminal", { cwd });
    }
  });

  return {
    onFocus() {
      term.focus();
    },
    onClose() {
      closed = true;
      ro.disconnect();
      try {
        ws?.close();
      } catch {
        // ignore
      }
      term.dispose();
    },
  };
}
