export function createMarkdown(ctx) {
  const { marked, katex } = ctx;

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

function enhanceCodeBlocks(element) {
  element.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector(".code-copy")) {
      return;
    }
    const code = pre.querySelector("code");
    if (!code) {
      return;
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

function setMarkdown(element, text) {
  element.dataset.rawText = text;
  element.innerHTML = renderMarkdown(text, {
    restoreEscapedInlineMarkdown: element.dataset.restoreEscapedInlineMarkdown === "true",
  });
  enhanceTables(element);
  enhanceCodeBlocks(element);
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

