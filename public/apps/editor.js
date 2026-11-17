export function mountEditorApp(winBody, ctx, options = {}) {
  const tabs = []; // { path, name, content, dirty }
  let activePath = null;

  winBody.innerHTML = `
    <div class="app-toolbar">
      <div class="app-toolbar-group">
        <button type="button" class="os-btn" data-act="open-file">Open…</button>
        <button type="button" class="os-btn primary" data-act="save">💾 Save (Ctrl+S)</button>
        <button type="button" class="os-btn run" data-act="run">▶ Run on Cloud CPU</button>
        <button type="button" class="os-btn" data-act="preview-html">🌐 Preview HTML</button>
      </div>
      <span class="mono muted" data-role="status" style="font-size:12px">Ready</span>
    </div>
    <div class="editor-tabs" data-role="tabs"></div>
    <div class="editor-workspace">
      <textarea class="code-textarea" data-role="textarea" spellcheck="false" placeholder="Open or create a file to start coding on your Cloud Desktop…"></textarea>
      <div class="runner-drawer" data-role="runner" hidden>
        <div class="runner-head">
          <span data-role="runner-meta">Execution Output</span>
          <button type="button" class="os-btn" data-act="hide-runner" style="padding:2px 8px;font-size:11px">Hide</button>
        </div>
        <pre class="runner-pre" data-role="runner-out"></pre>
      </div>
    </div>
  `;

  const tabsEl = winBody.querySelector('[data-role="tabs"]');
  const areaEl = winBody.querySelector('[data-role="textarea"]');
  const statusEl = winBody.querySelector('[data-role="status"]');
  const runnerEl = winBody.querySelector('[data-role="runner"]');
  const runnerMeta = winBody.querySelector('[data-role="runner-meta"]');
  const runnerOut = winBody.querySelector('[data-role="runner-out"]');

  function getActiveTab() {
    return tabs.find((t) => t.path === activePath) || null;
  }

  function renderTabs() {
    if (tabs.length === 0) {
      tabsEl.innerHTML = `<span class="muted" style="padding:6px 4px;font-size:12px">No open tabs</span>`;
      areaEl.value = "";
      statusEl.textContent = "No file selected";
      return;
    }
    tabsEl.innerHTML = tabs
      .map(
        (t) => `
        <div class="editor-tab ${t.path === activePath ? "is-active" : ""}" data-tab-path="${ctx.escapeHtml(t.path)}">
          <span>${ctx.escapeHtml(t.name)}${t.dirty ? " ●" : ""}</span>
          <span data-close-tab="${ctx.escapeHtml(t.path)}" style="opacity:0.7;padding-left:4px">×</span>
        </div>
      `
      )
      .join("");
    const cur = getActiveTab();
    if (cur) {
      areaEl.value = cur.content;
      statusEl.textContent = `~/${cur.path}${cur.dirty ? " (unsaved)" : ""}`;
    }
  }

  async function openFilePath(relPath, autoRun = false) {
    if (!relPath) return;
    const existing = tabs.find((t) => t.path === relPath);
    if (existing) {
      activePath = existing.path;
      renderTabs();
      if (autoRun) await runActiveFile();
      return;
    }
    try {
      const file = await ctx.apiFetch(`/api/fs/read?path=${encodeURIComponent(relPath)}`);
      tabs.push({
        path: file.path,
        name: file.name,
        content: file.content,
        dirty: false,
      });
      activePath = file.path;
      renderTabs();
      if (autoRun) await runActiveFile();
    } catch (err) {
      ctx.toast(err.message, true);
    }
  }

  async function saveActiveFile() {
    const cur = getActiveTab();
    if (!cur) {
      const newRel = await ctx.promptModal("Save New File", "Enter relative path in Cloud Home:", "Desktop/notes.py");
      if (!newRel) return false;
      tabs.push({
        path: newRel,
        name: newRel.split("/").pop(),
        content: areaEl.value,
        dirty: true,
      });
      activePath = newRel;
    }
    const target = getActiveTab();
    if (!target) return false;

    try {
      await ctx.apiFetch("/api/fs/write", {
        method: "POST",
        body: JSON.stringify({ path: target.path, content: target.content }),
      });
      target.dirty = false;
      renderTabs();
      statusEl.textContent = `Saved ~/${target.path}`;
      if (target.path.startsWith("Desktop/")) ctx.refreshDesktopIcons();
      return true;
    } catch (err) {
      ctx.toast(err.message, true);
      return false;
    }
  }

  async function runActiveFile() {
    const saved = await saveActiveFile();
    if (!saved) return;
    const cur = getActiveTab();
    if (!cur) return;

    runnerEl.hidden = false;
    runnerMeta.textContent = `Running ~/${cur.path} on Linux CPU…`;
    runnerOut.textContent = "";

    try {
      const res = await ctx.apiFetch("/api/exec/file", {
        method: "POST",
        body: JSON.stringify({ path: cur.path }),
      });
      runnerMeta.textContent = `Exit ${res.exitCode} · ${res.durationMs} ms · ~/${cur.path}`;
      runnerOut.textContent = [res.stdout, res.stderr].filter(Boolean).join("\n") || "(Completed with no output)";
    } catch (err) {
      runnerMeta.textContent = "Execution failed";
      runnerOut.textContent = err.message;
    }
  }

  areaEl.addEventListener("input", () => {
    const cur = getActiveTab();
    if (cur) {
      cur.content = areaEl.value;
      if (!cur.dirty) {
        cur.dirty = true;
        renderTabs();
      }
    }
  });

  areaEl.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
      ev.preventDefault();
      saveActiveFile();
      return;
    }
    if (ev.key === "Tab") {
      ev.preventDefault();
      const start = areaEl.selectionStart;
      const end = areaEl.selectionEnd;
      areaEl.value = areaEl.value.slice(0, start) + "  " + areaEl.value.slice(end);
      areaEl.selectionStart = areaEl.selectionEnd = start + 2;
      areaEl.dispatchEvent(new Event("input"));
    }
  });

  tabsEl.addEventListener("click", (ev) => {
    const closeEl = ev.target.closest("[data-close-tab]");
    if (closeEl) {
      const p = closeEl.dataset.closeTab;
      const idx = tabs.findIndex((t) => t.path === p);
      if (idx >= 0) tabs.splice(idx, 1);
      if (activePath === p) activePath = tabs[0]?.path || null;
      renderTabs();
      return;
    }
    const tabEl = ev.target.closest("[data-tab-path]");
    if (tabEl) {
      activePath = tabEl.dataset.tabPath;
      renderTabs();
    }
  });

  winBody.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "save") {
      await saveActiveFile();
    } else if (act === "run") {
      await runActiveFile();
    } else if (act === "hide-runner") {
      runnerEl.hidden = true;
    } else if (act === "open-file") {
      const rel = await ctx.promptModal(
        "Open File",
        "Enter path inside Cloud Home (or double-click any file in Files):",
        "Desktop/hello_cloud.py"
      );
      if (rel) openFilePath(rel);
    } else if (act === "preview-html") {
      const saved = await saveActiveFile();
      const cur = getActiveTab();
      if (saved && cur) {
        ctx.openApp("browser", { url: `/cloud-files/${cur.path}` });
      }
    }
  });

  const initialPath = options.path || "Desktop/hello_cloud.py";
  openFilePath(initialPath, Boolean(options.autoRun));

  return {
    openFilePath,
  };
}
