function formatBytes(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function iconForItem(item) {
  if (item.isDirectory) return "📁";
  if (item.kind === "html") return "🌐";
  if (item.kind === "image") return "🖼️";
  if (/\.(py)$/i.test(item.name)) return "🐍";
  if (/\.(js|mjs|ts)$/i.test(item.name)) return "⚡";
  if (/\.(sh|bash)$/i.test(item.name)) return "›_";
  if (/\.(md|txt)$/i.test(item.name)) return "📄";
  return "📦";
}

export function mountFilesApp(winBody, ctx, options = {}) {
  let currentPath = options.path || "";

  winBody.innerHTML = `
    <div class="app-toolbar">
      <div class="app-toolbar-group">
        <button type="button" class="os-btn" data-act="up" title="Parent folder">↑ Up</button>
        <span class="mono" data-role="crumb" style="font-size:12.5px; padding:0 6px;">~/</span>
      </div>
      <div class="app-toolbar-group">
        <button type="button" class="os-btn" data-act="new-file">+ File</button>
        <button type="button" class="os-btn" data-act="new-dir">+ Folder</button>
        <label class="os-btn primary" style="cursor:pointer">
          ⬆ Upload
          <input type="file" data-role="upload-input" multiple hidden />
        </label>
        <button type="button" class="os-btn" data-act="term-here" title="Open Terminal in this directory">›_ Shell</button>
        <button type="button" class="os-btn" data-act="refresh">↻</button>
      </div>
    </div>
    <div class="files-layout">
      <nav class="files-sidebar">
        <button type="button" class="files-nav-btn" data-nav="">🏠 Cloud Home</button>
        <button type="button" class="files-nav-btn" data-nav="Desktop">🖥️ Desktop</button>
        <button type="button" class="files-nav-btn" data-nav="Documents">📄 Documents</button>
        <button type="button" class="files-nav-btn" data-nav="Projects">🚀 Projects</button>
        <button type="button" class="files-nav-btn" data-nav="Downloads">⬇️ Downloads</button>
      </nav>
      <div class="files-main" data-role="dropzone">
        <table class="files-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Modified</th>
              <th style="text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody data-role="rows"></tbody>
        </table>
      </div>
    </div>
  `;

  const rowsEl = winBody.querySelector('[data-role="rows"]');
  const crumbEl = winBody.querySelector('[data-role="crumb"]');
  const uploadInp = winBody.querySelector('[data-role="upload-input"]');

  async function loadDir(targetPath = currentPath) {
    try {
      const data = await ctx.apiFetch(`/api/fs/list?path=${encodeURIComponent(targetPath)}`);
      currentPath = data.path || "";
      crumbEl.textContent = `~/${currentPath}`;

      for (const navBtn of winBody.querySelectorAll("[data-nav]")) {
        navBtn.classList.toggle("is-active", navBtn.dataset.nav === currentPath);
      }

      if (!data.items || data.items.length === 0) {
        rowsEl.innerHTML = `<tr><td colspan="4" class="muted" style="padding:18px">Folder is empty. Drag files here from your Chromebook or click + File.</td></tr>`;
        return;
      }

      rowsEl.innerHTML = data.items
        .map((item) => {
          const runnable = /\.(py|js|mjs|sh)$/i.test(item.name);
          const timeStr = item.mtime ? item.mtime.slice(0, 16).replace("T", " ") : "";
          return `
            <tr class="files-row" data-item-path="${ctx.escapeHtml(item.path)}" data-is-dir="${item.isDirectory}" data-kind="${item.kind}">
              <td>
                <button type="button" class="file-name-btn" data-open-item="${ctx.escapeHtml(item.path)}">
                  <span>${iconForItem(item)}</span>
                  <span>${ctx.escapeHtml(item.name)}</span>
                </button>
              </td>
              <td class="mono muted">${item.isDirectory ? "Folder" : formatBytes(item.size)}</td>
              <td class="mono muted">${ctx.escapeHtml(timeStr)}</td>
              <td>
                <div class="file-row-actions">
                  ${
                    runnable
                      ? `<button type="button" class="os-btn run" data-run-item="${ctx.escapeHtml(item.path)}" title="Open & Run">▶</button>`
                      : ""
                  }
                  ${
                    item.kind === "html"
                      ? `<button type="button" class="os-btn" data-preview-html="${ctx.escapeHtml(item.path)}" title="Preview in Browser">🌐</button>`
                      : ""
                  }
                  ${
                    !item.isDirectory
                      ? `<a class="os-btn" href="/cloud-files/${encodeURI(item.path)}?download=1${
                          ctx.getPasscode() ? `&token=${encodeURIComponent(ctx.getPasscode())}` : ""
                        }" download style="text-decoration:none" title="Download to Chromebook">⬇</a>`
                      : ""
                  }
                  <button type="button" class="os-btn" data-rename-item="${ctx.escapeHtml(item.path)}" data-cur-name="${ctx.escapeHtml(item.name)}" title="Rename">✎</button>
                  <button type="button" class="os-btn danger" data-del-item="${ctx.escapeHtml(item.path)}" title="Delete">✕</button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("");
    } catch (err) {
      ctx.toast(err.message, true);
    }
  }

  async function uploadFileList(fileList) {
    for (const file of fileList) {
      const b64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const str = String(reader.result || "");
          const comma = str.indexOf(",");
          resolve(comma >= 0 ? str.slice(comma + 1) : str);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await ctx.apiFetch("/api/fs/upload", {
        method: "POST",
        body: JSON.stringify({
          dir: currentPath,
          filename: file.name,
          base64Data: b64,
        }),
      });
    }
    ctx.toast(`Uploaded ${fileList.length} file(s) to ~/${currentPath}`);
    await loadDir();
    if (currentPath === "Desktop") ctx.refreshDesktopIcons();
  }

  uploadInp.addEventListener("change", async (ev) => {
    if (ev.target.files?.length) {
      await uploadFileList(ev.target.files);
      uploadInp.value = "";
    }
  });

  const dropzone = winBody.querySelector('[data-role="dropzone"]');
  dropzone.addEventListener("dragover", (ev) => ev.preventDefault());
  dropzone.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    if (ev.dataTransfer?.files?.length) {
      await uploadFileList(ev.dataTransfer.files);
    }
  });

  winBody.querySelector(".files-sidebar").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-nav]");
    if (btn) loadDir(btn.dataset.nav);
  });

  winBody.querySelector(".app-toolbar").addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "up") {
      if (!currentPath) return;
      const parts = currentPath.split("/");
      parts.pop();
      loadDir(parts.join("/"));
    } else if (act === "refresh") {
      loadDir();
    } else if (act === "term-here") {
      ctx.openApp("terminal", { cwd: currentPath });
    } else if (act === "new-file") {
      const name = await ctx.promptModal("New File", `Create file inside ~/${currentPath || ""}`, "script.py");
      if (!name) return;
      const rel = currentPath ? `${currentPath}/${name}` : name;
      await ctx.apiFetch("/api/fs/write", {
        method: "POST",
        body: JSON.stringify({ path: rel, content: "" }),
      });
      await loadDir();
      if (currentPath === "Desktop") ctx.refreshDesktopIcons();
      ctx.openApp("editor", { path: rel });
    } else if (act === "new-dir") {
      const name = await ctx.promptModal("New Folder", `Create folder inside ~/${currentPath || ""}`, "new-folder");
      if (!name) return;
      const rel = currentPath ? `${currentPath}/${name}` : name;
      await ctx.apiFetch("/api/fs/mkdir", {
        method: "POST",
        body: JSON.stringify({ path: rel }),
      });
      await loadDir();
      if (currentPath === "Desktop") ctx.refreshDesktopIcons();
    }
  });

  rowsEl.addEventListener("click", async (ev) => {
    const openBtn = ev.target.closest("[data-open-item]");
    if (openBtn) {
      const tr = openBtn.closest("tr");
      const itemPath = openBtn.dataset.openItem;
      const isDir = tr.dataset.isDir === "true";
      const kind = tr.dataset.kind;
      if (isDir) {
        loadDir(itemPath);
      } else if (kind === "image") {
        ctx.openApp("browser", { url: `/cloud-files/${itemPath}`, title: itemPath });
      } else {
        ctx.openApp("editor", { path: itemPath });
      }
      return;
    }

    const runBtn = ev.target.closest("[data-run-item]");
    if (runBtn) {
      ctx.openApp("editor", { path: runBtn.dataset.runItem, autoRun: true });
      return;
    }

    const htmlBtn = ev.target.closest("[data-preview-html]");
    if (htmlBtn) {
      ctx.openApp("browser", { url: `/cloud-files/${htmlBtn.dataset.previewHtml}` });
      return;
    }

    const renBtn = ev.target.closest("[data-rename-item]");
    if (renBtn) {
      const fromPath = renBtn.dataset.renameItem;
      const nextName = await ctx.promptModal("Rename Item", "Enter new name:", renBtn.dataset.curName);
      if (!nextName || nextName === renBtn.dataset.curName) return;
      const parent = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
      const toPath = parent ? `${parent}/${nextName}` : nextName;
      await ctx.apiFetch("/api/fs/rename", {
        method: "POST",
        body: JSON.stringify({ fromPath, toPath }),
      });
      await loadDir();
      ctx.refreshDesktopIcons();
      return;
    }

    const delBtn = ev.target.closest("[data-del-item]");
    if (delBtn) {
      const target = delBtn.dataset.delItem;
      await ctx.apiFetch("/api/fs/delete", {
        method: "POST",
        body: JSON.stringify({ path: target }),
      });
      ctx.toast(`Deleted ${target}`);
      await loadDir();
      ctx.refreshDesktopIcons();
    }
  });

  loadDir(currentPath);
  return {};
}
