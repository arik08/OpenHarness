import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import hljs from "highlight.js/lib/common";
import { deleteArtifact, listProjectFiles, organizeProjectFiles, readArtifact } from "../api/artifacts";
import { useAppState } from "../state/app-state";
import type { ArtifactSummary } from "../types/backend";
import type { ArtifactPayload } from "../types/ui";
import { MarkdownMessage } from "./MarkdownMessage";

type IconName = "source" | "preview" | "copy" | "fullscreen" | "restore" | "close" | "back" | "download" | "save" | "trash" | "warning" | "refresh";

const artifactHistoryMarker = "myharnessArtifactPanel";
const artifactFrameBackMessage = "myharness:artifact-panel-back";
const artifactPanelMinWidth = 320;
const visibleChatMinWidth = 300;
const desktopSidebarWidth = 268;
const collapsedSidebarWidth = 16;
const projectFileCategories = [
  ["all", "전체"],
  ["web", "웹"],
  ["docs", "문서"],
  ["data", "데이터"],
  ["code", "코드"],
  ["other", "기타"],
];
const projectFileCategoryValues = new Set(projectFileCategories.map(([value]) => value));

function isArtifactHistoryState(value: unknown) {
  return Boolean(value && typeof value === "object" && (value as Record<string, unknown>)[artifactHistoryMarker] === true);
}

function artifactHistoryState(view: "list" | "detail", artifact?: ArtifactSummary | null) {
  return {
    [artifactHistoryMarker]: true,
    view,
    path: artifact?.path || "",
    name: artifact?.name || "",
    kind: artifact?.kind || "",
    label: artifact?.label || "",
    size: artifact?.size,
  };
}

function sameArtifactHistoryState(nextState: Record<string, unknown>) {
  const current = history.state;
  return isArtifactHistoryState(current)
    && current.view === nextState.view
    && String(current.path || "") === String(nextState.path || "");
}

export function clampArtifactPanelWidth(value: number, options: { windowWidth: number; sidebarCollapsed: boolean }) {
  const sidebarWidth = options.sidebarCollapsed ? collapsedSidebarWidth : desktopSidebarWidth;
  const maxWidth = Math.max(artifactPanelMinWidth, options.windowWidth - sidebarWidth - visibleChatMinWidth);
  return Math.min(Math.max(value, artifactPanelMinWidth), maxWidth);
}

function iframeBackBridge(content: string) {
  const bridge = `
<script>
(() => {
  let pending = false;
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
})();
</script>`;
  if (/<\/body\s*>/i.test(content)) {
    return content.replace(/<\/body\s*>/i, `${bridge}</body>`);
  }
  return `${content}${bridge}`;
}

function artifactLabel(artifact: ArtifactSummary) {
  if (artifact.kind === "html") return "HTML";
  if (artifact.kind === "image") return "이미지";
  if (artifact.kind === "pdf") return "PDF";
  if (artifact.kind === "text") return "텍스트";
  return artifact.label || artifact.kind || "파일";
}

function artifactIcon(kind: string) {
  if (kind === "html") return "</>";
  if (kind === "image") return "IMG";
  if (kind === "pdf") return "PDF";
  if (kind === "text" || kind === "markdown" || kind === "json") return "TXT";
  return "FILE";
}

function artifactTypeBadge(artifact: ArtifactSummary) {
  const ext = artifactExtension(artifact.path || artifact.name);
  const category = artifactCategory(artifact);
  if (["html", "htm"].includes(ext)) return { label: "HTML", tone: "web" };
  if (["md", "markdown"].includes(ext)) return { label: "MD", tone: "docs" };
  if (["txt", "log"].includes(ext)) return { label: "TXT", tone: "docs" };
  if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) return { label: ext.toUpperCase(), tone: "docs" };
  if (["json", "csv", "xml", "yaml", "yml", "toml", "ini"].includes(ext)) return { label: ext.toUpperCase(), tone: "data" };
  if (["py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "sql", "sh", "ps1", "bat", "cmd"].includes(ext)) return { label: ext.toUpperCase(), tone: "code" };
  if (["png", "gif", "jpg", "jpeg", "webp", "svg"].includes(ext)) return { label: ext.toUpperCase(), tone: "image" };
  if (ext === "zip") return { label: "ZIP", tone: "archive" };
  return { label: artifactIcon(artifact.kind), tone: category };
}

function formatBytes(value?: number) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function projectFileDirectory(path: string) {
  const normalized = String(path || "").replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "루트";
}

function groupedArtifacts(artifacts: ArtifactSummary[]) {
  const groups = new Map<string, ArtifactSummary[]>();
  for (const artifact of artifacts) {
    const directory = projectFileDirectory(artifact.path);
    groups.set(directory, [...(groups.get(directory) || []), artifact]);
  }
  return [...groups.entries()];
}

function downloadUrl(artifact: ArtifactSummary, state: ReturnType<typeof useAppState>["state"]) {
  const query = new URLSearchParams({ clientId: state.clientId, path: artifact.path });
  if (state.sessionId) query.set("session", state.sessionId);
  if (state.workspacePath) query.set("workspacePath", state.workspacePath);
  if (state.workspaceName) query.set("workspaceName", state.workspaceName);
  return `/api/artifact/download?${query.toString()}`;
}

function Icon({ name }: { name: IconName }) {
  if (name === "source") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m16 18 6-6-6-6" />
        <path d="m8 6-6 6 6 6" />
      </svg>
    );
  }
  if (name === "preview") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  if (name === "copy") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    );
  }
  if (name === "fullscreen") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
        <path d="M16 3h3a2 2 0 0 1 2 2v3" />
        <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
        <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
      </svg>
    );
  }
  if (name === "restore") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M8 3v3a2 2 0 0 1-2 2H3" />
        <path d="M16 3v3a2 2 0 0 0 2 2h3" />
        <path d="M8 21v-3a2 2 0 0 0-2-2H3" />
        <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
      </svg>
    );
  }
  if (name === "back") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m15 18-6-6 6-6" />
      </svg>
    );
  }
  if (name === "download") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 3v11" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 20h14" />
      </svg>
    );
  }
  if (name === "save") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
        <path d="M17 21v-8H7v8" />
        <path d="M7 3v5h8" />
      </svg>
    );
  }
  if (name === "trash") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="M19 6l-1 14H6L5 6" />
        <path d="M10 11v5" />
        <path d="M14 11v5" />
      </svg>
    );
  }
  if (name === "warning") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 3 21 20H3L12 3Z" />
        <path d="M12 9v5" />
        <path d="M12 17h.01" />
      </svg>
    );
  }
  if (name === "refresh") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
        <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
        <path d="M3 21v-5h5" />
        <path d="M21 3v5h-5" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function ArtifactAction({
  label,
  icon,
  onClick,
  disabled,
  danger,
  active,
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      className={`artifact-action${danger ? " danger" : ""}${active ? " active" : ""}`}
      type="button"
      aria-label={label}
      data-tooltip={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} />
    </button>
  );
}

export function ArtifactPanel() {
  const { state, dispatch } = useAppState();
  const [loadingPath, setLoadingPath] = useState("");
  const [fileScope, setFileScope] = useState<"default" | "all">("default");
  const [fileFilter, setFileFilter] = useState(() => localStorage.getItem("myharness:projectFileFilter") || "all");
  const [fileSort, setFileSort] = useState(() => localStorage.getItem("myharness:projectFileSortMode") || "recent");
  const [fullscreen, setFullscreen] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [copyLabel, setCopyLabel] = useState("복사");
  const [sourceMode, setSourceMode] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set());
  const [pendingDeletePath, setPendingDeletePath] = useState("");
  const [deletingPath, setDeletingPath] = useState("");
  const [organizeCandidates, setOrganizeCandidates] = useState<ArtifactSummary[] | null>(null);
  const skipNextHistoryPushRef = useRef(false);
  const visibleArtifacts = useMemo(() => sortedArtifacts(state.artifacts, fileFilter, fileSort), [fileFilter, fileSort, state.artifacts]);

  function requestHistoryBack() {
    if (!state.artifactPanelOpen || !isArtifactHistoryState(history.state)) {
      return false;
    }
    history.back();
    return true;
  }

  function closePanel() {
    if (state.activeArtifact) {
      skipNextHistoryPushRef.current = true;
      if (isArtifactHistoryState(history.state)) {
        history.replaceState(artifactHistoryState("list"), "", window.location.href);
      }
      dispatch({ type: "open_artifact_list" });
      return;
    }
    if (isArtifactHistoryState(history.state)) {
      history.replaceState(null, "", window.location.href);
    }
    dispatch({ type: "close_artifact" });
  }

  function returnToList() {
    if (requestHistoryBack()) {
      return;
    }
    dispatch({ type: "open_artifact_list" });
  }

  useEffect(() => {
    setDraftContent(String(state.activeArtifactPayload?.content || ""));
    setCopyLabel("복사");
    setSourceMode(false);
  }, [state.activeArtifact?.path, state.activeArtifactPayload]);

  useEffect(() => {
    if (!state.artifactPanelOpen) {
      return;
    }
    const view = state.activeArtifact ? "detail" : "list";
    const nextState = artifactHistoryState(view, state.activeArtifact);
    if (skipNextHistoryPushRef.current) {
      skipNextHistoryPushRef.current = false;
      return;
    }
    if (!sameArtifactHistoryState(nextState)) {
      history.pushState(nextState, "", window.location.href);
    }
  }, [state.activeArtifact, state.artifactPanelOpen]);

  useEffect(() => {
    function handlePopState(event: PopStateEvent) {
      if (isArtifactHistoryState(event.state)) {
        skipNextHistoryPushRef.current = true;
        if (event.state.view === "list") {
          dispatch({ type: "open_artifact_list" });
          return;
        }
        if (event.state.view === "detail" && event.state.path) {
          const artifact = state.artifacts.find((item) => item.path === event.state.path) || {
            path: String(event.state.path),
            name: String(event.state.name || event.state.path),
            kind: String(event.state.kind || "file"),
            label: String(event.state.label || event.state.kind || "파일"),
            size: Number(event.state.size || 0),
          };
          void openArtifact(artifact);
          return;
        }
      }
      if (state.artifactPanelOpen) {
        dispatch({ type: "close_artifact" });
      }
    }

    function handleFrameBackMessage(event: MessageEvent) {
      if (event.data?.type === artifactFrameBackMessage) {
        window.setTimeout(() => requestHistoryBack(), 180);
      }
    }

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("message", handleFrameBackMessage);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("message", handleFrameBackMessage);
    };
  }, [dispatch, state.artifacts, state.artifactPanelOpen]);

  useEffect(() => {
    if (!state.artifactPanelOpen || state.activeArtifact) {
      return;
    }
    void refreshProjectFiles("default");
  }, [
    state.activeArtifact,
    state.artifactPanelOpen,
    state.clientId,
    state.sessionId,
    state.workspaceName,
    state.workspacePath,
  ]);

  async function openArtifact(artifact: ArtifactSummary) {
    dispatch({ type: "open_artifact", artifact });
    setLoadingPath(artifact.path);
    try {
      const payload = await readArtifact({
        sessionId: state.sessionId || undefined,
        clientId: state.clientId,
        workspacePath: state.workspacePath,
        workspaceName: state.workspaceName,
        path: artifact.path,
      });
      dispatch({ type: "set_artifact_payload", payload });
    } catch (error) {
      dispatch({
        type: "open_modal",
        modal: { kind: "error", message: error instanceof Error ? error.message : String(error) },
      });
    } finally {
      setLoadingPath("");
    }
  }

  if (!state.artifactPanelOpen) {
    return null;
  }

  const active = state.activeArtifact;
  const payload = state.activeArtifactPayload;
  const canSave = Boolean(active && payload && isEditablePayload(active, payload));
  const canShowSource = Boolean(active && payload?.content);

  async function refreshProjectFiles(nextScope = fileScope) {
    try {
      const data = await listProjectFiles({
        sessionId: state.sessionId || undefined,
        clientId: state.clientId,
        workspacePath: state.workspacePath,
        workspaceName: state.workspaceName,
        scope: nextScope,
      });
      setFileScope(data.scope === "all" ? "all" : "default");
      setPendingDeletePath("");
      dispatch({ type: "set_artifacts", artifacts: Array.isArray(data.files) ? data.files : [] });
    } catch (error) {
      dispatch({
        type: "open_modal",
        modal: { kind: "error", message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  function changeFilter(value: string) {
    setFileFilter(value);
    setPendingDeletePath("");
    localStorage.setItem("myharness:projectFileFilter", value);
  }

  function changeSort(value: string) {
    const next = value === "path" ? "path" : "recent";
    setFileSort(next);
    setPendingDeletePath("");
    localStorage.setItem("myharness:projectFileSortMode", next);
  }

  function beginResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = state.artifactPanelWidth || Math.min(Math.max(window.innerWidth * 0.38, 360), 680);
    dispatch({ type: "set_artifact_resizing", value: true });
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Some test/browser paths do not support pointer capture for this event.
    }
    let finished = false;
    const finishResize = () => {
      if (finished) return;
      finished = true;
      dispatch({ type: "set_artifact_resizing", value: false });
      try {
        if (handle.hasPointerCapture(event.pointerId)) {
          handle.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Pointer capture may already be gone if the browser canceled the pointer.
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      window.removeEventListener("mouseup", finishResize);
      window.removeEventListener("blur", finishResize);
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.buttons === 0) {
        finishResize();
        return;
      }
      const next = clampArtifactPanelWidth(startWidth + startX - moveEvent.clientX, {
        windowWidth: window.innerWidth,
        sidebarCollapsed: state.sidebarCollapsed,
      });
      dispatch({ type: "set_artifact_panel_width", value: Math.round(next) });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
    window.addEventListener("mouseup", finishResize);
    window.addEventListener("blur", finishResize);
  }

  async function copyActiveArtifact() {
    if (!active || !payload) return;
    const text = canSave ? draftContent : String(payload.content || payload.dataUrl || "");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyLabel("복사됨");
      window.setTimeout(() => setCopyLabel("복사"), 1400);
    } catch (error) {
      dispatch({
        type: "open_modal",
        modal: { kind: "error", message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  async function deleteProjectFile(artifact: ArtifactSummary) {
    if (pendingDeletePath !== artifact.path) {
      setPendingDeletePath(artifact.path);
      return;
    }
    setDeletingPath(artifact.path);
    try {
      await deleteArtifact({
        path: artifact.path,
        sessionId: state.sessionId || undefined,
        clientId: state.clientId,
        workspacePath: state.workspacePath,
        workspaceName: state.workspaceName,
      });
      setPendingDeletePath("");
      dispatch({ type: "set_artifacts", artifacts: state.artifacts.filter((item) => item.path !== artifact.path) });
      if (state.activeArtifact?.path === artifact.path) {
        dispatch({ type: "open_artifact_list" });
      }
    } catch (error) {
      dispatch({
        type: "open_modal",
        modal: { kind: "error", message: error instanceof Error ? error.message : String(error) },
      });
    } finally {
      setDeletingPath("");
    }
  }

  async function organizeRootFiles(paths: string[]) {
    await organizeProjectFiles({
      paths,
      sessionId: state.sessionId || undefined,
      clientId: state.clientId,
      workspacePath: state.workspacePath,
      workspaceName: state.workspaceName,
    });
    setOrganizeCandidates(null);
    await refreshProjectFiles(fileScope);
  }

  return (
    <aside className={`artifact-panel${fullscreen ? " fullscreen" : ""}`} aria-label="산출물 미리보기">
      <button className="artifact-resize-handle" type="button" aria-label="패널 너비 조절" onPointerDown={beginResize} />
      <div className="artifact-panel-header">
        <div className="artifact-panel-title">
          <strong>{active?.name || "프로젝트 파일"}</strong>
          <small>{active ? `${artifactLabel(active)} · ${active.path}` : `${state.artifacts.length}개 파일`}</small>
        </div>
        <div className="artifact-panel-actions">
          {active ? (
            <>
              <ArtifactAction
                label={sourceMode ? "미리보기" : "원문보기"}
                icon={sourceMode ? "preview" : "source"}
                onClick={() => setSourceMode((value) => !value)}
                disabled={!canShowSource}
                active={sourceMode}
              />
              <ArtifactAction label={copyLabel === "복사됨" ? "복사됨" : "원문 복사"} icon="copy" onClick={() => void copyActiveArtifact()} disabled={!payload || (!canSave && !payload.content && !payload.dataUrl)} active={copyLabel === "복사됨"} />
            </>
          ) : null}
          <ArtifactAction label={fullscreen ? "미리보기 축소" : "미리보기 확대"} icon={fullscreen ? "restore" : "fullscreen"} onClick={() => setFullscreen((value) => !value)} />
          <ArtifactAction label="닫기" icon="close" onClick={closePanel} />
        </div>
      </div>
      <div className="artifact-viewer" key={active ? "detail" : "list"}>
        {!active ? (
          <ArtifactList
            artifacts={visibleArtifacts}
            totalCount={state.artifacts.length}
            loadingPath={loadingPath}
            filter={fileFilter}
            sort={fileSort}
            scope={fileScope}
            onFilterChange={changeFilter}
            onSortChange={changeSort}
            onToggleScope={() => void refreshProjectFiles(fileScope === "all" ? "default" : "all")}
            onRefresh={() => void refreshProjectFiles(fileScope)}
            onOpen={openArtifact}
            onDelete={deleteProjectFile}
            onOrganize={setOrganizeCandidates}
            allArtifacts={state.artifacts}
            getDownloadUrl={(artifact) => downloadUrl(artifact, state)}
            collapsedDirs={collapsedDirs}
            pendingDeletePath={pendingDeletePath}
            deletingPath={deletingPath}
            onToggleDirectory={(directory) => setCollapsedDirs((current) => {
              const next = new Set(current);
              if (next.has(directory)) next.delete(directory);
              else next.add(directory);
              return next;
            })}
          />
        ) : payload ? (
          <ArtifactPreview
            artifact={active}
            payload={payload}
            draftContent={draftContent}
            sourceMode={sourceMode}
            downloadUrl={downloadUrl(active, state)}
            onDraftContentChange={setDraftContent}
          />
        ) : (
          <p className="artifact-empty">산출물을 불러오는 중...</p>
        )}
      </div>
      {organizeCandidates ? (
        <OrganizeProjectFilesModal
          candidates={organizeCandidates}
          onClose={() => setOrganizeCandidates(null)}
          onSubmit={organizeRootFiles}
        />
      ) : null}
    </aside>
  );
}

const projectFileCandidateExtensions = new Set([
  "html",
  "htm",
  "md",
  "markdown",
  "txt",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
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
  "zip",
]);

function normalizeProjectFilePath(value: string) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function isRootOrganizeCandidate(artifact: ArtifactSummary) {
  const path = normalizeProjectFilePath(artifact.path || artifact.name || "");
  if (!path || path.includes("/") || path.startsWith("outputs/")) return false;
  return projectFileCandidateExtensions.has(artifactExtension(path));
}

function artifactCategory(artifact: ArtifactSummary) {
  const ext = artifactExtension(artifact.path || artifact.name);
  if (["html", "htm"].includes(ext)) return "web";
  if (["md", "markdown", "txt", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) return "docs";
  if (["json", "csv", "xml", "yaml", "yml", "toml", "ini", "log"].includes(ext)) return "data";
  if (["py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "sql", "sh", "ps1", "bat", "cmd"].includes(ext)) return "code";
  return "other";
}

function sortedArtifacts(artifacts: ArtifactSummary[], filter: string, sort: string) {
  const normalizedFilter = projectFileCategoryValues.has(filter) ? filter : "all";
  return artifacts
    .filter((artifact) => normalizedFilter === "all" || artifactCategory(artifact) === normalizedFilter)
    .slice()
    .sort((left, right) => {
      if (sort === "path") {
        return left.path.localeCompare(right.path, "ko");
      }
      return Number(right.mtimeMs || right.birthtimeMs || 0) - Number(left.mtimeMs || left.birthtimeMs || 0)
        || left.path.localeCompare(right.path, "ko");
    });
}

function ArtifactList({
  artifacts,
  allArtifacts,
  totalCount,
  loadingPath,
  filter,
  sort,
  scope,
  onFilterChange,
  onSortChange,
  onToggleScope,
  onRefresh,
  onOpen,
  onDelete,
  onOrganize,
  getDownloadUrl,
  collapsedDirs,
  pendingDeletePath,
  deletingPath,
  onToggleDirectory,
}: {
  artifacts: ArtifactSummary[];
  allArtifacts: ArtifactSummary[];
  totalCount: number;
  loadingPath: string;
  filter: string;
  sort: string;
  scope: "default" | "all";
  onFilterChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onToggleScope: () => void;
  onRefresh: () => void;
  onOpen: (artifact: ArtifactSummary) => void;
  onDelete: (artifact: ArtifactSummary) => void;
  onOrganize: (artifacts: ArtifactSummary[]) => void;
  getDownloadUrl: (artifact: ArtifactSummary) => string;
  collapsedDirs: Set<string>;
  pendingDeletePath: string;
  deletingPath: string;
  onToggleDirectory: (directory: string) => void;
}) {
  const categories = projectFileCategories;
  const organizeCandidates = allArtifacts.filter(isRootOrganizeCandidate);

  if (!artifacts.length) {
    return (
      <>
        <ProjectFileToolbar
          totalCount={totalCount}
          filter={filter}
          sort={sort}
          scope={scope}
          categories={categories}
          organizeCandidates={organizeCandidates}
          onFilterChange={onFilterChange}
          onSortChange={onSortChange}
          onOrganize={onOrganize}
          onToggleScope={onToggleScope}
          onRefresh={onRefresh}
        />
        <p className="artifact-empty">표시할 프로젝트 파일이 아직 없습니다.</p>
      </>
    );
  }
  const groups = groupedArtifacts(artifacts);
  return (
    <>
      <ProjectFileToolbar
        totalCount={totalCount}
        filter={filter}
        sort={sort}
        scope={scope}
        categories={categories}
        organizeCandidates={organizeCandidates}
        onFilterChange={onFilterChange}
        onSortChange={onSortChange}
        onOrganize={onOrganize}
        onToggleScope={onToggleScope}
        onRefresh={onRefresh}
      />
      <div className="project-file-list">
        {groups.map(([directory, groupArtifacts]) => (
          <section className={`project-file-section${collapsedDirs.has(directory) ? " collapsed" : ""}`} key={directory}>
            <button className="project-file-section-header" type="button" aria-expanded={collapsedDirs.has(directory) ? "false" : "true"} onClick={() => onToggleDirectory(directory)}>
              <span className="project-file-section-caret" aria-hidden="true">›</span>
              <span className="project-file-section-title">{directory}</span>
              <small>{groupArtifacts.length}개</small>
            </button>
            {collapsedDirs.has(directory) ? null : (
              <div className="project-file-section-body">
                {groupArtifacts.map((artifact) => (
                  <ProjectFileItem
                    artifact={artifact}
                    deleting={deletingPath === artifact.path}
                    deleteReady={pendingDeletePath === artifact.path}
                    downloadUrl={getDownloadUrl(artifact)}
                    key={artifact.path}
                    loading={loadingPath === artifact.path}
                    onDelete={onDelete}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </>
  );
}

function ProjectFileItem({
  artifact,
  deleteReady,
  deleting,
  downloadUrl,
  loading,
  onDelete,
  onOpen,
}: {
  artifact: ArtifactSummary;
  deleteReady: boolean;
  deleting: boolean;
  downloadUrl: string;
  loading: boolean;
  onDelete: (artifact: ArtifactSummary) => void;
  onOpen: (artifact: ArtifactSummary) => void;
}) {
  const badge = artifactTypeBadge(artifact);
  return (
    <div className={`project-file-item${deleteReady ? " delete-ready" : ""}${deleting ? " deleting" : ""}`}>
      <button className="project-file-open" type="button" aria-label={`${artifact.name || artifact.path} 열기`} data-tooltip={artifact.path} onClick={() => void onOpen(artifact)}>
        <span className={`artifact-card-icon artifact-card-icon-${badge.tone}`} aria-hidden="true">{badge.label}</span>
        <span className="artifact-card-copy">
          <strong>{artifact.name || artifact.path}</strong>
          <small>{loading ? "불러오는 중" : [artifactLabel(artifact), formatBytes(artifact.size)].filter(Boolean).join(" · ")}</small>
        </span>
      </button>
      <span className="project-file-actions">
        <button
          className="project-file-delete"
          type="button"
          aria-label={deleteReady ? `${artifact.name} 삭제 확인` : `${artifact.name} 삭제`}
          data-tooltip={deleteReady ? "한 번 더 누르면 삭제됩니다" : "파일 삭제"}
          disabled={deleting}
          onClick={(event) => {
            event.stopPropagation();
            void onDelete(artifact);
          }}
        >
          <Icon name={deleteReady ? "warning" : "trash"} />
        </button>
        <a className="project-file-download" href={downloadUrl} download={artifact.name} aria-label={`${artifact.name} 다운로드`} data-tooltip="다운로드" onClick={(event) => event.stopPropagation()}>
          <Icon name="download" />
        </a>
      </span>
    </div>
  );
}

function ProjectFileToolbar({
  totalCount,
  filter,
  sort,
  scope,
  categories,
  organizeCandidates,
  onFilterChange,
  onSortChange,
  onOrganize,
  onToggleScope,
  onRefresh,
}: {
  totalCount: number;
  filter: string;
  sort: string;
  scope: "default" | "all";
  categories: string[][];
  organizeCandidates: ArtifactSummary[];
  onFilterChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onOrganize: (artifacts: ArtifactSummary[]) => void;
  onToggleScope: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="project-file-toolbar">
      <span className="project-file-sort-summary">{scope === "all" ? "전체" : "outputs"} · {totalCount}개</span>
      <div className="project-file-controls">
        <label className="project-file-sort">
          <span>유형</span>
          <select aria-label="프로젝트 파일 유형 필터" value={projectFileCategoryValues.has(filter) ? filter : "all"} onChange={(event) => onFilterChange(event.currentTarget.value)}>
            {categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <label className="project-file-sort">
          <span>정렬</span>
          <select aria-label="프로젝트 파일 정렬" value={sort} onChange={(event) => onSortChange(event.currentTarget.value)}>
            <option value="recent">최근순</option>
            <option value="path">경로순</option>
          </select>
        </label>
        <button className="project-file-toolbar-button" type="button" disabled={!organizeCandidates.length} onClick={() => onOrganize(organizeCandidates)}>정리</button>
        <button className="project-file-toolbar-button" type="button" onClick={onToggleScope}>{scope === "all" ? "outputs만" : "전체 보기"}</button>
        <button className="project-file-toolbar-button" type="button" onClick={onRefresh}>새로고침</button>
      </div>
    </div>
  );
}

function OrganizeProjectFilesModal({
  candidates,
  onClose,
  onSubmit,
}: {
  candidates: ArtifactSummary[];
  onClose: () => void;
  onSubmit: (paths: string[]) => Promise<void>;
}) {
  const [selectedPaths, setSelectedPaths] = useState(() => new Set(candidates.map((artifact) => normalizeProjectFilePath(artifact.path))));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const paths = candidates
      .map((artifact) => normalizeProjectFilePath(artifact.path))
      .filter((path) => selectedPaths.has(path));
    if (!paths.length) {
      setError("이동할 파일을 선택하세요.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(paths);
    } catch (submitError) {
      setError(`정리 실패: ${submitError instanceof Error ? submitError.message : String(submitError)}`);
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="modal-card project-file-organize-card" role="dialog" aria-modal="true" aria-label="루트 산출물 정리">
        <button className="modal-close" type="button" aria-label="닫기" onClick={onClose}>
          <Icon name="close" />
        </button>
        <h2>루트 산출물 정리</h2>
        <p>선택한 루트 파일을 outputs 폴더로 이동합니다. 같은 이름은 자동으로 번호를 붙입니다.</p>
        <div className="project-file-organize-list">
          {candidates.map((artifact) => {
            const path = normalizeProjectFilePath(artifact.path);
            return (
              <label className="project-file-organize-row" key={path}>
                <input
                  type="checkbox"
                  value={path}
                  checked={selectedPaths.has(path)}
                  onChange={(event) => setSelectedPaths((current) => {
                    const next = new Set(current);
                    if (event.currentTarget.checked) next.add(path);
                    else next.delete(path);
                    return next;
                  })}
                />
                <span>
                  <strong>{path}</strong>
                  <small>{`outputs/${artifact.name || path}`}</small>
                </span>
              </label>
            );
          })}
        </div>
        <p className="settings-helper workspace-error">{error}</p>
        <div className="modal-actions">
          <button type="button" className="modal-button" onClick={onClose} disabled={submitting}>취소</button>
          <button type="button" className="modal-button primary" onClick={() => void submit()} disabled={submitting}>선택 파일 이동</button>
        </div>
      </div>
    </div>
  );
}

function isEditablePayload(artifact: ArtifactSummary, payload: ArtifactPayload) {
  const kind = String(payload.kind || artifact.kind || "");
  return kind === "html" || kind === "text" || kind === "markdown" || kind === "json";
}

function isMarkdownArtifact(artifact: ArtifactSummary, payload: ArtifactPayload) {
  const kind = String(payload.kind || artifact.kind || "").toLowerCase();
  const path = String(artifact.path || "").toLowerCase();
  return kind === "markdown" || path.endsWith(".md") || path.endsWith(".markdown");
}

const sourceCodeExtensions = new Set(["py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "sql", "sh", "ps1", "bat", "cmd"]);

function isSourceCodeArtifact(artifact: ArtifactSummary) {
  return sourceCodeExtensions.has(artifactExtension(artifact.path || artifact.name));
}

function ArtifactPreview({
  artifact,
  payload,
  draftContent,
  sourceMode,
  downloadUrl,
  onDraftContentChange,
}: {
  artifact: ArtifactSummary;
  payload: ArtifactPayload;
  draftContent: string;
  sourceMode: boolean;
  downloadUrl: string;
  onDraftContentChange: (value: string) => void;
}) {
  const kind = String(payload.kind || artifact.kind || "");
  const content = String(payload.content || "");
  const dataUrl = String(payload.dataUrl || "");
  if (sourceMode && content && (kind === "html" || isSourceCodeArtifact(artifact))) {
    return <HighlightedArtifactSource artifact={artifact} content={draftContent || content} />;
  }
  if (sourceMode && content) {
    return (
      <textarea
        className="artifact-text artifact-source-editor"
        value={draftContent || content}
        aria-label={`${artifact.name} 원문`}
        onChange={(event) => onDraftContentChange(event.currentTarget.value)}
      />
    );
  }
  if (kind === "html") {
    return <iframe className="artifact-frame artifact-html-frame" title={artifact.name} sandbox="allow-scripts" srcDoc={iframeBackBridge(draftContent || content)} />;
  }
  if (kind === "image") {
    return <img className="artifact-image" src={dataUrl} alt={artifact.name} />;
  }
  if (kind === "pdf") {
    return <iframe className="artifact-frame" title={artifact.name} src={dataUrl} />;
  }
  if (isMarkdownArtifact(artifact, payload)) {
    return (
      <div className="artifact-markdown">
        <MarkdownMessage text={content || "(내용 없음)"} />
      </div>
    );
  }
  if (content && isSourceCodeArtifact(artifact)) {
    return <HighlightedArtifactSource artifact={artifact} content={draftContent || content} />;
  }
  if (kind === "file") {
    return (
      <div className="artifact-file">
        <p className="artifact-empty">이 파일 형식은 미리보기 대신 다운로드로 열 수 있습니다.</p>
        <a className="artifact-file-download" href={downloadUrl} download={artifact.name} aria-label={`${artifact.name} 다운로드`}>
          <Icon name="download" />
          <span>다운로드</span>
        </a>
      </div>
    );
  }
  return (
    <textarea
      className="artifact-text artifact-source-editor"
      value={draftContent || content}
      aria-label={`${artifact.name} 내용`}
      onChange={(event) => onDraftContentChange(event.currentTarget.value)}
    />
  );
}

function artifactExtension(path: string) {
  const match = String(path || "").match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

function sourceLanguageForArtifact(path: string) {
  const aliases: Record<string, string> = {
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
  const ext = artifactExtension(path);
  return aliases[ext] || ext || "plaintext";
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function HighlightedArtifactSource({ artifact, content }: { artifact: ArtifactSummary; content: string }) {
  const language = sourceLanguageForArtifact(artifact.path);
  const highlighted = hljs.getLanguage(language)
    ? hljs.highlight(content, { language, ignoreIllegals: true }).value
    : escapeHtml(content);
  return (
    <pre className="artifact-text artifact-source">
      <code
        className={`hljs language-${language}`}
        data-highlighted="yes"
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </pre>
  );
}
