import {
  artifactCategoryForPath,
  isDefaultProjectFileCandidate,
  projectFileCategories,
  projectFileDirectory,
} from "./projectFiles.js";

export function createArtifacts(ctx) {
  const { state, els } = ctx;
  function setMarkdown(...args) { return ctx.setMarkdown(...args); }

const artifactPanelWidthKey = "myharness:artifactPanelWidth";
const artifactPanelMinWidth = 320;
const artifactPanelMaxWidth = 1280;
let artifactPanelReturnView = null;
let pendingArtifactPanelReturnView = null;
let artifactHistoryMode = "";
let restoringArtifactHistory = false;
let artifactHistoryBackPending = false;
let activeArtifactFrameWindow = null;
let artifactFrameBackFallbackTimer = 0;
const artifactFrameBackMessage = "myharness:artifact-panel-back";
const artifactFrameResizeMessage = "myharness:artifact-panel-resize";
const artifactFrameOptimalWidthMessage = "myharness:artifact-panel-optimal-width";
let artifactFrameResizeCleanup = null;
const artifactExtensions = new Set([
  "html",
  "htm",
  "md",
  "markdown",
  "txt",
  "json",
  "csv",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "log",
  "py",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "css",
  "sql",
  "sh",
  "ps1",
  "bat",
  "cmd",
  "png",
  "gif",
  "jpg",
  "jpeg",
  "webp",
  "svg",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "zip",
]);
const imageExtensions = new Set(["png", "gif", "jpg", "jpeg", "webp", "svg"]);
const textExtensions = new Set([
  "md",
  "markdown",
  "txt",
  "json",
  "csv",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "log",
  "py",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "css",
  "sql",
  "sh",
  "ps1",
  "bat",
  "cmd",
]);
const documentExtensions = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip"]);
const artifactPathExtensionPattern = "html?|md|markdown|txt|json|csv|xml|ya?ml|toml|ini|log|py|m?js|cjs|tsx?|jsx|css|sql|sh|ps1|bat|cmd|png|gif|jpe?g|webp|svg|pdf|docx?|xlsx?|pptx?|zip";
const hiddenProjectFilePrefixes = [
  "autopilot-dashboard/",
  "docs/autopilot/",
];
const projectFileFilterKey = "myharness:projectFileFilter";
const projectFileCollapsedDirsKey = "myharness:projectFileCollapsedDirs";

function isArtifactHistoryState(value) {
  return Boolean(value && value.myharnessArtifactPanel === true);
}

function artifactHistoryState(view, artifact = null) {
  return {
    myharnessArtifactPanel: true,
    view,
    session: state.sessionId || "",
    workspaceName: state.workspaceName || "",
    path: artifact?.path || "",
    name: artifact?.name || "",
    kind: artifact?.kind || "",
    label: artifact?.label || "",
    size: artifact?.size,
  };
}

function sameArtifactHistoryState(nextState) {
  const current = history.state;
  return isArtifactHistoryState(current)
    && current.view === nextState.view
    && String(current.path || "") === String(nextState.path || "");
}

function pushArtifactHistory(view, artifact = null) {
  if (restoringArtifactHistory) {
    artifactHistoryMode = view;
    return;
  }
  const nextState = artifactHistoryState(view, artifact);
  artifactHistoryMode = view;
  if (sameArtifactHistoryState(nextState)) {
    return;
  }
  history.pushState(nextState, "", window.location.href);
}

function isBackMouseButton(event) {
  return event?.button === 3 || event?.button === 4;
}

function requestArtifactHistoryBack(event = null) {
  if (!artifactHistoryMode || !isArtifactHistoryState(history.state)) {
    return false;
  }
  if (artifactHistoryBackPending) {
    return true;
  }
  artifactHistoryBackPending = true;
  window.setTimeout(() => {
    artifactHistoryBackPending = false;
  }, 900);
  history.back();
  return true;
}

function clearArtifactFrameBackFallback() {
  if (!artifactFrameBackFallbackTimer) {
    return;
  }
  window.clearTimeout(artifactFrameBackFallbackTimer);
  artifactFrameBackFallbackTimer = 0;
}

function cleanupArtifactFrameResizeObserver() {
  artifactFrameResizeCleanup?.();
  artifactFrameResizeCleanup = null;
}

function postArtifactFrameResize(frame) {
  if (!frame?.isConnected || !frame.contentWindow) {
    return;
  }
  const rect = frame.getBoundingClientRect();
  frame.contentWindow.postMessage({
    type: artifactFrameResizeMessage,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }, "*");
}

function observeArtifactFrameResize(frame) {
  cleanupArtifactFrameResizeObserver();
  let lastWidth = -1;
  let frameId = 0;
  let observer = null;
  const targets = [frame, els.artifactViewer, els.artifactPanel].filter(Boolean);
  const cleanup = () => {
    if (frameId) {
      window.cancelAnimationFrame(frameId);
      frameId = 0;
    }
    observer?.disconnect();
    window.removeEventListener("resize", schedule);
  };
  const schedule = () => {
    if (!frame.isConnected) {
      cleanupArtifactFrameResizeObserver();
      return;
    }
    const width = Math.round(frame.getBoundingClientRect().width);
    if (width < 1 || width === lastWidth) {
      return;
    }
    lastWidth = width;
    if (frameId) {
      window.cancelAnimationFrame(frameId);
    }
    frameId = window.requestAnimationFrame(() => {
      frameId = 0;
      postArtifactFrameResize(frame);
    });
  };
  if (window.ResizeObserver) {
    observer = new ResizeObserver(schedule);
    targets.forEach((target) => observer.observe(target));
  }
  window.addEventListener("resize", schedule);
  schedule();
  window.setTimeout(schedule, 120);
  window.setTimeout(schedule, 420);
  artifactFrameResizeCleanup = cleanup;
}

function withArtifactFrameBackBridge(content) {
  const bridge = `
<script>
(() => {
  let pending = false;
  let lastOptimalWidth = 0;
  const sendBack = (event) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    event.stopPropagation();
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; }, 900);
    parent.postMessage({ type: "${artifactFrameBackMessage}" }, "*");
  };
  window.addEventListener("mousedown", sendBack, true);
  window.addEventListener("mouseup", sendBack, true);
  window.addEventListener("auxclick", sendBack, true);
  const dispatchResize = () => {
    try {
      window.dispatchEvent(new Event("resize"));
    } catch (error) {
      const resizeEvent = document.createEvent("Event");
      resizeEvent.initEvent("resize", true, true);
      window.dispatchEvent(resizeEvent);
    }
  };
  const cssLengthToPx = (value) => {
    const text = String(value || "");
    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    let best = 0;
    for (const match of text.matchAll(/(-?\\d*\\.?\\d+)\\s*(px|rem|em)/gi)) {
      const number = Number(match[1]);
      if (!Number.isFinite(number) || number <= 0) continue;
      const unit = match[2].toLowerCase();
      const px = unit === "px" ? number : number * rootSize;
      if (px >= 280 && px <= 2400) {
        best = Math.max(best, px);
      }
    }
    return best;
  };
  const maxWidthFromStylesheets = () => {
    let best = 0;
    for (const sheet of Array.from(document.styleSheets || [])) {
      let rules = [];
      try {
        rules = Array.from(sheet.cssRules || []);
      } catch {
        continue;
      }
      const visit = (rule) => {
        if (rule?.cssRules) {
          Array.from(rule.cssRules || []).forEach(visit);
          return;
        }
        best = Math.max(best, cssLengthToPx(rule?.style?.maxWidth));
      };
      rules.forEach(visit);
    }
    return best;
  };
  const maxWidthFromElements = () => {
    let best = 0;
    const selectors = [
      "body",
      "main",
      "article",
      "section",
      "[class*='container' i]",
      "[class*='wrapper' i]",
      "[class*='layout' i]",
      "[class*='dashboard' i]",
      "[class*='canvas' i]",
      "[class*='app' i]",
      "[class*='page' i]"
    ];
    const nodes = new Set();
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => nodes.add(node));
    }
    nodes.forEach((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || style.display === "none" || style.visibility === "hidden") {
        return;
      }
      best = Math.max(best, cssLengthToPx(style.maxWidth), cssLengthToPx(node.style?.maxWidth));
    });
    return best;
  };
  const postOptimalWidth = () => {
    const width = Math.ceil(Math.max(maxWidthFromStylesheets(), maxWidthFromElements()));
    if (width < 1 || Math.abs(width - lastOptimalWidth) < 4) return;
    lastOptimalWidth = width;
    parent.postMessage({ type: "${artifactFrameOptimalWidthMessage}", width }, "*");
  };
  const scheduleOptimalWidth = () => {
    requestAnimationFrame(() => {
      postOptimalWidth();
      setTimeout(postOptimalWidth, 120);
      setTimeout(postOptimalWidth, 420);
    });
  };
  window.addEventListener("message", (event) => {
    if (event.data?.type !== "${artifactFrameResizeMessage}") return;
    dispatchResize();
    requestAnimationFrame(dispatchResize);
    setTimeout(dispatchResize, 120);
    scheduleOptimalWidth();
  });
  window.addEventListener("load", scheduleOptimalWidth);
  scheduleOptimalWidth();
})();
</script>`;
  const value = String(content || "");
  if (/<\/body\s*>/i.test(value)) {
    return value.replace(/<\/body\s*>/i, `${bridge}</body>`);
  }
  return `${value}${bridge}`;
}

function normalizeArtifactPath(value) {
  return String(value || "")
    .trim()
    .replace(/^file:\/\//i, "")
    .replace(/^["'`]+|["'`.,;:)]+$/g, "")
    .replace(/\\/g, "/");
}

function projectFileQuery(extra = {}) {
  const query = new URLSearchParams();
  if (state.sessionId) {
    query.set("session", state.sessionId);
    query.set("clientId", state.clientId);
  }
  if (state.workspacePath) {
    query.set("workspacePath", state.workspacePath);
  }
  if (state.workspaceName) {
    query.set("workspaceName", state.workspaceName);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) {
      query.set(key, String(value));
    }
  }
  return query;
}

function artifactName(path) {
  const normalized = normalizeArtifactPath(path);
  return normalized.split("/").filter(Boolean).pop() || normalized || "artifact";
}

function artifactExtension(path) {
  const name = artifactName(path);
  const match = name.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

function artifactKind(path) {
  const ext = artifactExtension(path);
  if (ext === "html" || ext === "htm") return "html";
  if (imageExtensions.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (textExtensions.has(ext)) return "text";
  return "file";
}

function sourceLanguageForArtifact(path) {
  const ext = artifactExtension(path);
  const aliases = {
    htm: "html",
    html: "html",
    md: "markdown",
    markdown: "markdown",
    txt: "plaintext",
    json: "json",
    csv: "csv",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    ini: "ini",
    log: "plaintext",
    svg: "xml",
    xml: "xml",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    tsx: "typescript",
    jsx: "javascript",
    css: "css",
    py: "python",
    sql: "sql",
    ps1: "powershell",
    sh: "bash",
    bat: "dos",
    cmd: "dos",
  };
  return aliases[ext] || ext || "plaintext";
}

function artifactLabel(kind) {
  if (kind === "html") return "HTML";
  if (kind === "image") return "이미지";
  if (kind === "pdf") return "PDF";
  if (kind === "text") return "텍스트";
  return "파일";
}

function artifactLabelForPath(path, kind = artifactKind(path)) {
  if (kind === "file") {
    const ext = artifactExtension(path);
    if (documentExtensions.has(ext)) {
      return ext.toUpperCase();
    }
  }
  return artifactLabel(kind);
}

function labelForArtifact(artifact) {
  return artifact.label || artifactLabelForPath(artifact.path, artifact.kind);
}

function isProjectFileArtifact(artifact) {
  return String(artifact?.id || "").startsWith("project-file-");
}

function artifactIcon(kind) {
  if (kind === "html") return "&lt;/&gt;";
  if (kind === "image") return "IMG";
  if (kind === "pdf") return "PDF";
  if (kind === "text") return "TXT";
  return "FILE";
}

function collectArtifactCandidates(text) {
  const value = String(text || "");
  const candidates = [];
  const push = (candidate) => {
    const normalized = normalizeArtifactPath(candidate);
    const ext = artifactExtension(normalized);
    if (!normalized || !artifactExtensions.has(ext) || /^https?:\/\//i.test(normalized)) {
      return;
    }
    candidates.push(normalized);
  };

  for (const match of value.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    push(match[1]);
  }
  const backtickPattern = new RegExp(`\`([^\`\\n]+\\.(?:${artifactPathExtensionPattern}))\``, "gi");
  const pathPattern = new RegExp(`(?:^|[\\s(["'])((?:[A-Za-z]:)?[^\\s<>"'()]*\\.(?:${artifactPathExtensionPattern}))`, "gim");

  for (const match of value.matchAll(backtickPattern)) {
    push(match[1]);
  }
  for (const match of value.matchAll(pathPattern)) {
    push(match[1]);
  }

  const seen = new Set();
  return candidates
    .filter((path) => {
      const key = path.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 8)
    .map((path, index) => {
      const kind = artifactKind(path);
      return {
        id: `artifact-${Date.now()}-${index}`,
        path,
        name: artifactName(path),
        kind,
        label: artifactLabelForPath(path, kind),
      };
    });
}

function dedupeArtifactsByResolvedPath(artifacts) {
  const seen = new Set();
  return artifacts.filter((artifact) => {
    const key = normalizeArtifactPath(artifact?.path).toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function renderArtifactCards(container, artifacts) {
  const uniqueArtifacts = dedupeArtifactsByResolvedPath(artifacts);
  if (!container || !uniqueArtifacts.length) {
    return;
  }
  const keys = new Set(uniqueArtifacts.map((artifact) => normalizeArtifactPath(artifact.path).toLowerCase()));
  for (const existing of els.messages?.querySelectorAll(".artifact-card") || []) {
    const existingKey = String(existing.dataset.artifactPath || "").toLowerCase();
    if (keys.has(existingKey) && !container.contains(existing)) {
      const wrap = existing.closest(".artifact-cards");
      existing.remove();
      if (wrap && !wrap.querySelector(".artifact-card")) {
        wrap.remove();
      }
    }
  }
  for (const existingWrap of container.querySelectorAll(".artifact-cards")) {
    existingWrap.remove();
  }
  const wrap = document.createElement("div");
  wrap.className = "artifact-cards";
  for (const artifact of uniqueArtifacts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "artifact-card";
    button.dataset.artifactId = artifact.id;
    button.dataset.artifactPath = normalizeArtifactPath(artifact.path);
    button.innerHTML = `
      <span class="artifact-card-icon" aria-hidden="true">${artifactIcon(artifact.kind)}</span>
      <span class="artifact-card-copy">
        <strong></strong>
        <small></small>
      </span>
    `;
    button.querySelector("strong").textContent = artifact.name;
    button.querySelector("small").textContent = typeof artifact.size === "number"
      ? `${labelForArtifact(artifact)} · ${formatBytes(artifact.size)}`
      : labelForArtifact(artifact);
    button.addEventListener("click", () => openArtifact(artifact));
    wrap.append(button);
  }
  container.append(wrap);
}

async function resolveExistingArtifacts(artifacts) {
  if (!state.sessionId || !artifacts.length) {
    return [];
  }
  const resolved = await Promise.all(
    artifacts.map(async (artifact) => {
      const query = new URLSearchParams({
        session: state.sessionId,
        clientId: state.clientId,
        path: artifact.path,
      });
      try {
        const response = await fetch(`/api/artifact/resolve?${query.toString()}`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          return null;
        }
        const payload = await response.json();
        return {
          ...artifact,
          path: payload.path || artifact.path,
          name: payload.name || artifact.name,
          kind: payload.kind || artifact.kind,
          label: artifactLabelForPath(payload.path || artifact.path, payload.kind || artifact.kind),
          size: payload.size,
        };
      } catch {
        return null;
      }
    }),
  );
  return dedupeArtifactsByResolvedPath(resolved.filter(Boolean));
}

function setArtifactPanel(open) {
  state.artifactPanelOpen = open;
  if (open) {
    applyStoredArtifactPanelWidth();
    els.appShell?.classList.add("artifact-open");
    els.artifactPanel?.classList.remove("hidden", "closing");
  } else {
    setArtifactFullscreen(false);
    els.artifactPanel?.classList.add("hidden");
    els.artifactPanel?.classList.remove("closing");
    els.appShell?.classList.remove("artifact-open");
  }
}

function setArtifactFullscreen(enabled) {
  els.artifactPanel?.classList.toggle("fullscreen", enabled);
  if (!els.artifactPanelFullscreen) {
    return;
  }
  els.artifactPanelFullscreen.setAttribute("aria-pressed", enabled ? "true" : "false");
  els.artifactPanelFullscreen.setAttribute(
    "aria-label",
    enabled ? "산출물 미리보기 축소" : "산출물 미리보기 확대",
  );
  els.artifactPanelFullscreen.dataset.tooltip = enabled ? "미리보기 축소" : "미리보기 확대";
  els.artifactPanelFullscreen.innerHTML = enabled
    ? `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M8 3v3a2 2 0 0 1-2 2H3"></path>
        <path d="M16 3v3a2 2 0 0 0 2 2h3"></path>
        <path d="M8 21v-3a2 2 0 0 0-2-2H3"></path>
        <path d="M16 21v-3a2 2 0 0 1 2-2h3"></path>
      </svg>
    `
    : `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
        <path d="M16 3h3a2 2 0 0 1 2 2v3"></path>
        <path d="M8 21H5a2 2 0 0 1-2-2v-3"></path>
        <path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
      </svg>
    `;
}

function toggleArtifactFullscreen() {
  const enabled = !els.artifactPanel?.classList.contains("fullscreen");
  setArtifactFullscreen(enabled);
}

function clampArtifactPanelWidth(value) {
  const viewportLimit = Math.max(artifactPanelMinWidth, Math.floor(window.innerWidth * 0.84));
  const maxWidth = Math.min(artifactPanelMaxWidth, viewportLimit);
  return Math.min(maxWidth, Math.max(artifactPanelMinWidth, Math.round(Number(value) || 0)));
}

function setArtifactPanelWidth(width, persist = false) {
  const nextWidth = clampArtifactPanelWidth(width);
  els.appShell?.style.setProperty("--artifact-panel-width", `${nextWidth}px`);
  if (persist) {
    localStorage.setItem(artifactPanelWidthKey, String(nextWidth));
  }
  return nextWidth;
}

function setArtifactPanelWidthForFrameContent(contentWidth) {
  if (!Number.isFinite(contentWidth) || contentWidth < 1 || els.artifactPanel?.classList.contains("fullscreen")) {
    return;
  }
  const frame = els.artifactViewer?.querySelector(".artifact-frame");
  if (!frame) {
    return;
  }
  const panelWidth = els.artifactPanel?.getBoundingClientRect().width || 0;
  const frameWidth = frame.getBoundingClientRect().width || 0;
  const chromeWidth = Math.max(0, panelWidth - frameWidth);
  const nextWidth = clampArtifactPanelWidth(contentWidth + chromeWidth);
  if (!panelWidth || Math.abs(nextWidth - panelWidth) < 8) {
    return;
  }
  setArtifactPanelWidth(nextWidth);
}

function applyStoredArtifactPanelWidth() {
  const stored = Number(localStorage.getItem(artifactPanelWidthKey) || 0);
  if (stored > 0) {
    setArtifactPanelWidth(stored);
  }
}

function showArtifactLoading(artifact) {
  state.activeArtifactRaw = "";
  state.activeArtifactPayload = null;
  state.artifactSourceMode = false;
  updateArtifactCopyButton(false);
  updateArtifactSourceButton(false);
  if (els.artifactPanelTitle) {
    els.artifactPanelTitle.textContent = artifact.name;
  }
  if (els.artifactPanelMeta) {
    els.artifactPanelMeta.textContent = `${labelForArtifact(artifact)} · 불러오는 중`;
  }
  if (els.artifactViewer) {
    els.artifactViewer.innerHTML = `<p class="artifact-empty">산출물을 불러오는 중...</p>`;
  }
}

function renderArtifactRenderedView(artifact, payload) {
  if (!els.artifactViewer) {
    return;
  }
  activeArtifactFrameWindow = null;
  cleanupArtifactFrameResizeObserver();
  els.artifactViewer.textContent = "";
  if (payload.name && els.artifactPanelTitle) {
    els.artifactPanelTitle.textContent = payload.name;
  }
  if (els.artifactPanelMeta) {
    const size = typeof payload.size === "number" ? ` · ${formatBytes(payload.size)}` : "";
    els.artifactPanelMeta.textContent = `${labelForArtifact(artifact)}${size}`;
  }

  if (payload.kind === "html") {
    const iframe = document.createElement("iframe");
    iframe.className = "artifact-frame";
    iframe.sandbox = "allow-scripts";
    iframe.addEventListener("load", () => {
      activeArtifactFrameWindow = iframe.contentWindow;
      postArtifactFrameResize(iframe);
    });
    iframe.srcdoc = withArtifactFrameBackBridge(payload.content);
    els.artifactViewer.append(iframe);
    observeArtifactFrameResize(iframe);
    return;
  }
  if (payload.kind === "image") {
    const img = document.createElement("img");
    img.className = "artifact-image";
    img.src = payload.dataUrl || "";
    img.alt = artifact.name;
    els.artifactViewer.append(img);
    return;
  }
  if (payload.kind === "pdf") {
    const frame = document.createElement("iframe");
    frame.className = "artifact-frame";
    frame.addEventListener("load", () => {
      activeArtifactFrameWindow = frame.contentWindow;
    });
    frame.src = payload.dataUrl || "";
    els.artifactViewer.append(frame);
    return;
  }
  if (payload.kind === "file") {
    const wrap = document.createElement("div");
    wrap.className = "artifact-file";
    const message = document.createElement("p");
    message.className = "artifact-empty";
    message.textContent = "이 파일 형식은 미리보기 대신 다운로드로 열 수 있습니다.";
    const download = document.createElement("button");
    download.type = "button";
    download.className = "artifact-file-download";
    download.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 3v11"></path>
        <path d="m7 10 5 5 5-5"></path>
        <path d="M5 20h14"></path>
      </svg>
      <span>다운로드</span>
    `;
    download.addEventListener("click", async () => {
      download.disabled = true;
      try {
        await downloadProjectFile(artifact, download);
      } catch (error) {
        setArtifactDownloadStatus(`다운로드 실패: ${error.message}`, true);
        download.dataset.tooltip = `다운로드 실패: ${error.message}`;
      } finally {
        download.disabled = false;
      }
    });
    wrap.append(message, download);
    els.artifactViewer.append(wrap);
    return;
  }
  if (["md", "markdown"].includes(artifactExtension(artifact.path))) {
    const markdown = document.createElement("div");
    markdown.className = "artifact-markdown markdown-body";
    setMarkdown(markdown, payload.content || "(내용 없음)");
    els.artifactViewer.append(markdown);
    return;
  }
  const pre = document.createElement("pre");
  pre.className = "artifact-text";
  pre.textContent = payload.content || "(내용 없음)";
  els.artifactViewer.append(pre);
}

function renderArtifactSourceView(artifact, payload) {
  if (!els.artifactViewer) {
    return;
  }
  activeArtifactFrameWindow = null;
  cleanupArtifactFrameResizeObserver();
  els.artifactViewer.textContent = "";
  if (payload.name && els.artifactPanelTitle) {
    els.artifactPanelTitle.textContent = payload.name;
  }
  if (els.artifactPanelMeta) {
    const size = typeof payload.size === "number" ? ` · ${formatBytes(payload.size)}` : "";
    els.artifactPanelMeta.textContent = `${labelForArtifact(artifact)} 원문${size}`;
  }
  const pre = document.createElement("pre");
  pre.className = "artifact-text artifact-source";
  const code = document.createElement("code");
  code.className = `language-${sourceLanguageForArtifact(artifact.path)}`;
  code.textContent = String(payload.content || state.activeArtifactRaw || "(내용 없음)");
  pre.append(code);
  els.artifactViewer.append(pre);
  if (window.hljs && !code.dataset.highlighted) {
    window.hljs.highlightElement(code);
  }
}

function renderArtifactPreview(artifact, payload) {
  state.activeArtifactRaw = String(payload.content || payload.dataUrl || "");
  state.activeArtifactPayload = payload;
  updateArtifactCopyButton(Boolean(state.activeArtifactRaw));
  updateArtifactSourceButton(Boolean(payload.content));
  if (state.artifactSourceMode && payload.content) {
    renderArtifactSourceView(artifact, payload);
    return;
  }
  renderArtifactRenderedView(artifact, payload);
}

function renderArtifactError(error) {
  state.activeArtifactRaw = "";
  state.activeArtifactPayload = null;
  state.artifactSourceMode = false;
  cleanupArtifactFrameResizeObserver();
  updateArtifactCopyButton(false);
  updateArtifactSourceButton(false);
  if (!els.artifactViewer) {
    return;
  }
  const message = error instanceof Error ? error.message : String(error || "산출물을 열 수 없습니다.");
  els.artifactViewer.innerHTML = "";
  const node = document.createElement("p");
  node.className = "artifact-empty error";
  node.textContent = message;
  els.artifactViewer.append(node);
  if (els.artifactPanelMeta) {
    els.artifactPanelMeta.textContent = "미리보기 실패";
  }
}

function setArtifactDownloadStatus(message, isError = false) {
  if (!els.artifactPanelMeta) {
    return;
  }
  els.artifactPanelMeta.textContent = message;
  els.artifactPanelMeta.classList.toggle("error", Boolean(isError));
}

async function saveArtifactCopy(artifact, folderPath = "") {
  const response = await fetch("/api/artifact/save-copy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      session: state.sessionId || "",
      clientId: state.clientId,
      workspacePath: state.workspacePath || "",
      workspaceName: state.workspaceName || "",
      path: artifact.path,
      folderPath,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload.saved || {};
}

function isLocalBrowserHost() {
  const host = String(window.location.hostname || "").trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

async function fetchArtifactBlob(artifact) {
  const query = projectFileQuery({ path: artifact.path });
  const response = await fetch(`/api/artifact/download?${query.toString()}`);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let message = body || `HTTP ${response.status}`;
    try {
      message = JSON.parse(body).error || message;
    } catch {
      // Keep the raw response text when the server does not return JSON.
    }
    throw new Error(message);
  }
  return response.blob();
}

async function saveArtifactWithBrowserDownload(artifact, suggestedName) {
  const blob = await fetchArtifactBlob(artifact);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName || artifact.name || artifactName(artifact.path);
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadProjectFile(artifact, control) {
  const suggestedName = artifact.name || artifactName(artifact.path);
  const downloadSettings = state.appSettings || {};
  setArtifactDownloadStatus("다운로드 준비 중...");
  if (downloadSettings.downloadMode === "folder" && downloadSettings.downloadFolderPath && isLocalBrowserHost()) {
    const saved = await saveArtifactCopy(artifact, downloadSettings.downloadFolderPath);
    const savedPath = saved.path || downloadSettings.downloadFolderPath;
    setArtifactDownloadStatus(`저장됨: ${savedPath}`);
    if (control) {
      control.dataset.tooltip = `저장됨: ${savedPath}`;
      window.setTimeout(() => {
        if (control.isConnected) {
          control.dataset.tooltip = "다운로드";
        }
      }, 2200);
    }
    return;
  }

  let fileHandle = null;
  if (typeof window.showSaveFilePicker === "function") {
    try {
      fileHandle = await window.showSaveFilePicker({ suggestedName });
    } catch (error) {
      if (error?.name === "AbortError") {
        if (control) {
          control.dataset.tooltip = "저장 취소됨";
        }
        setArtifactDownloadStatus("저장 취소됨");
        return;
      }
      throw error;
    }
  }

  if (fileHandle) {
    const blob = await fetchArtifactBlob(artifact);
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    setArtifactDownloadStatus("선택한 위치에 저장됨");
    if (control) {
      control.dataset.tooltip = "선택한 위치에 저장됨";
      window.setTimeout(() => {
        if (control.isConnected) {
          control.dataset.tooltip = "다운로드";
        }
      }, 1600);
    }
    return;
  }

  await saveArtifactWithBrowserDownload(artifact, suggestedName);
  setArtifactDownloadStatus("브라우저 다운로드 시작됨");
  if (control) {
    control.dataset.tooltip = "브라우저 다운로드 시작됨";
    window.setTimeout(() => {
      if (control.isConnected) {
        control.dataset.tooltip = "다운로드";
      }
    }, 3000);
  }
  return;
}

function projectFileSortKey(file) {
  return String(file?.path || file?.name || "").replace(/\\/g, "/");
}

function projectFileRecentTime(file) {
  const modified = Number(file?.mtimeMs);
  if (Number.isFinite(modified) && modified > 0) {
    return modified;
  }
  const created = Number(file?.birthtimeMs);
  return Number.isFinite(created) && created > 0 ? created : 0;
}

function isVisibleProjectFile(file) {
  const key = projectFileSortKey(file).replace(/^\/+/, "");
  return !hiddenProjectFilePrefixes.some((prefix) => key === prefix.slice(0, -1) || key.startsWith(prefix));
}

function sortedProjectFiles(files) {
  const filter = String(state.projectFileFilter || "all");
  const source = (Array.isArray(files) ? files.filter(isVisibleProjectFile) : [])
    .filter((file) => filter === "all" || artifactCategoryForPath(file?.path || file?.name) === filter);
  const comparePath = (left, right) =>
    projectFileSortKey(left).localeCompare(projectFileSortKey(right), "ko", {
      numeric: true,
      sensitivity: "base",
    });
  if (state.projectFileSortMode === "path") {
    return source.sort(comparePath);
  }
  return source.sort((left, right) =>
    projectFileRecentTime(right) - projectFileRecentTime(left) || comparePath(left, right),
  );
}

function saveProjectFileCollapsedDirs() {
  localStorage.setItem(projectFileCollapsedDirsKey, JSON.stringify([...state.projectFileCollapsedDirs || []]));
}

function groupedProjectFiles(files) {
  const groups = new Map();
  for (const file of files) {
    const directory = projectFileDirectory(file.path || file.name);
    if (!groups.has(directory)) {
      groups.set(directory, []);
    }
    groups.get(directory).push(file);
  }
  return [...groups.entries()];
}

function closeProjectFileModal() {
  if (!els.modalHost) {
    return;
  }
  els.modalHost.classList.add("hidden");
  els.modalHost.textContent = "";
  delete els.modalHost.dataset.dismissible;
}

function showOrganizeProjectFilesModal(candidates) {
  if (!els.modalHost) {
    return;
  }
  const files = Array.isArray(candidates) ? candidates : [];
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  els.modalHost.dataset.dismissible = "true";

  const card = document.createElement("div");
  card.className = "modal-card project-file-organize-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");

  const close = document.createElement("button");
  close.type = "button";
  close.className = "modal-close";
  close.setAttribute("aria-label", "닫기");
  close.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M6 6l12 12"></path>
      <path d="M18 6L6 18"></path>
    </svg>
  `;
  close.addEventListener("click", closeProjectFileModal);

  const title = document.createElement("h2");
  title.textContent = "루트 산출물 정리";
  const body = document.createElement("p");
  body.textContent = "선택한 루트 파일을 outputs 폴더로 이동합니다. 같은 이름은 자동으로 번호를 붙입니다.";

  const list = document.createElement("div");
  list.className = "project-file-organize-list";
  for (const file of files) {
    const path = String(file.path || file.name || "");
    const row = document.createElement("label");
    row.className = "project-file-organize-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = path;
    input.checked = true;
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = path;
    const target = document.createElement("small");
    target.textContent = `outputs/${file.name || path}`;
    copy.append(name, target);
    row.append(input, copy);
    list.append(row);
  }

  const status = document.createElement("p");
  status.className = "settings-helper workspace-error";
  status.textContent = "";

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "modal-button";
  cancel.textContent = "취소";
  cancel.addEventListener("click", closeProjectFileModal);
  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "modal-button primary";
  submit.textContent = "선택 파일 이동";
  submit.addEventListener("click", async () => {
    const paths = [...list.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value);
    if (!paths.length) {
      status.textContent = "이동할 파일을 선택하세요.";
      return;
    }
    submit.disabled = true;
    status.textContent = "이동 중...";
    try {
      const response = await fetch("/api/project-files/organize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          session: state.sessionId || "",
          clientId: state.clientId,
          workspacePath: state.workspacePath || "",
          workspaceName: state.workspaceName || "",
          paths,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "파일을 정리하지 못했습니다.");
      }
      closeProjectFileModal();
      state.projectFilesLoadedForSession = "";
      await openProjectFiles({ scope: state.projectFileScope || "default", force: true });
    } catch (error) {
      submit.disabled = false;
      status.textContent = `정리 실패: ${error.message}`;
    }
  });
  actions.append(cancel, submit);
  card.append(close, title, body, list, status, actions);
  els.modalHost.append(card);
}

function renderProjectFiles(files) {
  artifactPanelReturnView = null;
  pendingArtifactPanelReturnView = null;
  setArtifactCloseMode("close");
  if (state.artifactPanelOpen) {
    artifactHistoryMode = "list";
  }
  activeArtifactFrameWindow = null;
  cleanupArtifactFrameResizeObserver();
  state.activeArtifactRaw = "";
  state.activeArtifactPayload = null;
  state.artifactSourceMode = false;
  updateArtifactCopyButton(false);
  updateArtifactSourceButton(false);
  if (!els.artifactViewer) {
    return;
  }
  els.artifactViewer.textContent = "";
  const visibleFiles = sortedProjectFiles(files);
  const toolbar = document.createElement("div");
  toolbar.className = "project-file-toolbar";
  const sortSummary = document.createElement("span");
  sortSummary.className = "project-file-sort-summary";
  sortSummary.textContent = state.projectFileScope === "all"
    ? "전체 프로젝트 파일을 표시합니다"
    : "outputs와 루트 산출물 후보를 표시합니다";

  const controls = document.createElement("div");
  controls.className = "project-file-controls";

  const filterLabel = document.createElement("label");
  filterLabel.className = "project-file-sort";
  const filterText = document.createElement("span");
  filterText.textContent = "유형";
  const filterSelect = document.createElement("select");
  filterSelect.setAttribute("aria-label", "프로젝트 파일 유형 필터");
  filterSelect.innerHTML = projectFileCategories
    .map((category) => `<option value="${category.value}">${category.label}</option>`)
    .join("");
  filterSelect.value = projectFileCategories.some((category) => category.value === state.projectFileFilter)
    ? state.projectFileFilter
    : "all";
  filterSelect.addEventListener("change", () => {
    state.projectFileFilter = filterSelect.value || "all";
    localStorage.setItem(projectFileFilterKey, state.projectFileFilter);
    renderProjectFiles(state.projectFiles || []);
  });
  filterLabel.append(filterText, filterSelect);

  const sortLabel = document.createElement("label");
  sortLabel.className = "project-file-sort";
  const sortText = document.createElement("span");
  sortText.textContent = "정렬";
  const sortSelect = document.createElement("select");
  sortSelect.setAttribute("aria-label", "프로젝트 파일 정렬");
  sortSelect.innerHTML = `
    <option value="recent">최신순</option>
    <option value="path">경로+이름순</option>
  `;
  sortSelect.value = state.projectFileSortMode === "path" ? "path" : "recent";
  sortSelect.addEventListener("change", () => {
    state.projectFileSortMode = sortSelect.value === "path" ? "path" : "recent";
    localStorage.setItem("myharness:projectFileSortMode", state.projectFileSortMode);
    renderProjectFiles(state.projectFiles || []);
  });
  sortLabel.append(sortText, sortSelect);

  const rootCandidates = (Array.isArray(files) ? files : [])
    .filter((file) => isDefaultProjectFileCandidate(file.path || file.name) && !String(file.path || file.name).includes("/"));

  const organizeButton = document.createElement("button");
  organizeButton.type = "button";
  organizeButton.className = "project-file-toolbar-button";
  organizeButton.textContent = "정리";
  organizeButton.disabled = rootCandidates.length === 0;
  organizeButton.addEventListener("click", () => showOrganizeProjectFilesModal(rootCandidates));

  const scopeButton = document.createElement("button");
  scopeButton.type = "button";
  scopeButton.className = "project-file-toolbar-button";
  scopeButton.textContent = state.projectFileScope === "all" ? "outputs만" : "전체 보기";
  scopeButton.addEventListener("click", () => {
    openProjectFiles({ scope: state.projectFileScope === "all" ? "default" : "all", force: true });
  });

  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "project-file-toolbar-button";
  refreshButton.setAttribute("aria-label", "프로젝트 파일 새로고침");
  refreshButton.textContent = "새로고침";
  refreshButton.addEventListener("click", () => openProjectFiles({ scope: state.projectFileScope || "default", force: true }));

  controls.append(filterLabel, sortLabel, organizeButton, scopeButton, refreshButton);
  toolbar.append(sortSummary, controls);
  els.artifactViewer.append(toolbar);

  if (!visibleFiles.length) {
    const empty = document.createElement("p");
    empty.className = "artifact-empty";
    empty.textContent = "현재 조건에 맞는 파일이 없습니다.";
    els.artifactViewer.append(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "project-file-list";
  let pendingDeletePath = "";
  const setDeleteIcon = (button, armed = false) => {
    button.innerHTML = armed
      ? `
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 3l9 16H3L12 3z"></path>
          <path d="M12 9v4"></path>
          <path d="M12 17h.01"></path>
        </svg>
      `
      : `
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M3 6h18"></path>
          <path d="M8 6V4h8v2"></path>
          <path d="M19 6l-1 14H6L5 6"></path>
          <path d="M10 11v5"></path>
          <path d="M14 11v5"></path>
        </svg>
      `;
  };
  const clearPendingDelete = () => {
    pendingDeletePath = "";
    list.querySelectorAll(".project-file-item.delete-ready").forEach((row) => {
      row.classList.remove("delete-ready");
      const deleteButton = row.querySelector(".project-file-delete");
      if (deleteButton) {
        deleteButton.dataset.tooltip = "파일 삭제";
        deleteButton.setAttribute("aria-label", `${deleteButton.dataset.fileName || ""} 삭제`);
        setDeleteIcon(deleteButton, false);
      }
    });
  };
  list.addEventListener("click", (event) => {
    if (!pendingDeletePath || event.target.closest(".project-file-delete")) {
      return;
    }
    clearPendingDelete();
  });
  const armOutsideDeleteClear = () => {
    window.setTimeout(() => {
      document.addEventListener("click", (event) => {
        if (!pendingDeletePath || list.contains(event.target)) {
          return;
        }
        clearPendingDelete();
      }, { capture: true, once: true });
    }, 0);
  };

  const appendProjectFileItem = (parent, file) => {
    const artifact = {
      id: `project-file-${file.path}`,
      path: file.path,
      name: file.name,
      kind: file.kind,
      label: artifactLabelForPath(file.path, file.kind),
      size: file.size,
    };
    const item = document.createElement("div");
    item.className = "project-file-item";
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "project-file-open";
    openButton.innerHTML = `
      <span class="artifact-card-icon" aria-hidden="true">${artifactIcon(artifact.kind)}</span>
      <span class="artifact-card-copy">
        <strong></strong>
        <small></small>
      </span>
    `;
    openButton.querySelector("strong").textContent = artifact.path;
    openButton.querySelector("small").textContent = `${artifact.label} · ${formatBytes(artifact.size)}`;
    openButton.addEventListener("click", () => openArtifact(artifact));

    const download = document.createElement("a");
    const query = projectFileQuery({ path: artifact.path });
    download.className = "project-file-download";
    download.href = `/api/artifact/download?${query.toString()}`;
    download.download = artifact.name;
    download.setAttribute("aria-label", `${artifact.name} 다운로드`);
    download.dataset.tooltip = "다운로드";
    download.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 3v11"></path>
        <path d="m7 10 5 5 5-5"></path>
        <path d="M5 20h14"></path>
      </svg>
    `;
    download.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      download.classList.add("is-loading");
      download.dataset.tooltip = "다운로드 중";
      try {
        await downloadProjectFile(artifact, download);
      } catch (error) {
        setArtifactDownloadStatus(`다운로드 실패: ${error.message}`, true);
        download.dataset.tooltip = `다운로드 실패: ${error.message}`;
      } finally {
        download.classList.remove("is-loading");
      }
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "project-file-delete";
    deleteButton.dataset.fileName = artifact.name;
    deleteButton.dataset.tooltip = "파일 삭제";
    deleteButton.setAttribute("aria-label", `${artifact.name} 삭제`);
    setDeleteIcon(deleteButton, false);
    deleteButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (pendingDeletePath !== artifact.path) {
        clearPendingDelete();
        pendingDeletePath = artifact.path;
        item.classList.add("delete-ready");
        deleteButton.dataset.tooltip = "한 번 더 누르면 삭제됩니다";
        deleteButton.setAttribute("aria-label", `${artifact.name} 삭제 확인`);
        setDeleteIcon(deleteButton, true);
        armOutsideDeleteClear();
        return;
      }
      deleteButton.disabled = true;
      item.classList.add("deleting");
      try {
        const response = await fetch("/api/artifact", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            session: state.sessionId || "",
            clientId: state.clientId,
            workspacePath: state.workspacePath || "",
            workspaceName: state.workspaceName || "",
            path: artifact.path,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "파일을 삭제하지 못했습니다.");
        }
        state.projectFiles = (state.projectFiles || []).filter((entry) => entry.path !== artifact.path);
        if (state.activeArtifact?.path === artifact.path) {
          state.activeArtifact = null;
          state.activeArtifactRaw = "";
          state.activeArtifactPayload = null;
        }
        renderProjectFiles(state.projectFiles);
      } catch (error) {
        item.classList.remove("deleting", "delete-ready");
        pendingDeletePath = "";
        deleteButton.disabled = false;
        deleteButton.dataset.tooltip = `삭제 실패: ${error.message}`;
        setDeleteIcon(deleteButton, false);
      }
    });

    const actions = document.createElement("span");
    actions.className = "project-file-actions";
    actions.append(download, deleteButton);

    item.append(openButton, actions);
    parent.append(item);
  };

  for (const [directory, groupFiles] of groupedProjectFiles(visibleFiles)) {
    const section = document.createElement("section");
    section.className = "project-file-section";
    const collapsed = state.projectFileCollapsedDirs?.has(directory);
    section.classList.toggle("collapsed", Boolean(collapsed));

    const header = document.createElement("button");
    header.type = "button";
    header.className = "project-file-section-header";
    header.setAttribute("aria-expanded", collapsed ? "false" : "true");
    header.innerHTML = `
      <span class="project-file-section-caret" aria-hidden="true">›</span>
      <span class="project-file-section-title"></span>
      <small></small>
    `;
    header.querySelector(".project-file-section-title").textContent = directory;
    header.querySelector("small").textContent = `${groupFiles.length}개`;
    header.addEventListener("click", () => {
      if (!state.projectFileCollapsedDirs) {
        state.projectFileCollapsedDirs = new Set();
      }
      if (state.projectFileCollapsedDirs.has(directory)) {
        state.projectFileCollapsedDirs.delete(directory);
      } else {
        state.projectFileCollapsedDirs.add(directory);
      }
      saveProjectFileCollapsedDirs();
      renderProjectFiles(state.projectFiles || []);
    });

    const body = document.createElement("div");
    body.className = "project-file-section-body";
    if (!collapsed) {
      for (const file of groupFiles) {
        appendProjectFileItem(body, file);
      }
    }
    section.append(header, body);
    list.append(section);
  }
  els.artifactViewer.append(list);
}

async function openProjectFiles(options = {}) {
  if (!state.sessionId && !state.workspacePath && !state.workspaceName) {
    return;
  }
  const scope = options.scope === "all" ? "all" : "default";
  const force = options.force === true;
  state.projectFileScope = scope;
  state.activeArtifactRaw = "";
  state.activeArtifactPayload = null;
  state.artifactSourceMode = false;
  artifactPanelReturnView = null;
  pendingArtifactPanelReturnView = null;
  updateArtifactCopyButton(false);
  updateArtifactSourceButton(false);
  setArtifactPanel(true);
  pushArtifactHistory("list");
  if (els.artifactPanelTitle) {
    els.artifactPanelTitle.textContent = "프로젝트 파일";
  }
  if (els.artifactPanelMeta) {
    els.artifactPanelMeta.textContent = scope === "all"
      ? "전체 프로젝트 파일을 불러오는 중"
      : "outputs와 루트 산출물을 불러오는 중";
  }
  if (els.artifactViewer) {
    els.artifactViewer.innerHTML = `<p class="artifact-empty">파일 목록을 불러오는 중...</p>`;
  }
  try {
    const query = projectFileQuery({ scope, force: force ? "true" : undefined });
    const response = await fetch(`/api/project-files?${query.toString()}`, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    const files = Array.isArray(payload.files) ? payload.files : [];
    state.projectFiles = files;
    state.projectFileScope = payload.scope || scope;
    if (els.artifactPanelMeta) {
      els.artifactPanelMeta.textContent = `${files.length}개 파일`;
    }
    renderProjectFiles(files);
  } catch (error) {
    renderArtifactError(error);
  }
}

async function openArtifact(artifact, options = {}) {
  state.activeArtifact = artifact;
  if (
    els.artifactPanelTitle?.textContent === "프로젝트 파일"
    || options.projectFilesReturn
    || isProjectFileArtifact(artifact)
  ) {
    artifactPanelReturnView = {
      kind: "project-files",
      files: Array.isArray(state.projectFiles) ? state.projectFiles : [],
    };
    setArtifactCloseMode("back");
    if (!options.fromHistory) {
      pushArtifactHistory("detail", artifact);
    } else {
      artifactHistoryMode = "detail";
    }
  }
  setArtifactPanel(true);
  showArtifactLoading(artifact);
  try {
    const query = new URLSearchParams({
      session: state.sessionId || "",
      clientId: state.clientId,
      path: artifact.path,
    });
    const response = await fetch(`/api/artifact?${query.toString()}`, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    renderArtifactPreview(artifact, payload);
  } catch (error) {
    renderArtifactError(error);
  }
}

function closeArtifactPanel(options = {}) {
  const fromHistory = options?.fromHistory === true;
  const skipHistory = options?.skipHistory === true;
  if (!fromHistory && !skipHistory && artifactPanelReturnView?.kind === "project-files") {
    pendingArtifactPanelReturnView = artifactPanelReturnView;
  }
  if (!fromHistory && !skipHistory && requestArtifactHistoryBack()) {
    return;
  }
  const returnView = skipHistory ? null : artifactPanelReturnView || pendingArtifactPanelReturnView;
  if (returnView?.kind === "project-files") {
    const files = returnView.files || [];
    artifactPanelReturnView = null;
    pendingArtifactPanelReturnView = null;
    state.activeArtifact = null;
    state.activeArtifactRaw = "";
    state.activeArtifactPayload = null;
    state.artifactSourceMode = false;
    updateArtifactCopyButton(false);
    updateArtifactSourceButton(false);
    setArtifactFullscreen(false);
    if (els.artifactPanelTitle) {
      els.artifactPanelTitle.textContent = "프로젝트 파일";
    }
    if (els.artifactPanelMeta) {
      els.artifactPanelMeta.textContent = `${files.length}개 파일`;
    }
    renderProjectFiles(files);
    return;
  }
  state.activeArtifact = null;
  state.activeArtifactRaw = "";
  state.activeArtifactPayload = null;
  state.artifactSourceMode = false;
  artifactPanelReturnView = null;
  pendingArtifactPanelReturnView = null;
  artifactHistoryMode = "";
  activeArtifactFrameWindow = null;
  cleanupArtifactFrameResizeObserver();
  clearArtifactFrameBackFallback();
  setArtifactCloseMode("close");
  updateArtifactCopyButton(false);
  updateArtifactSourceButton(false);
  setArtifactFullscreen(false);
  setArtifactPanel(false);
}

function setArtifactCloseMode(mode) {
  if (!els.artifactPanelClose) {
    return;
  }
  const isBack = mode === "back";
  els.artifactPanelClose.setAttribute("aria-label", isBack ? "프로젝트 파일 목록으로 돌아가기" : "산출물 패널 닫기");
  els.artifactPanelClose.dataset.tooltip = isBack ? "목록으로" : "닫기";
}

function resetArtifacts() {
  state.artifacts = [];
  state.activeArtifact = null;
  state.activeArtifactRaw = "";
  state.activeArtifactPayload = null;
  state.artifactSourceMode = false;
  artifactPanelReturnView = null;
  pendingArtifactPanelReturnView = null;
  artifactHistoryMode = "";
  activeArtifactFrameWindow = null;
  cleanupArtifactFrameResizeObserver();
  clearArtifactFrameBackFallback();
  setArtifactCloseMode("close");
  updateArtifactCopyButton(false);
  updateArtifactSourceButton(false);
  setArtifactFullscreen(false);
  setArtifactPanel(false);
  if (els.artifactPanelTitle) {
    els.artifactPanelTitle.textContent = "산출물";
  }
  if (els.artifactPanelMeta) {
    els.artifactPanelMeta.textContent = "파일을 선택하세요";
  }
  if (els.artifactViewer) {
    els.artifactViewer.innerHTML = `<p class="artifact-empty">최종 답변의 산출물 카드를 선택하면 여기에 표시됩니다.</p>`;
  }
}

async function extractAndRenderArtifacts(text, messageNode) {
  const candidates = collectArtifactCandidates(text);
  if (!candidates.length) {
    return [];
  }
  const artifacts = await resolveExistingArtifacts(candidates);
  if (!artifacts.length || !messageNode?.isConnected) {
    return [];
  }
  state.artifacts = artifacts;
  renderArtifactCards(messageNode, artifacts);
  return artifacts;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function updateArtifactCopyButton(enabled) {
  if (!els.artifactPanelCopy) {
    return;
  }
  els.artifactPanelCopy.disabled = !enabled;
  els.artifactPanelCopy.classList.remove("copied");
  els.artifactPanelCopy.dataset.tooltip = enabled ? "원문 복사" : "복사할 원문 없음";
}

function updateArtifactSourceButton(enabled) {
  if (!els.artifactPanelSource) {
    return;
  }
  els.artifactPanelSource.disabled = !enabled;
  els.artifactPanelSource.classList.toggle("active", Boolean(enabled && state.artifactSourceMode));
  els.artifactPanelSource.setAttribute("aria-pressed", state.artifactSourceMode ? "true" : "false");
  els.artifactPanelSource.setAttribute("aria-label", state.artifactSourceMode ? "미리보기" : "원문보기");
  els.artifactPanelSource.dataset.tooltip = enabled
    ? state.artifactSourceMode ? "미리보기" : "원문보기"
    : "볼 수 있는 원문 없음";
}

function toggleArtifactSourceView() {
  const artifact = state.activeArtifact;
  const payload = state.activeArtifactPayload;
  if (!artifact || !payload?.content) {
    updateArtifactSourceButton(false);
    return;
  }
  state.artifactSourceMode = !state.artifactSourceMode;
  updateArtifactSourceButton(true);
  if (state.artifactSourceMode) {
    renderArtifactSourceView(artifact, payload);
  } else {
    renderArtifactRenderedView(artifact, payload);
  }
}

async function copyActiveArtifactRaw() {
  const raw = String(state.activeArtifactRaw || "");
  if (!raw) {
    updateArtifactCopyButton(false);
    return;
  }
  try {
    await navigator.clipboard.writeText(raw);
  } catch {
    const area = document.createElement("textarea");
    area.value = raw;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  if (els.artifactPanelCopy) {
    els.artifactPanelCopy.classList.add("copied");
    els.artifactPanelCopy.dataset.tooltip = "복사됨";
    window.setTimeout(() => {
      if (!els.artifactPanelCopy?.disabled) {
        els.artifactPanelCopy.classList.remove("copied");
        els.artifactPanelCopy.dataset.tooltip = "원문 복사";
      }
    }, 1200);
  }
}

function initializeArtifactPanel() {
  els.artifactPanelSource?.addEventListener("click", toggleArtifactSourceView);
  els.artifactPanelCopy?.addEventListener("click", copyActiveArtifactRaw);
  els.artifactPanelFullscreen?.addEventListener("click", toggleArtifactFullscreen);
  els.artifactPanelClose?.addEventListener("click", closeArtifactPanel);
  els.projectFilesButton?.addEventListener("click", openProjectFiles);
  window.addEventListener("message", (event) => {
    if (event.source !== activeArtifactFrameWindow) {
      return;
    }
    if (event.data?.type === artifactFrameOptimalWidthMessage) {
      setArtifactPanelWidthForFrameContent(Number(event.data.width));
      return;
    }
    if (event.data?.type !== artifactFrameBackMessage) {
      return;
    }
    clearArtifactFrameBackFallback();
    artifactFrameBackFallbackTimer = window.setTimeout(() => {
      artifactFrameBackFallbackTimer = 0;
      requestArtifactHistoryBack();
    }, 180);
  });
  window.addEventListener("popstate", (event) => {
    clearArtifactFrameBackFallback();
    artifactHistoryBackPending = false;
    if (isArtifactHistoryState(event.state)) {
      restoringArtifactHistory = true;
      try {
        if (event.state.view === "list") {
          artifactHistoryMode = "list";
          artifactPanelReturnView = null;
          state.activeArtifact = null;
          state.activeArtifactRaw = "";
          state.activeArtifactPayload = null;
          state.artifactSourceMode = false;
          updateArtifactCopyButton(false);
          updateArtifactSourceButton(false);
          setArtifactFullscreen(false);
          setArtifactPanel(true);
          if (els.artifactPanelTitle) {
            els.artifactPanelTitle.textContent = "프로젝트 파일";
          }
          if (els.artifactPanelMeta) {
            els.artifactPanelMeta.textContent = `${(state.projectFiles || []).length}개 파일`;
          }
          renderProjectFiles(state.projectFiles || []);
          return;
        }
        if (event.state.view === "detail" && event.state.path) {
          const artifact = {
            id: `project-file-${event.state.path}`,
            path: event.state.path,
            name: event.state.name || artifactName(event.state.path),
            kind: event.state.kind || artifactKind(event.state.path),
            label: event.state.label || artifactLabel(event.state.kind || artifactKind(event.state.path)),
            size: event.state.size,
          };
          openArtifact(artifact, { fromHistory: true, projectFilesReturn: true });
          return;
        }
      } finally {
        restoringArtifactHistory = false;
      }
    }
    if (artifactHistoryMode) {
      restoringArtifactHistory = true;
      try {
        closeArtifactPanel({ fromHistory: true });
      } finally {
        restoringArtifactHistory = false;
      }
    }
  });
  applyStoredArtifactPanelWidth();
  els.artifactResizeHandle?.addEventListener("pointerdown", (event) => {
    if (!els.artifactPanel || !els.appShell) {
      return;
    }
    event.preventDefault();
    els.artifactResizeHandle.setPointerCapture?.(event.pointerId);
    els.appShell.classList.add("resizing-artifact");
    const onMove = (moveEvent) => {
      setArtifactPanelWidth(window.innerWidth - moveEvent.clientX);
    };
    const onUp = (upEvent) => {
      els.artifactResizeHandle.releasePointerCapture?.(upEvent.pointerId);
      els.appShell.classList.remove("resizing-artifact");
      setArtifactPanelWidth(window.innerWidth - upEvent.clientX, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
  window.addEventListener("resize", () => {
    const stored = Number(localStorage.getItem(artifactPanelWidthKey) || 0);
    if (stored > 0) {
      setArtifactPanelWidth(stored);
    }
  });
}

  return {
    collectArtifactCandidates,
    extractAndRenderArtifacts,
    closeArtifactPanel,
    resetArtifacts,
    initializeArtifactPanel,
    openArtifact,
    openProjectFiles,
    renderArtifactCards,
    setArtifactPanelWidth,
  };
}
