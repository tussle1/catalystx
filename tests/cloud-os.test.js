import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { createBridgeApp } from "../server/index.js";

function listenRandom(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("Real Cloud Desktop OS: Linux PTY shell, Filesystem, Python/Node Runner, Telemetry & Localhost Proxy", async (t) => {
  const tmpCloudHome = await fs.mkdtemp(path.join(os.tmpdir(), "catalystx-cloud-home-"));
  const { server } = createBridgeApp({
    cloudHomeDir: tmpCloudHome,
    mode: "simulator",
  });
  const port = await listenRandom(server);
  const base = `http://127.0.0.1:${port}`;

  t.after(async () => {
    server.close();
    await fs.rm(tmpCloudHome, { recursive: true, force: true }).catch(() => {});
  });

  // 1. Desktop bootstrap seeds real ~/Desktop files & telemetry
  const bootRes = await fetch(`${base}/api/desktop/bootstrap`);
  assert.equal(bootRes.status, 200);
  const boot = await bootRes.json();
  assert.ok(boot.desktopItems.some((i) => i.name === "hello_cloud.py"));
  assert.ok(boot.telemetry.cpuCores >= 1);

  // 2. Real Python 3 execution on Linux CPU via /api/exec/file
  const execRes = await fetch(`${base}/api/exec/file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "Desktop/hello_cloud.py" }),
  });
  assert.equal(execRes.status, 200);
  const execOut = await execRes.json();
  assert.equal(execOut.exitCode, 0);
  assert.ok(execOut.stdout.includes("CatalystX Real Cloud Python Runner"));

  // 3. Real Filesystem write/read & path traversal protection
  const traversalRes = await fetch(`${base}/api/fs/read?path=${encodeURIComponent("../../etc/passwd")}`);
  assert.equal(traversalRes.status, 403);

  const writeRes = await fetch(`${base}/api/fs/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "Projects/calc.js", content: "console.log(21 * 2);\n" }),
  });
  assert.equal(writeRes.status, 200);

  const nodeRun = await (
    await fetch(`${base}/api/exec/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "Projects/calc.js" }),
    })
  ).json();
  assert.equal(nodeRun.stdout.trim(), "42");

  // 4. Real interactive Linux PTY WebSocket (/ws/pty)
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pty?cols=80&rows=24`);
  await new Promise((r) => ws.once("open", r));

  const outputPromise = new Promise((resolve, reject) => {
    let acc = "";
    const timer = setTimeout(() => reject(new Error(`PTY timeout, got: ${acc}`)), 5000);
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "output") {
        acc += msg.data;
        if (acc.includes("PTY_OK_99")) {
          clearTimeout(timer);
          resolve(acc);
        }
      }
    });
  });

  ws.send(JSON.stringify({ type: "input", data: "echo PTY_OK_$((90+9))\n" }));
  const ptyText = await outputPromise;
  assert.ok(ptyText.includes("PTY_OK_99"));
  ws.close();

  // 5. Built-in Localhost Port Reverse Proxy (/proxy-port/:port/*)
  const miniApp = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("hello-from-user-localhost-server");
  });
  const miniPort = await listenRandom(miniApp);
  t.after(() => miniApp.close());

  const proxied = await fetch(`${base}/proxy-port/${miniPort}/test`);
  assert.equal(proxied.status, 200);
  assert.equal(await proxied.text(), "hello-from-user-localhost-server");
});
