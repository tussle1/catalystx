import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import WebSocket from "ws";
import { createBridgeApp } from "../server/index.js";

// Minimal 1x1 valid PNG base64 for testing live Phaze MCP binary/base64 image forwarding
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function listenRandom(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });
}

test("Live Phaze MCP JSON-RPC 2.0 + SSE compatibility & WebSocket frame/input bridge", async (t) => {
  const receivedCalls = [];
  let captureMode = "normal"; // "normal" | "not_ready" | "not_capturing"
  let controllerGuestId = 777;

  // Spin up a spec-accurate mock Phaze Desktop MCP HTTP server (simulating 127.0.0.1:41010/mcp)
  const mockPhazeServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const rpc = JSON.parse(body);
      if (rpc.method === "tools/list") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            result: {
              tools: [
                {
                  name: "phaze_run_command",
                  inputSchema: { properties: { connection_id: {}, command: {} } },
                },
              ],
            },
          })
        );
        return;
      }

      const { name, arguments: args } = rpc.params;
      receivedCalls.push({ name, args });

      const replyText = (obj, isError = false) => {
        // Alternate SSE and JSON responses to verify both MCP HTTP transports work
        if (name === "phaze_list_hosts") {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.end(
            `event: message\ndata: ${JSON.stringify({
              jsonrpc: "2.0",
              id: rpc.id,
              result: {
                isError,
                content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }],
              },
            })}\n\n`
          );
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            result: {
              isError,
              content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }],
            },
          })
        );
      };

      if (name === "phaze_status") {
        replyText({
          connected: true,
          connections: [
            {
              connection_id: "connection-live-99",
              owner: "agent",
              connected: true,
              host_machine_id: "m_win_1",
              has_control: controllerGuestId === 777,
              guests: [
                {
                  guest_id: 777,
                  user: "u_me",
                  has_control: controllerGuestId === 777,
                  is_self: true,
                },
              ],
              outputs: [{ id: 1, primary: true, width: 1920, height: 1080 }],
            },
          ],
        });
      } else if (name === "phaze_list_hosts") {
        replyText({
          hosts: [
            {
              machine_id: "m_win_1",
              peer_id: "p_win_1",
              name: "REAL-WIN11-RIG",
              online: true,
              requires_relay: true,
            },
          ],
        });
      } else if (name === "phaze_connect") {
        replyText({ connection_id: "connection-live-99" });
      } else if (name === "phaze_set_control") {
        controllerGuestId = args.guest_id;
        replyText({ ok: true });
      } else if (name === "phaze_screenshot") {
        if (captureMode === "not_capturing") {
          replyText("connection is not capturing", true);
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            result: {
              content: [{ type: "image", mimeType: "image/png", data: TINY_PNG_B64 }],
            },
          })
        );
      } else if (name === "phaze_run_command") {
        replyText({ stdout: `ran:${args.command}`, exit_code: 0 });
      } else {
        replyText({ ok: true });
      }
    });
  });

  const mcpPort = await listenRandom(mockPhazeServer);
  const { server: bridgeServer } = createBridgeApp({
    mode: "live",
    mcpUrl: `http://127.0.0.1:${mcpPort}/mcp`,
    passcode: "chromebook-pin",
  });
  const bridgePort = await listenRandom(bridgeServer);
  const baseUrl = `http://127.0.0.1:${bridgePort}`;

  t.after(() => {
    bridgeServer.close();
    mockPhazeServer.close();
  });

  // 1. Verify passcode enforcement
  const unauthRes = await fetch(`${baseUrl}/api/bootstrap`);
  assert.equal(unauthRes.status, 401);

  // 2. Verify authenticated bootstrap against live Phaze MCP (including SSE parsing)
  const bootRes = await fetch(`${baseUrl}/api/bootstrap`, {
    headers: { "X-Bridge-Passcode": "chromebook-pin" },
  });
  assert.equal(bootRes.status, 200);
  const boot = await bootRes.json();
  assert.equal(boot.activeMode, "live");
  assert.equal(boot.hosts.length, 1);
  assert.equal(boot.hosts[0].name, "REAL-WIN11-RIG");

  // 3. Connect and execute direct host command
  const connRes = await fetch(`${baseUrl}/api/connect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Passcode": "chromebook-pin",
    },
    body: JSON.stringify({
      machineId: "m_win_1",
      peerId: "p_win_1",
      relay: true,
    }),
  });
  assert.equal(connRes.status, 200);
  const connData = await connRes.json();
  assert.equal(connData.connectionId, "connection-live-99");

  const cmdRes = await fetch(`${baseUrl}/api/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Passcode": "chromebook-pin",
    },
    body: JSON.stringify({
      connectionId: "connection-live-99",
      command: "whoami",
    }),
  });
  const cmdData = await cmdRes.json();
  assert.equal(cmdData.output, "ran:whoami");

  // 4. Verify WebSocket frame streaming + click/drag/keys forwarding + Secure Desktop state
  const ws = new WebSocket(`ws://127.0.0.1:${bridgePort}/ws?token=chromebook-pin`);
  await new Promise((resolve) => ws.once("open", resolve));

  const firstFramePromise = new Promise((resolve) => {
    ws.on("message", function handler(raw) {
      const msg = JSON.parse(String(raw));
      if (msg.type === "frame") {
        ws.off("message", handler);
        resolve(msg);
      }
    });
  });

  ws.send(
    JSON.stringify({
      type: "subscribe",
      connectionId: "connection-live-99",
      output: 1,
      intervalMs: 0,
      paused: true,
    })
  );

  const frame = await firstFramePromise;
  assert.equal(frame.mimeType, "image/png");
  assert.equal(frame.data, TINY_PNG_B64);

  // Dispatch click and keystrokes over WebSocket
  const ackPromise = new Promise((resolve) => {
    const acks = [];
    ws.on("message", function handler(raw) {
      const msg = JSON.parse(String(raw));
      if (msg.type === "input_ack") {
        acks.push(msg);
        if (acks.length === 2) {
          ws.off("message", handler);
          resolve(acks);
        }
      }
    });
  });

  ws.send(JSON.stringify({ type: "click", button: "left", coordinate: [640, 360] }));
  ws.send(JSON.stringify({ type: "keys", text: "[Enter]", modifiers: ["ControlLeft"] }));
  await ackPromise;

  assert.ok(
    receivedCalls.some(
      (c) => c.name === "phaze_left_click" && c.args.coordinate[0] === 640 && c.args.coordinate[1] === 360
    )
  );
  assert.ok(
    receivedCalls.some(
      (c) =>
        c.name === "phaze_send_keys" &&
        c.args.text === "[Enter]" &&
        c.args.modifiers.includes("ControlLeft")
    )
  );

  // Verify Windows Secure Desktop ('not capturing') detection
  captureMode = "not_capturing";
  const capStatePromise = new Promise((resolve) => {
    ws.on("message", function handler(raw) {
      const msg = JSON.parse(String(raw));
      if (msg.type === "capture_state") {
        ws.off("message", handler);
        resolve(msg);
      }
    });
  });
  ws.send(JSON.stringify({ type: "refresh_now" }));
  const capState = await capStatePromise;
  assert.equal(capState.state, "not_capturing");

  ws.close();
});

test("Interactive Simulator fallback works out-of-the-box when local Phaze is unreachable", async (t) => {
  const { server } = createBridgeApp({
    mode: "auto",
    mcpUrl: "http://127.0.0.1:41999/mcp", // unused local port
  });
  const port = await listenRandom(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  t.after(() => server.close());

  const boot = await (await fetch(`${baseUrl}/api/bootstrap`)).json();
  assert.equal(boot.activeMode, "simulator");
  assert.ok(boot.hosts.length >= 3);

  const conn = await (
    await fetch(`${baseUrl}/api/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        machineId: boot.hosts[0].machine_id,
        peerId: boot.hosts[0].peer_id,
      }),
    })
  ).json();
  assert.ok(conn.connectionId.startsWith("connection-sim-"));

  const cmd = await (
    await fetch(`${baseUrl}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectionId: conn.connectionId,
        command: "nvidia-smi",
      }),
    })
  ).json();
  assert.ok(cmd.output.includes("NVIDIA-SMI"));
});
