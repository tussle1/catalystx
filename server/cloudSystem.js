import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CODE_EXTS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".py", ".sh", ".bash", ".json", ".yaml", ".yml",
  ".css", ".html", ".htm", ".md", ".txt", ".toml",
  ".ini", ".env", ".sql", ".xml", ".svg", ".csv", ".c", ".cpp", ".rs", ".go"
]);

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp"]);

export function classifyFile(name, isDir) {
  if (isDir) return "directory";
  const ext = path.extname(name).toLowerCase();
  if (ext === ".html" || ext === ".htm") return "html";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (CODE_EXTS.has(ext)) return "text";
  return "binary";
}

export function mimeForExt(name) {
  const ext = path.extname(name).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".py": "text/plain; charset=utf-8",
    ".sh": "text/plain; charset=utf-8",
    ".pdf": "application/pdf",
  };
  return map[ext] || "application/octet-stream";
}

export async function ensureCloudHome(cloudHomeDir) {
  await fsp.mkdir(cloudHomeDir, { recursive: true });
  const subdirs = ["Desktop", "Documents", "Projects", "Projects/webapp-demo", "Downloads"];
  for (const sub of subdirs) {
    await fsp.mkdir(path.join(cloudHomeDir, sub), { recursive: true });
  }

  const seedFiles = [
    {
      rel: "Desktop/Welcome_to_CatalystX.md",
      content: `# Welcome to CatalystX Cloud OS

You are running on a **real Linux x86_64 cloud computer** right inside your Chromebook browser!

## Things to try right now:
1. **Terminal (\`bash\`)**: Open a real Linux interactive shell — run \`python3\`, \`node\`, \`git\`, \`top\`, or start web servers.
2. **Code Studio**: Open \`Desktop/hello_cloud.py\` or \`Desktop/sys_report.js\` and click **▶ Run** to execute real code on the cloud CPU.
3. **Files**: Upload files from your Chromebook, create projects, edit code, and download outputs anytime.
4. **Browser & Port Viewer**: Start a local server in Terminal (e.g. \`python3 -m http.server 9000\`) and preview \`localhost:9000\` right inside a desktop window!
5. **Phaze Remote**: If a teammate shares a Windows 11 Phaze workstation with you, open the built-in **Phaze Bridge** app from the Launcher.
`,
    },
    {
      rel: "Desktop/hello_cloud.py",
      content: `import platform
import os
import datetime

print("=== CatalystX Real Cloud Python Runner ===")
print(f"Timestamp : {datetime.datetime.now(datetime.timezone.utc).isoformat()}")
print(f"OS Kernel : {platform.system()} {platform.release()} ({platform.machine()})")
print(f"Python    : {platform.python_version()}")
print(f"CPU Cores : {os.cpu_count()}")
print(f"Work Dir  : {os.getcwd()}")

squares = [n * n for n in range(1, 9)]
print(f"Computed  : {squares}")
`,
    },
    {
      rel: "Desktop/sys_report.js",
      content: `import os from "node:os";

const memTotalGb = (os.totalmem() / 1024 ** 3).toFixed(2);
const memFreeGb = (os.freemem() / 1024 ** 3).toFixed(2);

console.log("=== CatalystX Cloud Node.js Diagnostics ===");
console.log("Hostname :", os.hostname());
console.log("Platform :", os.platform(), os.arch(), os.release());
console.log("CPU Model:", os.cpus()[0]?.model || "Cloud vCPU");
console.log(\`Memory   : \${memFreeGb} GB free / \${memTotalGb} GB total\`);
`,
    },
    {
      rel: "Projects/webapp-demo/index.html",
      content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Cloud Mini App</title>
  <style>
    body {
      margin: 0; font-family: system-ui, sans-serif;
      background: #101225; color: #f5f6ff;
      display: grid; place-items: center; min-height: 100vh;
    }
    .box {
      background: #1b1e3b; border: 1px solid #4842ef;
      border-radius: 16px; padding: 28px; text-align: center; max-width: 420px;
    }
    button {
      background: #6464fe; color: #fff; border: none; border-radius: 10px;
      padding: 10px 18px; font-size: 15px; cursor: pointer; margin-top: 14px;
    }
  </style>
</head>
<body>
  <div class="box">
    <h2>Live Cloud HTML App</h2>
    <p>Edited &amp; hosted directly inside your CatalystX Cloud Desktop!</p>
    <p id="counter">Clicks: 0</p>
    <button onclick="window.c=(window.c||0)+1; document.getElementById('counter').textContent='Clicks: '+window.c">
      Test Interactive Click
    </button>
  </div>
</body>
</html>
`,
    },
  ];

  for (const seed of seedFiles) {
    const target = path.join(cloudHomeDir, seed.rel);
    if (!fs.existsSync(target)) {
      await fsp.writeFile(target, seed.content, "utf8");
    }
  }

  const settingsPath = path.join(cloudHomeDir, ".desktop-settings.json");
  if (!fs.existsSync(settingsPath)) {
    await fsp.writeFile(
      settingsPath,
      JSON.stringify({ wallpaper: "nebula", singleClickIcons: false }, null, 2),
      "utf8"
    );
  }
}

export function createSafeFs(rootDir) {
  const realRoot = path.resolve(rootDir);

  function resolveRel(relPath = "") {
    const cleaned = String(relPath || "").replace(/^[/\\]+/, "");
    const resolved = path.resolve(realRoot, cleaned);
    if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) {
      const err = new Error("Path outside cloud workspace is not permitted");
      err.status = 403;
      throw err;
    }
    return {
      abs: resolved,
      rel: path.relative(realRoot, resolved).split(path.sep).join("/"),
    };
  }

  async function listDir(relPath = "") {
    const { abs, rel } = resolveRel(relPath);
    const entries = await fsp.readdir(abs, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      if (entry.name === ".desktop-settings.json") continue;
      const itemAbs = path.join(abs, entry.name);
      const st = await fsp.stat(itemAbs).catch(() => null);
      if (!st) continue;
      const isDir = entry.isDirectory();
      const itemRel = rel ? `${rel}/${entry.name}` : entry.name;
      items.push({
        name: entry.name,
        path: itemRel,
        isDirectory: isDir,
        kind: classifyFile(entry.name, isDir),
        size: isDir ? 0 : st.size,
        mtime: st.mtime.toISOString(),
      });
    }
    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { path: rel, items };
  }

  return {
    root: realRoot,
    resolveRel,
    listDir,
  };
}

let prevCpuSnapshot = null;
function sampleCpuPercent() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times)) {
      total += cpu.times[type];
    }
    idle += cpu.times.idle;
  }
  if (!prevCpuSnapshot) {
    prevCpuSnapshot = { idle, total };
    const loadPct = Math.min(100, Math.round(((os.loadavg()[0] || 0) / Math.max(1, cpus.length)) * 100));
    return loadPct;
  }
  const idleDiff = idle - prevCpuSnapshot.idle;
  const totalDiff = total - prevCpuSnapshot.total;
  prevCpuSnapshot = { idle, total };
  if (totalDiff <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100)));
}

export function getSystemTelemetry(rootDir) {
  const totalMem = os.totalmem();
  let availMem = os.freemem();
  try {
    const meminfo = fs.readFileSync("/proc/meminfo", "utf8");
    const match = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);
    if (match) {
      availMem = Number(match[1]) * 1024;
    }
  } catch {
    // fallback to os.freemem()
  }
  const usedMem = Math.max(0, totalMem - availMem);

  let diskTotal = 0;
  let diskFree = 0;
  try {
    const st = fs.statfsSync(rootDir);
    diskTotal = st.blocks * st.bsize;
    diskFree = st.bavail * st.bsize;
  } catch {
    // ignore if statfs unavailable
  }

  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    cpuModel: cpus[0]?.model || "Linux Cloud vCPU",
    cpuCores: cpus.length,
    cpuPercent: sampleCpuPercent(),
    loadAvg: os.loadavg().map((n) => Number(n.toFixed(2))),
    memTotalBytes: totalMem,
    memUsedBytes: usedMem,
    memPercent: Math.round((usedMem / Math.max(1, totalMem)) * 100),
    diskTotalBytes: diskTotal,
    diskUsedBytes: Math.max(0, diskTotal - diskFree),
    diskFreeBytes: diskFree,
    uptimeSec: Math.floor(os.uptime()),
    nodeVersion: process.version,
  };
}

export async function listProcesses() {
  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-eo", "pid,user,pcpu,pmem,etime,comm,args", "--sort=-pcpu"],
      { timeout: 4000 }
    );
    const lines = stdout.trim().split(/\r?\n/).slice(1, 36);
    return lines
      .map((ln) => {
        const m = ln.trim().match(/^(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/);
        if (!m) return null;
        const pid = Number(m[1]);
        return {
          pid,
          user: m[2],
          cpu: Number(m[3]) || 0,
          mem: Number(m[4]) || 0,
          elapsed: m[5],
          name: m[6],
          command: m[7].slice(0, 120),
          protected: pid <= 2 || pid === process.pid || pid === process.ppid,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function runFileProcess(absPath, cwd, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const ext = path.extname(absPath).toLowerCase();
    let cmd = "bash";
    let args = [absPath];
    if (ext === ".py") {
      cmd = "python3";
      args = [absPath];
    } else if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
      cmd = "node";
      args = [absPath];
    } else if (ext === ".sh" || ext === ".bash") {
      cmd = "bash";
      args = [absPath];
    } else {
      resolve({
        exitCode: 1,
        durationMs: 0,
        stdout: "",
        stderr: `Unsupported runnable extension "${ext}". Supported direct runners: .py (Python 3), .js/.mjs (Node.js), .sh (Bash).`,
      });
      return;
    }

    const started = Date.now();
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      if (stdout.length < 120000) stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < 120000) stderr += d.toString("utf8");
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: killedByTimeout ? 124 : code ?? 0,
        durationMs: Date.now() - started,
        stdout,
        stderr: killedByTimeout ? `${stderr}\n[Execution timed out after ${timeoutMs / 1000}s]` : stderr,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        durationMs: Date.now() - started,
        stdout,
        stderr: err.message,
      });
    });
  });
}
