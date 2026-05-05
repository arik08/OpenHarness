import { useEffect, useRef } from "react";
import hljs from "highlight.js/lib/common";
import type { ArtifactSummary } from "../types/backend";
import type { ArtifactPayload } from "../types/ui";
import { isSourceCodeArtifact, sourceLanguageForArtifact } from "../utils/artifacts";
import { Icon } from "./ArtifactIcons";
import { MarkdownMessage } from "./MarkdownMessage";

export const artifactFrameBackMessage = "myharness:artifact-panel-back";

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

function escapeAttribute(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function iframeAssetBase(content: string, assetBaseUrl: string) {
  const baseUrl = String(assetBaseUrl || "").trim();
  if (!baseUrl) {
    return content;
  }
  const withAssetUrls = iframeRelativeAssetUrls(content, baseUrl);
  const base = `<base href="${escapeAttribute(baseUrl)}">`;
  if (/<base(?:\s[^>]*)?>/i.test(withAssetUrls)) {
    return withAssetUrls;
  }
  if (/<head(?:\s[^>]*)?>/i.test(withAssetUrls)) {
    return withAssetUrls.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}${base}`);
  }
  if (/<html(?:\s[^>]*)?>/i.test(withAssetUrls)) {
    return withAssetUrls.replace(/<html(?:\s[^>]*)?>/i, (match) => `${match}<head>${base}</head>`);
  }
  return `${base}${withAssetUrls}`;
}

function iframeRelativeAssetUrls(content: string, assetBaseUrl: string) {
  const toAssetUrl = (value: string) => {
    const raw = String(value || "").trim();
    if (!raw || raw.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(raw)) {
      return value;
    }
    try {
      return new URL(raw, `${globalThis.location?.origin || "http://localhost"}${assetBaseUrl}`).pathname;
    } catch {
      return `${assetBaseUrl}${raw}`;
    }
  };
  return content
    .replace(/\b(src|poster)\s*=\s*(["'])([^"']+)\2/gi, (_match, attr, quote, value) => {
      return `${attr}=${quote}${escapeAttribute(toAssetUrl(value))}${quote}`;
    })
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (_match, quote, value) => {
      return `url(${quote}${escapeAttribute(toAssetUrl(value))}${quote})`;
    });
}

export function isEditablePayload(artifact: ArtifactSummary, payload: ArtifactPayload) {
  const kind = String(payload.kind || artifact.kind || "");
  return kind === "html" || kind === "text" || kind === "markdown" || kind === "json";
}

function isMarkdownArtifact(artifact: ArtifactSummary, payload: ArtifactPayload) {
  const kind = String(payload.kind || artifact.kind || "").toLowerCase();
  const path = String(artifact.path || "").toLowerCase();
  return kind === "markdown" || path.endsWith(".md") || path.endsWith(".markdown");
}

export function ArtifactPreview({
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
    const previewContent = iframeAssetBase(draftContent || content, String(payload.assetBaseUrl || ""));
    return <iframe className="artifact-frame artifact-html-frame" title={artifact.name} sandbox="allow-scripts" srcDoc={iframeBackBridge(previewContent)} />;
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

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isEditableKeyTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) {
    return false;
  }
  const tagName = element.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || element.isContentEditable;
}

function nodeIsInside(root: HTMLElement, node: Node | null) {
  if (!node) {
    return false;
  }
  return root.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
}

function selectElementText(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function HighlightedArtifactSource({ artifact, content }: { artifact: ArtifactSummary; content: string }) {
  const sourceRef = useRef<HTMLPreElement | null>(null);
  const language = sourceLanguageForArtifact(artifact.path);
  const highlighted = hljs.getLanguage(language)
    ? hljs.highlight(content, { language, ignoreIllegals: true }).value
    : escapeHtml(content);

  useEffect(() => {
    function handleSelectAll(event: KeyboardEvent) {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.key.toLowerCase() !== "a") {
        return;
      }
      if (isEditableKeyTarget(event.target)) {
        return;
      }
      const source = sourceRef.current;
      if (!source?.isConnected) {
        return;
      }
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const selection = window.getSelection();
      const selectionIsInSource = nodeIsInside(source, selection?.anchorNode || null);
      const focusIsInArtifactPanel = Boolean(activeElement?.closest(".artifact-panel"));
      const focusIsDocumentBody = activeElement === document.body;
      if (!selectionIsInSource && !focusIsInArtifactPanel && !focusIsDocumentBody) {
        return;
      }
      event.preventDefault();
      selectElementText(source.querySelector("code") || source);
    }

    document.addEventListener("keydown", handleSelectAll, true);
    return () => {
      document.removeEventListener("keydown", handleSelectAll, true);
    };
  }, []);

  return (
    <pre
      ref={sourceRef}
      className="artifact-text artifact-source"
      tabIndex={0}
      aria-label={`${artifact.name} 코드 원문`}
      onMouseDown={(event) => {
        event.currentTarget.focus();
      }}
    >
      <code
        className={`hljs language-${language}`}
        data-highlighted="yes"
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </pre>
  );
}
