import type { ArtifactSummary } from "../types/backend";

export const artifactPathExtensionPattern = "html?|md|markdown|txt|json|csv|xml|ya?ml|toml|ini|log|py|m?js|cjs|tsx?|jsx|css|sql|sh|ps1|bat|cmd|png|gif|jpe?g|webp|svg|pdf|docx?|xlsx?|pptx?|zip";

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
const sourceCodeExtensions = new Set(["py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "sql", "sh", "ps1", "bat", "cmd"]);

export function normalizeArtifactPath(value: string) {
  return String(value || "")
    .trim()
    .replace(/^file:\/\//i, "")
    .replace(/^["'`]+|["'`.,;:)]+$/g, "")
    .replace(/\\/g, "/");
}

export function normalizeProjectFilePath(value: string) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

export function artifactName(path: string) {
  const normalized = normalizeArtifactPath(path);
  return normalized.split("/").filter(Boolean).pop() || normalized || "artifact";
}

export function artifactExtension(path: string) {
  const name = artifactName(path);
  const match = name.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

export function isKnownArtifactPath(path: string) {
  return artifactExtensions.has(artifactExtension(path));
}

export function artifactKind(path: string) {
  const ext = artifactExtension(path);
  if (ext === "html" || ext === "htm") return "html";
  if (imageExtensions.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (textExtensions.has(ext)) return "text";
  return "file";
}

export function artifactKindLabel(kind: string) {
  if (kind === "html") return "HTML";
  if (kind === "image") return "이미지";
  if (kind === "pdf") return "PDF";
  if (kind === "text") return "텍스트";
  return "파일";
}

export function artifactLabelForPath(path: string, kind = artifactKind(path)) {
  if (kind === "file") {
    const ext = artifactExtension(path);
    if (documentExtensions.has(ext)) {
      return ext.toUpperCase();
    }
  }
  return artifactKindLabel(kind);
}

export function labelForArtifact(artifact: ArtifactSummary) {
  return artifact.label || artifactLabelForPath(artifact.path, artifact.kind);
}

export function artifactIcon(kind: string) {
  if (kind === "html") return "</>";
  if (kind === "image") return "IMG";
  if (kind === "pdf") return "PDF";
  if (kind === "text" || kind === "markdown" || kind === "json") return "TXT";
  return "FILE";
}

export function formatBytes(value?: number) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function artifactCategoryForPath(path: string) {
  const ext = artifactExtension(path);
  if (["html", "htm"].includes(ext)) return "web";
  if (["md", "markdown"].includes(ext)) return "markdown";
  if (["txt", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) return "docs";
  if (["json", "csv", "xml", "yaml", "yml", "toml", "ini", "log"].includes(ext)) return "data";
  if (sourceCodeExtensions.has(ext)) return "code";
  return "other";
}

export function artifactCategory(artifact: ArtifactSummary) {
  return artifactCategoryForPath(artifact.path || artifact.name);
}

export function isRootProjectFileCandidatePath(path: string) {
  const normalized = normalizeProjectFilePath(path);
  if (!normalized || normalized.includes("/") || normalized.startsWith("outputs/")) return false;
  return isKnownArtifactPath(normalized);
}

export function isSourceCodeArtifact(artifact: ArtifactSummary) {
  return sourceCodeExtensions.has(artifactExtension(artifact.path || artifact.name));
}

export function sourceLanguageForArtifact(path: string) {
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

export type ArtifactReference = ArtifactSummary & {
  start: number;
  end: number;
};

function artifactReferenceKey(path: string) {
  return normalizeArtifactPath(path).toLowerCase();
}

function trimArtifactCandidateRange(value: string, start: number, end: number) {
  let nextStart = start;
  let nextEnd = end;
  while (nextStart < nextEnd && /\s/.test(value[nextStart])) {
    nextStart += 1;
  }
  while (nextEnd > nextStart && /[\s`.,;:)\]]/.test(value[nextEnd - 1])) {
    nextEnd -= 1;
  }
  return { start: nextStart, end: nextEnd };
}

function expandFileLabelLine(value: string, start: number, end: number) {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextNewline = value.indexOf("\n", end);
  const lineEnd = nextNewline >= 0 ? nextNewline : value.length;
  const line = value.slice(lineStart, lineEnd);
  const localStart = start - lineStart;
  const localEnd = end - lineStart;
  const before = line.slice(0, localStart);
  const after = line.slice(localEnd);
  const fileLabelOnly = /^\s*(?:[-*+]\s*)?(?:파일|file)\s*:\s*["'`]*\s*$/i.test(before) && /^[\s"'`.,;:)\]]*$/.test(after);
  if (!fileLabelOnly) {
    return { start, end };
  }
  return {
    start: lineStart,
    end: nextNewline >= 0 ? nextNewline + 1 : lineEnd,
  };
}

function artifactReferenceFromRange(value: string, start: number, end: number, replaceStart = start, replaceEnd = end): ArtifactReference | null {
  const trimmed = trimArtifactCandidateRange(value, start, end);
  const path = normalizeArtifactPath(value.slice(trimmed.start, trimmed.end));
  if (!path || !isKnownArtifactPath(path) || /^https?:\/\//i.test(path)) {
    return null;
  }
  const expanded = expandFileLabelLine(value, replaceStart, replaceEnd);
  const kind = artifactKind(path);
  return {
    path,
    name: artifactName(path),
    kind,
    label: artifactLabelForPath(path, kind),
    start: expanded.start,
    end: expanded.end,
  };
}

export function collectArtifactReferences(text: string) {
  const value = String(text || "");
  const references: ArtifactReference[] = [];
  const occupiedRanges: Array<{ start: number; end: number }> = [];
  const push = (start: number, end: number, replaceStart = start, replaceEnd = end) => {
    const reference = artifactReferenceFromRange(value, start, end, replaceStart, replaceEnd);
    if (!reference) {
      return;
    }
    if (occupiedRanges.some((range) => reference.start < range.end && reference.end > range.start)) {
      return;
    }
    occupiedRanges.push({ start: reference.start, end: reference.end });
    references.push(reference);
  };

  for (const match of value.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const rawPath = match[1] || "";
    const pathStart = (match.index || 0) + match[0].lastIndexOf(rawPath);
    push(pathStart, pathStart + rawPath.length, match.index || 0, (match.index || 0) + match[0].length);
  }
  const backtickPattern = new RegExp(`\`([^\`\\n]+\\.(?:${artifactPathExtensionPattern}))\``, "gi");
  const pathPattern = new RegExp(`(?:^|[\\s(["'])((?:[A-Za-z]:)?[^\\s<>"'()]*\\.(?:${artifactPathExtensionPattern}))`, "gim");

  for (const match of value.matchAll(backtickPattern)) {
    const rawPath = match[1] || "";
    const start = (match.index || 0) + 1;
    push(start, start + rawPath.length);
  }
  for (const match of value.matchAll(pathPattern)) {
    const rawPath = match[1] || "";
    const start = (match.index || 0) + match[0].length - rawPath.length;
    push(start, start + rawPath.length);
  }

  const seen = new Set<string>();
  return references
    .filter((reference) => {
      const key = artifactReferenceKey(reference.path);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

export function collectArtifactCandidates(text: string) {
  return collectArtifactReferences(text).map(({ start: _start, end: _end, ...artifact }) => artifact);
}

export function dedupeArtifactsByResolvedPath(artifacts: ArtifactSummary[]) {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    const key = normalizeArtifactPath(artifact.path).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
