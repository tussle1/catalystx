import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELPER_PATH = path.join(__dirname, "ptyHelper.py");

export class PtySessionManager {
  constructor(defaultCwd) {
    this.defaultCwd = defaultCwd;
    this.sessions = new Map();
    this.nextId = 1;
  }

  createSession({ cwd = this.defaultCwd, cols = 100, rows = 28, onData, onExit } = {}) {
    const termId = `term-${this.nextId++}`;
    const proc = spawn("python3", ["-u", HELPER_PATH, cwd, String(cols), String(rows)], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutBuf = "";
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      stdoutBuf += chunk;
      let idx;
      while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === "output" && msg.data && onData) {
            onData(Buffer.from(msg.data, "base64").toString("utf8"));
          } else if (msg.type === "exit" && onExit) {
            onExit(msg.code ?? 0);
          }
        } catch {
          // ignore malformed line
        }
      }
    });

    proc.on("close", (code) => {
      if (this.sessions.has(termId)) {
        this.sessions.delete(termId);
        if (onExit) onExit(code ?? 0);
      }
    });

    const session = {
      id: termId,
      proc,
      write(str) {
        if (proc.stdin.writable) {
          const b64 = Buffer.from(String(str), "utf8").toString("base64");
          proc.stdin.write(JSON.stringify({ type: "input", data: b64 }) + "\n");
        }
      },
      resize(newCols, newRows) {
        if (proc.stdin.writable) {
          proc.stdin.write(
            JSON.stringify({
              type: "resize",
              cols: Math.max(10, Math.round(newCols || 80)),
              rows: Math.max(2, Math.round(newRows || 24)),
            }) + "\n"
          );
        }
      },
      kill() {
        this.closed = true;
        try {
          proc.kill("SIGTERM");
        } catch {
          // ignore
        }
      },
    };

    this.sessions.set(termId, session);
    return session;
  }

  get(termId) {
    return this.sessions.get(termId) || null;
  }

  destroy(termId) {
    const s = this.sessions.get(termId);
    if (s) {
      this.sessions.delete(termId);
      s.kill();
    }
  }

  destroyAll() {
    for (const [id, s] of this.sessions.entries()) {
      this.sessions.delete(id);
      s.kill();
    }
  }
}
