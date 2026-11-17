function normalizeTargetUrl(raw, passcode) {
  const input = String(raw || "").trim();
  if (!input) return "/cloud-files/Projects/webapp-demo/index.html";

  const addToken = (u) => {
    if (!passcode) return u;
    return u + (u.includes("?") ? "&" : "?") + `token=${encodeURIComponent(passcode)}`;
  };

  // Shorthand ":9000" or "localhost:9000/foo" or "http://127.0.0.1:9000/bar"
  const portOnly = input.match(/^:?(\d{4,5})(\/.*)?$/);
  if (portOnly) {
    return addToken(`/proxy-port/${portOnly[1]}${portOnly[2] || "/"}`);
  }

  const localMatch = input.match(/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})(\/.*)?$/i);
  if (localMatch) {
    return addToken(`/proxy-port/${localMatch[1]}${localMatch[2] || "/"}`);
  }

  if (input.startsWith("/cloud-files/") || input.startsWith("/proxy-port/")) {
    return addToken(input);
  }

  if (input.startsWith("cloud://")) {
    return addToken(`/cloud-files/${input.slice("cloud://".length)}`);
  }

  if (/^https?:\/\//i.test(input)) {
    return input;
  }

  return addToken(`/cloud-files/${input.replace(/^\/+/, "")}`);
}

export function mountBrowserApp(winBody, ctx, options = {}) {
  let rawLocation = options.url || "cloud://Projects/webapp-demo/index.html";

  winBody.innerHTML = `
    <form class="app-toolbar" data-role="nav-form" style="gap:6px">
      <button type="button" class="os-btn" data-act="home" title="Demo Cloud HTML App">🏠 Demo</button>
      <button type="button" class="os-btn" data-act="reload" title="Reload">↻</button>
      <input
        type="text"
        class="os-input mono"
        data-role="addr"
        style="flex:1;min-width:140px"
        value="${ctx.escapeHtml(rawLocation)}"
        placeholder="cloud://Projects/webapp-demo/index.html or localhost:9000"
      />
      <button type="submit" class="os-btn primary">Go</button>
      <button type="button" class="os-btn run" data-act="spawn-9000" title="Start python3 -m http.server 9000 in Terminal & open :9000">
        ⚡ Serve :9000
      </button>
    </form>
    <iframe class="browser-frame" data-role="iframe" title="Cloud Web & Localhost Port Viewer"></iframe>
  `;

  const addrInp = winBody.querySelector('[data-role="addr"]');
  const iframe = winBody.querySelector('[data-role="iframe"]');

  function navigate(target) {
    rawLocation = target;
    addrInp.value = target;
    iframe.src = normalizeTargetUrl(target, ctx.getPasscode());
  }

  winBody.querySelector('[data-role="nav-form"]').addEventListener("submit", (ev) => {
    ev.preventDefault();
    navigate(addrInp.value);
  });

  winBody.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-act]");
    if (!btn) return;
    if (btn.dataset.act === "home") {
      navigate("cloud://Projects/webapp-demo/index.html");
    } else if (btn.dataset.act === "reload") {
      iframe.src = normalizeTargetUrl(addrInp.value, ctx.getPasscode());
    } else if (btn.dataset.act === "spawn-9000") {
      ctx.openApp("terminal", {
        cwd: "Projects/webapp-demo",
        initialCommand: "python3 -m http.server 9000",
      });
      setTimeout(() => navigate("localhost:9000"), 900);
    }
  });

  navigate(rawLocation);
  return {};
}
