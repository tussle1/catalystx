#!/usr/bin/env python3
"""
Lightweight POSIX PTY bridge for CatalystX Cloud Desktop.
Spawns a real interactive login/bash shell inside a pseudo-terminal (pty),
supporting ANSI colors, job control (Ctrl+C), REPLs, and dynamic TIOCSWINSZ window resizing.
Communicates with Node.js via newline-delimited JSON with base64 payloads.
"""

import base64
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios


def set_winsize(fd: int, rows: int, cols: int) -> None:
    winsize = struct.pack("HHHH", max(2, rows), max(10, cols), 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def main() -> None:
    cwd = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    cols = int(sys.argv[2]) if len(sys.argv) > 2 else 100
    rows = int(sys.argv[3]) if len(sys.argv) > 3 else 28

    pid, master_fd = pty.fork()
    if pid == 0:
        # Child process inside new session & controlling terminal
        try:
            os.chdir(cwd)
        except OSError:
            pass
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env.setdefault("PS1", r"\[\033[01;34m\]catalystx\[\033[00m\]:\[\033[01;32m\]\w\[\033[00m\]\$ ")
        shell = env.get("SHELL") or "/bin/bash"
        if not os.path.exists(shell):
            shell = "/bin/sh"
        args = [shell, "--norc", "-i"] if shell.endswith("bash") else [shell, "-i"]
        os.execvpe(shell, args, env)

    # Parent bridge loop
    set_winsize(master_fd, rows, cols)
    stdin_fd = sys.stdin.fileno()
    stdin_buf = b""

    try:
        while True:
            rlist, _, _ = select.select([master_fd, stdin_fd], [], [], 1.0)
            if master_fd in rlist:
                try:
                    chunk = os.read(master_fd, 16384)
                except OSError as e:
                    if e.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                emit({"type": "output", "data": base64.b64encode(chunk).decode("ascii")})

            if stdin_fd in rlist:
                in_chunk = os.read(stdin_fd, 16384)
                if not in_chunk:
                    break
                stdin_buf += in_chunk
                while b"\n" in stdin_buf:
                    raw_line, stdin_buf = stdin_buf.split(b"\n", 1)
                    if not raw_line.strip():
                        continue
                    try:
                        cmd = json.loads(raw_line.decode("utf-8"))
                    except Exception:
                        continue
                    msg_type = cmd.get("type")
                    if msg_type == "input":
                        raw_bytes = base64.b64decode(cmd.get("data", ""))
                        if raw_bytes:
                            os.write(master_fd, raw_bytes)
                    elif msg_type == "resize":
                        r = int(cmd.get("rows", 28))
                        c = int(cmd.get("cols", 100))
                        set_winsize(master_fd, r, c)
                        try:
                            os.killpg(os.getpgid(pid), signal.SIGWINCH)
                        except OSError:
                            pass
    finally:
        try:
            os.close(master_fd)
        except OSError:
            pass
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
        try:
            _, status = os.waitpid(pid, 0)
            code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 0
        except OSError:
            code = 0
        emit({"type": "exit", "code": code})


if __name__ == "__main__":
    main()
