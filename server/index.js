import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { loadDotEnv } from "./env.js";
import {
  PhazeMCPClient,
  PhazeMCPError,
  findAgentConnectionForMachine,
  findConnection,
  getPrimaryOutput,
  getSelfGuest,
} from "./phazeMcp.js";
import { PhazeEnterpriseAPI } from "./phazeApi.js";
import { SimulatedPhazeMCP } from "./simulator.js";
import {
  createSafeFs,
  ensureCloudHome,
  getSystemTelemetry,
  listProcesses,
  mimeForExt,
  runFileProcess,
} from "./cloudSystem.js";
import { PtySessionManager } from "./ptyManager.js";

loadDotEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const XTERM_DIR = path.join(ROOT_DIR, "node_modules", "@xterm", "xterm");
const XTERM_FIT_DIR = path.join(ROOT_DIR, "node_modules", "@xterm", "addon-fit");

export function createBridgeApp(overrides = {}) {
  const cloudHomeDir = path.resolve(
    overrides.cloudHomeDir || process.env.CLOUD_HOME_DIR || path.join(ROOT_DIR, "cloud-home")
  );
  const readyPromise = ensureCloudHome(cloudHomeDir);
  const safeFs = createSafeFs(cloudHomeDir);
  const ptyManager = new PtySessionManager(cloudHomeDir);

  const state = {
    configuredMode: (overrides.mode || process.env.BRIDGE_MODE || "auto").toLowerCase(),
    mcpUrl: overrides.mcpUrl || process.env.PHAZE_MCP_URL || "http://127.0.0.1:41010/mcp",
    mcpAuthToken: overrides.mcpAuthToken || process.env.PHAZE_MCP_AUTH_TOKEN || "",
    passcode: overrides.passcode ?? process.env.BRIDGE_PASSCODE ?? "",
    liveReachable: false,
    lastLiveError: null,
    lastProbeAt: 0,
  };

  const liveMcp = new PhazeMCPClient(state.mcpUrl, {
    headers: state.mcpAuthToken ? { Authorization: `Bearer ${state.mcpAuthToken}` } : {},
  });
  const simMcp = new SimulatedPhazeMCP();
  const enterpriseApi = new PhazeEnterpriseAPI(
    overrides.phazeApiKey || process.env.PHAZE_API_KEY || ""
  );

  async function probeLiveMcp(force = false) {
    if (state.configuredMode === "simulator") {
      state.liveReachable = false;
      return false;
    }
    const now = Date.now();
    if (!force && now - state.lastProbeAt < 4000) {
      return state.liveReachable;
    }
    state.lastProbeAt = now;
    try {
      await liveMcp.ping();
      state.liveReachable = true;
      state.lastLiveError = null;
      return true;
    } catch (err) {
      state.liveReachable = false;
      state.lastLiveError = err?.message || "Cannot reach local Phaze MCP";
      return false;
    }
  }

  async function getActiveClient(forceProbe = false) {
    if (state.configuredMode === "simulator") {
      return { client: simMcp, activeMode: "simulator" };
    }
    const ok = await probeLiveMcp(forceProbe);
    if (ok || state.configuredMode === "live") {
      return { client: liveMcp, activeMode: "live" };
    }
    return { client: simMcp, activeMode: "simulator" };
  }

  function isAuthorizedRequest(req) {
    if (!state.passcode) return true;
    const provided = req.headers["x-bridge-passcode"] || req.query?.token || "";
    return String(provided) === String(state.passcode);
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16mb" }));

  // Serve @xterm/xterm & @xterm/addon-fit locally (zero external CDN needed)
  app.use("/vendor/xterm/css", express.static(path.join(XTERM_DIR, "css")));
  app.use("/vendor/xterm/lib", express.static(path.join(XTERM_DIR, "lib")));
  app.use("/vendor/xterm-fit/lib", express.static(path.join(XTERM_FIT_DIR, "lib")));

  // Serve static Cloud Desktop frontend
  app.use(express.static(PUBLIC_DIR));

  app.get("/api/auth-status", (_req, res) => {
    res.json({
      passcodeRequired: Boolean(state.passcode),
    });
  });

  // Passcode guard when BRIDGE_PASSCODE is set
  app.use(["/api", "/cloud-files", "/proxy-port"], (req, res, next) => {
    if (!isAuthorizedRequest(req)) {
      res.status(401).json({
        error: "Desktop passcode required or invalid.",
        code: "UNAUTHORIZED",
      });
      return;
    }
    next();
  });

  // Serve real user files directly for image/HTML previews inside the desktop
  app.get("/cloud-files/*", async (req, res) => {
    await readyPromise;
    try {
      const relReq = req.params[0] || "";
      const { abs } = safeFs.resolveRel(relReq);
      const st = await fsp.stat(abs);
      if (st.isDirectory()) {
        const idxFile = path.join(abs, "index.html");
        if (fs.existsSync(idxFile)) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          fs.createReadStream(idxFile).pipe(res);
          return;
        }
        res.status(400).send("Cannot stream directory directly");
        return;
      }
      res.setHeader("Content-Type", mimeForExt(abs));
      if (req.query.download === "1") {
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(path.basename(abs))}"`
        );
      }
      fs.createReadStream(abs).pipe(res);
    } catch (err) {
      res.status(err.status || 404).send(err.message || "File not found");
    }
  });

  // Reverse proxy to localhost ports inside the Cloud Computer (e.g. python3 -m http.server 9000)
  app.all("/proxy-port/:port*", (req, res) => {
    const targetPort = Number(req.params.port);
    const ownPort = server.address()?.port;
    if (!Number.isInteger(targetPort) || targetPort < 1024 || targetPort > 65535 || targetPort === ownPort) {
      res.status(400).send("Invalid target localhost port (must be 1024–65535 and not the desktop port).");
      return;
    }
    const tailPath = req.params[0] || "/";
    const qsIdx = req.originalUrl.indexOf("?");
    const search = qsIdx >= 0 ? req.originalUrl.slice(qsIdx) : "";
    const forwardPath = (tailPath.startsWith("/") ? tailPath : `/${tailPath}`) + search;

    const proxyReq = http.request(
      {
        hostname: "127.0.0.1",
        port: targetPort,
        path: forwardPath,
        method: req.method,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${targetPort}`,
        },
        timeout: 10000,
      },
      (proxyRes) => {
        const headers = { ...proxyRes.headers };
        delete headers["x-frame-options"];
        delete headers["content-security-policy"];
        res.writeHead(proxyRes.statusCode || 200, headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on("error", (err) => {
      res
        .status(502)
        .type("html")
        .send(
          `<!doctype html><body style="font-family:system-ui;background:#141426;color:#f7f7fd;padding:32px">
            <h3>Nothing listening on localhost:${targetPort} yet</h3>
            <p style="color:#a3a3c7">Start a web server in <strong>Terminal</strong> first — for example:</p>
            <pre style="background:#0b0c18;padding:12px;border-radius:10px;color:#6bd47a">python3 -m http.server ${targetPort}</pre>
            <p style="color:#a3a3c7;font-size:13px">${err.message}</p>
          </body>`
        );
    });

    if (req.body && Object.keys(req.body).length > 0 && req.is("application/json")) {
      proxyReq.write(JSON.stringify(req.body));
    }
    proxyReq.end();
  });

  /* =========================================================
     REAL CLOUD OS ENDPOINTS (Filesystem, Runner, Telemetry)
     ========================================================= */
  app.get("/api/desktop/bootstrap", async (_req, res) => {
    await readyPromise;
    try {
      const settingsPath = path.join(cloudHomeDir, ".desktop-settings.json");
      let settings = { wallpaper: "nebula" };
      try {
        settings = JSON.parse(await fsp.readFile(settingsPath, "utf8"));
      } catch {
        // use default
      }
      const desktopDir = await safeFs.listDir("Desktop");
      const telemetry = getSystemTelemetry(cloudHomeDir);
      res.json({
        cloudHome: cloudHomeDir,
        settings,
        desktopItems: desktopDir.items,
        telemetry,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/desktop/settings", async (req, res) => {
    await readyPromise;
    try {
      const settingsPath = path.join(cloudHomeDir, ".desktop-settings.json");
      let existing = {};
      try {
        existing = JSON.parse(await fsp.readFile(settingsPath, "utf8"));
      } catch {
        // ignore
      }
      const merged = { ...existing, ...(req.body || {}) };
      await fsp.writeFile(settingsPath, JSON.stringify(merged, null, 2), "utf8");
      res.json({ ok: true, settings: merged });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/fs/list", async (req, res) => {
    await readyPromise;
    try {
      const rel = String(req.query.path || "");
      const listing = await safeFs.listDir(rel);
      res.json(listing);
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  app.get("/api/fs/read", async (req, res) => {
    await readyPromise;
    try {
      const { abs, rel } = safeFs.resolveRel(String(req.query.path || ""));
      const st = await fsp.stat(abs);
      if (st.isDirectory()) {
        res.status(400).json({ error: "Cannot read directory as text file" });
        return;
      }
      if (st.size > 2 * 1024 * 1024) {
        res.status(413).json({ error: "File exceeds 2 MB editor preview limit; download to view." });
        return;
      }
      const content = await fsp.readFile(abs, "utf8");
      res.json({ path: rel, name: path.basename(abs), size: st.size, content });
    } catch (err) {
      res.status(err.status || 404).json({ error: err.message });
    }
  });

  app.post("/api/fs/write", async (req, res) => {
    await readyPromise;
    try {
      const { path: relPath, content = "" } = req.body || {};
      if (!relPath) {
        res.status(400).json({ error: "path is required" });
        return;
      }
      const { abs, rel } = safeFs.resolveRel(relPath);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, String(content), "utf8");
      const st = await fsp.stat(abs);
      res.json({ ok: true, path: rel, size: st.size, mtime: st.mtime.toISOString() });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  app.post("/api/fs/upload", async (req, res) => {
    await readyPromise;
    try {
      const { dir = "", filename, base64Data } = req.body || {};
      if (!filename || typeof base64Data !== "string") {
        res.status(400).json({ error: "filename and base64Data are required" });
        return;
      }
      const safeName = path.basename(filename);
      const targetRel = dir ? `${dir}/${safeName}` : safeName;
      const { abs, rel } = safeFs.resolveRel(targetRel);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      const buf = Buffer.from(base64Data, "base64");
      await fsp.writeFile(abs, buf);
      res.json({ ok: true, path: rel, size: buf.length });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  app.post("/api/fs/mkdir", async (req, res) => {
    await readyPromise;
    try {
      const { path: relPath } = req.body || {};
      if (!relPath) {
        res.status(400).json({ error: "path is required" });
        return;
      }
      const { abs, rel } = safeFs.resolveRel(relPath);
      await fsp.mkdir(abs, { recursive: true });
      res.json({ ok: true, path: rel });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  app.post("/api/fs/rename", async (req, res) => {
    await readyPromise;
    try {
      const { fromPath, toPath } = req.body || {};
      if (!fromPath || !toPath) {
        res.status(400).json({ error: "fromPath and toPath are required" });
        return;
      }
      const src = safeFs.resolveRel(fromPath);
      const dst = safeFs.resolveRel(toPath);
      if (!src.rel || !dst.rel) {
        res.status(400).json({ error: "Cannot rename cloud workspace root" });
        return;
      }
      await fsp.mkdir(path.dirname(dst.abs), { recursive: true });
      await fsp.rename(src.abs, dst.abs);
      res.json({ ok: true, path: dst.rel });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  app.post("/api/fs/delete", async (req, res) => {
    await readyPromise;
    try {
      const { path: relPath } = req.body || {};
      const target = safeFs.resolveRel(relPath);
      if (!target.rel) {
        res.status(400).json({ error: "Cannot delete cloud workspace root" });
        return;
      }
      await fsp.rm(target.abs, { recursive: true, force: true });
      res.json({ ok: true });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  app.post("/api/exec/file", async (req, res) => {
    await readyPromise;
    try {
      const { path: relPath } = req.body || {};
      if (!relPath) {
        res.status(400).json({ error: "path is required" });
        return;
      }
      const { abs } = safeFs.resolveRel(relPath);
      const result = await runFileProcess(abs, path.dirname(abs), 20000);
      res.json(result);
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  app.get("/api/sys/telemetry", async (_req, res) => {
    await readyPromise;
    const [processes] = await Promise.all([listProcesses()]);
    res.json({
      telemetry: getSystemTelemetry(cloudHomeDir),
      processes,
    });
  });

  app.post("/api/sys/kill", (req, res) => {
    const pid = Number(req.body?.pid);
    if (!Number.isInteger(pid) || pid <= 2 || pid === process.pid || pid === process.ppid) {
      res.status(400).json({ error: "Refusing to terminate protected system process." });
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
      res.json({ ok: true, pid });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /* =========================================================
     PHAZE REMOTE BRIDGE ENDPOINTS (Built-in Desktop App)
     ========================================================= */
  async function buildFleetPayload(forceProbe = false) {
    const { client, activeMode } = await getActiveClient(forceProbe);
    const [hosts, statusPayload, tools] = await Promise.all([
      client.listHosts().catch((err) => {
        if (state.configuredMode === "live") throw err;
        return [];
      }),
      client.status().catch(() => ({ connected: false, connections: [] })),
      client.listTools().catch(() => []),
    ]);

    let enterpriseSummary = null;
    let enterpriseError = null;
    if (enterpriseApi.isConfigured) {
      try {
        enterpriseSummary = await enterpriseApi.fetchFleetSummary();
      } catch (err) {
        enterpriseError = err?.message || "Failed to query Phaze Enterprise API";
      }
    } else if (activeMode === "simulator") {
      enterpriseSummary = {
        orgs: [{ id: "org_sim_01", name: "CatalystX Studio (Demo)" }],
        machinesById: simMcp.getEnterpriseMetadataMap(),
        recentConnections: [],
      };
    }

    const activeByMachine = new Map();
    for (const conn of statusPayload?.connections || []) {
      if (conn.host_machine_id) {
        activeByMachine.set(conn.host_machine_id, conn);
      }
    }

    const mergedHosts = hosts.map((h) => {
      const meta = enterpriseSummary?.machinesById?.get(h.machine_id) || {};
      const activeConn = activeByMachine.get(h.machine_id) || null;
      return {
        ...h,
        os: meta.os || "Windows 11",
        gpu: meta.gpu || null,
        assignee:
          typeof meta.assignee === "object" && meta.assignee
            ? meta.assignee.email || meta.assignee.name
            : meta.assignee || null,
        group:
          typeof meta.group === "object" && meta.group
            ? meta.group.name
            : meta.group || null,
        location:
          typeof meta.location === "object" && meta.location
            ? meta.location.name
            : meta.location || null,
        org_name: meta.org_name || null,
        deep_link: `phaze://connect?id=${encodeURIComponent(h.machine_id)}`,
        active_connection: activeConn,
      };
    });

    return {
      activeMode,
      configuredMode: state.configuredMode,
      mcpUrl: state.mcpUrl,
      mcpAuthConfigured: Boolean(state.mcpAuthToken),
      liveReachable: state.liveReachable,
      liveError: state.lastLiveError,
      enterpriseApiConfigured: enterpriseApi.isConfigured,
      enterpriseError,
      orgs: enterpriseSummary?.orgs || [],
      hosts: mergedHosts,
      status: statusPayload,
      tools,
    };
  }

  app.get("/api/bootstrap", async (req, res) => {
    try {
      const force = req.query.probe === "1";
      const payload = await buildFleetPayload(force);
      res.json(payload);
    } catch (err) {
      res.status(502).json({
        error: err?.message || "Failed to load Phaze bridge state",
        code: err?.code || "BRIDGE_ERROR",
        configuredMode: state.configuredMode,
        mcpUrl: state.mcpUrl,
      });
    }
  });

  app.post("/api/config", async (req, res) => {
    try {
      const { mcpUrl, mcpAuthToken, mode, phazeApiKey, clearApiKey } = req.body || {};
      if (typeof mode === "string" && ["auto", "live", "simulator"].includes(mode.toLowerCase())) {
        state.configuredMode = mode.toLowerCase();
      }
      if (typeof mcpUrl === "string" && mcpUrl.trim()) {
        state.mcpUrl = mcpUrl.trim();
      }
      if (typeof mcpAuthToken === "string") {
        state.mcpAuthToken = mcpAuthToken.trim();
      }
      liveMcp.setUrl(
        state.mcpUrl,
        state.mcpAuthToken ? { Authorization: `Bearer ${state.mcpAuthToken}` } : {}
      );

      if (clearApiKey) {
        enterpriseApi.setApiKey("");
      } else if (typeof phazeApiKey === "string" && phazeApiKey.trim()) {
        enterpriseApi.setApiKey(phazeApiKey.trim());
      }

      const payload = await buildFleetPayload(true);
      res.json(payload);
    } catch (err) {
      res.status(400).json({
        error: err?.message || "Failed to apply configuration",
        code: err?.code || "CONFIG_ERROR",
      });
    }
  });

  app.post("/api/connect", async (req, res) => {
    try {
      const { machineId, peerId, relay = false, takeControl = true } = req.body || {};
      if (!machineId || !peerId) {
        res.status(400).json({ error: "machineId and peerId are required" });
        return;
      }

      const { client, activeMode } = await getActiveClient();
      const beforeStatus = await client.status();
      const existing = findAgentConnectionForMachine(beforeStatus, machineId);
      let connectionId = existing?.connection_id || null;

      if (!connectionId) {
        const opened = await client.connect({ peerId, machineId, relay: Boolean(relay) });
        connectionId = opened.connection_id;
      }

      let conn = null;
      let latestStatus = beforeStatus;
      for (let i = 0; i < 20; i++) {
        latestStatus = await client.status();
        conn = findConnection(latestStatus, connectionId);
        if (conn?.connected) break;
        await new Promise((r) => setTimeout(r, 450));
      }

      if (!conn) {
        throw new PhazeMCPError(
          "Connection opened, but did not appear in phaze_status.",
          "CONNECT_TIMEOUT"
        );
      }

      const selfGuest = getSelfGuest(conn);
      const currentController = (conn.guests || []).find((g) => g.has_control);
      if (takeControl && selfGuest && (!currentController || currentController.is_self)) {
        await client.setControl(connectionId, selfGuest.guest_id).catch(() => {});
        latestStatus = await client.status();
        conn = findConnection(latestStatus, connectionId) || conn;
      }

      const primaryOut = getPrimaryOutput(conn);
      res.json({
        activeMode,
        connectionId,
        connection: conn,
        defaultOutput: primaryOut?.id ?? null,
        status: latestStatus,
      });
    } catch (err) {
      res.status(502).json({
        error: err?.message || "Failed to connect to Phaze host",
        code: err?.code || "CONNECT_ERROR",
      });
    }
  });

  app.post("/api/disconnect", async (req, res) => {
    try {
      const { connectionId, force = false } = req.body || {};
      if (!connectionId) {
        res.status(400).json({ error: "connectionId is required" });
        return;
      }
      const { client } = await getActiveClient();
      const st = await client.status();
      const conn = findConnection(st, connectionId);
      if (conn && conn.owner && conn.owner !== "agent" && !force) {
        res.status(409).json({
          error: "Human-owned Phaze session. Pass force=true to close it anyway.",
          code: "HUMAN_OWNED_SESSION",
        });
        return;
      }
      await client.disconnect(connectionId);
      const updated = await client.status();
      res.json({ ok: true, status: updated });
    } catch (err) {
      res.status(502).json({
        error: err?.message || "Disconnect failed",
        code: err?.code || "MCP_ERROR",
      });
    }
  });

  app.post("/api/control", async (req, res) => {
    try {
      const { connectionId, guestId } = req.body || {};
      if (!connectionId || guestId === undefined) {
        res.status(400).json({ error: "connectionId and guestId are required" });
        return;
      }
      const { client } = await getActiveClient();
      await client.setControl(connectionId, Number(guestId));
      const updated = await client.status();
      res.json({
        ok: true,
        connection: findConnection(updated, connectionId),
        status: updated,
      });
    } catch (err) {
      res.status(502).json({
        error: err?.message || "Failed to update session control",
        code: err?.code || "MCP_ERROR",
      });
    }
  });

  app.post("/api/command", async (req, res) => {
    try {
      const { connectionId, command, cwd } = req.body || {};
      if (!connectionId || !command) {
        res.status(400).json({ error: "connectionId and command are required" });
        return;
      }
      const { client } = await getActiveClient();
      const result = await client.runCommand(connectionId, command, { cwd });
      res.json(result);
    } catch (err) {
      res.status(502).json({
        error: err?.message || "Remote command failed",
        code: err?.code || "COMMAND_ERROR",
      });
    }
  });

  app.post("/api/sim/unlock", (req, res) => {
    const { connectionId } = req.body || {};
    if (connectionId) {
      simMcp.setSimulatedSecureDesktop(connectionId, false);
    }
    res.json({ ok: true });
  });

  app.get("/api/logs", async (_req, res) => {
    const { client, activeMode } = await getActiveClient();
    res.json({
      activeMode,
      logs: client.getLogs(),
    });
  });

  /* =========================================================
     HTTP SERVER + MULTIPLEXED WEBSOCKETS (/ws/pty & /ws)
     ========================================================= */
  const server = http.createServer(app);
  const phazeWss = new WebSocketServer({ noServer: true });
  const ptyWss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const parsed = new URL(req.url || "/", "http://localhost");
    const token = parsed.searchParams.get("token") || "";
    if (state.passcode && token !== state.passcode) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    if (parsed.pathname === "/ws/pty") {
      ptyWss.handleUpgrade(req, socket, head, (ws) => {
        ptyWss.emit("connection", ws, req, parsed);
      });
    } else if (parsed.pathname === "/ws") {
      phazeWss.handleUpgrade(req, socket, head, (ws) => {
        phazeWss.emit("connection", ws, req, parsed);
      });
    } else {
      socket.destroy();
    }
  });

  server.on("close", () => {
    ptyManager.destroyAll();
  });

  // 1. REAL LINUX PTY WEBSOCKET (/ws/pty)
  ptyWss.on("connection", async (ws, _req, parsedUrl) => {
    await readyPromise;
    const requestedRelCwd = parsedUrl.searchParams.get("cwd") || "";
    let startCwd = cloudHomeDir;
    try {
      const resolved = safeFs.resolveRel(requestedRelCwd);
      if (fs.existsSync(resolved.abs) && fs.statSync(resolved.abs).isDirectory()) {
        startCwd = resolved.abs;
      }
    } catch {
      // fallback to cloudHomeDir
    }

    const cols = Number(parsedUrl.searchParams.get("cols") || 100);
    const rows = Number(parsedUrl.searchParams.get("rows") || 28);

    const ptySession = ptyManager.createSession({
      cwd: startCwd,
      cols,
      rows,
      onData(text) {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "output", data: text }));
        }
      },
      onExit(code) {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "exit", code }));
          ws.close();
        }
      },
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === "input" && typeof msg.data === "string") {
          ptySession.write(msg.data);
        } else if (msg.type === "resize") {
          ptySession.resize(msg.cols, msg.rows);
        } else if (msg.type === "ping") {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "pong", ts: msg.ts }));
          }
        }
      } catch {
        // ignore invalid message
      }
    });

    ws.on("close", () => {
      ptyManager.destroy(ptySession.id);
    });
  });

  // 2. PHAZE BRIDGE STREAMING WEBSOCKET (/ws)
  phazeWss.on("connection", (ws) => {
    let sub = {
      connectionId: null,
      output: null,
      intervalMs: 450,
      paused: false,
    };
    let loopTimer = null;
    let capturing = false;
    let closed = false;
    let statusTick = 0;

    function clearLoop() {
      if (loopTimer) {
        clearTimeout(loopTimer);
        loopTimer = null;
      }
    }

    function sendJson(obj) {
      if (!closed && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(obj));
      }
    }

    async function captureOnce(immediateAfterInput = false) {
      if (closed || !sub.connectionId || capturing) return;
      capturing = true;
      const t0 = Date.now();
      try {
        const { client, activeMode } = await getActiveClient();
        const shot = await client.screenshot(sub.connectionId, sub.output);
        const rttMs = Date.now() - t0;
        sendJson({
          type: "frame",
          activeMode,
          connectionId: sub.connectionId,
          output: sub.output,
          mimeType: shot.mimeType,
          data: shot.data,
          rttMs,
          ts: Date.now(),
        });

        statusTick = (statusTick + 1) % 6;
        if (statusTick === 0 || immediateAfterInput) {
          const st = await client.status().catch(() => null);
          if (st) {
            const conn = findConnection(st, sub.connectionId);
            sendJson({ type: "session_status", connection: conn, status: st });
          }
        }
      } catch (err) {
        const code = err?.code || "MCP_ERROR";
        sendJson({
          type: "capture_state",
          connectionId: sub.connectionId,
          state:
            code === "NOT_READY"
              ? "not_ready"
              : code === "NOT_CAPTURING"
                ? "not_capturing"
                : "error",
          code,
          message: err?.message || "Screenshot capture failed",
        });
      } finally {
        capturing = false;
        if (!closed && sub.connectionId && !sub.paused && sub.intervalMs > 0) {
          clearLoop();
          loopTimer = setTimeout(() => captureOnce(false), sub.intervalMs);
        }
      }
    }

    function scheduleQuickFrame(delayMs = 80) {
      if (closed || !sub.connectionId) return;
      clearLoop();
      loopTimer = setTimeout(() => captureOnce(true), delayMs);
    }

    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === "subscribe") {
        sub.connectionId = msg.connectionId || null;
        sub.output = msg.output ?? null;
        sub.intervalMs = typeof msg.intervalMs === "number" ? msg.intervalMs : 450;
        sub.paused = Boolean(msg.paused);
        clearLoop();
        if (sub.connectionId) {
          await captureOnce(true);
        }
        return;
      }

      if (msg.type === "unsubscribe") {
        sub.connectionId = null;
        clearLoop();
        return;
      }

      if (msg.type === "set_stream_options") {
        if (msg.output !== undefined) sub.output = msg.output;
        if (typeof msg.intervalMs === "number") sub.intervalMs = msg.intervalMs;
        if (typeof msg.paused === "boolean") sub.paused = msg.paused;
        scheduleQuickFrame(20);
        return;
      }

      if (msg.type === "refresh_now") {
        await captureOnce(true);
        return;
      }

      if (!sub.connectionId) return;

      try {
        const { client } = await getActiveClient();
        if (msg.type === "click") {
          await client.click(sub.connectionId, msg.button || "left", msg.coordinate, {
            output: sub.output,
            modifier: msg.modifier || null,
          });
          sendJson({ type: "input_ack", action: "click", coordinate: msg.coordinate });
          scheduleQuickFrame(65);
        } else if (msg.type === "drag") {
          await client.drag(sub.connectionId, msg.startCoordinate, msg.coordinate, {
            output: sub.output,
          });
          sendJson({ type: "input_ack", action: "drag", coordinate: msg.coordinate });
          scheduleQuickFrame(65);
        } else if (msg.type === "scroll") {
          await client.scroll(
            sub.connectionId,
            msg.coordinate,
            msg.direction || "down",
            msg.amount || 3,
            { output: sub.output }
          );
          scheduleQuickFrame(80);
        } else if (msg.type === "keys") {
          await client.sendKeys(sub.connectionId, msg.text, msg.modifiers || [], {
            sensitive: Boolean(msg.sensitive),
          });
          sendJson({ type: "input_ack", action: "keys" });
          scheduleQuickFrame(65);
        }
      } catch (err) {
        sendJson({
          type: "input_error",
          code: err?.code || "INPUT_ERROR",
          message: err?.message || "Failed to send input to Phaze host",
        });
      }
    });

    ws.on("close", () => {
      closed = true;
      clearLoop();
    });
  });

  return { app, server, state, liveMcp, simMcp, ptyManager, cloudHomeDir };
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || "0.0.0.0";
  const { server, cloudHomeDir } = createBridgeApp();
  server.listen(port, host, () => {
    console.log(
      `[CatalystX Cloud Desktop OS] Listening on http://${host}:${port} (workspace=${cloudHomeDir})`
    );
  });
}
