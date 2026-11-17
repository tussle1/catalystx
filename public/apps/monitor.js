function fmtGiB(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function fmtUptime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

export function mountMonitorApp(winBody, ctx) {
  winBody.innerHTML = `
    <div class="app-toolbar">
      <div class="app-toolbar-group">
        <span class="mono muted" data-role="host-meta">Loading Linux kernel telemetry…</span>
      </div>
      <button type="button" class="os-btn" data-act="refresh">↻ Refresh</button>
    </div>
    <div class="mon-body">
      <div class="mon-cards">
        <div class="mon-card">
          <div class="mon-card-label">CPU Utilization</div>
          <div class="mon-card-val" data-role="cpu-val">--%</div>
          <div class="meter"><span data-role="cpu-bar" style="width:0%"></span></div>
        </div>
        <div class="mon-card">
          <div class="mon-card-label">System Memory</div>
          <div class="mon-card-val" data-role="mem-val">--</div>
          <div class="meter"><span data-role="mem-bar" style="width:0%"></span></div>
        </div>
        <div class="mon-card">
          <div class="mon-card-label">Cloud Disk Storage</div>
          <div class="mon-card-val" data-role="disk-val">--</div>
          <div class="meter"><span data-role="disk-bar" style="width:0%"></span></div>
        </div>
      </div>

      <table class="files-table">
        <thead>
          <tr>
            <th>PID</th>
            <th>Process</th>
            <th>CPU %</th>
            <th>MEM %</th>
            <th>Command</th>
            <th style="text-align:right">Action</th>
          </tr>
        </thead>
        <tbody data-role="proc-rows"></tbody>
      </table>
    </div>
  `;

  const hostMeta = winBody.querySelector('[data-role="host-meta"]');
  const cpuVal = winBody.querySelector('[data-role="cpu-val"]');
  const cpuBar = winBody.querySelector('[data-role="cpu-bar"]');
  const memVal = winBody.querySelector('[data-role="mem-val"]');
  const memBar = winBody.querySelector('[data-role="mem-bar"]');
  const diskVal = winBody.querySelector('[data-role="disk-val"]');
  const diskBar = winBody.querySelector('[data-role="disk-bar"]');
  const procRows = winBody.querySelector('[data-role="proc-rows"]');

  async function poll() {
    try {
      const { telemetry: t, processes } = await ctx.apiFetch("/api/sys/telemetry");
      hostMeta.textContent = `${t.hostname} · ${t.platform} · ${t.cpuCores} vCPU · Up ${fmtUptime(t.uptimeSec)}`;
      cpuVal.textContent = `${t.cpuPercent}%`;
      cpuBar.style.width = `${t.cpuPercent}%`;

      memVal.textContent = `${fmtGiB(t.memUsedBytes)} / ${fmtGiB(t.memTotalBytes)}`;
      memBar.style.width = `${t.memPercent}%`;

      const diskPct = t.diskTotalBytes
        ? Math.round((t.diskUsedBytes / t.diskTotalBytes) * 100)
        : 0;
      diskVal.textContent = t.diskTotalBytes
        ? `${fmtGiB(t.diskFreeBytes)} free`
        : "Available";
      diskBar.style.width = `${diskPct}%`;

      procRows.innerHTML = (processes || [])
        .map(
          (p) => `
          <tr class="files-row">
            <td class="mono muted">${p.pid}</td>
            <td><strong>${ctx.escapeHtml(p.name)}</strong></td>
            <td class="mono">${p.cpu.toFixed(1)}%</td>
            <td class="mono">${p.mem.toFixed(1)}%</td>
            <td class="mono muted" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ctx.escapeHtml(
              p.command
            )}</td>
            <td style="text-align:right">
              ${
                p.protected
                  ? `<span class="muted" style="font-size:11px">System</span>`
                  : `<button type="button" class="os-btn danger" data-kill-pid="${p.pid}" style="padding:3px 8px;font-size:11px">End</button>`
              }
            </td>
          </tr>
        `
        )
        .join("");
    } catch {
      // ignore transient error
    }
  }

  winBody.addEventListener("click", async (ev) => {
    if (ev.target.closest('[data-act="refresh"]')) {
      poll();
      return;
    }
    const killBtn = ev.target.closest("[data-kill-pid]");
    if (killBtn) {
      const pid = Number(killBtn.dataset.killPid);
      try {
        await ctx.apiFetch("/api/sys/kill", {
          method: "POST",
          body: JSON.stringify({ pid }),
        });
        ctx.toast(`Sent SIGTERM to PID ${pid}`);
        setTimeout(poll, 350);
      } catch (err) {
        ctx.toast(err.message, true);
      }
    }
  });

  poll();
  const timer = setInterval(poll, 2800);

  return {
    onClose() {
      clearInterval(timer);
    },
  };
}
