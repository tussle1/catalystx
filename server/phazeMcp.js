/**
 * Spec-compliant client for the Phaze local MCP HTTP server (default http://127.0.0.1:41010/mcp).
 * Speaks JSON-RPC 2.0 over HTTP POST and handles both application/json and SSE (text/event-stream) payloads.
 */

export class PhazeMCPError extends Error {
  constructor(message, code = "MCP_ERROR", details = null) {
    super(message);
    this.name = "PhazeMCPError";
    this.code = code;
    this.details = details;
  }
}

const TRANSIENT_PATTERNS = ["timed out", "etimedout", "econnreset", "socket hang up"];

function classifyError(message = "") {
  const lower = String(message).toLowerCase();
  if (lower.includes("not ready")) return "NOT_READY";
  if (lower.includes("not capturing")) return "NOT_CAPTURING";
  if (TRANSIENT_PATTERNS.some((p) => lower.includes(p))) return "TIMED_OUT";
  if (
    lower.includes("econnrefused") ||
    lower.includes("fetch failed") ||
    lower.includes("enotfound")
  ) {
    return "UNREACHABLE";
  }
  return "MCP_ERROR";
}

function parseMcpHttpBody(rawText, contentType = "") {
  if (!rawText || !rawText.trim()) return {};
  if (contentType.includes("text/event-stream") || rawText.trimStart().startsWith("event:") || rawText.trimStart().startsWith("data:")) {
    const lines = rawText.split(/\r?\n/);
    let lastJson = null;
    for (const line of lines) {
      if (line.startsWith("data:")) {
        const dataStr = line.slice(5).trim();
        if (!dataStr) continue;
        try {
          lastJson = JSON.parse(dataStr);
        } catch {
          // ignore partial SSE comment/chunk
        }
      }
    }
    if (lastJson) return lastJson;
  }
  return JSON.parse(rawText);
}

export class PhazeMCPClient {
  constructor(url = "http://127.0.0.1:41010/mcp", options = {}) {
    this.url = url;
    this.timeoutMs = options.timeoutMs ?? 20000;
    this.nextId = 1;
    this.sessionId = null;
    this.cachedTools = null;
    this.rpcLog = [];
    this.customHeaders = options.headers ?? {};
  }

  setUrl(url, customHeaders = {}) {
    this.url = url.trim();
    this.customHeaders = customHeaders;
    this.sessionId = null;
    this.cachedTools = null;
  }

  recordLog(entry) {
    this.rpcLog.unshift({
      ts: new Date().toISOString(),
      ...entry,
    });
    if (this.rpcLog.length > 80) {
      this.rpcLog.length = 80;
    }
  }

  getLogs() {
    return this.rpcLog;
  }

  async rpc(method, params = {}, { timeoutMs = this.timeoutMs, redactArgs = false } = {}) {
    const id = this.nextId++;
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...this.customHeaders,
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params,
        }),
        signal: controller.signal,
      });

      const returnedSession = response.headers.get("mcp-session-id");
      if (returnedSession) {
        this.sessionId = returnedSession;
      }

      const rawText = await response.text();
      if (!response.ok) {
        throw new PhazeMCPError(
          `HTTP ${response.status} from Phaze MCP: ${rawText.slice(0, 240)}`,
          response.status === 502 || response.status === 504 ? "UNREACHABLE" : "HTTP_ERROR"
        );
      }

      const msg = parseMcpHttpBody(rawText, response.headers.get("content-type") || "");
      if (msg.error) {
        const errText =
          typeof msg.error === "string"
            ? msg.error
            : msg.error.message || JSON.stringify(msg.error);
        throw new PhazeMCPError(errText, classifyError(errText), msg.error);
      }

      const durationMs = Date.now() - started;
      this.recordLog({
        id,
        method,
        tool: params?.name || null,
        args: redactArgs ? { redacted: true } : params?.arguments || null,
        ok: !msg.result?.isError,
        durationMs,
      });

      return msg.result ?? {};
    } catch (err) {
      const durationMs = Date.now() - started;
      const rawMsg = err?.name === "AbortError" ? "Phaze MCP request timed out" : err?.message || String(err);
      const code = err instanceof PhazeMCPError ? err.code : classifyError(rawMsg);
      this.recordLog({
        id,
        method,
        tool: params?.name || null,
        args: redactArgs ? { redacted: true } : params?.arguments || null,
        ok: false,
        error: rawMsg,
        code,
        durationMs,
      });
      if (err instanceof PhazeMCPError) throw err;
      throw new PhazeMCPError(rawMsg, code);
    } finally {
      clearTimeout(timer);
    }
  }

  async callToolRaw(name, args = {}, { retries = 2, timeoutMs = this.timeoutMs, redactArgs = false } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await this.rpc(
          "tools/call",
          { name, arguments: args },
          { timeoutMs, redactArgs }
        );
        if (result?.isError) {
          const text = (result.content || [])
            .filter((c) => c.type === "text")
            .map((c) => c.text || "")
            .join("");
          const errMessage = text || `${name} returned an MCP tool error`;
          throw new PhazeMCPError(errMessage, classifyError(errMessage));
        }
        return result;
      } catch (err) {
        const isTransient = err?.code === "TIMED_OUT";
        if (!isTransient || attempt === retries) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
    }
    throw new PhazeMCPError(`Exhausted retries calling ${name}`, "TIMED_OUT");
  }

  async callTool(name, args = {}, options = {}) {
    const result = await this.callToolRaw(name, args, options);
    const text = (result.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("");
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }

  async listTools({ force = false } = {}) {
    if (this.cachedTools && !force) return this.cachedTools;
    try {
      const res = await this.rpc("tools/list", {}, { timeoutMs: 6000 });
      if (Array.isArray(res?.tools)) {
        this.cachedTools = res.tools;
        return this.cachedTools;
      }
    } catch {
      // Fallback to known baseline Phaze MCP tool definitions if tools/list isn't exposed
    }
    return [];
  }

  async ping() {
    const status = await this.callTool("phaze_status", {}, { retries: 0, timeoutMs: 3500 });
    return status;
  }

  async status() {
    return await this.callTool("phaze_status", {}, { retries: 1, timeoutMs: 8000 });
  }

  async listHosts() {
    const res = await this.callTool("phaze_list_hosts", {}, { retries: 2, timeoutMs: 10000 });
    return Array.isArray(res?.hosts) ? res.hosts : [];
  }

  async connect({ peerId, machineId, relay = false }) {
    const args = {
      host_peer_id: peerId,
      machine_id: machineId,
    };
    // Phaze MCP spec: pass relay=true ONLY if requires_relay is truthy
    if (relay) {
      args.relay = true;
    }
    return await this.callTool("phaze_connect", args, { retries: 2, timeoutMs: 15000 });
  }

  async disconnect(connectionId) {
    return await this.callTool("phaze_disconnect", { connection_id: connectionId }, { retries: 1 });
  }

  async setControl(connectionId, guestId) {
    return await this.callTool(
      "phaze_set_control",
      { connection_id: connectionId, guest_id: Number(guestId) },
      { retries: 1 }
    );
  }

  async screenshot(connectionId, output = null) {
    const args = { connection_id: connectionId };
    if (output !== null && output !== undefined && output !== "") {
      args.output = Number(output);
    }
    const result = await this.callToolRaw("phaze_screenshot", args, {
      retries: 1,
      timeoutMs: 12000,
    });
    for (const block of result.content || []) {
      if (block.type === "image" && block.data) {
        return {
          mimeType: block.mimeType || "image/png",
          data: block.data,
        };
      }
    }
    throw new PhazeMCPError("phaze_screenshot returned no image block", "MCP_ERROR");
  }

  async click(connectionId, buttonAction, coordinate, { output = null, modifier = null } = {}) {
    const toolMap = {
      left: "phaze_left_click",
      right: "phaze_right_click",
      middle: "phaze_middle_click",
      double: "phaze_double_click",
      triple: "phaze_triple_click",
    };
    const toolName = toolMap[buttonAction] || "phaze_left_click";
    const args = {
      connection_id: connectionId,
      coordinate: [Math.round(coordinate[0]), Math.round(coordinate[1])],
    };
    if (output !== null && output !== undefined) {
      args.output = Number(output);
    }
    if (toolName === "phaze_left_click" && modifier) {
      args.text = modifier;
    }
    return await this.callTool(toolName, args, { retries: 1 });
  }

  async drag(connectionId, startCoordinate, endCoordinate, { output = null } = {}) {
    const args = {
      connection_id: connectionId,
      start_coordinate: [Math.round(startCoordinate[0]), Math.round(startCoordinate[1])],
      coordinate: [Math.round(endCoordinate[0]), Math.round(endCoordinate[1])],
    };
    if (output !== null && output !== undefined) {
      args.output = Number(output);
    }
    return await this.callTool("phaze_left_click_drag", args, { retries: 1 });
  }

  async mouseMove(connectionId, coordinate, { output = null } = {}) {
    const args = {
      connection_id: connectionId,
      coordinate: [Math.round(coordinate[0]), Math.round(coordinate[1])],
    };
    if (output !== null && output !== undefined) {
      args.output = Number(output);
    }
    return await this.callTool("phaze_mouse_move", args, { retries: 0 });
  }

  async scroll(connectionId, coordinate, direction = "down", amount = 3, { output = null } = {}) {
    const args = {
      connection_id: connectionId,
      coordinate: [Math.round(coordinate[0]), Math.round(coordinate[1])],
      scroll_direction: direction,
      scroll_amount: Math.max(1, Math.min(20, Math.round(amount))),
    };
    if (output !== null && output !== undefined) {
      args.output = Number(output);
    }
    return await this.callTool("phaze_scroll", args, { retries: 0 });
  }

  async sendKeys(connectionId, text, modifiers = [], { sensitive = false } = {}) {
    const args = {
      connection_id: connectionId,
      text: String(text ?? ""),
    };
    if (Array.isArray(modifiers) && modifiers.length > 0) {
      args.modifiers = modifiers;
    }
    return await this.callTool("phaze_send_keys", args, {
      retries: 1,
      redactArgs: sensitive,
    });
  }

  /**
   * Executes a command directly on the host using Phaze v0.9.0+ MCP command execution tool.
   * Dynamically inspects tools/list so any command tool name/schema in Phaze 0.9+ works out of the box.
   */
  async runCommand(connectionId, command, { cwd = null, timeoutSec = 30 } = {}) {
    const tools = await this.listTools();
    const cmdTool = tools.find((t) =>
      /command|exec|shell|powershell/i.test(t.name || "")
    );

    const candidateTools = cmdTool
      ? [cmdTool]
      : [
          { name: "phaze_run_command", inputSchema: { properties: { connection_id: {}, command: {} } } },
          { name: "phaze_command", inputSchema: { properties: { connection_id: {}, command: {} } } },
          { name: "phaze_exec", inputSchema: { properties: { connection_id: {}, command: {} } } },
        ];

    let lastErr = null;
    for (const candidate of candidateTools) {
      const props = candidate.inputSchema?.properties || {};
      const args = { connection_id: connectionId };
      if ("command" in props || Object.keys(props).length === 0) args.command = command;
      else if ("cmd" in props) args.cmd = command;
      else if ("script" in props) args.script = command;
      else args.command = command;

      if (cwd && "cwd" in props) args.cwd = cwd;
      if (timeoutSec && "timeout" in props) args.timeout = timeoutSec;

      try {
        const out = await this.callTool(candidate.name, args, { retries: 0, timeoutMs: (timeoutSec + 5) * 1000 });
        return {
          toolUsed: candidate.name,
          output:
            typeof out === "string"
              ? out
              : out.stdout !== undefined || out.stderr !== undefined
                ? [out.stdout, out.stderr].filter(Boolean).join("\n")
                : out.output || out.text || JSON.stringify(out, null, 2),
          exitCode: out.exit_code ?? out.exitCode ?? 0,
          raw: out,
        };
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || "").toLowerCase();
        if (!msg.includes("unknown tool") && !msg.includes("not found") && !msg.includes("method")) {
          throw err;
        }
      }
    }

    throw new PhazeMCPError(
      lastErr?.message ||
        "Remote command tool not advertised by this Phaze app version (requires Phaze v0.9.0+). Update Phaze or use 'Open PowerShell on Screen'.",
      "UNSUPPORTED_TOOL"
    );
  }
}

export function findConnection(statusPayload, connectionId) {
  return (statusPayload?.connections || []).find((c) => c.connection_id === connectionId) || null;
}

export function findAgentConnectionForMachine(statusPayload, machineId) {
  return (
    (statusPayload?.connections || []).find(
      (c) => c.owner === "agent" && c.host_machine_id === machineId
    ) || null
  );
}

export function getSelfGuest(conn) {
  return (conn?.guests || []).find((g) => g.is_self) || null;
}

export function getPrimaryOutput(conn) {
  const outputs = conn?.outputs || [];
  if (outputs.length === 0) return null;
  return outputs.find((o) => o.primary) || outputs[0];
}
