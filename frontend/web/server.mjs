import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const root = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = normalize(join(root, "../.."));
const webRoot = normalize(root);
const assetsRoot = normalize(join(repoRoot, "assets"));
const vendorRoot = normalize(join(root, "node_modules"));
const playgroundRoot = normalize(join(repoRoot, "Playground"));
const defaultWorkspaceName = "Default";
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const protocolPrefix = "OHJSON:";
const sessions = new Map();
let server = null;
let serverIdleTimer = null;
let hasCreatedBackendSession = false;
const serverIdleShutdownMs = 5000;
const reservedWorkspaceNames = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};
const artifactPreviewMaxBytes = 8 * 1024 * 1024;
const artifactTypes = {
  ".html": { kind: "html", mime: "text/html; charset=utf-8", encoding: "text" },
  ".htm": { kind: "html", mime: "text/html; charset=utf-8", encoding: "text" },
  ".md": { kind: "text", mime: "text/markdown; charset=utf-8", encoding: "text" },
  ".markdown": { kind: "text", mime: "text/markdown; charset=utf-8", encoding: "text" },
  ".txt": { kind: "text", mime: "text/plain; charset=utf-8", encoding: "text" },
  ".json": { kind: "text", mime: "application/json; charset=utf-8", encoding: "text" },
  ".csv": { kind: "text", mime: "text/csv; charset=utf-8", encoding: "text" },
  ".png": { kind: "image", mime: "image/png", encoding: "base64" },
  ".jpg": { kind: "image", mime: "image/jpeg", encoding: "base64" },
  ".jpeg": { kind: "image", mime: "image/jpeg", encoding: "base64" },
  ".webp": { kind: "image", mime: "image/webp", encoding: "base64" },
  ".svg": { kind: "image", mime: "image/svg+xml", encoding: "base64" },
  ".pdf": { kind: "pdf", mime: "application/pdf", encoding: "base64" },
};
const artifactListSkipDirs = new Set([".git", ".openharness", "node_modules", "__pycache__", ".venv", "venv"]);
const artifactListMaxItems = 300;
const projectFileListMaxItems = 600;
const shellCommandTimeoutMs = 60_000;
const shellOutputMaxChars = 24_000;

function resolvePath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://localhost:${port}`).pathname);
  const relativePath = pathname.replace(/^\/+/, "");
  const filePath =
    pathname === "/"
      ? join(root, "index.html")
      : pathname === "/vendor/marked/marked.esm.js"
        ? join(vendorRoot, "marked/lib/marked.esm.js")
        : pathname === "/vendor/highlight/highlight.min.js"
          ? join(vendorRoot, "@highlightjs/cdn-assets/highlight.min.js")
          : pathname === "/vendor/highlight/github-dark.min.css"
            ? join(vendorRoot, "@highlightjs/cdn-assets/styles/github-dark.min.css")
        : pathname === "/vendor/katex/katex.mjs"
          ? join(vendorRoot, "katex/dist/katex.mjs")
          : pathname === "/vendor/katex/katex.min.css"
            ? join(vendorRoot, "katex/dist/katex.min.css")
            : pathname.startsWith("/vendor/katex/fonts/")
              ? join(vendorRoot, "katex/dist/fonts", pathname.replace("/vendor/katex/fonts/", ""))
      : relativePath.startsWith("assets/")
        ? join(repoRoot, relativePath)
        : join(root, relativePath);
  const normalized = normalize(filePath);

  if (
    normalized !== webRoot &&
    !normalized.startsWith(webRoot) &&
    !normalized.startsWith(assetsRoot) &&
    !normalized.startsWith(vendorRoot)
  ) {
    return null;
  }

  return normalized;
}

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function workspaceRelativeTarget(workspacePath, candidate) {
  const raw = String(candidate || "").trim();
  if (!raw) {
    throw new Error("Artifact path is required");
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !raw.toLowerCase().startsWith("file://")) {
    throw new Error("External URLs cannot be previewed");
  }
  const withoutFileScheme = raw
    .replace(/^file:\/\/\/?/i, "")
    .replace(/^\/([A-Za-z]:\/)/, "$1")
    .replace(/\\/g, "/");
  const target = isAbsolute(withoutFileScheme)
    ? normalize(withoutFileScheme)
    : normalize(join(workspacePath, withoutFileScheme));
  const rel = relative(workspacePath, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Artifact must stay inside the current project");
  }
  return { target, rel };
}

async function readArtifactPreview(session, artifactPath) {
  const { target, rel } = workspaceRelativeTarget(session.workspace.path, artifactPath);
  const ext = extname(target).toLowerCase();
  const type = artifactTypes[ext];
  if (!type) {
    throw new Error("Unsupported artifact type");
  }
  const info = await stat(target);
  if (!info.isFile()) {
    throw new Error("Artifact is not a file");
  }
  if (info.size > artifactPreviewMaxBytes) {
    throw new Error("Artifact is too large to preview");
  }
  const body = await readFile(target);
  const payload = {
    path: rel,
    name: rel.split(/[\\/]/).pop() || rel,
    kind: type.kind,
    mime: type.mime,
    size: info.size,
  };
  if (type.encoding === "base64") {
    payload.dataUrl = `data:${type.mime};base64,${body.toString("base64")}`;
  } else {
    payload.content = body.toString("utf8");
  }
  return payload;
}

async function readArtifactMetadata(session, artifactPath) {
  const { target, rel } = workspaceRelativeTarget(session.workspace.path, artifactPath);
  const ext = extname(target).toLowerCase();
  const type = artifactTypes[ext];
  if (!type) {
    throw new Error("Unsupported artifact type");
  }
  const info = await stat(target);
  if (!info.isFile()) {
    throw new Error("Artifact is not a file");
  }
  return {
    path: rel,
    name: rel.split(/[\\/]/).pop() || rel,
    kind: type.kind,
    mime: type.mime,
    size: info.size,
  };
}

async function artifactDownloadTarget(session, artifactPath) {
  const { target, rel } = workspaceRelativeTarget(session.workspace.path, artifactPath);
  const info = await stat(target);
  if (!info.isFile()) {
    throw new Error("Artifact is not a file");
  }
  const ext = extname(target).toLowerCase();
  const type = artifactTypes[ext] || { mime: "application/octet-stream" };
  return {
    target,
    rel,
    name: rel.split(/[\\/]/).pop() || "download",
    mime: type.mime || "application/octet-stream",
    size: info.size,
  };
}

async function listProjectArtifacts(session) {
  const files = [];
  async function walk(directory) {
    if (files.length >= artifactListMaxItems) {
      return;
    }
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= artifactListMaxItems) {
        return;
      }
      if (entry.isDirectory()) {
        if (!artifactListSkipDirs.has(entry.name)) {
          await walk(join(directory, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const ext = extname(entry.name).toLowerCase();
      const type = artifactTypes[ext];
      if (!type) {
        continue;
      }
      const target = join(directory, entry.name);
      const rel = relative(session.workspace.path, target);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
        continue;
      }
      const info = await stat(target);
      files.push({
        path: rel,
        name: entry.name,
        kind: type.kind,
        mime: type.mime,
        size: info.size,
      });
    }
  }
  await walk(session.workspace.path);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

async function listProjectFiles(session) {
  const files = [];
  async function walk(directory) {
    if (files.length >= projectFileListMaxItems) {
      return;
    }
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= projectFileListMaxItems) {
        return;
      }
      if (entry.isDirectory()) {
        if (!artifactListSkipDirs.has(entry.name)) {
          await walk(join(directory, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const target = join(directory, entry.name);
      const rel = relative(session.workspace.path, target);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
        continue;
      }
      const info = await stat(target);
      const ext = extname(entry.name).toLowerCase();
      const type = artifactTypes[ext] || { kind: "file", mime: "application/octet-stream" };
      files.push({
        path: rel,
        name: entry.name,
        kind: type.kind,
        mime: type.mime,
        size: info.size,
      });
    }
  }
  await walk(session.workspace.path);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

function validateWorkspaceName(value) {
  const name = normalizeWorkspaceName(value);
  if (!name) {
    return { ok: false, error: "Project name is required" };
  }
  if (name === "." || name === ".." || name.length > 80) {
    return { ok: false, error: "Invalid project name" };
  }
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) {
    return { ok: false, error: "Project name contains invalid Windows path characters" };
  }
  if (reservedWorkspaceNames.has(name.toUpperCase())) {
    return { ok: false, error: "Project name is reserved on Windows" };
  }
  return { ok: true, name };
}

function normalizeWorkspaceName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_");
}

function workspacePathFromName(name) {
  const validation = validateWorkspaceName(name);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const workspacePath = normalize(join(playgroundRoot, validation.name));
  const rel = relative(playgroundRoot, workspacePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Workspace path must stay inside Playground");
  }
  return { name: validation.name, path: workspacePath };
}

function workspaceFromDirectoryName(name) {
  const displayName = String(name || "").trim();
  if (!displayName) {
    throw new Error("Project name is required");
  }
  if (/[<>:"/\\|?*\x00-\x1f]/.test(displayName) || /[. ]$/.test(displayName)) {
    throw new Error("Project name contains invalid Windows path characters");
  }
  if (reservedWorkspaceNames.has(displayName.toUpperCase())) {
    throw new Error("Project name is reserved on Windows");
  }
  const workspacePath = normalize(join(playgroundRoot, displayName));
  const rel = relative(playgroundRoot, workspacePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.includes("\\") || rel.includes("/")) {
    throw new Error("Workspace path must stay inside Playground");
  }
  return { name: displayName, path: workspacePath };
}

function workspaceFromPath(candidate) {
  const workspacePath = normalize(String(candidate || ""));
  const rel = relative(playgroundRoot, workspacePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.includes("\\") || rel.includes("/")) {
    throw new Error("Workspace cwd must be a direct Playground child");
  }
  return workspaceFromDirectoryName(rel);
}

async function ensureWorkspace(name = defaultWorkspaceName) {
  const workspace = workspacePathFromName(name);
  await mkdir(playgroundRoot, { recursive: true });
  await mkdir(workspace.path, { recursive: true });
  return workspace;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deleteWorkspace(name) {
  const workspace = workspacePathFromName(name);
  const activeSession = [...sessions.values()].find(
    (session) => session.workspace?.path === workspace.path && !session.shuttingDown
  );
  if (activeSession) {
    throw new Error("Cannot delete a project while it has an active session");
  }
  const retryableCodes = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
  const delays = [0, 120, 300, 700, 1200];
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) {
      await sleep(delays[attempt]);
    }
    try {
      await rm(workspace.path, { recursive: true, force: true });
      return workspace;
    } catch (error) {
      if (attempt === delays.length - 1 || !retryableCodes.has(error?.code)) {
        throw error;
      }
    }
  }
  return workspace;
}

async function listWorkspaces() {
  await mkdir(playgroundRoot, { recursive: true });
  const entries = await readdir(playgroundRoot, { withFileTypes: true });
  const directories = (
    await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
      try {
        const workspace = workspaceFromDirectoryName(entry.name);
        const info = await stat(workspace.path);
        return { ...workspace, createdAt: info.birthtimeMs || info.ctimeMs || 0 };
      } catch {
        return null;
      }
    }))
  )
    .filter(Boolean)
    .sort((left, right) => {
      const byCreated = left.createdAt - right.createdAt;
      return byCreated || left.name.localeCompare(right.name);
    })
    .map(({ createdAt, ...workspace }) => workspace);
  if (!directories.length) {
    return [await ensureWorkspace(defaultWorkspaceName)];
  }
  return directories;
}

async function resolveSessionWorkspace(options = {}) {
  if (options.cwd) {
    const workspace = workspaceFromPath(options.cwd);
    try {
      const info = await stat(workspace.path);
      if (info.isDirectory()) {
        return workspace;
      }
    } catch {
      return ensureWorkspace(defaultWorkspaceName);
    }
    return workspace;
  }
  return ensureWorkspace(defaultWorkspaceName);
}

function sendBackend(session, payload) {
  if (!session.process || session.process.killed || session.process.stdin.destroyed) {
    return false;
  }
  session.process.stdin.write(`${JSON.stringify(payload)}\n`);
  return true;
}

function trimShellOutput(value) {
  const text = String(value || "");
  if (text.length <= shellOutputMaxChars) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, shellOutputMaxChars)}\n\n[output truncated]`,
    truncated: true,
  };
}

function shellCommandForPlatform(command) {
  if (process.platform === "win32") {
    return {
      file: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; ${command}`,
      ],
    };
  }
  return {
    file: process.env.SHELL || "/bin/sh",
    args: ["-lc", command],
  };
}

async function runShellCommand(options = {}) {
  const command = String(options.command || "").trim();
  if (!command) {
    throw new Error("Command is required");
  }
  const workspace = options.cwd
    ? workspaceFromPath(options.cwd)
    : options.session?.workspace || await ensureWorkspace(defaultWorkspaceName);
  const { file, args } = shellCommandForPlatform(command);
  return await new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: workspace.path,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, shellCommandTimeoutMs);
    timer.unref?.();

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        command,
        cwd: workspace.path,
        exitCode: 1,
        stdout: "",
        stderr: error.message,
        timedOut: false,
        truncated: false,
      });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      const trimmedStdout = trimShellOutput(stdout);
      const trimmedStderr = trimShellOutput(stderr);
      resolve({
        command,
        cwd: workspace.path,
        exitCode: timedOut ? null : code ?? 0,
        stdout: trimmedStdout.text,
        stderr: trimmedStderr.text,
        timedOut,
        truncated: trimmedStdout.truncated || trimmedStderr.truncated,
      });
    });
  });
}

async function streamShellCommand(options = {}, request, response) {
  const command = String(options.command || "").trim();
  if (!command) {
    throw new Error("Command is required");
  }
  const workspace = options.cwd
    ? workspaceFromPath(options.cwd)
    : options.session?.workspace || await ensureWorkspace(defaultWorkspaceName);
  const { file, args } = shellCommandForPlatform(command);

  response.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders?.();

  let outputChars = 0;
  let truncated = false;
  let timedOut = false;
  let finished = false;

  const writeEvent = (event) => {
    if (!response.writableEnded && !response.destroyed) {
      response.write(`${JSON.stringify(event)}\n`);
    }
  };

  const writeText = (type, chunk) => {
    if (truncated) {
      return;
    }
    const text = chunk.toString("utf8");
    const remaining = shellOutputMaxChars - outputChars;
    if (remaining <= 0) {
      truncated = true;
      writeEvent({ type: "truncated" });
      return;
    }
    const visible = text.length > remaining ? text.slice(0, remaining) : text;
    outputChars += visible.length;
    if (visible) {
      writeEvent({ type, text: visible });
    }
    if (text.length > remaining) {
      truncated = true;
      writeEvent({ type: "truncated" });
    }
  };

  const child = spawn(file, args, {
    cwd: workspace.path,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });

  const finish = (event) => {
    if (finished) {
      return;
    }
    finished = true;
    clearTimeout(timer);
    writeEvent({ ...event, truncated });
    response.end();
  };

  const timer = setTimeout(() => {
    timedOut = true;
    killProcessTree(child);
  }, shellCommandTimeoutMs);
  timer.unref?.();

  response.on("close", () => {
    if (!finished) {
      killProcessTree(child);
    }
  });

  writeEvent({ type: "start", command, cwd: workspace.path });
  child.stdout.on("data", (chunk) => writeText("stdout", chunk));
  child.stderr.on("data", (chunk) => writeText("stderr", chunk));
  child.on("error", (error) => {
    writeEvent({ type: "stderr", text: error.message });
    finish({ type: "exit", exitCode: 1, timedOut: false });
  });
  child.on("exit", (code) => {
    finish({ type: "exit", exitCode: timedOut ? null : code ?? 0, timedOut });
  });
}

function normalizeAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") {
    return null;
  }
  const mediaType = String(attachment.media_type || attachment.mediaType || "").trim();
  const data = String(attachment.data || "").trim();
  if (!mediaType || !data) {
    return null;
  }
  return {
    media_type: mediaType,
    data,
    name: String(attachment.name || ""),
  };
}

function emit(session, event) {
  session.events.push(event);
  if (session.events.length > 400) {
    session.events.splice(0, session.events.length - 400);
  }
  for (const client of session.clients) {
    client.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

function shouldReplayEvent(event) {
  const type = String(event?.type || "");
  return !["modal_request", "select_request"].includes(type);
}

function killProcessTree(child) {
  if (!child || child.killed || !child.pid) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // Process already exited.
  }
}

function shutdownSession(session, reason = "shutdown") {
  if (!session || session.shuttingDown) {
    return;
  }
  session.shuttingDown = true;
  if (session.clientCloseTimer) {
    clearTimeout(session.clientCloseTimer);
    session.clientCloseTimer = null;
  }
  sendBackend(session, { type: "shutdown", reason });
  try {
    session.process.stdin.end();
  } catch {
    // stdin may already be closed.
  }
  session.forceKillTimer = setTimeout(() => {
    killProcessTree(session.process);
  }, 1200);
  session.forceKillTimer.unref?.();
}

function shutdownAllSessions(reason = "server shutdown") {
  for (const session of sessions.values()) {
    shutdownSession(session, reason);
  }
}

function cancelServerIdleShutdown() {
  if (serverIdleTimer) {
    clearTimeout(serverIdleTimer);
    serverIdleTimer = null;
  }
}

function scheduleServerIdleShutdown() {
  if (!hasCreatedBackendSession || sessions.size > 0 || serverIdleTimer) {
    return;
  }
  serverIdleTimer = setTimeout(() => {
    serverIdleTimer = null;
    if (sessions.size === 0) {
      stopServer("idle");
    }
  }, serverIdleShutdownMs);
  serverIdleTimer.unref?.();
}

function scheduleClientlessShutdown(session) {
  if (!session || session.shuttingDown || session.clients.size > 0) {
    return;
  }
  if (session.clientCloseTimer) {
    clearTimeout(session.clientCloseTimer);
  }
  session.clientCloseTimer = setTimeout(() => {
    session.clientCloseTimer = null;
    if (session.clients.size === 0) {
      shutdownSession(session, "browser disconnected");
    }
  }, 2500);
  session.clientCloseTimer.unref?.();
}

function getLanUrl() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal && !address.address.startsWith("169.254.")) {
        return `http://${address.address}:${port}`;
      }
    }
  }
  return "";
}

async function createBackendSession(options = {}) {
  const id = crypto.randomUUID();
  const workspace = await resolveSessionWorkspace(options);
  const clientId = String(options.clientId || "").trim();
  if (clientId && countBusySessionsForClient(clientId) >= 3) {
    throw new Error("Concurrent response limit reached");
  }
  const args = ["-3", "-m", "openharness", "--backend-only", "--cwd", workspace.path];
  const env = {
    ...process.env,
    PYTHONPATH: [join(repoRoot, "src"), process.env.PYTHONPATH].filter(Boolean).join(";"),
  };

  if (options.permissionMode) {
    args.push("--permission-mode", options.permissionMode);
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.systemPrompt) {
    args.push("--system-prompt", String(options.systemPrompt));
  }

  const child = spawn("py", args, {
    cwd: repoRoot,
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const session = {
    id,
    process: child,
    clients: new Set(),
    events: [],
    createdAt: Date.now(),
    workspace,
    clientId,
    busy: false,
    savedSessionId: "",
    shuttingDown: false,
    clientCloseTimer: null,
    forceKillTimer: null,
  };
  sessions.set(id, session);
  hasCreatedBackendSession = true;
  cancelServerIdleShutdown();
  scheduleClientlessShutdown(session);

  emit(session, {
    type: "web_session",
    session_id: id,
    message: "Starting MyHarness backend...",
    workspace,
  });

  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    if (!line.startsWith(protocolPrefix)) {
      emit(session, { type: "transcript_item", item: { role: "log", text: line } });
      return;
    }
    try {
      const event = JSON.parse(line.slice(protocolPrefix.length));
      updateSessionStateFromBackendEvent(session, event);
      emit(session, event);
    } catch (error) {
      emit(session, { type: "error", message: `Could not parse backend event: ${error.message}` });
    }
  });

  readline.createInterface({ input: child.stderr }).on("line", (line) => {
    emit(session, { type: "transcript_item", item: { role: "log", text: line } });
  });

  child.on("error", (error) => {
    emit(session, { type: "error", message: `Failed to start backend: ${error.message}` });
  });

  child.on("exit", (code) => {
    if (session.forceKillTimer) {
      clearTimeout(session.forceKillTimer);
      session.forceKillTimer = null;
    }
    if (session.clientCloseTimer) {
      clearTimeout(session.clientCloseTimer);
      session.clientCloseTimer = null;
    }
    emit(session, { type: "shutdown", code, message: `Backend exited with code ${code ?? 0}` });
    sessions.delete(id);
    scheduleServerIdleShutdown();
  });

  return session;
}

function countBusySessionsForClient(clientId) {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.clientId === clientId && session.busy && !session.shuttingDown) {
      count += 1;
    }
  }
  return count;
}

function updateSessionStateFromBackendEvent(session, event) {
  if (!event || typeof event !== "object") {
    return;
  }
  if (event.type === "active_session") {
    session.savedSessionId = String(event.value || "").trim();
  }
  if (event.type === "line_complete" || event.type === "error" || event.type === "shutdown") {
    session.busy = false;
  }
}

function liveSessionPayload(session) {
  return {
    sessionId: session.id,
    savedSessionId: session.savedSessionId || "",
    workspace: session.workspace,
    busy: Boolean(session.busy),
    createdAt: session.createdAt,
  };
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/workspaces") {
    const workspaces = await listWorkspaces();
    json(response, 200, { root: playgroundRoot, workspaces });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/workspaces") {
    try {
      const body = await readJson(request);
      const workspace = await ensureWorkspace(body.name);
      const workspaces = await listWorkspaces();
      json(response, 200, { workspace, workspaces });
    } catch (error) {
      json(response, 400, { error: error.message || "Invalid workspace" });
    }
    return true;
  }

  if (request.method === "DELETE" && pathname === "/api/workspaces") {
    try {
      const body = await readJson(request);
      const workspace = await deleteWorkspace(body.name);
      const workspaces = await listWorkspaces();
      json(response, 200, { deleted: workspace, workspaces });
    } catch (error) {
      json(response, 400, { error: error.message || "Could not delete workspace" });
    }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/session") {
    try {
      const options = await readJson(request);
      const session = await createBackendSession(options);
      json(response, 200, { sessionId: session.id, workspace: session.workspace });
    } catch (error) {
      json(response, 400, { error: error.message || "Could not start session" });
    }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/live-sessions") {
    const searchParams = new URL(request.url, `http://localhost:${port}`).searchParams;
    const clientId = searchParams.get("clientId") || "";
    const workspacePath = searchParams.get("workspacePath") || "";
    const liveSessions = [...sessions.values()]
      .filter((session) => session.clientId && session.clientId === clientId && !session.shuttingDown)
      .filter((session) => !workspacePath || session.workspace?.path === workspacePath)
      .map(liveSessionPayload)
      .sort((left, right) => left.createdAt - right.createdAt);
    json(response, 200, { sessions: liveSessions });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/events") {
    const id = new URL(request.url, `http://localhost:${port}`).searchParams.get("session");
    const session = sessions.get(id);
    if (!session) {
      json(response, 404, { error: "Unknown session" });
      return true;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    session.clients.add(response);
    if (session.clientCloseTimer) {
      clearTimeout(session.clientCloseTimer);
      session.clientCloseTimer = null;
    }
    for (const event of session.events.filter(shouldReplayEvent)) {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    request.on("close", () => {
      session.clients.delete(response);
      scheduleClientlessShutdown(session);
    });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/artifact") {
    const params = new URL(request.url, `http://localhost:${port}`).searchParams;
    const session = sessions.get(params.get("session"));
    if (!session) {
      json(response, 404, { error: "Unknown session" });
      return true;
    }
    try {
      const payload = await readArtifactPreview(session, params.get("path"));
      json(response, 200, payload);
    } catch (error) {
      json(response, 400, { error: error.message || "Could not preview artifact" });
    }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/artifact/resolve") {
    const params = new URL(request.url, `http://localhost:${port}`).searchParams;
    const session = sessions.get(params.get("session"));
    if (!session) {
      json(response, 404, { error: "Unknown session" });
      return true;
    }
    try {
      const payload = await readArtifactMetadata(session, params.get("path"));
      json(response, 200, payload);
    } catch (error) {
      json(response, 404, { error: error.message || "Artifact not found" });
    }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/artifact/download") {
    const params = new URL(request.url, `http://localhost:${port}`).searchParams;
    const session = sessions.get(params.get("session"));
    if (!session) {
      json(response, 404, { error: "Unknown session" });
      return true;
    }
    try {
      const payload = await artifactDownloadTarget(session, params.get("path"));
      const encodedName = encodeURIComponent(payload.name).replace(/['()]/g, escape).replace(/\*/g, "%2A");
      response.writeHead(200, {
        "Content-Type": payload.mime,
        "Content-Length": String(payload.size),
        "Content-Disposition": `attachment; filename="${payload.name.replace(/["\\]/g, "_")}"; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "no-store",
      });
      createReadStream(payload.target).pipe(response);
    } catch (error) {
      json(response, 400, { error: error.message || "Could not download artifact" });
    }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/artifacts") {
    const params = new URL(request.url, `http://localhost:${port}`).searchParams;
    const session = sessions.get(params.get("session"));
    if (!session) {
      json(response, 404, { error: "Unknown session" });
      return true;
    }
    try {
      json(response, 200, {
        workspace: session.workspace,
        files: await listProjectArtifacts(session),
      });
    } catch (error) {
      json(response, 400, { error: error.message || "Could not list project files" });
    }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/project-files") {
    const params = new URL(request.url, `http://localhost:${port}`).searchParams;
    const session = sessions.get(params.get("session"));
    if (!session) {
      json(response, 404, { error: "Unknown session" });
      return true;
    }
    try {
      json(response, 200, {
        workspace: session.workspace,
        files: await listProjectFiles(session),
      });
    } catch (error) {
      json(response, 400, { error: error.message || "Could not list project files" });
    }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/message") {
    const body = await readJson(request);
    const session = sessions.get(body.sessionId);
    if (!session) {
      json(response, 404, { error: "Unknown session" });
      return true;
    }
    const line = String(body.line || "").trim();
    const attachments = Array.isArray(body.attachments)
      ? body.attachments.map(normalizeAttachment).filter(Boolean)
      : [];
    if (!line && attachments.length === 0) {
      json(response, 400, { error: "Message is empty" });
      return true;
    }
    if (session.busy) {
      json(response, 409, { error: "Session is already busy" });
      return true;
    }
    if (session.clientId && countBusySessionsForClient(session.clientId) >= 3) {
      json(response, 429, { error: "Concurrent response limit reached" });
      return true;
    }
    session.busy = true;
    const ok = sendBackend(session, { type: "submit_line", line, attachments });
    if (!ok) {
      session.busy = false;
    }
    json(response, ok ? 200 : 409, { ok });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/shell") {
    try {
      const body = await readJson(request);
      const session = body.sessionId ? sessions.get(body.sessionId) : null;
      const result = await runShellCommand({
        command: body.command,
        cwd: body.cwd,
        session,
      });
      json(response, 200, result);
    } catch (error) {
      json(response, 400, { error: error.message || "Could not run command" });
    }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/shell/stream") {
    try {
      const body = await readJson(request);
      const session = body.sessionId ? sessions.get(body.sessionId) : null;
      await streamShellCommand({
        command: body.command,
        cwd: body.cwd,
        session,
      }, request, response);
    } catch (error) {
      if (!response.headersSent) {
        json(response, 400, { error: error.message || "Could not run command" });
      } else if (!response.writableEnded) {
        response.end();
      }
    }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/respond") {
    const body = await readJson(request);
    const session = sessions.get(body.sessionId);
    if (!session) {
      json(response, 404, { error: "Unknown session" });
      return true;
    }
    const ok = sendBackend(session, body.payload || {});
    json(response, ok ? 200 : 409, { ok });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/cancel") {
    const body = await readJson(request);
    const session = sessions.get(body.sessionId);
    if (!session) {
      json(response, 404, { error: "Unknown session" });
      return true;
    }
    const ok = sendBackend(session, { type: "cancel_current" });
    json(response, ok ? 200 : 409, { ok });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/shutdown") {
    const body = await readJson(request);
    const session = sessions.get(body.sessionId);
    if (session) {
      shutdownSession(session, "api shutdown");
    }
    json(response, 200, { ok: true });
    return true;
  }

  return false;
}

server = createServer(async (request, response) => {
  const pathname = new URL(request.url || "/", `http://localhost:${port}`).pathname;
  if (pathname.startsWith("/api/") && (await handleApi(request, response, pathname))) {
    return;
  }

  const filePath = resolvePath(request.url || "/");

  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": types[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

function stopServer(signal = "shutdown") {
  shutdownAllSessions(signal);
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1500).unref?.();
}

process.once("SIGINT", () => stopServer("SIGINT"));
process.once("SIGTERM", () => stopServer("SIGTERM"));
process.once("SIGHUP", () => stopServer("SIGHUP"));
process.once("exit", () => {
  shutdownAllSessions("process exit");
});

server.listen(port, host, () => {
  const localUrl = `http://localhost:${port}`;
  const lanUrl = getLanUrl();
  if (host === "0.0.0.0" || host === "::") {
    console.log(`Listening on all network interfaces.`);
  }
  console.log("");
  console.log("MyHarness web is ready:");
  console.log(`  ${localUrl}`);
  if (lanUrl) {
    console.log(`  ${lanUrl}`);
  }
});
