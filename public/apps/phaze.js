export function mountPhazeApp(winBody, ctx) {
  let hosts = [];
  let session = null; // { connectionId, host, output, connection }
  let ws = null;
  let closed = false;

  winBody.innerHTML = `
    <div class="app-toolbar">
      <div class="app-toolbar-group" data-role="toolbar-left">
        <span class="mono muted" data-role="mode-badge">Probing Phaze MCP…</span>
      </div>
      <div class="app-toolbar-group" data-role="toolbar-right">
        <button type="button" class="os-btn" data-act="cfg">⚙️ MCP URL</button>
        <button type="button" class="os-btn" data-act="refresh">↻ Hosts</button>
      </div>
    </div>
    <div class="phaze-win-root" data-role="content"></div>
  `;

  const modeBadge = winBody.querySelector('[data-role="mode-badge"]');
  const toolbarLeft = winBody.querySelector('[data-role="toolbar-left"]');
  const contentEl = winBody.querySelector('[data-role="content"]');

  function closeWs() {
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore
      }
      ws = null;
    }
  }

  async function loadHosts(force = false) {
    closeWs();
    session = null;
    try {
      const boot = await ctx.apiFetch(`/api/bootstrap${force ? "?probe=1" : ""}`);
      hosts = boot.hosts || [];
      toolbarLeft.innerHTML = `<span class="mono muted" data-role="mode-badge">${
        boot.activeMode === "live"
          ? `● Live Phaze MCP (${ctx.escapeHtml(boot.mcpUrl)})`
          : `◐ Phaze Demo Hosts (Connect real MCP via ⚙️ MCP URL)`
      }</span>`;

      contentEl.innerHTML = `
        <div class="phaze-hosts-list">
          ${hosts
            .map(
              (h) => `
              <div class="phaze-host-tile">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <strong>${ctx.escapeHtml(h.name)}</strong>
                  <span class="mono" style="font-size:11px;color:${h.online ? "#6bd47a" : "#9d9dc2"}">${
                    h.online ? "Online" : "Offline"
                  }</span>
                </div>
                <div class="muted" style="font-size:12px">${ctx.escapeHtml(h.os || "Windows 11")} · ${ctx.escapeHtml(
                  h.gpu || h.group || "Workstation"
                )}</div>
                <button type="button" class="os-btn primary" data-phaze-conn="${ctx.escapeHtml(h.machine_id)}" ${
                  h.online ? "" : "disabled"
                }>Connect Remote Screen</button>
              </div>
            `
            )
            .join("")}
        </div>
      `;
    } catch (err) {
      modeBadge.textContent = err.message;
    }
  }

  async function connectHost(machineId) {
    const host = hosts.find((h) => h.machine_id === machineId);
    if (!host) return;
    try {
      const res = await ctx.apiFetch("/api/connect", {
        method: "POST",
        body: JSON.stringify({
          machineId: host.machine_id,
          peerId: host.peer_id,
          relay: Boolean(host.requires_relay),
          takeControl: true,
        }),
      });
      session = {
        connectionId: res.connectionId,
        host,
        output: res.defaultOutput,
        connection: res.connection,
      };
      renderSessionStage();
    } catch (err) {
      ctx.toast(err.message, true);
    }
  }

  function renderSessionStage() {
    const outputs = session.connection?.outputs || [];
    toolbarLeft.innerHTML = `
      <button type="button" class="os-btn" data-act="back">← Hosts</button>
      <strong style="font-size:12.5px">${ctx.escapeHtml(session.host.name)}</strong>
      <select class="os-select" data-role="out-sel">
        ${outputs
          .map(
            (o, i) =>
              `<option value="${o.id}" ${o.id === session.output ? "selected" : ""}>${ctx.escapeHtml(
                o.name || `Display ${i + 1}`
              )}</option>`
          )
          .join("")}
      </select>
      <button type="button" class="os-btn" data-act="win-key">Win</button>
      <button type="button" class="os-btn danger" data-act="disc">Disconnect</button>
    `;

    contentEl.innerHTML = `
      <div class="phaze-stage-wrap" tabindex="0" data-role="stage">
        <img class="phaze-stage-img" data-role="frame" alt="Phaze remote stream" draggable="false" />
      </div>
    `;

    const stage = contentEl.querySelector('[data-role="stage"]');
    const img = contentEl.querySelector('[data-role="frame"]');

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const tokenQ = ctx.getPasscode() ? `?token=${encodeURIComponent(ctx.getPasscode())}` : "";
    ws = new WebSocket(`${proto}//${window.location.host}/ws${tokenQ}`);

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "subscribe",
          connectionId: session.connectionId,
          output: session.output,
          intervalMs: 450,
        })
      );
      stage.focus();
    });

    ws.addEventListener("message", (ev) => {
      if (closed) return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "frame") {
          img.src = `data:${msg.mimeType};base64,${msg.data}`;
        }
      } catch {
        // ignore
      }
    });

    function mapCoords(clientX, clientY) {
      const natW = img.naturalWidth || 1920;
      const natH = img.naturalHeight || 1080;
      const rect = img.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const scale = Math.min(rect.width / natW, rect.height / natH);
      const rw = natW * scale;
      const rh = natH * scale;
      const ox = rect.left + (rect.width - rw) / 2;
      const oy = rect.top + (rect.height - rh) / 2;
      if (clientX < ox || clientX > ox + rw || clientY < oy || clientY > oy + rh) return null;
      return [
        Math.round(((clientX - ox) / rw) * natW),
        Math.round(((clientY - oy) / rh) * natH),
      ];
    }

    stage.addEventListener("click", (ev) => {
      stage.focus();
      const pt = mapCoords(ev.clientX, ev.clientY);
      if (pt && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "click", button: "left", coordinate: pt }));
      }
    });

    stage.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      const pt = mapCoords(ev.clientX, ev.clientY);
      if (pt && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "click", button: "right", coordinate: pt }));
      }
    });

    stage.addEventListener("keydown", (ev) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(ev.key)) return;
      ev.preventDefault();
      const map = { Enter: "[Enter]", Backspace: "[Backspace]", Escape: "[Escape]", Tab: "[Tab]", " ": "[Space]" };
      const text = map[ev.key] || (ev.key.length === 1 ? ev.key : "");
      if (text && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "keys", text, modifiers: [] }));
      }
    });
  }

  winBody.addEventListener("change", (ev) => {
    if (ev.target.matches('[data-role="out-sel"]') && session && ws?.readyState === WebSocket.OPEN) {
      session.output = Number(ev.target.value);
      ws.send(JSON.stringify({ type: "set_stream_options", output: session.output }));
    }
  });

  winBody.addEventListener("click", async (ev) => {
    const connBtn = ev.target.closest("[data-phaze-conn]");
    if (connBtn) {
      connectHost(connBtn.dataset.phazeConn);
      return;
    }
    const actBtn = ev.target.closest("[data-act]");
    if (!actBtn) return;
    const act = actBtn.dataset.act;
    if (act === "refresh" || act === "back") {
      loadHosts(true);
    } else if (act === "disc" && session) {
      await ctx.apiFetch("/api/disconnect", {
        method: "POST",
        body: JSON.stringify({ connectionId: session.connectionId }),
      }).catch(() => {});
      loadHosts(false);
    } else if (act === "win-key" && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "keys", text: "", modifiers: ["MetaLeft"] }));
    } else if (act === "cfg") {
      const nextUrl = await ctx.promptModal(
        "Configure Phaze MCP Endpoint",
        "Enter local or HTTPS-tunneled Phaze MCP URL:",
        "http://127.0.0.1:41010/mcp"
      );
      if (nextUrl) {
        await ctx.apiFetch("/api/config", {
          method: "POST",
          body: JSON.stringify({ mcpUrl: nextUrl, mode: "auto" }),
        });
        loadHosts(true);
      }
    }
  });

  loadHosts(false);

  return {
    onClose() {
      closed = true;
      closeWs();
    },
  };
}
