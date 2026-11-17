import { PhazeMCPError } from "./phazeMcp.js";

function escapeXml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const SIM_TOOLS = [
  { name: "phaze_status", description: "App state and active remote sessions, guests, control, and monitor outputs." },
  { name: "phaze_list_hosts", description: "Machines reachable by the signed-in Phaze account." },
  { name: "phaze_connect", description: "Open a Phaze remote desktop session to a host." },
  { name: "phaze_screenshot", description: "Capture a monitor frame (base64 image) with pixel-accurate coordinates." },
  { name: "phaze_set_control", description: "Assign input control to a guest_id (or 0 to release control)." },
  { name: "phaze_left_click", description: "Left click at [x, y] pixel coordinates." },
  { name: "phaze_right_click", description: "Right click at [x, y] pixel coordinates." },
  { name: "phaze_double_click", description: "Double click at [x, y] pixel coordinates." },
  { name: "phaze_left_click_drag", description: "Click-and-drag from start_coordinate to coordinate." },
  { name: "phaze_scroll", description: "Scroll wheel up/down/left/right at [x, y]." },
  { name: "phaze_send_keys", description: "Send typed characters, bracketed named keys ([Enter], [Escape]), and modifiers." },
  { name: "phaze_run_command", description: "Run a shell/PowerShell command directly on the host (Phaze v0.9.0+)." },
  { name: "phaze_disconnect", description: "Close an active Phaze connection." },
];

function createDefaultDesktopState(hostId) {
  if (hostId === "mach_cad_04") {
    return {
      focusedWindow: "terminal",
      startMenuOpen: false,
      contextMenu: null,
      secureDesktop: false,
      lastClick: null,
      lastKeyHint: "Ready",
      renderFrame: 148,
      windows: {
        cad: {
          id: "cad",
          title: "Unreal Engine 5.5 — Packaging Project (Windows_x64)",
          x: 190,
          y: 78,
          w: 980,
          h: 590,
          open: true,
          z: 2,
        },
        terminal: {
          id: "terminal",
          title: "Windows PowerShell 7.4 — Administrator",
          x: 720,
          y: 350,
          w: 960,
          h: 510,
          open: true,
          z: 3,
        },
        notes: {
          id: "notes",
          title: "BuildChecklist.md — Notepad",
          x: 240,
          y: 160,
          w: 660,
          h: 420,
          open: false,
          z: 1,
        },
      },
      notesLines: [
        "# CAD-ENG-04 Release Checklist",
        "- Shader compilation complete (4,120 / 4,120)",
        "- Verify Pak chunk manifest from Chromebook Web Bridge",
        "- Hand session control back to build agent when done",
        "",
      ],
      terminalInput: "",
      terminalHistory: [
        "PS C:\\Projects\\CatalystUE5> .\\RunUAT.bat BuildCookRun -project=Catalyst -pak",
        "[UAT] Cooking 1,284 assets for WindowsClient... OK",
        "[UAT] Packaging stage 89% — writing Catalyst-Windows.pak (4.2 GB)",
        "PS C:\\Projects\\CatalystUE5> ",
      ],
    };
  }

  return {
    focusedWindow: "notes",
    startMenuOpen: false,
    contextMenu: null,
    secureDesktop: false,
    lastClick: null,
    lastKeyHint: "Click any window or desktop icon, drag titlebars, or type on your Chromebook",
    renderFrame: 74,
    windows: {
      blender: {
        id: "blender",
        title: "Blender 4.3 — Studio_Turbine_Assembly.blend [Cycles OptiX]",
        x: 175,
        y: 64,
        w: 1020,
        h: 620,
        open: true,
        z: 2,
      },
      notes: {
        id: "notes",
        title: "SessionScratchpad.txt — Notepad (Click & Type Here!)",
        x: 920,
        y: 340,
        w: 840,
        h: 520,
        open: true,
        z: 3,
      },
      terminal: {
        id: "terminal",
        title: "Windows PowerShell — VFX-STUDIO-01",
        x: 310,
        y: 210,
        w: 880,
        h: 480,
        open: false,
        z: 1,
      },
    },
    notesLines: [
      "Welcome to Phaze Web Bridge on your Chromebook!",
      "",
      "Try interacting right on this live desktop canvas:",
      "1. Click or drag window titlebars to move windows around",
      "2. Double-click desktop icons on the left (Blender, PowerShell, Notes)",
      "3. Type on your Chromebook keyboard — keystrokes stream right here!",
      "4. Switch to Display 2 in the top HUD or run commands in Remote Shell.",
      "",
      "> ",
    ],
    terminalInput: "",
    terminalHistory: [
      "Windows PowerShell — Phaze Host Direct Bridge",
      "GPU 0: NVIDIA GeForce RTX 4090 (24564 MiB) | Driver 566.14 | Temp 58C",
      "PS C:\\Users\\Studio> ",
    ],
  };
}

export class SimulatedPhazeMCP {
  constructor() {
    this.rpcLog = [];
    this.nextConnSeq = 1;
    this.hosts = [
      {
        machine_id: "mach_vfx_01",
        peer_id: "peer_99a81f02",
        name: "VFX-STUDIO-01",
        online: true,
        requires_relay: false,
        os: "Windows 11 Pro 24H2",
        gpu: "NVIDIA RTX 4090 · 64 GB RAM",
        location: "New York Studio · Rack A2",
        group: "3D & LookDev Pool",
        assignee: "Shared Workstation",
      },
      {
        machine_id: "mach_cad_04",
        peer_id: "peer_44c19e77",
        name: "CAD-ENG-04",
        online: true,
        requires_relay: false,
        os: "Windows 11 Enterprise",
        gpu: "RTX 5000 Ada · 128 GB RAM",
        location: "Park City Lab · Bay 4",
        group: "CAD & Unreal Engineering",
        assignee: "Build Agent + You",
      },
      {
        machine_id: "mach_render_07",
        peer_id: "peer_71d03b19",
        name: "RENDER-NODE-07",
        online: true,
        requires_relay: true,
        os: "Windows 11 Pro for Workstations",
        gpu: "2× RTX 6000 Ada · On-Prem Relay",
        location: "On-Prem Data Center (UDP 41000)",
        group: "Render Farm",
        assignee: "Unassigned Pool",
      },
      {
        machine_id: "mach_arch_09",
        peer_id: "peer_00offline",
        name: "REVIT-WORKSTATION-09",
        online: false,
        requires_relay: false,
        os: "Windows 11 Pro",
        gpu: "RTX 4080 SUPER · 64 GB RAM",
        location: "Remote Office",
        group: "AEC Design",
        assignee: "Sleeping / Offline",
      },
    ];

    this.desktops = new Map();
    for (const h of this.hosts) {
      this.desktops.set(h.machine_id, createDefaultDesktopState(h.machine_id));
    }

    // Seed an active collaborative session on CAD-ENG-04 to demonstrate Phaze shared agent/human control
    this.connections = new Map();
  }

  recordLog(tool, args, ok = true, extra = {}) {
    this.rpcLog.unshift({
      ts: new Date().toISOString(),
      id: Math.floor(Math.random() * 90000) + 10000,
      method: "tools/call",
      tool,
      args,
      ok,
      durationMs: Math.floor(Math.random() * 14) + 4,
      simulated: true,
      ...extra,
    });
    if (this.rpcLog.length > 80) this.rpcLog.length = 80;
  }

  getLogs() {
    return this.rpcLog;
  }

  async listTools() {
    return SIM_TOOLS;
  }

  async ping() {
    return await this.status();
  }

  async status() {
    const connections = Array.from(this.connections.values()).map((c) => ({
      connection_id: c.connection_id,
      owner: c.owner,
      connected: c.connected,
      host_machine_id: c.host_machine_id,
      host_name: c.host_name,
      has_control: c.guests.some((g) => g.is_self && g.has_control),
      guests: c.guests,
      outputs: c.outputs,
    }));
    const payload = { connected: true, simulator: true, connections };
    return payload;
  }

  async listHosts() {
    this.recordLog("phaze_list_hosts", {});
    return this.hosts.map(({ machine_id, peer_id, name, online, requires_relay }) => ({
      machine_id,
      peer_id,
      name,
      online,
      requires_relay,
    }));
  }

  getEnterpriseMetadataMap() {
    const map = new Map();
    for (const h of this.hosts) {
      map.set(h.machine_id, {
        id: h.machine_id,
        name: h.name,
        is_online: h.online,
        os: h.os,
        gpu: h.gpu,
        location: h.location,
        group: h.group,
        assignee: h.assignee,
        org_name: "CatalystX Studio (Simulated Org)",
        deep_link: `phaze://connect?id=${h.machine_id}`,
      });
    }
    return map;
  }

  async connect({ peerId, machineId, relay = false }) {
    const host = this.hosts.find((h) => h.machine_id === machineId || h.peer_id === peerId);
    if (!host) {
      throw new PhazeMCPError(`Host ${machineId} not found`, "MCP_ERROR");
    }
    if (!host.online) {
      throw new PhazeMCPError(`${host.name} is currently offline`, "UNREACHABLE");
    }

    // Reuse existing connection to same host if already open
    for (const existing of this.connections.values()) {
      if (existing.host_machine_id === host.machine_id) {
        this.recordLog("phaze_connect", { host_peer_id: host.peer_id, machine_id: host.machine_id, reused: true });
        return { connection_id: existing.connection_id };
      }
    }

    const connectionId = `connection-sim-${this.nextConnSeq++}-${host.machine_id.slice(-2)}`;
    const selfGuestId = 100420;
    const guests =
      host.machine_id === "mach_cad_04"
        ? [
            {
              guest_id: selfGuestId,
              user: "u_chromebook_you",
              label: "You (Chromebook Web Bridge)",
              role: "human",
              has_control: true,
              is_self: true,
            },
            {
              guest_id: 200881,
              user: "u_claude_build_agent",
              label: "Claude Build Watcher (MCP Agent)",
              role: "agent",
              has_control: false,
              is_self: false,
            },
          ]
        : [
            {
              guest_id: selfGuestId,
              user: "u_chromebook_you",
              label: "You (Chromebook Web Bridge)",
              role: "human",
              has_control: true,
              is_self: true,
            },
          ];

    const outputs =
      host.machine_id === "mach_render_07"
        ? [{ id: 101, name: "Virtual Headless 1080p", primary: true, width: 1920, height: 1080 }]
        : [
            { id: 101, name: "Display 1 · 4K Studio Primary (1080p Scaled)", primary: true, width: 1920, height: 1080 },
            { id: 102, name: "Display 2 · Ultrawide Telemetry & Nodes", primary: false, width: 1920, height: 1080 },
          ];

    this.connections.set(connectionId, {
      connection_id: connectionId,
      owner: "agent",
      connected: true,
      relay_used: Boolean(relay || host.requires_relay),
      host_machine_id: host.machine_id,
      host_name: host.name,
      guests,
      outputs,
    });

    this.recordLog("phaze_connect", {
      host_peer_id: host.peer_id,
      machine_id: host.machine_id,
      ...(relay ? { relay: true } : {}),
    });
    return { connection_id: connectionId };
  }

  async disconnect(connectionId) {
    this.connections.delete(connectionId);
    this.recordLog("phaze_disconnect", { connection_id: connectionId });
    return { ok: true };
  }

  async setControl(connectionId, guestId) {
    const conn = this.connections.get(connectionId);
    if (!conn) throw new PhazeMCPError(`Unknown connection ${connectionId}`, "MCP_ERROR");
    const targetId = Number(guestId);
    for (const g of conn.guests) {
      g.has_control = targetId !== 0 && g.guest_id === targetId;
    }
    this.recordLog("phaze_set_control", { connection_id: connectionId, guest_id: targetId });
    return { ok: true, controller_guest_id: targetId };
  }

  setSimulatedSecureDesktop(connectionId, locked) {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    const desk = this.desktops.get(conn.host_machine_id);
    if (desk) desk.secureDesktop = Boolean(locked);
  }

  requireControllable(connectionId) {
    const conn = this.connections.get(connectionId);
    if (!conn) throw new PhazeMCPError(`Connection ${connectionId} is closed`, "MCP_ERROR");
    const self = conn.guests.find((g) => g.is_self);
    if (!self?.has_control) {
      throw new PhazeMCPError(
        "Observe-only mode: click 'Take Control' in the top HUD before sending mouse or keyboard input.",
        "NO_CONTROL"
      );
    }
    const desk = this.desktops.get(conn.host_machine_id);
    return { conn, desk };
  }

  bringToFront(desk, winKey) {
    const win = desk.windows[winKey];
    if (!win) return;
    win.open = true;
    const maxZ = Math.max(1, ...Object.values(desk.windows).map((w) => w.z || 1));
    win.z = maxZ + 1;
    desk.focusedWindow = winKey;
  }

  async click(connectionId, buttonAction, coordinate, { output = 101, modifier = null } = {}) {
    const { desk } = this.requireControllable(connectionId);
    const [x, y] = [Math.round(coordinate[0]), Math.round(coordinate[1])];
    desk.lastClick = { x, y, button: buttonAction, ts: Date.now() };

    if (buttonAction === "right") {
      desk.contextMenu = { x: Math.min(x, 1660), y: Math.min(y, 840) };
      desk.startMenuOpen = false;
      this.recordLog("phaze_right_click", { connection_id: connectionId, coordinate: [x, y], output });
      return { ok: true };
    }

    // Dismiss context menu if clicking elsewhere
    if (desk.contextMenu) {
      const cm = desk.contextMenu;
      if (x >= cm.x && x <= cm.x + 230 && y >= cm.y && y <= cm.y + 176) {
        const idx = Math.floor((y - cm.y - 8) / 40);
        if (idx === 0) this.bringToFront(desk, "terminal");
        if (idx === 1) this.bringToFront(desk, "notes");
        if (idx === 2) desk.renderFrame = (desk.renderFrame + 7) % 250;
        if (idx === 3) desk.secureDesktop = true;
        desk.contextMenu = null;
        this.recordLog("phaze_left_click", { connection_id: connectionId, coordinate: [x, y], output });
        return { ok: true };
      }
      desk.contextMenu = null;
    }

    // Taskbar region (y >= 1024)
    if (y >= 1024) {
      if (x >= 680 && x <= 748) {
        desk.startMenuOpen = !desk.startMenuOpen;
      } else if (x >= 760 && x <= 890) {
        const primaryKey = desk.windows.blender ? "blender" : "cad";
        this.bringToFront(desk, primaryKey);
        desk.startMenuOpen = false;
      } else if (x >= 900 && x <= 1030) {
        this.bringToFront(desk, "terminal");
        desk.startMenuOpen = false;
      } else if (x >= 1040 && x <= 1170) {
        this.bringToFront(desk, "notes");
        desk.startMenuOpen = false;
      }
      this.recordLog(`phaze_${buttonAction}_click`, { connection_id: connectionId, coordinate: [x, y], output, modifier });
      return { ok: true };
    }

    // Start menu popup clicks
    if (desk.startMenuOpen && x >= 640 && x <= 1220 && y >= 540 && y <= 1012) {
      if (y >= 640 && y <= 730) this.bringToFront(desk, "terminal");
      else if (y >= 735 && y <= 825) this.bringToFront(desk, "notes");
      else if (y >= 830 && y <= 920) {
        const primaryKey = desk.windows.blender ? "blender" : "cad";
        this.bringToFront(desk, primaryKey);
      } else if (y >= 930) {
        desk.secureDesktop = true;
      }
      desk.startMenuOpen = false;
      this.recordLog(`phaze_${buttonAction}_click`, { connection_id: connectionId, coordinate: [x, y], output });
      return { ok: true };
    }
    desk.startMenuOpen = false;

    // Desktop icons column on left (x <= 150)
    if (x >= 24 && x <= 150) {
      if (y >= 36 && y <= 140) {
        const primaryKey = desk.windows.blender ? "blender" : "cad";
        this.bringToFront(desk, primaryKey);
      } else if (y >= 156 && y <= 260) {
        this.bringToFront(desk, "terminal");
      } else if (y >= 276 && y <= 380) {
        this.bringToFront(desk, "notes");
      } else if (y >= 396 && y <= 500) {
        desk.secureDesktop = true;
      }
    }

    // Window hit testing in reverse Z-order
    const openWins = Object.values(desk.windows)
      .filter((w) => w.open)
      .sort((a, b) => (b.z || 1) - (a.z || 1));

    for (const win of openWins) {
      if (x >= win.x && x <= win.x + win.w && y >= win.y && y <= win.y + win.h) {
        // Close button in top-right of window titlebar
        if (y <= win.y + 40 && x >= win.x + win.w - 46) {
          win.open = false;
          const nextTop = Object.values(desk.windows)
            .filter((w) => w.open)
            .sort((a, b) => (b.z || 1) - (a.z || 1))[0];
          desk.focusedWindow = nextTop?.id || null;
        } else {
          this.bringToFront(desk, win.id);
        }
        break;
      }
    }

    const toolMap = {
      left: "phaze_left_click",
      right: "phaze_right_click",
      middle: "phaze_middle_click",
      double: "phaze_double_click",
      triple: "phaze_triple_click",
    };
    this.recordLog(toolMap[buttonAction] || "phaze_left_click", {
      connection_id: connectionId,
      coordinate: [x, y],
      output,
      ...(modifier ? { text: modifier } : {}),
    });
    return { ok: true };
  }

  async drag(connectionId, startCoordinate, endCoordinate, { output = 101 } = {}) {
    const { desk } = this.requireControllable(connectionId);
    const [sx, sy] = [Math.round(startCoordinate[0]), Math.round(startCoordinate[1])];
    const [ex, ey] = [Math.round(endCoordinate[0]), Math.round(endCoordinate[1])];
    desk.lastClick = { x: ex, y: ey, button: "drag", ts: Date.now() };

    const openWins = Object.values(desk.windows)
      .filter((w) => w.open)
      .sort((a, b) => (b.z || 1) - (a.z || 1));

    for (const win of openWins) {
      // Dragging within top 48px titlebar moves the window!
      if (sx >= win.x && sx <= win.x + win.w && sy >= win.y && sy <= win.y + 48) {
        this.bringToFront(desk, win.id);
        const dx = ex - sx;
        const dy = ey - sy;
        win.x = Math.max(20, Math.min(1920 - 220, win.x + dx));
        win.y = Math.max(16, Math.min(960, win.y + dy));
        break;
      }
    }

    this.recordLog("phaze_left_click_drag", {
      connection_id: connectionId,
      start_coordinate: [sx, sy],
      coordinate: [ex, ey],
      output,
    });
    return { ok: true };
  }

  async mouseMove(connectionId, coordinate, { output = 101 } = {}) {
    this.recordLog("phaze_mouse_move", { connection_id: connectionId, coordinate, output });
    return { ok: true };
  }

  async scroll(connectionId, coordinate, direction = "down", amount = 3, { output = 101 } = {}) {
    const { desk } = this.requireControllable(connectionId);
    desk.lastKeyHint = `Scrolled ${direction} (${amount}) at [${Math.round(coordinate[0])}, ${Math.round(coordinate[1])}]`;
    this.recordLog("phaze_scroll", {
      connection_id: connectionId,
      coordinate,
      scroll_direction: direction,
      scroll_amount: amount,
      output,
    });
    return { ok: true };
  }

  executeSimCommandText(desk, hostName, rawCmd) {
    const cmd = rawCmd.trim();
    if (!cmd) return "";
    const lower = cmd.toLowerCase();
    if (lower === "cls" || lower === "clear") {
      desk.terminalHistory = [`PS C:\\Users\\Studio> `];
      return "[Screen cleared]";
    }
    if (lower.includes("nvidia-smi")) {
      return [
        "+-----------------------------------------------------------------------------------------+",
        "| NVIDIA-SMI 566.14                 Driver Version: 566.14         CUDA Version: 12.7     |",
        "|-----------------------------------------+------------------------+----------------------+",
        `| 0  NVIDIA RTX Workstation GPU     WDDM  |   00000000:01:00.0  On |                  Off |`,
        "| 38%   57C    P2             194W /  450W |   11420MiB /  24564MiB |     78%      Default |",
        "+-----------------------------------------+------------------------+----------------------+",
      ].join("\n");
    }
    if (lower.includes("hostname") || lower === "whoami") {
      return `${hostName.toLowerCase()}\\studio-engineer`;
    }
    if (lower.includes("ipconfig")) {
      return [
        "Windows IP Configuration",
        `   Host Name . . . . . . . . . . . . : ${hostName}`,
        "   IPv4 Address. . . . . . . . . . . : 10.24.8.42 (Preferred)",
        "   Phaze Direct UDP Stream . . . . . : Active (AES-256-GCM)",
      ].join("\n");
    }
    if (lower.includes("tasklist") || lower.includes("get-process")) {
      return [
        "Handles  NPM(K)    PM(K)      WS(K)     CPU(s)     Id  ProcessName",
        "-------  ------    -----      -----     ------     --  -----------",
        "   1482      94  4812400    5120900     842.19   4812  blender",
        "    612      41   245100     310440      19.44   7720  phaze-host",
        "    418      28   118400     164200       3.12   9104  pwsh",
      ].join("\n");
    }
    if (lower.includes("dir") || lower === "ls") {
      return [
        "    Directory: C:\\Projects\\Studio",
        "Mode                 LastWriteTime         Length Name",
        "----                 -------------         ------ ----",
        "d----          11/17/2026  1:10 AM                renders_exr",
        "-a---          11/17/2026  1:04 AM      148912640 Studio_Turbine_Assembly.blend",
        "-a---          11/17/2026  1:12 AM           4096 BuildChecklist.md",
      ].join("\n");
    }
    return `[${hostName}] Executed: ${cmd}\nExitCode: 0 (Completed in 18ms)`;
  }

  async sendKeys(connectionId, text, modifiers = [], { sensitive = false } = {}) {
    const { conn, desk } = this.requireControllable(connectionId);
    const modStr = modifiers.length ? `${modifiers.join("+")}+` : "";
    desk.lastKeyHint = sensitive ? "Sent [redacted input]" : `Key: ${modStr}${text}`;

    // Handle global shortcuts
    if (modifiers.includes("MetaLeft") && (!text || text === "")) {
      desk.startMenuOpen = !desk.startMenuOpen;
    } else if (text === "[Escape]") {
      desk.startMenuOpen = false;
      desk.contextMenu = null;
    } else if (modifiers.includes("AltLeft") && text === "[Tab]") {
      const openIds = Object.values(desk.windows)
        .filter((w) => w.open)
        .map((w) => w.id);
      if (openIds.length > 1) {
        const nextIdx = (openIds.indexOf(desk.focusedWindow) + 1) % openIds.length;
        this.bringToFront(desk, openIds[nextIdx]);
      }
    } else if (desk.focusedWindow === "terminal" && desk.windows.terminal?.open) {
      if (text === "[Enter]") {
        const cmd = desk.terminalInput;
        const lastIdx = desk.terminalHistory.length - 1;
        desk.terminalHistory[lastIdx] = `${desk.terminalHistory[lastIdx]}${cmd}`;
        const out = this.executeSimCommandText(desk, conn.host_name, cmd);
        if (out && out !== "[Screen cleared]") {
          for (const line of out.split("\n")) {
            desk.terminalHistory.push(line);
          }
          desk.terminalHistory.push("PS C:\\Users\\Studio> ");
        }
        desk.terminalInput = "";
        if (desk.terminalHistory.length > 14) {
          desk.terminalHistory = desk.terminalHistory.slice(-14);
        }
      } else if (text === "[Backspace]") {
        desk.terminalInput = desk.terminalInput.slice(0, -1);
      } else if (text === "[Space]") {
        desk.terminalInput += " ";
      } else if (!text.startsWith("[") && modifiers.length === 0) {
        desk.terminalInput += text;
      }
    } else {
      // Default to Notepad window if open, else bring Notes open when typing plain text
      if (!desk.windows.notes?.open && !text.startsWith("[") && modifiers.length === 0) {
        this.bringToFront(desk, "notes");
      }
      if (desk.windows.notes?.open) {
        const last = desk.notesLines.length - 1;
        if (text === "[Enter]") {
          desk.notesLines.push("> ");
        } else if (text === "[Backspace]") {
          if (desk.notesLines[last].length > 0) {
            desk.notesLines[last] = desk.notesLines[last].slice(0, -1);
          } else if (desk.notesLines.length > 1) {
            desk.notesLines.pop();
          }
        } else if (text === "[Space]") {
          desk.notesLines[last] += " ";
        } else if (text === "[Tab]") {
          desk.notesLines[last] += "    ";
        } else if (!text.startsWith("[") && modifiers.length === 0) {
          const pieces = String(text).split(/\r?\n/);
          desk.notesLines[last] += pieces[0];
          for (let i = 1; i < pieces.length; i++) {
            desk.notesLines.push(pieces[i]);
          }
        }
        if (desk.notesLines.length > 15) {
          desk.notesLines = desk.notesLines.slice(-15);
        }
      }
    }

    this.recordLog(
      "phaze_send_keys",
      sensitive ? { redacted: true } : { connection_id: connectionId, text, modifiers }
    );
    return { ok: true };
  }

  async runCommand(connectionId, command) {
    const conn = this.connections.get(connectionId);
    if (!conn) throw new PhazeMCPError(`Unknown connection ${connectionId}`, "MCP_ERROR");
    const desk = this.desktops.get(conn.host_machine_id);
    const out = this.executeSimCommandText(desk, conn.host_name, command);

    if (desk) {
      const lastIdx = desk.terminalHistory.length - 1;
      desk.terminalHistory[lastIdx] = `${desk.terminalHistory[lastIdx]}${command}`;
      if (out && out !== "[Screen cleared]") {
        for (const line of out.split("\n")) {
          desk.terminalHistory.push(line);
        }
        desk.terminalHistory.push("PS C:\\Users\\Studio> ");
      }
      if (desk.terminalHistory.length > 14) {
        desk.terminalHistory = desk.terminalHistory.slice(-14);
      }
    }

    this.recordLog("phaze_run_command", { connection_id: connectionId, command });
    return {
      toolUsed: "phaze_run_command (simulator)",
      output: out,
      exitCode: 0,
    };
  }

  async screenshot(connectionId, output = 101) {
    const conn = this.connections.get(connectionId);
    if (!conn) throw new PhazeMCPError(`Connection ${connectionId} not found`, "MCP_ERROR");
    const desk = this.desktops.get(conn.host_machine_id);
    if (desk.secureDesktop) {
      this.recordLog("phaze_screenshot", { connection_id: connectionId, output }, false, {
        code: "NOT_CAPTURING",
        error: "connection is not capturing (Windows sign-in / UAC secure desktop)",
      });
      throw new PhazeMCPError(
        "connection is not capturing (Windows secure desktop: lock screen or UAC prompt)",
        "NOT_CAPTURING"
      );
    }

    // Advance animated render progress slightly on each frame
    desk.renderFrame = (desk.renderFrame + 1) % 240;

    const outNum = Number(output || 101);
    const svg =
      outNum === 102
        ? this.renderSecondaryMonitorSvg(conn, desk)
        : this.renderPrimaryMonitorSvg(conn, desk);

    return {
      mimeType: "image/svg+xml",
      data: Buffer.from(svg, "utf8").toString("base64"),
    };
  }

  renderWindowChrome(win, isFocused, bodySvg) {
    const borderStroke = isFocused ? "#7784fc" : "#3a3a5c";
    const headerBg = isFocused ? "#20203b" : "#18182e";
    return `
      <g transform="translate(${win.x}, ${win.y})">
        <rect width="${win.w}" height="${win.h}" rx="12" fill="#131325" stroke="${borderStroke}" stroke-width="${isFocused ? 2 : 1.2}" />
        <path d="M0 12 Q0 0 12 0 L${win.w - 12} 0 Q${win.w} 0 ${win.w} 12 L${win.w} 42 L0 42 Z" fill="${headerBg}" />
        <circle cx="22" cy="21" r="5.5" fill="${isFocused ? "#6464fe" : "#4a4a69"}" />
        <text x="38" y="26" fill="#f7f7fd" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="600">${escapeXml(win.title)}</text>
        <rect x="${win.w - 44}" y="7" width="34" height="28" rx="6" fill="#2c1d27" />
        <text x="${win.w - 27}" y="26" text-anchor="middle" fill="#f0736f" font-family="system-ui, sans-serif" font-size="14" font-weight="700">×</text>
        <g transform="translate(0, 42)">
          ${bodySvg}
        </g>
      </g>
    `;
  }

  renderPrimaryMonitorSvg(conn, desk) {
    const pct = Math.min(99, Math.floor((desk.renderFrame / 240) * 100));
    const clockStr = new Date().toISOString().slice(11, 19) + " UTC";

    const openWindows = Object.values(desk.windows)
      .filter((w) => w.open)
      .sort((a, b) => (a.z || 1) - (b.z || 1));

    const windowSvgs = openWindows
      .map((win) => {
        const focused = desk.focusedWindow === win.id;
        const innerH = win.h - 42;
        if (win.id === "blender" || win.id === "cad") {
          const barW = Math.round(((win.w - 80) * pct) / 100);
          const angle = (desk.renderFrame * 3) % 360;
          const body = `
            <rect width="${win.w}" height="${innerH}" fill="#0f1020" />
            <rect x="16" y="16" width="${win.w - 260}" height="${innerH - 92}" rx="8" fill="#090a14" stroke="#282946" />
            <g transform="translate(${Math.round((win.w - 260) / 2 + 16)}, ${Math.round((innerH - 92) / 2 + 16)})">
              <ellipse rx="210" ry="74" fill="none" stroke="#31356e" stroke-width="1.5" stroke-dasharray="6 6"/>
              <g transform="rotate(${angle})">
                <polygon points="0,-125 112,62 -112,62" fill="rgba(100,100,254,0.18)" stroke="#7784fc" stroke-width="2.5"/>
                <circle cx="0" cy="-125" r="6" fill="#6bd47a"/>
                <circle cx="112" cy="62" r="6" fill="#ffc93f"/>
                <circle cx="-112" cy="62" r="6" fill="#7784fc"/>
              </g>
              <circle cx="0" cy="0" r="34" fill="#1b1c38" stroke="#6464fe" stroke-width="2"/>
            </g>
            <text x="34" y="46" fill="#a3a3c7" font-family="monospace" font-size="13">Viewport: Camera_Main · 4:4:4 Chroma · 10-bit · Frame ${desk.renderFrame}/240</text>
            <rect x="${win.w - 230}" y="16" width="214" height="${innerH - 92}" rx="8" fill="#17182d" stroke="#282946" />
            <text x="${win.w - 214}" y="44" fill="#f7f7fd" font-family="system-ui, sans-serif" font-size="13" font-weight="600">Scene Inspector</text>
            <text x="${win.w - 214}" y="74" fill="#cbcbdf" font-family="monospace" font-size="12">• Turbine_Rotor_LOD0</text>
            <text x="${win.w - 214}" y="98" fill="#cbcbdf" font-family="monospace" font-size="12">• AreaLight_Key_4K</text>
            <text x="${win.w - 214}" y="122" fill="#cbcbdf" font-family="monospace" font-size="12">• HDRI_Studio_Rig</text>
            <text x="${win.w - 214}" y="166" fill="#6bd47a" font-family="monospace" font-size="12">GPU OptiX: ACTIVE</text>
            <text x="${win.w - 214}" y="190" fill="#a3a3c7" font-family="monospace" font-size="12">VRAM: 11.4 / 24.0 GB</text>
            <text x="${win.w - 214}" y="214" fill="#a3a3c7" font-family="monospace" font-size="12">Samples: 512 / 512</text>
            <rect x="16" y="${innerH - 60}" width="${win.w - 32}" height="44" rx="8" fill="#17182d" />
            <rect x="28" y="${innerH - 44}" width="${win.w - 80}" height="12" rx="6" fill="#0c0c18" />
            <rect x="28" y="${innerH - 44}" width="${barW}" height="12" rx="6" fill="#6464fe" />
            <text x="${win.w - 42}" y="${innerH - 34}" text-anchor="end" fill="#f7f7fd" font-family="monospace" font-size="12">${pct}%</text>
          `;
          return this.renderWindowChrome(win, focused, body);
        }

        if (win.id === "terminal") {
          const lines = [...desk.terminalHistory];
          const lastIdx = lines.length - 1;
          lines[lastIdx] = `${lines[lastIdx]}${desk.terminalInput}${focused ? "█" : ""}`;
          const textRows = lines
            .map(
              (ln, idx) =>
                `<text x="20" y="${32 + idx * 24}" fill="${
                  ln.startsWith("PS ") ? "#7784fc" : "#d9ffe0"
                }" font-family="ui-monospace, Consolas, monospace" font-size="14">${escapeXml(ln)}</text>`
            )
            .join("");
          const body = `
            <rect width="${win.w}" height="${innerH}" rx="0" fill="#0b0d17" />
            ${textRows}
          `;
          return this.renderWindowChrome(win, focused, body);
        }

        // Notepad / Scratchpad window
        const noteRows = desk.notesLines
          .map((ln, idx) => {
            const isLast = idx === desk.notesLines.length - 1;
            return `<text x="22" y="${34 + idx * 25}" fill="#f7f7fd" font-family="ui-monospace, Consolas, monospace" font-size="15">${escapeXml(
              ln + (isLast && focused ? "▋" : "")
            )}</text>`;
          })
          .join("");
        const body = `
          <rect width="${win.w}" height="${innerH}" fill="#17172b" />
          <rect width="${win.w}" height="28" fill="#1e1e36" />
          <text x="16" y="19" fill="#a3a3c7" font-family="system-ui, sans-serif" font-size="12">File   Edit   View   Phaze Clipboard Sync: Enabled</text>
          <g transform="translate(0, 26)">${noteRows}</g>
        `;
        return this.renderWindowChrome(win, focused, body);
      })
      .join("\n");

    const desktopIcons = [
      { y: 42, label: desk.windows.blender ? "Blender 4.3" : "Unreal 5.5", color: "#6464fe", glyph: "3D" },
      { y: 162, label: "PowerShell 7", color: "#2b6cb0", glyph: ">_" },
      { y: 282, label: "Scratchpad", color: "#4a4a69", glyph: "MD" },
      { y: 402, label: "Test Lock/UAC", color: "#8a3b12", glyph: "🔒" },
    ]
      .map(
        (ic) => `
        <g transform="translate(32, ${ic.y})">
          <rect x="18" y="0" width="64" height="64" rx="14" fill="${ic.color}" stroke="rgba(255,255,255,0.22)" />
          <text x="50" y="40" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-size="20" font-weight="700">${ic.glyph}</text>
          <text x="50" y="84" text-anchor="middle" fill="#f7f7fd" font-family="system-ui, sans-serif" font-size="13">${escapeXml(ic.label)}</text>
        </g>`
      )
      .join("");

    const startMenuSvg = desk.startMenuOpen
      ? `
      <g transform="translate(640, 548)">
        <rect width="580" height="462" rx="18" fill="#1b1b33" stroke="#4a4a69" stroke-width="1.5" />
        <text x="28" y="44" fill="#f7f7fd" font-family="system-ui, sans-serif" font-size="18" font-weight="600">Pinned Workstation Apps (${escapeXml(conn.host_name)})</text>
        <rect x="24" y="88" width="532" height="78" rx="12" fill="#252545" />
        <text x="48" y="124" fill="#7784fc" font-family="system-ui, sans-serif" font-size="16" font-weight="600">Windows PowerShell 7.4 (Admin)</text>
        <text x="48" y="148" fill="#a3a3c7" font-family="system-ui, sans-serif" font-size="13">Click to launch &amp; focus interactive shell window</text>

        <rect x="24" y="182" width="532" height="78" rx="12" fill="#252545" />
        <text x="48" y="218" fill="#6bd47a" font-family="system-ui, sans-serif" font-size="16" font-weight="600">SessionScratchpad.txt — Notepad</text>
        <text x="48" y="242" fill="#a3a3c7" font-family="system-ui, sans-serif" font-size="13">Test Chromebook typing, clipboard paste &amp; shortcuts</text>

        <rect x="24" y="276" width="532" height="78" rx="12" fill="#252545" />
        <text x="48" y="312" fill="#ffc93f" font-family="system-ui, sans-serif" font-size="16" font-weight="600">3D / CAD Viewport</text>
        <text x="48" y="336" fill="#a3a3c7" font-family="system-ui, sans-serif" font-size="13">Bring primary GPU workload to foreground</text>

        <rect x="24" y="376" width="532" height="62" rx="12" fill="#3b1d26" />
        <text x="48" y="413" fill="#f0736f" font-family="system-ui, sans-serif" font-size="15" font-weight="600">Lock Workstation (Simulate Secure Desktop 'not capturing')</text>
      </g>`
      : "";

    const contextMenuSvg = desk.contextMenu
      ? `
      <g transform="translate(${desk.contextMenu.x}, ${desk.contextMenu.y})">
        <rect width="232" height="176" rx="10" fill="#1f1f3a" stroke="#6464fe" stroke-width="1.2" />
        <text x="18" y="34" fill="#f7f7fd" font-family="system-ui, sans-serif" font-size="14">Open PowerShell Here</text>
        <text x="18" y="74" fill="#f7f7fd" font-family="system-ui, sans-serif" font-size="14">Open Session Scratchpad</text>
        <text x="18" y="114" fill="#f7f7fd" font-family="system-ui, sans-serif" font-size="14">Step Render Frame (+7)</text>
        <text x="18" y="154" fill="#f0736f" font-family="system-ui, sans-serif" font-size="14">Lock Windows Desktop</text>
      </g>`
      : "";

    // Phaze v0.13.2 feature: screenshots mark where the last click landed!
    const clickMarkerSvg =
      desk.lastClick && Date.now() - desk.lastClick.ts < 15000
        ? `
      <g transform="translate(${desk.lastClick.x}, ${desk.lastClick.y})">
        <circle r="16" fill="none" stroke="#ffc93f" stroke-width="2" stroke-dasharray="4 3" />
        <circle r="4" fill="#ffc93f" />
      </g>`
        : "";

    return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <defs>
        <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#13132b"/>
          <stop offset="52%" stop-color="#1b1942"/>
          <stop offset="100%" stop-color="#0d1326"/>
        </linearGradient>
        <radialGradient id="glow" cx="78%" cy="22%" r="55%">
          <stop offset="0%" stop-color="rgba(100,100,254,0.34)"/>
          <stop offset="100%" stop-color="rgba(20,20,38,0)"/>
        </radialGradient>
      </defs>
      <rect width="1920" height="1080" fill="url(#wall)"/>
      <rect width="1920" height="1080" fill="url(#glow)"/>

      <!-- Subtle Phaze host watermark -->
      <text x="1884" y="42" text-anchor="end" fill="rgba(247,247,253,0.45)" font-family="monospace" font-size="14">${escapeXml(
        conn.host_name
      )} · Display 1 (1920×1080) · ${escapeXml(desk.lastKeyHint)}</text>

      ${desktopIcons}
      ${windowSvgs}
      ${startMenuSvg}
      ${contextMenuSvg}
      ${clickMarkerSvg}

      <!-- Windows 11 Taskbar -->
      <rect x="0" y="1024" width="1920" height="56" fill="rgba(16, 16, 32, 0.92)" />
      <line x1="0" y1="1024" x2="1920" y2="1024" stroke="#33334d" stroke-width="1" />

      <rect x="684" y="1032" width="60" height="40" rx="8" fill="${desk.startMenuOpen ? "#6464fe" : "#262649"}" />
      <text x="714" y="1057" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-size="14" font-weight="700">Win</text>

      <rect x="760" y="1032" width="126" height="40" rx="8" fill="${
        desk.focusedWindow === "blender" || desk.focusedWindow === "cad" ? "#343463" : "#1f1f3a"
      }" />
      <text x="823" y="1057" text-anchor="middle" fill="#f7f7fd" font-family="system-ui, sans-serif" font-size="13">${
        desk.windows.blender ? "Blender 4.3" : "Unreal 5.5"
      }</text>

      <rect x="898" y="1032" width="128" height="40" rx="8" fill="${
        desk.focusedWindow === "terminal" ? "#343463" : "#1f1f3a"
      }" />
      <text x="962" y="1057" text-anchor="middle" fill="#f7f7fd" font-family="system-ui, sans-serif" font-size="13">PowerShell</text>

      <rect x="1038" y="1032" width="128" height="40" rx="8" fill="${
        desk.focusedWindow === "notes" ? "#343463" : "#1f1f3a"
      }" />
      <text x="1102" y="1057" text-anchor="middle" fill="#f7f7fd" font-family="system-ui, sans-serif" font-size="13">Scratchpad</text>

      <!-- Phaze Hosting Indicator in System Tray -->
      <rect x="1520" y="1033" width="212" height="38" rx="19" fill="#1e2248" stroke="#6464fe" />
      <circle cx="1542" cy="1052" r="5" fill="#6bd47a" />
      <text x="1556" y="1057" fill="#f7f7fd" font-family="system-ui, sans-serif" font-size="13">Phaze Host · ${
        conn.guests.length
      } Guest${conn.guests.length > 1 ? "s" : ""}</text>
      <text x="1896" y="1057" text-anchor="end" fill="#cbcbdf" font-family="monospace" font-size="13">${clockStr}</text>
    </svg>`;
  }

  renderSecondaryMonitorSvg(conn, desk) {
    const bars = Array.from({ length: 24 }, (_, idx) => {
      const val = 35 + ((desk.renderFrame * 7 + idx * 19) % 60);
      const h = Math.round((val / 100) * 240);
      return `<rect x="${90 + idx * 32}" y="${420 - h}" width="22" height="${h}" rx="4" fill="#6464fe" opacity="0.88" />`;
    }).join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <rect width="1920" height="1080" fill="#101122"/>
      <text x="60" y="64" fill="#f7f7fd" font-family="system-ui, sans-serif" font-size="26" font-weight="600">${escapeXml(
        conn.host_name
      )} — Display 2: GPU Render &amp; Shader Node Monitor</text>
      <text x="60" y="96" fill="#a3a3c7" font-family="monospace" font-size="15">Secondary Monitor Output #102 · Switched cleanly via Phaze Multi-Monitor HUD</text>

      <rect x="60" y="136" width="860" height="340" rx="16" fill="#181930" stroke="#33334d" />
      <text x="90" y="176" fill="#cbcbdf" font-family="system-ui, sans-serif" font-size="16" font-weight="600">CUDA / OptiX Frame Time &amp; Utilization</text>
      ${bars}

      <rect x="960" y="136" width="900" height="840" rx="16" fill="#181930" stroke="#33334d" />
      <text x="996" y="180" fill="#cbcbdf" font-family="system-ui, sans-serif" font-size="16" font-weight="600">Material &amp; Compositor Graph</text>
      <line x1="1180" y1="330" x2="1420" y2="450" stroke="#7784fc" stroke-width="3" />
      <line x1="1180" y1="590" x2="1420" y2="490" stroke="#6bd47a" stroke-width="3" />
      <line x1="1620" y1="470" x2="1730" y2="470" stroke="#ffc93f" stroke-width="3" />

      <rect x="1010" y="270" width="180" height="120" rx="12" fill="#232447" stroke="#7784fc" />
      <text x="1030" y="305" fill="#f7f7fd" font-family="monospace" font-size="14">PBR Metallic</text>
      <text x="1030" y="335" fill="#a3a3c7" font-family="monospace" font-size="12">Roughness: 0.18</text>

      <rect x="1010" y="530" width="180" height="120" rx="12" fill="#232447" stroke="#6bd47a" />
      <text x="1030" y="565" fill="#f7f7fd" font-family="monospace" font-size="14">HDRI Dome 8K</text>
      <text x="1030" y="595" fill="#a3a3c7" font-family="monospace" font-size="12">Exposure: +1.4 EV</text>

      <rect x="1420" y="400" width="200" height="140" rx="12" fill="#232447" stroke="#ffc93f" />
      <text x="1442" y="438" fill="#f7f7fd" font-family="monospace" font-size="14">Principled BSDF</text>
      <text x="1442" y="468" fill="#6bd47a" font-family="monospace" font-size="12">10-bit 4:4:4 Out</text>

      <rect x="1720" y="420" width="110" height="100" rx="12" fill="#322daa" stroke="#ffffff" />
      <text x="1742" y="475" fill="#ffffff" font-family="monospace" font-size="14">Output</text>

      <rect x="60" y="508" width="860" height="468" rx="16" fill="#181930" stroke="#33334d" />
      <text x="90" y="550" fill="#cbcbdf" font-family="system-ui, sans-serif" font-size="16" font-weight="600">Active Bridge Session Telemetry</text>
      <text x="90" y="594" fill="#6bd47a" font-family="monospace" font-size="15">• Client: Chromebook Web Browser (HTTPS + WebSocket)</text>
      <text x="90" y="628" fill="#cbcbdf" font-family="monospace" font-size="15">• Transport: Phaze Local MCP Bridge (127.0.0.1:41010/mcp)</text>
      <text x="90" y="662" fill="#cbcbdf" font-family="monospace" font-size="15">• Frame Counter: #${desk.renderFrame}</text>
      <text x="90" y="696" fill="#a3a3c7" font-family="monospace" font-size="14">Switch back to Display 1 in the top bar anytime to interact with windows.</text>
    </svg>`;
  }
}
