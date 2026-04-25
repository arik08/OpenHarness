export function createArtifacts(ctx) {
  const { state, els } = ctx;
  function setMarkdown(...args) { return ctx.setMarkdown(...args); }

const artifactPanelWidthKey = "openharness:artifactPanelWidth";
const artifactPanelMinWidth = 320;
const artifactPanelMaxWidth = 920;
const artifactExtensions = new Set([
  "html",
  "htm",
  "md",
  "markdown",
  "txt",
  "json",
  "csv",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "svg",
  "pdf",
]);
const imageExtensions = new Set(["png", "jpg", "jpeg", "webp", "svg"]);
const textExtensions = new Set(["md", "markdown", "txt", "json", "csv"]);

function normalizeArtifactPath(value) {
  return String(value || "")
    .trim()
    .replace(/^file:\/\//i, "")
    .replace(/^["'`]+|["'`.,;:)]+$/g, "")
    .replace(/\\/g, "/");
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

function artifactLabel(kind) {
  if (kind === "html") return "HTML";
  if (kind === "image") return "이미지";
  if (kind === "pdf") return "PDF";
  if (kind === "text") return "텍스트";
  return "파일";
}

function labelForArtifact(artifact) {
  return artifact.label || artifactLabel(artifact.kind);
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
  for (const match of value.matchAll(/`([^`\n]+\.(?:html?|md|markdown|txt|json|csv|png|jpe?g|webp|svg|pdf))`/gi)) {
    push(match[1]);
  }
  for (const match of value.matchAll(/(?:^|[\s(["'])((?:[A-Za-z]:)?[^\s<>"'()]*\.(?:html?|md|markdown|txt|json|csv|png|jpe?g|webp|svg|pdf))/gim)) {
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
        label: artifactLabel(kind),
      };
    });
}

function renderArtifactCards(container, artifacts) {
  if (!container || !artifacts.length) {
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "artifact-cards";
  for (const artifact of artifacts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "artifact-card";
    button.dataset.artifactId = artifact.id;
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
          label: artifactLabel(payload.kind || artifact.kind),
          size: payload.size,
        };
      } catch {
        return null;
      }
    }),
  );
  return resolved.filter(Boolean);
}

function setArtifactPanel(open) {
  state.artifactPanelOpen = open;
  if (open) {
    applyStoredArtifactPanelWidth();
  } else {
    setArtifactFullscreen(false);
  }
  els.appShell?.classList.toggle("artifact-open", open);
  els.artifactPanel?.classList.toggle("hidden", !open);
}

function setArtifactFullscreen(enabled) {
  els.artifactPanel?.classList.toggle("fullscreen", enabled);
  if (!els.artifactPanelFullscreen) {
    return;
  }
  els.artifactPanelFullscreen.setAttribute("aria-pressed", enabled ? "true" : "false");
  els.artifactPanelFullscreen.setAttribute(
    "aria-label",
    enabled ? "전체화면 해제" : "전체화면으로 보기",
  );
  els.artifactPanelFullscreen.dataset.tooltip = enabled ? "전체화면 해제" : "전체화면";
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
  const viewportLimit = Math.max(artifactPanelMinWidth, Math.floor(window.innerWidth * 0.72));
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

function applyStoredArtifactPanelWidth() {
  const stored = Number(localStorage.getItem(artifactPanelWidthKey) || 0);
  if (stored > 0) {
    setArtifactPanelWidth(stored);
  }
}

function showArtifactLoading(artifact) {
  state.activeArtifactRaw = "";
  updateArtifactCopyButton(false);
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

function renderArtifactPreview(artifact, payload) {
  if (!els.artifactViewer) {
    return;
  }
  state.activeArtifactRaw = String(payload.content || payload.dataUrl || "");
  updateArtifactCopyButton(Boolean(state.activeArtifactRaw));
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
    iframe.srcdoc = payload.content || "";
    els.artifactViewer.append(iframe);
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
    frame.src = payload.dataUrl || "";
    els.artifactViewer.append(frame);
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

function renderArtifactError(error) {
  state.activeArtifactRaw = "";
  updateArtifactCopyButton(false);
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

function renderProjectFiles(files) {
  state.activeArtifactRaw = "";
  updateArtifactCopyButton(false);
  if (!els.artifactViewer) {
    return;
  }
  els.artifactViewer.textContent = "";
  if (!files.length) {
    const empty = document.createElement("p");
    empty.className = "artifact-empty";
    empty.textContent = "현재 프로젝트에 열 수 있는 파일이 없습니다.";
    els.artifactViewer.append(empty);
    return;
  }
  const list = document.createElement("div");
  list.className = "project-file-list";
  for (const file of files) {
    const artifact = {
      id: `project-file-${file.path}`,
      path: file.path,
      name: file.name,
      kind: file.kind,
      label: artifactLabel(file.kind),
      size: file.size,
    };
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-file-item";
    button.innerHTML = `
      <span class="artifact-card-icon" aria-hidden="true">${artifactIcon(artifact.kind)}</span>
      <span class="artifact-card-copy">
        <strong></strong>
        <small></small>
      </span>
    `;
    button.querySelector("strong").textContent = artifact.path;
    button.querySelector("small").textContent = `${artifact.label} · ${formatBytes(artifact.size)}`;
    button.addEventListener("click", () => openArtifact(artifact));
    list.append(button);
  }
  els.artifactViewer.append(list);
}

async function openProjectFiles() {
  if (!state.sessionId) {
    return;
  }
  state.activeArtifactRaw = "";
  updateArtifactCopyButton(false);
  setArtifactPanel(true);
  if (els.artifactPanelTitle) {
    els.artifactPanelTitle.textContent = "프로젝트 파일";
  }
  if (els.artifactPanelMeta) {
    els.artifactPanelMeta.textContent = "열 수 있는 파일을 불러오는 중";
  }
  if (els.artifactViewer) {
    els.artifactViewer.innerHTML = `<p class="artifact-empty">파일 목록을 불러오는 중...</p>`;
  }
  try {
    const query = new URLSearchParams({ session: state.sessionId });
    const response = await fetch(`/api/artifacts?${query.toString()}`, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (els.artifactPanelMeta) {
      els.artifactPanelMeta.textContent = `${files.length}개 파일`;
    }
    renderProjectFiles(files);
  } catch (error) {
    renderArtifactError(error);
  }
}

async function openArtifact(artifact) {
  state.activeArtifact = artifact;
  setArtifactPanel(true);
  showArtifactLoading(artifact);
  try {
    const query = new URLSearchParams({
      session: state.sessionId || "",
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

function closeArtifactPanel() {
  state.activeArtifact = null;
  state.activeArtifactRaw = "";
  updateArtifactCopyButton(false);
  setArtifactFullscreen(false);
  setArtifactPanel(false);
}

function resetArtifacts() {
  state.artifacts = [];
  state.activeArtifact = null;
  state.activeArtifactRaw = "";
  updateArtifactCopyButton(false);
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
  els.artifactPanelCopy?.addEventListener("click", copyActiveArtifactRaw);
  els.artifactPanelFullscreen?.addEventListener("click", toggleArtifactFullscreen);
  els.artifactPanelClose?.addEventListener("click", closeArtifactPanel);
  els.projectFilesButton?.addEventListener("click", openProjectFiles);
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
