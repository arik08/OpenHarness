import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, extname, isAbsolute, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { countTokens } from "gpt-tokenizer";

const root = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = normalize(join(root, "../.."));
const webRoot = normalize(root);
const assetsRoot = normalize(join(repoRoot, "assets"));
const vendorRoot = normalize(join(root, "node_modules"));
const playgroundRoot = normalize(join(repoRoot, "Playground"));
const appConfigRoot = normalize(join(repoRoot, ".openharness"));
if (!String(process.env.OPENHARNESS_CONFIG_DIR || "").trim()) {
  process.env.OPENHARNESS_CONFIG_DIR = appConfigRoot;
}
if (!String(process.env.OPENHARNESS_DATA_DIR || "").trim()) {
  process.env.OPENHARNESS_DATA_DIR = join(appConfigRoot, "data");
}
if (!String(process.env.OPENHARNESS_LOGS_DIR || "").trim()) {
  process.env.OPENHARNESS_LOGS_DIR = join(appConfigRoot, "logs");
}
if (!String(process.env.OPENHARNESS_HOME || "").trim()) {
  process.env.OPENHARNESS_HOME = appConfigRoot;
}
configurePoscoCertificate();
const sharedWorkspaceScopeName = "shared";
const defaultWorkspaceName = "Default";
const projectPreferencesRel = join(".openharness", "preferences.json");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
let workspaceScopeMode = normalizeWorkspaceScopeMode(process.env.OPENHARNESS_WORKSPACE_SCOPE);
let shellPreference = normalizeShellPreference(process.env.OPENHARNESS_SHELL);
const protocolPrefix = "OHJSON:";
const sessions = new Map();
let server = null;
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
const chatHtmlPreviewMaxBytes = 2 * 1024 * 1024;
const chatHtmlPreviewTtlMs = 10 * 60 * 1000;
const chatHtmlPreviews = new Map();
const artifactTypes = {
  ".html": { kind: "html", mime: "text/html; charset=utf-8", encoding: "text" },
  ".htm": { kind: "html", mime: "text/html; charset=utf-8", encoding: "text" },
  ".md": { kind: "text", mime: "text/markdown; charset=utf-8", encoding: "text" },
  ".markdown": { kind: "text", mime: "text/markdown; charset=utf-8", encoding: "text" },
  ".txt": { kind: "text", mime: "text/plain; charset=utf-8", encoding: "text" },
  ".json": { kind: "text", mime: "application/json; charset=utf-8", encoding: "text" },
  ".csv": { kind: "text", mime: "text/csv; charset=utf-8", encoding: "text" },
  ".xml": { kind: "text", mime: "application/xml; charset=utf-8", encoding: "text" },
  ".yaml": { kind: "text", mime: "text/yaml; charset=utf-8", encoding: "text" },
  ".yml": { kind: "text", mime: "text/yaml; charset=utf-8", encoding: "text" },
  ".toml": { kind: "text", mime: "text/plain; charset=utf-8", encoding: "text" },
  ".ini": { kind: "text", mime: "text/plain; charset=utf-8", encoding: "text" },
  ".log": { kind: "text", mime: "text/plain; charset=utf-8", encoding: "text" },
  ".py": { kind: "text", mime: "text/x-python; charset=utf-8", encoding: "text" },
  ".js": { kind: "text", mime: "text/javascript; charset=utf-8", encoding: "text" },
  ".mjs": { kind: "text", mime: "text/javascript; charset=utf-8", encoding: "text" },
  ".cjs": { kind: "text", mime: "text/javascript; charset=utf-8", encoding: "text" },
  ".ts": { kind: "text", mime: "text/typescript; charset=utf-8", encoding: "text" },
  ".tsx": { kind: "text", mime: "text/typescript; charset=utf-8", encoding: "text" },
  ".jsx": { kind: "text", mime: "text/javascript; charset=utf-8", encoding: "text" },
  ".css": { kind: "text", mime: "text/css; charset=utf-8", encoding: "text" },
  ".sql": { kind: "text", mime: "application/sql; charset=utf-8", encoding: "text" },
  ".sh": { kind: "text", mime: "text/x-shellscript; charset=utf-8", encoding: "text" },
  ".ps1": { kind: "text", mime: "text/plain; charset=utf-8", encoding: "text" },
  ".bat": { kind: "text", mime: "text/plain; charset=utf-8", encoding: "text" },
  ".cmd": { kind: "text", mime: "text/plain; charset=utf-8", encoding: "text" },
  ".png": { kind: "image", mime: "image/png", encoding: "base64" },
  ".gif": { kind: "image", mime: "image/gif", encoding: "base64" },
  ".jpg": { kind: "image", mime: "image/jpeg", encoding: "base64" },
  ".jpeg": { kind: "image", mime: "image/jpeg", encoding: "base64" },
  ".webp": { kind: "image", mime: "image/webp", encoding: "base64" },
  ".svg": { kind: "image", mime: "image/svg+xml", encoding: "base64" },
  ".pdf": { kind: "pdf", mime: "application/pdf", encoding: "base64" },
  ".doc": { kind: "file", mime: "application/msword", encoding: "binary" },
  ".docx": { kind: "file", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", encoding: "binary" },
  ".xls": { kind: "file", mime: "application/vnd.ms-excel", encoding: "binary" },
  ".xlsx": { kind: "file", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", encoding: "binary" },
  ".ppt": { kind: "file", mime: "application/vnd.ms-powerpoint", encoding: "binary" },
  ".pptx": { kind: "file", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", encoding: "binary" },
  ".zip": { kind: "file", mime: "application/zip", encoding: "binary" },
};
const artifactListSkipDirs = new Set([".git", ".openharness", "node_modules", "__pycache__", ".venv", "venv"]);
const artifactListMaxItems = 300;
const projectFileListMaxItems = 600;
const projectFileListSkipPrefixes = [
  "autopilot-dashboard/",
  "docs/autopilot/",
];
const shellCommandTimeoutMs = 60_000;
const shellOutputMaxChars = 24_000;
const tokenCountMaxChars = 200_000;

function normalizeWorkspaceScopeMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return mode === "ip" || mode === "client_ip" || mode === "client-ip" ? "ip" : "shared";
}

function normalizeShellPreference(value) {
  const normalized = String(value || "auto").trim().toLowerCase().replace(/_/g, "-");
  if (["pwsh", "powershell", "powershell.exe", "power-shell"].includes(normalized)) {
    return "powershell";
  }
  if (["gitbash", "git-bash", "bash"].includes(normalized)) {
    return "git-bash";
  }
  if (["cmd", "cmd.exe", "command-prompt"].includes(normalized)) {
    return "cmd";
  }
  return "auto";
}

function configurePoscoCertificate() {
  if (process.platform !== "win32") {
    return;
  }
  const certPath = "C:\\POSCO.crt";
  if (!existsSync(certPath)) {
    return;
  }
  process.env.SSL_CERT_FILE = certPath;
  process.env.REQUESTS_CA_BUNDLE = certPath;
  process.env.CURL_CA_BUNDLE = certPath;
  process.env.PIP_CERT = certPath;
  process.env.NODE_EXTRA_CA_CERTS = process.env.NODE_EXTRA_CA_CERTS || certPath;
  process.env.npm_config_cafile = process.env.npm_config_cafile || certPath;
}

function forwardedAddressFromRequest(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(request.socket?.remoteAddress || "");
}

function normalizeClientAddress(value) {
  let address = String(value || "").trim();
  if (!address) {
    return "127.0.0.1";
  }
  if (address.startsWith("::ffff:")) {
    address = address.slice("::ffff:".length);
  }
  if (address === "::1") {
    return "127.0.0.1";
  }
  return address.replace(/^\[|\]$/g, "");
}

function safeWorkspaceScopeName(value) {
  const name = normalizeClientAddress(value).replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_");
  return name || "127.0.0.1";
}

function workspaceScopeFromRequest(request) {
  const name = workspaceScopeMode === "ip"
    ? safeWorkspaceScopeName(forwardedAddressFromRequest(request))
    : sharedWorkspaceScopeName;
  const scopeRoot = normalize(join(playgroundRoot, name));
  const rel = relative(playgroundRoot, scopeRoot);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.includes("\\") || rel.includes("/")) {
    throw new Error("Workspace scope must stay directly inside Playground");
  }
  return { mode: workspaceScopeMode, name, root: scopeRoot };
}

function defaultWorkspaceScope() {
  const scopeRoot = normalize(join(playgroundRoot, sharedWorkspaceScopeName));
  return { mode: "shared", name: sharedWorkspaceScopeName, root: scopeRoot };
}

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

function pruneChatHtmlPreviews() {
  const now = Date.now();
  for (const [id, preview] of chatHtmlPreviews) {
    if (preview.expiresAt <= now) {
      chatHtmlPreviews.delete(id);
    }
  }
}

const chatHtmlPreviewAutosizeScript = `<script>
(function () {
  function visibleElementHeight() {
    var minTop = Infinity;
    var maxBottom = 0;
    var elements = document.body ? document.body.querySelectorAll("*") : [];
    for (var i = 0; i < elements.length; i += 1) {
      var element = elements[i];
      if (/^(script|style|link|meta)$/i.test(element.tagName)) {
        continue;
      }
      var style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") {
        continue;
      }
      var rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        continue;
      }
      var fillsViewport = element.children.length > 0
        && rect.top <= 1
        && rect.height >= window.innerHeight - 2;
      if (fillsViewport) {
        continue;
      }
      minTop = Math.min(minTop, rect.top);
      maxBottom = Math.max(maxBottom, rect.bottom);
    }
    if (!Number.isFinite(minTop) || maxBottom <= 0) {
      return 0;
    }
    var bodyStyle = document.body ? getComputedStyle(document.body) : null;
    var bottomSpace = bodyStyle
      ? (parseFloat(bodyStyle.marginBottom) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0)
      : 0;
    return Math.ceil(maxBottom + window.scrollY + bottomSpace);
  }
  function height() {
    var body = document.body;
    var doc = document.documentElement;
    var visibleHeight = visibleElementHeight();
    if (visibleHeight > 0) {
      return visibleHeight;
    }
    return Math.ceil(Math.max(
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      doc ? doc.scrollHeight : 0,
      doc ? doc.offsetHeight : 0
    ));
  }
  function send() {
    var token = "";
    try {
      token = new URLSearchParams(location.search).get("ohPreviewToken") || window.name;
    } catch (error) {
      token = window.name;
    }
    parent.postMessage({
      type: "openharness-html-preview-size",
      token: token,
      height: height()
    }, "*");
  }
  window.addEventListener("load", send);
  window.addEventListener("resize", send);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", send);
  } else {
    send();
  }
  if (window.ResizeObserver) {
    new ResizeObserver(send).observe(document.documentElement);
  }
  if (window.MutationObserver) {
    new MutationObserver(send).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
  }
})();
<\/script>`;

function injectChatHtmlPreviewAutosize(content) {
  const value = String(content || "");
  if (/<\/body\s*>/i.test(value)) {
    return value.replace(/<\/body\s*>/i, `${chatHtmlPreviewAutosizeScript}</body>`);
  }
  if (/<\/html\s*>/i.test(value)) {
    return value.replace(/<\/html\s*>/i, `${chatHtmlPreviewAutosizeScript}</html>`);
  }
  return `${value}${chatHtmlPreviewAutosizeScript}`;
}

function wrapChatHtmlPreview(content) {
  const value = String(content || "");
  if (/^\s*(?:<!doctype\s+html|<html[\s>])/i.test(value)) {
    return injectChatHtmlPreviewAutosize(value);
  }
  return injectChatHtmlPreviewAutosize(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>${value}</body>
</html>`);
}

function storeChatHtmlPreview(content) {
  const value = String(content || "");
  if (Buffer.byteLength(value, "utf8") > chatHtmlPreviewMaxBytes) {
    throw new Error("HTML preview is too large");
  }
  pruneChatHtmlPreviews();
  const id = crypto.randomUUID();
  chatHtmlPreviews.set(id, {
    content: wrapChatHtmlPreview(value),
    expiresAt: Date.now() + chatHtmlPreviewTtlMs,
  });
  return id;
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
  if (type.encoding !== "binary" && info.size > artifactPreviewMaxBytes) {
    throw new Error("Artifact is too large to preview");
  }
  const payload = {
    path: rel,
    name: rel.split(/[\\/]/).pop() || rel,
    kind: type.kind,
    mime: type.mime,
    size: info.size,
  };
  if (type.encoding === "binary") {
    return payload;
  }
  const body = await readFile(target);
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
    mtimeMs: info.mtimeMs,
    birthtimeMs: info.birthtimeMs,
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

function asciiHeaderFilename(name) {
  const safe = String(name || "download")
    .replace(/[\x00-\x1f\x7f"\\]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_")
    .trim();
  return safe || "download";
}

async function workspaceSessionFromRequest(params, artifactPath = "", scope = defaultWorkspaceScope()) {
  const session = sessions.get(params.get("session"));
  if (session) {
    return session;
  }
  if (!params.get("workspacePath") && !params.get("workspaceName") && artifactPath) {
    const workspaces = await listWorkspaces(scope);
    for (const workspace of workspaces) {
      try {
        const { target } = workspaceRelativeTarget(workspace.path, artifactPath);
        const info = await stat(target);
        if (info.isFile()) {
          return { workspace };
        }
      } catch {
        // Try the next workspace.
      }
    }
  }
  const workspace = workspaceFromHistoryRequest({
    workspacePath: params.get("workspacePath"),
    workspaceName: params.get("workspaceName"),
  }, scope);
  return { workspace };
}

async function deleteArtifactFile(session, artifactPath) {
  const { target, rel } = workspaceRelativeTarget(session.workspace.path, artifactPath);
  const info = await stat(target);
  if (!info.isFile()) {
    throw new Error("Artifact is not a file");
  }
  await rm(target);
  return {
    path: rel,
    name: rel.split(/[\\/]/).pop() || rel,
  };
}

async function copyArtifactToFolder(session, artifactPath, folderPath) {
  const directory = normalize(String(folderPath || defaultDownloadFolder()).trim());
  if (!directory || !isAbsolute(directory)) {
    throw new Error("저장 폴더는 절대 경로여야 합니다");
  }
  const { target, rel } = workspaceRelativeTarget(session.workspace.path, artifactPath);
  const info = await stat(target);
  if (!info.isFile()) {
    throw new Error("Artifact is not a file");
  }
  await mkdir(directory, { recursive: true });
  const name = rel.split(/[\\/]/).pop() || basename(target) || "download";
  const destination = join(directory, name);
  await copyFile(target, destination);
  return {
    path: destination,
    name,
    size: info.size,
  };
}

function defaultDownloadFolder() {
  const home = String(process.env.USERPROFILE || process.env.HOME || "").trim();
  if (home) {
    const downloads = normalize(join(home, "Downloads"));
    if (existsSync(downloads)) {
      return downloads;
    }
  }
  return normalize(join(repoRoot, "downloads"));
}

async function openFolderDialog(initialPath = "") {
  if (process.platform !== "win32") {
    throw new Error("Folder picker is only available on Windows in this build");
  }
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "저장할 폴더를 선택하세요"
$dialog.ShowNewFolderButton = $true
$owner = New-Object System.Windows.Forms.Form
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Opacity = 0
$owner.ShowInTaskbar = $false
$owner.TopMost = $true
$initial = [Environment]::GetFolderPath("MyDocuments")
if ($env:OPENHARNESS_DIALOG_INITIAL -and (Test-Path -LiteralPath $env:OPENHARNESS_DIALOG_INITIAL -PathType Container)) {
  $initial = $env:OPENHARNESS_DIALOG_INITIAL
}
$dialog.SelectedPath = $initial
try {
  $owner.Show()
  $owner.Activate()
  $result = $dialog.ShowDialog($owner)
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Out.Write($dialog.SelectedPath)
    exit 0
  }
} finally {
  $dialog.Dispose()
  $owner.Dispose()
}
exit 2
`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          OPENHARNESS_DIALOG_INITIAL: String(initialPath || ""),
        },
        windowsHide: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ canceled: false, folderPath: stdout.trim() });
      } else if (code === 2) {
        resolve({ canceled: true, folderPath: "" });
      } else {
        reject(new Error(stderr.trim() || `Folder picker exited with code ${code ?? 0}`));
      }
    });
  });
}

async function saveArtifactFile(session, artifactPath, content) {
  let requestedPath = String(artifactPath || "").trim();
  if (!requestedPath) {
    requestedPath = "answer.md";
  }
  if (!/\.[A-Za-z0-9]{1,8}$/.test(requestedPath)) {
    requestedPath = `${requestedPath}.md`;
  }
  const ext = extname(requestedPath).toLowerCase();
  const type = artifactTypes[ext];
  if (!type) {
    throw new Error("Unsupported artifact type");
  }
  if (type.encoding !== "text") {
    throw new Error("Only text artifacts can be saved from assistant text");
  }
  let { target, rel } = workspaceRelativeTarget(session.workspace.path, requestedPath);
  const dotIndex = rel.lastIndexOf(".");
  const baseRel = dotIndex > 0 ? rel.slice(0, dotIndex) : rel;
  const suffix = dotIndex > 0 ? rel.slice(dotIndex) : "";
  let index = 2;
  while (true) {
    try {
      await stat(target);
      const nextRel = `${baseRel}-${index}${suffix}`;
      ({ target, rel } = workspaceRelativeTarget(session.workspace.path, nextRel));
      index += 1;
    } catch (error) {
      if (error?.code === "ENOENT") {
        break;
      }
      throw error;
    }
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, String(content || ""), "utf8");
  return readArtifactMetadata(session, rel);
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
        mtimeMs: info.mtimeMs,
        birthtimeMs: info.birthtimeMs,
      });
    }
  }
  await walk(session.workspace.path);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

async function listProjectFiles(session) {
  const files = [];
  const shouldSkipProjectFileRel = (rel) => {
    const normalized = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
    return projectFileListSkipPrefixes.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
  };
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
        const target = join(directory, entry.name);
        const rel = relative(session.workspace.path, target);
        if (!artifactListSkipDirs.has(entry.name) && !shouldSkipProjectFileRel(rel)) {
          await walk(target);
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
      if (shouldSkipProjectFileRel(rel)) {
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
        mtimeMs: info.mtimeMs,
        birthtimeMs: info.birthtimeMs,
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

function workspaceScopeOrDefault(scope) {
  return scope && scope.root ? scope : defaultWorkspaceScope();
}

function workspacePathFromName(name, scope = defaultWorkspaceScope()) {
  const activeScope = workspaceScopeOrDefault(scope);
  const validation = validateWorkspaceName(name);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const workspacePath = normalize(join(activeScope.root, validation.name));
  const rel = relative(activeScope.root, workspacePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Workspace path must stay inside Playground");
  }
  return { name: validation.name, path: workspacePath, scope: activeScope };
}

function workspaceFromDirectoryName(name, scope = defaultWorkspaceScope()) {
  const activeScope = workspaceScopeOrDefault(scope);
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
  const workspacePath = normalize(join(activeScope.root, displayName));
  const rel = relative(activeScope.root, workspacePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.includes("\\") || rel.includes("/")) {
    throw new Error("Workspace path must stay inside Playground");
  }
  return { name: displayName, path: workspacePath, scope: activeScope };
}

function workspaceFromPath(candidate, scope = defaultWorkspaceScope()) {
  const activeScope = workspaceScopeOrDefault(scope);
  const workspacePath = normalize(String(candidate || ""));
  const scopedRel = relative(activeScope.root, workspacePath);
  if (scopedRel && !scopedRel.startsWith("..") && !isAbsolute(scopedRel) && !scopedRel.includes("\\") && !scopedRel.includes("/")) {
    return workspaceFromDirectoryName(scopedRel, activeScope);
  }
  const rootRel = relative(playgroundRoot, workspacePath);
  if (rootRel && !rootRel.startsWith("..") && !isAbsolute(rootRel)) {
    const parts = rootRel.split(/[\\/]/).filter(Boolean);
    if (parts.length === 1 || parts.length === 2) {
      return workspaceFromDirectoryName(parts[parts.length - 1], activeScope);
    }
  }
  throw new Error("Workspace cwd must stay inside the current Playground scope");
}

function projectPreferencesPath(workspace) {
  return join(workspace.path, projectPreferencesRel);
}

function globalConfigDir() {
  const envDir = String(process.env.OPENHARNESS_CONFIG_DIR || "").trim();
  if (envDir) {
    return normalize(envDir);
  }
  return normalize(join(process.env.USERPROFILE || process.env.HOME || ".", ".openharness"));
}

function maskSecret(value) {
  const raw = String(value || "");
  if (!raw) {
    return "";
  }
  if (raw.length <= 8) {
    return "••••";
  }
  return `${raw.slice(0, 4)}••••${raw.slice(-4)}`;
}

async function readJsonFileIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function writeJsonFile(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function readWorkspaceScopeSettings(request = null) {
  const settings = await readJsonFileIfExists(join(globalConfigDir(), "settings.json")) || {};
  const mode = normalizeWorkspaceScopeMode(settings.web_workspace_scope || settings.workspace_scope || workspaceScopeMode);
  return {
    mode,
    scope: request ? workspaceScopeFromRequest(request) : null,
  };
}

async function saveWorkspaceScopeSettings(body = {}, request = null) {
  const mode = normalizeWorkspaceScopeMode(body.mode);
  workspaceScopeMode = mode;
  const settingsPath = join(globalConfigDir(), "settings.json");
  const settings = await readJsonFileIfExists(settingsPath) || {};
  settings.web_workspace_scope = mode;
  await writeJsonFile(settingsPath, settings);
  return readWorkspaceScopeSettings(request);
}

function normalizeLearnedSkillsMode(value, fallback = "hide") {
  const raw = String(value || "").trim().toLowerCase();
  if (["use", "hide", "off"].includes(raw)) {
    return raw;
  }
  if (["on", "enabled", "visible"].includes(raw)) {
    return "use";
  }
  if (["hidden"].includes(raw)) {
    return "hide";
  }
  if (["disabled", "disable", "false"].includes(raw)) {
    return "off";
  }
  return fallback;
}

async function readLearnedSkillsSettings() {
  const settings = await readJsonFileIfExists(join(globalConfigDir(), "settings.json")) || {};
  const learning = settings.learning && typeof settings.learning === "object" ? settings.learning : {};
  const mode = learning.enabled === false
    ? "off"
    : normalizeLearnedSkillsMode(learning.mode, "hide");
  return { mode };
}

async function saveLearnedSkillsSettings(body = {}) {
  const mode = normalizeLearnedSkillsMode(body.mode, "hide");
  const settingsPath = join(globalConfigDir(), "settings.json");
  const settings = await readJsonFileIfExists(settingsPath) || {};
  const learning = settings.learning && typeof settings.learning === "object" ? settings.learning : {};
  settings.learning = {
    ...learning,
    enabled: mode !== "off",
    mode,
  };
  await writeJsonFile(settingsPath, settings);
  return readLearnedSkillsSettings();
}

async function readShellSettings() {
  const settings = await readJsonFileIfExists(join(globalConfigDir(), "settings.json")) || {};
  const preference = normalizeShellPreference(settings.shell || settings.web_shell || shellPreference);
  shellPreference = preference;
  return {
    shell: preference,
    options: shellOptions(),
  };
}

async function saveShellSettings(body = {}) {
  const preference = normalizeShellPreference(body.shell);
  shellPreference = preference;
  const settingsPath = join(globalConfigDir(), "settings.json");
  const settings = await readJsonFileIfExists(settingsPath) || {};
  settings.shell = preference;
  await writeJsonFile(settingsPath, settings);
  return readShellSettings();
}

function shellOptions() {
  return [
    {
      value: "auto",
      label: "자동",
      description: "Windows에서는 PowerShell을 우선 사용하고, 없으면 Git Bash, 마지막으로 cmd를 사용합니다.",
    },
    {
      value: "powershell",
      label: "PowerShell",
      description: "pwsh가 있으면 pwsh, 없으면 Windows PowerShell을 사용합니다.",
    },
    {
      value: "git-bash",
      label: "Git Bash",
      description: "Git for Windows의 bash.exe를 사용합니다.",
    },
    {
      value: "cmd",
      label: "cmd",
      description: "Windows Command Prompt(cmd.exe)를 사용합니다.",
    },
  ];
}

async function readPgptSettings() {
  const credentials = await readJsonFileIfExists(join(globalConfigDir(), "credentials.json")) || {};
  const entry = credentials.pgpt && typeof credentials.pgpt === "object" ? credentials.pgpt : {};
  return {
    apiKeyConfigured: Boolean(entry.api_key),
    apiKeyMasked: maskSecret(entry.api_key),
    employeeNo: String(entry.employee_no || entry.system_code || ""),
    companyCode: String(entry.company_code || "30"),
  };
}

async function savePgptSettings(body = {}) {
  const credentialsPath = join(globalConfigDir(), "credentials.json");
  const credentials = await readJsonFileIfExists(credentialsPath) || {};
  const current = credentials.pgpt && typeof credentials.pgpt === "object" ? credentials.pgpt : {};
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(body, "apiKey")) {
    const value = String(body.apiKey || "").trim();
    if (value) {
      next.api_key = value;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "employeeNo")) {
    next.employee_no = String(body.employeeNo || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, "companyCode")) {
    next.company_code = String(body.companyCode || "").trim() || "30";
  }
  credentials.pgpt = next;
  await writeJsonFile(credentialsPath, credentials);
  return readPgptSettings();
}

function normalizeProjectPreferences(raw = {}) {
  const disabledSkills = Array.isArray(raw.disabled_skills)
    ? raw.disabled_skills
    : Array.isArray(raw.disabledSkills)
      ? raw.disabledSkills
      : [];
  const disabledMcpServers = Array.isArray(raw.disabled_mcp_servers)
    ? raw.disabled_mcp_servers
    : Array.isArray(raw.disabledMcpServers)
      ? raw.disabledMcpServers
      : [];
  const enabledPlugins = raw.enabled_plugins && typeof raw.enabled_plugins === "object" && !Array.isArray(raw.enabled_plugins)
    ? raw.enabled_plugins
    : raw.enabledPlugins && typeof raw.enabledPlugins === "object" && !Array.isArray(raw.enabledPlugins)
      ? raw.enabledPlugins
      : {};
  return {
    version: 1,
    disabled_skills: [...new Set(disabledSkills.map((name) => String(name || "").trim().toLowerCase()).filter(Boolean))].sort(),
    disabled_mcp_servers: [...new Set(disabledMcpServers.map((name) => String(name || "").trim()).filter(Boolean))].sort(),
    enabled_plugins: Object.fromEntries(
      Object.entries(enabledPlugins)
        .map(([name, value]) => [String(name || "").trim(), value !== false])
        .filter(([name]) => name)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

async function globalPreferencesSnapshot() {
  const configDir = globalConfigDir();
  const settings = await readJsonFileIfExists(join(configDir, "settings.json")) || {};
  const skillState = await readJsonFileIfExists(join(configDir, "skill_state.json")) || {};
  return normalizeProjectPreferences({
    disabled_skills: Array.isArray(skillState.disabled_skills) ? skillState.disabled_skills : [],
    disabled_mcp_servers: Array.isArray(settings.disabled_mcp_servers) ? settings.disabled_mcp_servers : [],
    enabled_plugins: settings.enabled_plugins && typeof settings.enabled_plugins === "object" ? settings.enabled_plugins : {},
  });
}

async function ensureDefaultPreferences(scope = defaultWorkspaceScope()) {
  const workspace = workspacePathFromName(defaultWorkspaceName, scope);
  await mkdir(workspace.path, { recursive: true });
  const preferencesPath = projectPreferencesPath(workspace);
  try {
    await stat(preferencesPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    await mkdir(dirname(preferencesPath), { recursive: true });
    await writeFile(preferencesPath, `${JSON.stringify(await globalPreferencesSnapshot(), null, 2)}\n`, "utf8");
  }
  return preferencesPath;
}

async function copyDefaultPreferencesToWorkspace(workspace, scope = defaultWorkspaceScope()) {
  if (workspace.name === defaultWorkspaceName) {
    await ensureDefaultPreferences(scope);
    return;
  }
  const source = await ensureDefaultPreferences(scope);
  const target = projectPreferencesPath(workspace);
  try {
    await stat(target);
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  const raw = await readJsonFileIfExists(source);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(normalizeProjectPreferences(raw), null, 2)}\n`, "utf8");
}

function legacyWorkspacePath(name) {
  const validation = validateWorkspaceName(name);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const workspacePath = normalize(join(playgroundRoot, validation.name));
  const rel = relative(playgroundRoot, workspacePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.includes("\\") || rel.includes("/")) {
    throw new Error("Legacy workspace path must stay directly inside Playground");
  }
  return workspacePath;
}

async function copyLegacyWorkspaceIfNeeded(workspace, scope = defaultWorkspaceScope()) {
  if (scope.name !== sharedWorkspaceScopeName) {
    return false;
  }
  let targetExists = false;
  try {
    targetExists = (await stat(workspace.path)).isDirectory();
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  if (targetExists) {
    return false;
  }
  const legacyPath = legacyWorkspacePath(workspace.name);
  try {
    const info = await stat(legacyPath);
    if (!info.isDirectory()) {
      return false;
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  await mkdir(dirname(workspace.path), { recursive: true });
  await cp(legacyPath, workspace.path, { recursive: true, errorOnExist: false, force: false });
  return true;
}

async function looksLikeLegacyWorkspace(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.some((entry) => entry.name === ".openharness" || entry.isFile());
  } catch {
    return false;
  }
}

async function copyLegacyWorkspacesIfNeeded(scope = defaultWorkspaceScope()) {
  if (scope.name !== sharedWorkspaceScopeName) {
    return;
  }
  await mkdir(playgroundRoot, { recursive: true });
  const entries = await readdir(playgroundRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === sharedWorkspaceScopeName || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(entry.name)) {
      continue;
    }
    try {
      const workspace = workspaceFromDirectoryName(entry.name, scope);
      if (await looksLikeLegacyWorkspace(join(playgroundRoot, entry.name))) {
        await copyLegacyWorkspaceIfNeeded(workspace, scope);
      }
    } catch {
      // Ignore folders that are not valid project names.
    }
  }
}

async function ensureWorkspace(name = defaultWorkspaceName, scope = defaultWorkspaceScope()) {
  const workspace = workspacePathFromName(name, scope);
  await mkdir(scope.root, { recursive: true });
  let existed = false;
  try {
    existed = (await stat(workspace.path)).isDirectory();
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  const copiedLegacy = await copyLegacyWorkspaceIfNeeded(workspace, scope);
  if (!copiedLegacy) {
    await mkdir(workspace.path, { recursive: true });
  }
  if (!existed) {
    await copyDefaultPreferencesToWorkspace(workspace, scope);
  }
  return workspace;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deleteWorkspace(name, scope = defaultWorkspaceScope()) {
  const workspace = workspacePathFromName(name, scope);
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

async function listWorkspaces(scope = defaultWorkspaceScope()) {
  await copyLegacyWorkspacesIfNeeded(scope);
  await mkdir(scope.root, { recursive: true });
  const entries = await readdir(scope.root, { withFileTypes: true });
  const directories = (
    await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
      try {
        const workspace = workspaceFromDirectoryName(entry.name, scope);
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
    return [await ensureWorkspace(defaultWorkspaceName, scope)];
  }
  return directories;
}

function sessionDirectoryForWorkspace(workspace) {
  return join(workspace.path, ".openharness", "sessions");
}

function compactText(value, limit = 80) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function messageText(message) {
  if (!message || typeof message !== "object") {
    return "";
  }
  if (typeof message.text === "string") {
    return message.text;
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  if (!Array.isArray(message.content)) {
    return "";
  }
  return message.content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      if (typeof block.text === "string") {
        return block.text;
      }
      if (typeof block.content === "string") {
        return block.content;
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function firstUserSummary(messages) {
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role === "user") {
      return compactText(messageText(message));
    }
  }
  return "";
}

async function readSessionListItem(path) {
  const data = JSON.parse(await readFile(path, "utf8"));
  const info = await stat(path);
  const fileName = basename(path);
  const sessionId = String(data.session_id || "").trim()
    || fileName.replace(/^session-/, "").replace(/\.json$/i, "");
  const summary = compactText(data.summary) || firstUserSummary(data.messages) || "(untitled chat)";
  const createdAt = Number(data.created_at || info.mtimeMs || Date.now());
  const date = new Date(createdAt * (createdAt < 10_000_000_000 ? 1000 : 1));
  const labelDate = `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const messageCount = Number(data.message_count || (Array.isArray(data.messages) ? data.messages.length : 0));
  return {
    value: sessionId || fileName.replace(/^session-/, "").replace(/\.json$/i, ""),
    label: `${labelDate}  ${messageCount}msg  ${summary}`,
    description: summary,
    createdAt,
  };
}

async function listWorkspaceHistory(workspace, options = {}) {
  const sessionDir = sessionDirectoryForWorkspace(workspace);
  let entries = [];
  try {
    entries = await readdir(sessionDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const items = [];
  const seen = new Set();
  const sessionFiles = entries
    .filter((entry) => entry.isFile() && /^session-.+\.json$/i.test(entry.name))
    .map((entry) => join(sessionDir, entry.name));
  for (const file of sessionFiles) {
    try {
      const item = await readSessionListItem(file);
      if (item.value) {
        seen.add(item.value);
        items.push(item);
      }
    } catch {
      // Ignore corrupt or partially written snapshots.
    }
  }

  const latestPath = join(sessionDir, "latest.json");
  try {
    const latest = await readSessionListItem(latestPath);
    if (latest.value && !seen.has(latest.value)) {
      items.push(latest);
    }
  } catch {
    // latest.json is optional.
  }

  const sorted = items.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  if (options.includeCreatedAt) {
    return sorted;
  }
  return sorted.map(({ createdAt, ...item }) => item);
}

async function listAllWorkspaceHistory(scope = defaultWorkspaceScope()) {
  const workspaces = await listWorkspaces(scope);
  const grouped = await Promise.all(workspaces.map(async (workspace) => {
    const items = await listWorkspaceHistory(workspace, { includeCreatedAt: true });
    return items.map(({ createdAt, ...item }) => ({
      ...item,
      description: item.description ? `${workspace.name} · ${item.description}` : workspace.name,
      workspace,
      createdAt,
    }));
  }));
  return grouped
    .flat()
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
    .map(({ createdAt, ...item }) => item);
}

function workspaceFromHistoryRequest(paramsOrBody = {}, scope = defaultWorkspaceScope()) {
  const workspacePath = String(paramsOrBody.workspacePath || "").trim();
  const workspaceName = String(paramsOrBody.workspaceName || paramsOrBody.name || "").trim();
  if (workspacePath) {
    return workspaceFromPath(workspacePath, scope);
  }
  if (workspaceName) {
    return workspaceFromDirectoryName(workspaceName, scope);
  }
  return workspacePathFromName(defaultWorkspaceName, scope);
}

async function deleteWorkspaceHistoryItem(workspace, sessionId) {
  const cleanId = String(sessionId || "").trim();
  if (!cleanId) {
    throw new Error("Session id is required");
  }
  const sessionDir = sessionDirectoryForWorkspace(workspace);
  const target = join(sessionDir, `session-${cleanId}.json`);
  let deleted = false;
  try {
    await rm(target);
    deleted = true;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  const latestPath = join(sessionDir, "latest.json");
  try {
    const latest = JSON.parse(await readFile(latestPath, "utf8"));
    if (String(latest.session_id || "latest") === cleanId || cleanId === "latest") {
      await rm(latestPath);
      deleted = true;
    }
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
      throw error;
    }
  }
  return deleted;
}

async function updateWorkspaceHistoryTitle(workspace, sessionId, title) {
  const cleanId = String(sessionId || "").trim();
  const cleanTitle = compactText(title, 80);
  if (!cleanId) {
    throw new Error("Session id is required");
  }
  if (!cleanTitle) {
    throw new Error("Session title is required");
  }
  const sessionDir = sessionDirectoryForWorkspace(workspace);
  const target = join(sessionDir, `session-${cleanId}.json`);
  const payload = JSON.parse(await readFile(target, "utf8"));
  payload.summary = cleanTitle;
  payload.tool_metadata = {
    ...(payload.tool_metadata && typeof payload.tool_metadata === "object" ? payload.tool_metadata : {}),
    session_title: cleanTitle,
    session_title_user_edited: true,
  };
  await writeJsonFile(target, payload);

  const latestPath = join(sessionDir, "latest.json");
  try {
    const latest = JSON.parse(await readFile(latestPath, "utf8"));
    if (String(latest.session_id || "") === cleanId) {
      await writeJsonFile(latestPath, payload);
    }
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
      throw error;
    }
  }
  return payload;
}

async function resolveSessionWorkspace(options = {}) {
  const scope = workspaceScopeOrDefault(options.workspaceScope);
  if (options.cwd) {
    const workspace = workspaceFromPath(options.cwd, scope);
    try {
      const info = await stat(workspace.path);
      if (info.isDirectory()) {
        return workspace;
      }
    } catch {
      return ensureWorkspace(workspace.name, scope);
    }
    return workspace;
  }
  return ensureWorkspace(defaultWorkspaceName, scope);
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

async function shellCommandForPlatform(command) {
  if (process.platform === "win32") {
    const pythonHeredoc = pythonHeredocCommandForWindows(command);
    if (pythonHeredoc) {
      return pythonHeredoc;
    }
    const { shell } = await readShellSettings();
    return windowsShellCommand(command, shell);
  }
  return {
    file: process.env.SHELL || "/bin/sh",
    args: ["-lc", command],
  };
}

function windowsShellCommand(command, shell) {
  const preference = normalizeShellPreference(shell);
  if (preference === "auto" || preference === "powershell") {
    const powershell = resolveWindowsPowerShell();
    if (powershell || preference === "powershell") {
      return {
        file: powershell || "powershell.exe",
        args: [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          powershellUtf8Command(command),
        ],
      };
    }
  }
  if (preference === "auto" || preference === "git-bash") {
    const gitBash = resolveGitBash();
    if (gitBash || preference === "git-bash") {
      return {
        file: gitBash || "bash.exe",
        args: ["-lc", command],
      };
    }
  }
  return {
    file: resolveCommandOnPath("cmd.exe") || "cmd.exe",
    args: ["/d", "/s", "/c", `chcp 65001>nul & ${command}`],
  };
}

function resolveWindowsPowerShell() {
  return resolveCommandOnPath("pwsh.exe")
    || resolveCommandOnPath("pwsh")
    || resolveCommandOnPath("powershell.exe")
    || (process.env.SystemRoot
      ? existingPath(join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"))
      : "");
}

function resolveGitBash() {
  const candidates = [
    resolveCommandOnPath("git-bash.exe"),
    resolveCommandOnPath("bash.exe"),
    process.env.OPENHARNESS_GIT_BASH,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "Git", "bin", "bash.exe") : "",
    process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe") : "",
    process.env.LocalAppData ? join(process.env.LocalAppData, "Programs", "Git", "bin", "bash.exe") : "",
  ];
  return candidates.find((candidate) => candidate && looksLikeGitBash(candidate)) || "";
}

function resolveCommandOnPath(commandName) {
  const pathEnv = process.env.PATH || "";
  for (const entry of pathEnv.split(delimiter)) {
    if (!entry) {
      continue;
    }
    const candidate = join(entry, commandName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "";
}

function existingPath(path) {
  return path && existsSync(path) ? path : "";
}

function looksLikeGitBash(path) {
  const normalized = String(path || "").replace(/\\/g, "/").toLowerCase();
  return normalized.endsWith("/bash.exe") && normalized.includes("/git/") && existsSync(path);
}

function powershellUtf8Command(command) {
  return "[Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; "
    + "$OutputEncoding = [Console]::OutputEncoding; "
    + command;
}

function pythonHeredocCommandForWindows(command) {
  const match = String(command || "").match(/^\s*(?<prefix>(?:python3?|py)(?:\.exe)?(?:\s+-3)?)\s+-\s+<<\s*(?<quote>['"]?)(?<tag>[A-Za-z_][A-Za-z0-9_]*)\k<quote>\s*\r?\n(?<body>[\s\S]*)\r?\n\k<tag>\s*$/i);
  if (!match?.groups) {
    return null;
  }
  const prefixParts = match.groups.prefix.trim().split(/\s+/);
  const python = resolvePythonCommand(prefixParts[0], prefixParts.slice(1));
  return {
    file: python.file,
    args: [...python.args, "-c", String(match.groups.body || "").replace(/\r\n/g, "\n")],
  };
}

function shellEnvironment(extra = {}) {
  return {
    ...process.env,
    PYTHONUNBUFFERED: "1",
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    ...extra,
  };
}

function backendPythonCommand() {
  return resolvePythonCommand("", []);
}

function resolvePythonCommand(requestedExecutable = "", requestedArgs = []) {
  const requestedName = String(requestedExecutable || "").trim();
  const requestedBase = basename(requestedName).toLowerCase();
  const requestedIsPy = requestedBase === "py" || requestedBase === "py.exe";
  const requestedIsGeneric = ["", "python", "python.exe", "python3", "python3.exe"].includes(requestedBase);
  const requestedHasPath = requestedName.includes("\\") || requestedName.includes("/") || isAbsolute(requestedName);
  const candidates = [];

  if (requestedName && (requestedHasPath || !requestedIsGeneric)) {
    candidates.push({
      file: resolveExecutable(requestedName),
      args: requestedArgs,
      label: [requestedName, ...requestedArgs].join(" "),
    });
  } else if (requestedIsPy) {
    candidates.push({
      file: resolveCommandOnPath(requestedName) || requestedName,
      args: requestedArgs,
      label: [requestedName, ...requestedArgs].join(" "),
    });
  }

  if (requestedIsGeneric) {
    candidates.push(...defaultPythonCandidates());
    if (requestedName && !requestedHasPath) {
      candidates.push({
        file: resolveExecutable(requestedName),
        args: requestedArgs,
        label: [requestedName, ...requestedArgs].join(" "),
      });
    }
  } else if (!requestedIsPy) {
    candidates.push(...defaultPythonCandidates());
  }

  const seen = new Set();
  const attempts = [];
  for (const candidate of candidates) {
    const key = [candidate.file, ...(candidate.args || [])].join("\u0000");
    if (!candidate.file || seen.has(key)) {
      continue;
    }
    seen.add(key);
    attempts.push(candidate.label || [candidate.file, ...(candidate.args || [])].join(" "));
    if (pythonCandidateIsUsable(candidate)) {
      return { file: candidate.file, args: candidate.args || [] };
    }
  }

  throw new Error(`No usable Python 3.10+ found. Tried: ${attempts.join(", ") || "none"}`);
}

function resolveExecutable(commandName) {
  return existingPath(commandName) || resolveCommandOnPath(commandName) || commandName;
}

function defaultPythonCandidates() {
  const candidates = [];
  const configured = String(process.env.OPENHARNESS_PYTHON || "").trim();
  if (configured) {
    candidates.push({ file: configured, args: [], label: "OPENHARNESS_PYTHON" });
  }

  const envPython = String(process.env.PYTHON || "").trim();
  if (envPython) {
    candidates.push({ file: envPython, args: [], label: "PYTHON" });
  }

  if (process.platform === "win32") {
    candidates.push(
      { file: resolveCommandOnPath("py.exe") || resolveCommandOnPath("py") || "py", args: ["-3"], label: "py -3" },
      { file: resolveCommandOnPath("python.exe") || resolveCommandOnPath("python") || "python", args: [], label: "python" },
      { file: resolveCommandOnPath("python3.exe") || resolveCommandOnPath("python3") || "python3", args: [], label: "python3" },
    );
  } else {
    candidates.push(
      { file: resolveCommandOnPath("python3") || "python3", args: [], label: "python3" },
      { file: resolveCommandOnPath("python") || "python", args: [], label: "python" },
    );
  }
  return candidates;
}

function pythonCandidateIsUsable(candidate) {
  const check = "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)";
  try {
    const result = spawnSync(candidate.file, [...(candidate.args || []), "-c", check], {
      cwd: repoRoot,
      env: shellEnvironment(),
      windowsHide: true,
      stdio: "ignore",
      timeout: 5000,
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

async function runShellCommand(options = {}) {
  const command = String(options.command || "").trim();
  if (!command) {
    throw new Error("Command is required");
  }
  const scope = workspaceScopeOrDefault(options.workspaceScope);
  const workspace = options.cwd
    ? workspaceFromPath(options.cwd, scope)
    : options.session?.workspace || await ensureWorkspace(defaultWorkspaceName, scope);
  const { file, args } = await shellCommandForPlatform(command);
  return await new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: workspace.path,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: shellEnvironment(),
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
  const scope = workspaceScopeOrDefault(options.workspaceScope);
  const workspace = options.cwd
    ? workspaceFromPath(options.cwd, scope)
    : options.session?.workspace || await ensureWorkspace(defaultWorkspaceName, scope);
  const { file, args } = await shellCommandForPlatform(command);

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
    env: shellEnvironment(),
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
  const python = backendPythonCommand();
  const args = [...python.args, "-m", "openharness", "--backend-only", "--cwd", workspace.path];
  const env = {
    ...process.env,
    PYTHONPATH: [join(repoRoot, "src"), process.env.PYTHONPATH].filter(Boolean).join(delimiter),
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

  const child = spawn(python.file, args, {
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
  if (
    event.type === "status" ||
    event.type === "tool_started" ||
    event.type === "tool_input_delta" ||
    event.type === "tool_progress" ||
    event.type === "assistant_delta" ||
    event.type === "assistant_complete"
  ) {
    session.busy = true;
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
  const workspaceScope = workspaceScopeFromRequest(request);
  if (request.method === "POST" && pathname === "/api/token-count") {
    try {
      const body = await readJson(request);
      const text = String(body.text || "");
      if (text.length > tokenCountMaxChars) {
        throw new Error("Text is too long to count tokens");
      }
      json(response, 200, { tokens: countTokens(text), encoding: "o200k_base" });
    } catch (error) {
      json(response, 400, { error: error.message || "Could not count tokens" });
    }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/html-preview") {
    try {
      const body = await readJson(request);
      const id = storeChatHtmlPreview(body.content);
      json(response, 200, { id, url: `/api/html-preview/${id}` });
    } catch (error) {
      json(response, 400, { error: error.message || "Could not create HTML preview" });
    }
    return true;
  }

  if (request.method === "GET" && pathname.startsWith("/api/html-preview/")) {
    pruneChatHtmlPreviews();
    const id = decodeURIComponent(pathname.slice("/api/html-preview/".length));
    const preview = chatHtmlPreviews.get(id);
    if (!preview) {
      response.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end("HTML preview not found");
      return true;
    }
    preview.expiresAt = Date.now() + chatHtmlPreviewTtlMs;
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self' http: https: data: blob:; script-src 'self' http: https: data: blob: 'unsafe-inline' 'unsafe-eval'; style-src 'self' http: https: 'unsafe-inline'; img-src * data: blob:; font-src * data:; media-src * data: blob:; connect-src * data: blob:; frame-src http: https: data: blob:; worker-src blob: data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(preview.content);
    return true;
  }

  if (request.method === "GET" && pathname === "/api/workspaces") {
    const workspaces = await listWorkspaces(workspaceScope);
    json(response, 200, { root: workspaceScope.root, scope: workspaceScope, workspaces });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/workspaces") {
    try {
      const body = await readJson(request);
      const workspace = await ensureWorkspace(body.name, workspaceScope);
      const workspaces = await listWorkspaces(workspaceScope);
      json(response, 200, { workspace, workspaces });
    } catch (error) {
      json(response, 400, { error: error.message || "Invalid workspace" });
    }
    return true;
  }

  if (request.method === "DELETE" && pathname === "/api/workspaces") {
    try {
      const body = await readJson(request);
      const workspace = await deleteWorkspace(body.name, workspaceScope);
      const workspaces = await listWorkspaces(workspaceScope);
      json(response, 200, { deleted: workspace, workspaces });
    } catch (error) {
      json(response, 400, { error: error.message || "Could not delete workspace" });
    }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/history") {
    try {
      const params = new URL(request.url, `http://localhost:${port}`).searchParams;
      const workspacePath = params.get("workspacePath");
      const workspaceName = params.get("workspaceName");
      if (workspacePath || workspaceName) {
        const workspace = workspaceFromHistoryRequest({ workspacePath, workspaceName }, workspaceScope);
        json(response, 200, {
          workspace,
          options: (await listWorkspaceHistory(workspace)).map((item) => ({ ...item, workspace })),
        });
      } else {
        json(response, 200, {
          workspace: null,
          options: await listAllWorkspaceHistory(workspaceScope),
        });
      }
    } catch (error) {
      json(response, 400, { error: error.message || "Could not list history" });
    }
    return true;
  }

  if (request.method === "DELETE" && pathname === "/api/history") {
    try {
      const body = await readJson(request);
      const workspace = workspaceFromHistoryRequest(body, workspaceScope);
      const deleted = await deleteWorkspaceHistoryItem(workspace, body.sessionId);
      json(response, deleted ? 200 : 404, { deleted, workspace });
    } catch (error) {
      json(response, 400, { error: error.message || "Could not delete history" });
    }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/history/title") {
    try {
      const body = await readJson(request);
      const workspace = workspaceFromHistoryRequest(body, workspaceScope);
      const snapshot = await updateWorkspaceHistoryTitle(workspace, body.sessionId, body.title);
      json(response, 200, {
        ok: true,
        workspace,
        sessionId: snapshot.session_id || body.sessionId,
        title: snapshot.summary,
      });
    } catch (error) {
      json(response, 400, { error: error.message || "Could not update history title" });
    }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/session") {
    try {
      const options = await readJson(request);
      options.workspaceScope = workspaceScope;
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

  if (request.method === "GET" && pathname === "/api/settings/pgpt") {
    try {
      json(response, 200, await readPgptSettings());
    } catch (error) {
      json(response, 400, { error: error.message || "Could not read P-GPT settings" });
    }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/settings/pgpt") {
    try {
      const body = await readJson(request);
      json(response, 200, await savePgptSettings(body));
    } catch (error) {
      json(response, 400, { error: error.message || "Could not save P-GPT settings" });
    }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/settings/workspace-scope") {
    try {
      json(response, 200, await readWorkspaceScopeSettings(request));
    } catch (error) {
      json(response, 400, { error: error.message || "Could not read workspace scope settings" });
    }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/settings/workspace-scope") {
    try {
      const body = await readJson(request);
      json(response, 200, await saveWorkspaceScopeSettings(body, request));
    } catch (error) {
      json(response, 400, { error: error.message || "Could not save workspace scope settings" });
    }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/settings/learned-skills") {
    try {
      json(response, 200, await readLearnedSkillsSettings());
    } catch (error) {
      json(response, 400, { error: error.message || "Could not read learned skill settings" });
    }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/settings/learned-skills") {
    try {
      const body = await readJson(request);
      json(response, 200, await saveLearnedSkillsSettings(body));
    } catch (error) {
      json(response, 400, { error: error.message || "Could not save learned skill settings" });
    }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/settings/shell") {
    try {
      json(response, 200, await readShellSettings());
    } catch (error) {
      json(response, 400, { error: error.message || "Could not read shell settings" });
    }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/settings/shell") {
    try {
      const body = await readJson(request);
      json(response, 200, await saveShellSettings(body));
    } catch (error) {
      json(response, 400, { error: error.message || "Could not save shell settings" });
    }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/dialog/folder") {
    try {
      const body = await readJson(request);
      json(response, 200, await openFolderDialog(body.initialPath));
    } catch (error) {
      json(response, 400, { error: error.message || "Could not open folder picker" });
    }
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
    });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/artifact") {
    const params = new URL(request.url, `http://localhost:${port}`).searchParams;
    try {
      const sessionId = params.get("session");
      const session = sessionId
        ? sessions.get(sessionId)
        : await workspaceSessionFromRequest(params, params.get("path"), workspaceScope);
      if (!session) {
        json(response, 404, { error: "Unknown session" });
        return true;
      }
      const payload = await readArtifactPreview(session, params.get("path"));
      json(response, 200, payload);
    } catch (error) {
      json(response, 400, { error: error.message || "Could not preview artifact" });
    }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/artifact/resolve") {
    const params = new URL(request.url, `http://localhost:${port}`).searchParams;
    try {
      const sessionId = params.get("session");
      const session = sessionId
        ? sessions.get(sessionId)
        : await workspaceSessionFromRequest(params, params.get("path"), workspaceScope);
      if (!session) {
        json(response, 404, { error: "Unknown session" });
        return true;
      }
      const payload = await readArtifactMetadata(session, params.get("path"));
      json(response, 200, payload);
    } catch (error) {
      json(response, 404, { error: error.message || "Artifact not found" });
    }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/artifact/download") {
    const params = new URL(request.url, `http://localhost:${port}`).searchParams;
    try {
      const artifactPath = params.get("path");
      const session = await workspaceSessionFromRequest(params, artifactPath, workspaceScope);
      const payload = await artifactDownloadTarget(session, artifactPath);
      const encodedName = encodeURIComponent(payload.name).replace(/[!'()*]/g, (char) =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`
      );
      const fallbackName = asciiHeaderFilename(payload.name);
      response.writeHead(200, {
        "Content-Type": payload.mime,
        "Content-Length": String(payload.size),
        "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "no-store",
      });
      createReadStream(payload.target).pipe(response);
    } catch (error) {
      json(response, 400, { error: error.message || "Could not download artifact" });
    }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/artifact/save-copy") {
    try {
      const body = await readJson(request);
      const params = new URLSearchParams();
      if (body.session) params.set("session", body.session);
      if (body.workspacePath) params.set("workspacePath", body.workspacePath);
      if (body.workspaceName) params.set("workspaceName", body.workspaceName);
      const session = await workspaceSessionFromRequest(params, body.path, workspaceScope);
      const saved = await copyArtifactToFolder(session, body.path, body.folderPath);
      json(response, 200, { saved });
    } catch (error) {
      json(response, 400, { error: error.message || "Could not save artifact" });
    }
    return true;
  }

  if (request.method === "DELETE" && pathname === "/api/artifact") {
    try {
      const body = await readJson(request);
      const params = new URLSearchParams();
      if (body.session) params.set("session", body.session);
      if (body.workspacePath) params.set("workspacePath", body.workspacePath);
      if (body.workspaceName) params.set("workspaceName", body.workspaceName);
      const session = await workspaceSessionFromRequest(params, body.path, workspaceScope);
      const deleted = await deleteArtifactFile(session, body.path);
      json(response, 200, { deleted });
    } catch (error) {
      json(response, 400, { error: error.message || "Could not delete artifact" });
    }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/artifact/save") {
    const body = await readJson(request);
    const session = sessions.get(body.session);
    if (!session) {
      json(response, 404, { error: "Unknown session" });
      return true;
    }
    try {
      const artifact = await saveArtifactFile(session, body.path, body.content);
      json(response, 200, { artifact });
    } catch (error) {
      json(response, 400, { error: error.message || "Could not save artifact" });
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
    try {
      const session = await workspaceSessionFromRequest(params, "", workspaceScope);
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
    const deliveryMode = String(body.mode || "").trim().toLowerCase();
    if (!line && attachments.length === 0) {
      json(response, 400, { error: "Message is empty" });
      return true;
    }
    if (session.busy) {
      if (attachments.length > 0) {
        json(response, 409, { error: "Attachments cannot be sent while the session is busy" });
        return true;
      }
      const queued = deliveryMode === "queue" || deliveryMode === "queued";
      const ok = sendBackend(session, { type: queued ? "queue_line" : "steer_line", line });
      json(response, ok ? 200 : 409, { ok, queued, steering: !queued });
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
        workspaceScope,
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
        workspaceScope,
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

if (!String(process.env.OPENHARNESS_WORKSPACE_SCOPE || "").trim()) {
  const savedScopeSettings = await readJsonFileIfExists(join(globalConfigDir(), "settings.json")) || {};
  workspaceScopeMode = normalizeWorkspaceScopeMode(savedScopeSettings.web_workspace_scope || savedScopeSettings.workspace_scope || workspaceScopeMode);
}
if (!String(process.env.OPENHARNESS_SHELL || "").trim()) {
  const savedShellSettings = await readJsonFileIfExists(join(globalConfigDir(), "settings.json")) || {};
  shellPreference = normalizeShellPreference(savedShellSettings.shell || savedShellSettings.web_shell || shellPreference);
}

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
  console.log(`Workspace scope: ${workspaceScopeMode}`);
  console.log(`Shell: ${shellPreference}`);
});
