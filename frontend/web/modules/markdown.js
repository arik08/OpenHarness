export function createMarkdown(ctx) {
  const { marked, katex } = ctx;
  const htmlPreviewUrlCache = new Map();

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function expandCompactTable(line) {
  if (/\\\|/.test(line)) {
    return line;
  }
  const cells = splitTableRow(line);
  const dividerStart = cells.findIndex((cell) => /^:?-{3,}:?$/.test(cell));
  if (dividerStart <= 0) {
    return line;
  }
  const header = cells.slice(0, dividerStart);
  const columnCount = header.length;
  const divider = cells.slice(dividerStart, dividerStart + columnCount);
  if (divider.length !== columnCount || !divider.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    return line;
  }
  const bodyCells = cells.slice(dividerStart + columnCount);
  if (!bodyCells.length || bodyCells.length % columnCount !== 0) {
    return line;
  }
  const rows = [header, divider];
  for (let index = 0; index < bodyCells.length; index += columnCount) {
    rows.push(bodyCells.slice(index, index + columnCount));
  }
  return rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function restoreEscapedInlineMarkdown(markdown) {
  return String(markdown || "")
    .replace(/\\\*\\\*/g, "**")
    .replace(/\\_\\_/g, "__")
    .replace(/\\~\\~/g, "~~")
    .replace(/\\`/g, "`");
}

function normalizeMarkdown(markdown, options = {}) {
  const source = options.restoreEscapedInlineMarkdown
    ? restoreEscapedInlineMarkdown(markdown)
    : String(markdown || "");
  return source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => (line.includes("|") ? expandCompactTable(line) : line))
    .join("\n");
}

marked.use({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: "displayMath",
      level: "block",
      start(source) {
        return source.match(/\\\[/)?.index;
      },
      tokenizer(source) {
        const match = source.match(/^\\\[([\s\S]+?)\\\](?:\n|$)/);
        if (!match) {
          return undefined;
        }
        return { type: "displayMath", raw: match[0], text: match[1].trim() };
      },
      renderer(token) {
        return katex.renderToString(token.text, { displayMode: true, throwOnError: false });
      },
    },
    {
      name: "inlineMath",
      level: "inline",
      start(source) {
        return source.match(/\\\(/)?.index;
      },
      tokenizer(source) {
        const match = source.match(/^\\\((.+?)\\\)/);
        if (!match) {
          return undefined;
        }
        return { type: "inlineMath", raw: match[0], text: match[1].trim() };
      },
      renderer(token) {
        return katex.renderToString(token.text, { displayMode: false, throwOnError: false });
      },
    },
  ],
});

function renderMarkdown(markdown, options = {}) {
  return marked.parse(normalizeMarkdown(markdown, options));
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the selection-based copy path.
    }
  }
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.top = "-1000px";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  if (!copied) {
    throw new Error("Copy failed");
  }
}

function codeBlockLanguage(code) {
  const className = String(code?.className || "").toLowerCase();
  const match = className.match(/(?:^|\s)language-([a-z0-9_-]+)/);
  return match?.[1] || "";
}

function isHtmlPreviewCodeBlock(code) {
  return ["html", "htm"].includes(codeBlockLanguage(code));
}

function normalizeHtmlPreviewSource(value) {
  return String(value || "").replace(/\r\n/g, "\n").trimEnd();
}

function rememberHtmlPreviewUrl(source, url) {
  const key = normalizeHtmlPreviewSource(source);
  if (!key || !url) {
    return;
  }
  if (htmlPreviewUrlCache.size >= 24 && !htmlPreviewUrlCache.has(key)) {
    htmlPreviewUrlCache.delete(htmlPreviewUrlCache.keys().next().value);
  }
  htmlPreviewUrlCache.set(key, url);
}

function completeHtmlFenceSources(markdown) {
  const sources = new Set();
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let fence = null;
  let content = [];

  for (const line of lines) {
    if (!fence) {
      const open = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (!open) {
        continue;
      }
      const info = String(open[2] || "").trim().toLowerCase().split(/\s+/)[0] || "";
      fence = {
        marker: open[1][0],
        length: open[1].length,
        html: ["html", "htm"].includes(info),
      };
      content = [];
      continue;
    }

    const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
    if (close && close[1][0] === fence.marker && close[1].length >= fence.length) {
      if (fence.html) {
        sources.add(normalizeHtmlPreviewSource(content.join("\n")));
      }
      fence = null;
      content = [];
      continue;
    }

    content.push(line);
  }

  return sources;
}

function htmlPreviewHeight(value) {
  const minHeight = 220;
  const maxHeight = Math.min(720, Math.max(420, Math.round(window.innerHeight * 0.72)));
  const height = Number(value);
  if (!Number.isFinite(height) || height <= 0) {
    return minHeight;
  }
  return Math.min(maxHeight, Math.max(minHeight, height + 12));
}

function htmlPreviewToken() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function notifyHtmlPreviewResize(frame, token) {
  if (!frame?.isConnected || !frame.contentWindow) {
    return;
  }
  const rect = frame.getBoundingClientRect();
  frame.contentWindow.postMessage({
    type: "myharness-html-preview-resize",
    token,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }, "*");
}

function observeHtmlPreviewFrame(frame, token) {
  let lastWidth = -1;
  let frameId = 0;
  let observer = null;
  const targets = [frame, frame.parentElement].filter(Boolean);
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
      cleanup();
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
      notifyHtmlPreviewResize(frame, token);
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
  return cleanup;
}

async function loadHtmlPreview(frame, errorNode, source) {
  try {
    const cacheKey = normalizeHtmlPreviewSource(source);
    let previewUrl = htmlPreviewUrlCache.get(cacheKey);
    if (!previewUrl) {
      const response = await fetch("/api/html-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: source }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Could not create HTML preview");
      }
      previewUrl = payload.url;
      rememberHtmlPreviewUrl(source, previewUrl);
    }
    if (frame.isConnected) {
      const token = htmlPreviewToken();
      frame.name = token;
      const stopResizeObserver = observeHtmlPreviewFrame(frame, token);
      const onMessage = (event) => {
        if (!frame.isConnected) {
          window.removeEventListener("message", onMessage);
          stopResizeObserver?.();
          return;
        }
        if (event.data?.type !== "myharness-html-preview-size" || event.data?.token !== token) {
          return;
        }
        frame.style.height = `${htmlPreviewHeight(event.data.height)}px`;
      };
      window.addEventListener("message", onMessage);
      frame.src = `${previewUrl}?ohPreviewToken=${encodeURIComponent(token)}`;
      frame.addEventListener("load", () => {
        notifyHtmlPreviewResize(frame, token);
      });
    }
  } catch {
    if (!frame.isConnected) {
      return;
    }
    frame.remove();
    errorNode.hidden = false;
  }
}

function createHtmlPreview(code) {
  const source = String(code.textContent || "");
  if (!source.trim()) {
    return null;
  }
  const preview = document.createElement("div");
  preview.className = "html-render-preview";
  const frame = document.createElement("iframe");
  frame.className = "html-render-frame";
  frame.title = "HTML preview";
  frame.loading = "lazy";
  frame.referrerPolicy = "no-referrer";
  frame.setAttribute("sandbox", "allow-scripts");
  const error = document.createElement("div");
  error.className = "html-render-error";
  error.hidden = true;
  error.textContent = "HTML 미리보기를 불러오지 못했습니다.";
  preview.append(frame, error);
  loadHtmlPreview(frame, error, source);
  return preview;
}

function createPendingHtmlPreview(code) {
  const source = String(code.textContent || "");
  if (!source.trim()) {
    return null;
  }
  const preview = document.createElement("div");
  preview.className = "workflow-output-preview html-stream-preview";
  const title = document.createElement("div");
  title.className = "workflow-output-title";
  const label = document.createElement("span");
  label.className = "workflow-output-label";
  label.textContent = "작성 중 - HTML preview";
  const count = document.createElement("span");
  count.className = "workflow-output-line-count";
  count.textContent = `${source.length.toLocaleString()}자`;
  const body = document.createElement("pre");
  body.className = "workflow-output-body";
  body.textContent = source;
  title.append(label, count);
  preview.append(title, body);
  body.scrollTop = body.scrollHeight;
  window.requestAnimationFrame(() => {
    if (body.isConnected) {
      body.scrollTop = body.scrollHeight;
    }
  });
  return preview;
}

function enhanceCodeBlocks(element, options = {}) {
  const isStreaming = element.classList.contains("streaming-text");
  const completeStreamingHtmlSources = isStreaming
    ? completeHtmlFenceSources(options.rawMarkdown || element.dataset.displayText || element.dataset.rawText)
    : null;
  element.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector(".code-copy")) {
      return;
    }
    const code = pre.querySelector("code");
    if (!code) {
      return;
    }
    const isHtmlPreview = isHtmlPreviewCodeBlock(code);
    const isCompleteStreamingHtml = isHtmlPreview
      && isStreaming
      && completeStreamingHtmlSources.has(normalizeHtmlPreviewSource(code.textContent));
    if (isHtmlPreview && (!isStreaming || isCompleteStreamingHtml)) {
      const preview = createHtmlPreview(code);
      if (preview) {
        pre.replaceWith(preview);
        return;
      }
    }
    if (isHtmlPreview && isStreaming && !isCompleteStreamingHtml) {
      const preview = createPendingHtmlPreview(code);
      if (preview) {
        pre.replaceWith(preview);
        return;
      }
    }
    pre.classList.toggle("single-line-code", !code.textContent?.trimEnd().includes("\n"));
    if (!code.dataset.highlighted && window.hljs) {
      window.hljs.highlightElement(code);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.setAttribute("aria-label", "Copy code");
    button.title = "Copy code";
    button.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <rect x="9" y="9" width="10" height="10" rx="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <span>Copy</span>
    `;
    button.addEventListener("click", async () => {
      const text = code.textContent || "";
      try {
        await copyTextToClipboard(text);
        button.classList.add("copied");
        button.querySelector("span").textContent = "Copied";
        window.setTimeout(() => {
          button.classList.remove("copied");
          button.querySelector("span").textContent = "Copy";
        }, 1300);
      } catch (error) {
        button.querySelector("span").textContent = "Failed";
        window.setTimeout(() => {
          button.querySelector("span").textContent = "Copy";
        }, 1300);
      }
    });
    pre.append(button);
  });
}

function enhanceTables(element) {
  element.querySelectorAll("table").forEach((table) => {
    if (table.parentElement?.classList.contains("table-wrap")) {
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    table.replaceWith(wrap);
    wrap.append(table);
  });
}

function setMarkdown(element, text, options = {}) {
  element.dataset.rawText = text;
  element.innerHTML = renderMarkdown(text, {
    restoreEscapedInlineMarkdown: element.dataset.restoreEscapedInlineMarkdown === "true",
  });
  enhanceTables(element);
  enhanceCodeBlocks(element, { rawMarkdown: options.rawMarkdown || text });
}

  return {
    normalizeMarkdown,
    restoreEscapedInlineMarkdown,
    renderMarkdown,
    copyTextToClipboard,
    enhanceCodeBlocks,
    enhanceTables,
    setMarkdown,
  };
}

