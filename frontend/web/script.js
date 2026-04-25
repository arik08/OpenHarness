import { marked } from "/vendor/marked/marked.esm.js";
import katex from "/vendor/katex/katex.mjs";

import {
  state,
  els,
  STATUS_LABELS,
  commandDescription,
  updateState,
  setPlanModeIndicatorActive,
  formatProviderName,
  formatEffort,
} from "./modules/state.js";
import { createApi } from "./modules/api.js";
import { createCommands } from "./modules/commands.js";
import { createEvents } from "./modules/events.js";
import { createHistory } from "./modules/history.js";
import { createMarkdown } from "./modules/markdown.js";
import { createArtifacts } from "./modules/artifacts.js";
import { createMessages } from "./modules/messages.js";
import { createModals } from "./modules/modals.js";
import { createUI } from "./modules/ui.js";

const ctx = {
  marked,
  katex,
  state,
  els,
  STATUS_LABELS,
  commandDescription,
  updateState,
  setPlanModeIndicatorActive,
  formatProviderName,
  formatEffort,
};

Object.assign(ctx, createUI(ctx));
Object.assign(ctx, createMarkdown(ctx));
Object.assign(ctx, createArtifacts(ctx));
Object.assign(ctx, createMessages(ctx));
Object.assign(ctx, createCommands(ctx));
Object.assign(ctx, createApi(ctx));
Object.assign(ctx, createHistory(ctx));
Object.assign(ctx, createModals(ctx));
Object.assign(ctx, createEvents(ctx));
ctx.initializeArtifactPanel();

const {
  appendMessage,
  addPastedText,
  autoSizeInput,
  buildComposerLine,
  cancelCurrent,
  clearChat,
  clearComposerToken,
  closeModal,
  closeSlashMenu,
  filteredSlashCommands,
  isNearMessageBottom,
  initializeWorkspace,
  renderSlashMenu,
  requestHistory,
  requestSelectCommand,
  renderAttachments,
  removePastedText,
  scheduleScrollPositionSave,
  selectSlashCommand,
  sendLine,
  setBusy,
  setSidebarCollapsed,
  setStatus,
  showModelSettingsModal,
  showSettingsModal,
  showWorkspaceModal,
  startSession,
  startTitleEdit,
  updateComposerTokenFromInput,
  updateSendState,
  updateSlashMenu,
} = ctx;

const maxImageBytes = 10 * 1024 * 1024;
const longPastedTextLineThreshold = 5;
const themeOptions = [
  { id: "light", label: "Claude" },
  { id: "posco", label: "POSCO" },
  { id: "dark", label: "Dark-Blue" },
  { id: "mono", label: "MonoChrome-Green" },
  { id: "mono-orange", label: "MonoChrome-Orange" },
];

function applyTheme(themeId) {
  const theme = themeOptions.find((item) => item.id === themeId) || themeOptions[0];
  document.documentElement.dataset.theme = theme.id === "light" ? "" : theme.id;
  localStorage.setItem("openharness:theme", theme.id);
  if (els.themeToggle) {
    els.themeToggle.dataset.tooltip = `테마: ${theme.label}`;
    els.themeToggle.setAttribute("aria-label", `테마 전환: ${theme.label}`);
  }
}

function cycleTheme() {
  const current = localStorage.getItem("openharness:theme") || "light";
  const currentIndex = Math.max(0, themeOptions.findIndex((item) => item.id === current));
  const next = themeOptions[(currentIndex + 1) % themeOptions.length];
  applyTheme(next.id);
}

function imageId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error(`${file.name}은 이미지 파일이 아닙니다.`));
      return;
    }
    if (file.size > maxImageBytes) {
      reject(new Error(`${file.name}은 10MB보다 커서 첨부할 수 없습니다.`));
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result || "");
      const [, payload = ""] = result.split(",", 2);
      resolve({
        id: imageId(),
        name: file.name,
        mediaType: file.type || "image/png",
        data: payload,
      });
    });
    reader.addEventListener("error", () => reject(new Error(`${file.name}을 읽지 못했습니다.`)));
    reader.readAsDataURL(file);
  });
}

async function addImageFiles(files) {
  const images = [...files].filter((file) => file.type.startsWith("image/"));
  if (!images.length) {
    return;
  }
  try {
    const attachments = await Promise.all(images.map(readImageFile));
    state.attachments.push(...attachments);
    renderAttachments();
    updateSendState();
  } catch (error) {
    appendMessage("system", `이미지 첨부 실패: ${error.message}`);
  }
}

function imageFilesFromClipboard(dataTransfer) {
  const directFiles = [...(dataTransfer?.files || [])].filter((file) => file.type.startsWith("image/"));
  if (directFiles.length) {
    return directFiles;
  }
  return [...(dataTransfer?.items || [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

function countTextLines(value) {
  return String(value || "").replace(/\r\n/g, "\n").split("\n").length;
}

function isLongPastedText(value) {
  return countTextLines(value) >= longPastedTextLineThreshold;
}

function captureLongInputIfNeeded() {
  const value = els.input.value;
  if (!isLongPastedText(value)) {
    return false;
  }
  addPastedText(value);
  els.input.value = "";
  closeSlashMenu();
  autoSizeInput();
  updateSendState();
  return true;
}

function handlePlanModeShortcut(event) {
  if (event.key !== "Tab" || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
    return false;
  }
  event.preventDefault();
  closeSlashMenu();
  if (state.busy) {
    return true;
  }
  sendLine("/plan").catch((error) => {
    appendMessage("system", `Plan mode toggle failed: ${error.message}`);
    setBusy(false, STATUS_LABELS.error);
  });
  return true;
}

els.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) {
    return;
  }
  try {
    await sendLine(buildComposerLine());
  } catch (error) {
    appendMessage("system", `전송 실패: ${error.message}`);
    setBusy(false, STATUS_LABELS.error);
  }
});

els.input.addEventListener("input", () => {
  updateComposerTokenFromInput();
  if (captureLongInputIfNeeded()) {
    return;
  }
  autoSizeInput();
  updateSendState();
  state.slashMenuIndex = 0;
  updateSlashMenu();
});

els.send?.addEventListener("click", (event) => {
  if (!state.busy) {
    return;
  }
  event.preventDefault();
  cancelCurrent().catch((error) => {
    appendMessage("system", `중단 실패: ${error.message}`);
    setBusy(false, STATUS_LABELS.error);
  });
});

els.input.addEventListener("keydown", (event) => {
  if (handlePlanModeShortcut(event)) {
    event.stopPropagation();
    return;
  }
  if ((event.key === "Backspace" || event.key === "Delete") && state.composerToken && els.input.value.length === 0) {
    event.preventDefault();
    clearComposerToken();
    return;
  }
  if (state.slashMenuOpen && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
    if (state.slashMenuMode === "cli") {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSlashMenu();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        closeSlashMenu();
        els.composer.requestSubmit();
        return;
      }
      return;
    }
    const commands = filteredSlashCommands();
    if (event.key === "Escape") {
      event.preventDefault();
      closeSlashMenu();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.slashMenuIndex = (state.slashMenuIndex + 1) % commands.length;
      renderSlashMenu();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.slashMenuIndex = (state.slashMenuIndex - 1 + commands.length) % commands.length;
      renderSlashMenu();
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      selectSlashCommand(commands[state.slashMenuIndex]);
      return;
    }
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    els.composer.requestSubmit();
  }
});

els.input.addEventListener("click", updateSlashMenu);

els.input.addEventListener("blur", () => {
  window.setTimeout(closeSlashMenu, 120);
});

els.planModeIndicator?.addEventListener("click", () => {
  sendLine("/plan").catch((error) => {
    appendMessage("system", `Plan mode toggle failed: ${error.message}`);
    setBusy(false, STATUS_LABELS.error);
  });
});

els.attachmentTray?.addEventListener("click", (event) => {
  const remove = event.target.closest(".attachment-remove");
  if (!remove) {
    return;
  }
  state.attachments = state.attachments.filter((attachment) => attachment.id !== remove.dataset.id);
  renderAttachments();
  updateSendState();
});

els.pastedTextTray?.addEventListener("click", (event) => {
  const remove = event.target.closest(".pasted-text-remove");
  if (!remove) {
    return;
  }
  removePastedText(remove.dataset.id);
  els.input.focus();
});

els.composer.addEventListener("paste", (event) => {
  const files = imageFilesFromClipboard(event.clipboardData);
  if (files.length) {
    event.preventDefault();
    addImageFiles(files);
    return;
  }
  const text = event.clipboardData?.getData("text/plain") || "";
  if (isLongPastedText(text)) {
    event.preventDefault();
    addPastedText(text);
    closeSlashMenu();
    autoSizeInput();
    updateSendState();
  }
});

els.messages.addEventListener("scroll", () => {
  if (!state.restoringHistory && !state.ignoreScrollSave) {
    if (Date.now() < state.autoScrollUntil) {
      state.autoFollowMessages = true;
    } else {
      state.autoFollowMessages = isNearMessageBottom();
    }
  }
  scheduleScrollPositionSave();
});

els.chatTitleButton?.addEventListener("click", startTitleEdit);

els.modalHost.addEventListener("click", (event) => {
  if (event.target === els.modalHost && els.modalHost.dataset.dismissible === "true") {
    closeModal();
  }
});

window.addEventListener("keydown", (event) => {
  if (!event.defaultPrevented && handlePlanModeShortcut(event)) {
    return;
  }
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "o") {
    event.preventDefault();
    closeSlashMenu();
    clearChat().catch((error) => appendMessage("system", `채팅을 초기화하지 못했습니다: ${error.message}`));
  }
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    const prompt = button.dataset.prompt || "";
    sendLine(prompt).catch((error) => {
      appendMessage("system", `명령어 실행 실패: ${error.message}`);
      setBusy(false, STATUS_LABELS.error);
    });
  });
});

document.querySelectorAll("[data-action='open-settings']").forEach((button) => {
  button.addEventListener("click", showSettingsModal);
});

document.querySelectorAll("[data-action='open-model-settings']").forEach((button) => {
  button.addEventListener("click", showModelSettingsModal);
});

document.querySelectorAll("[data-action='open-workspace']").forEach((button) => {
  button.addEventListener("click", () => {
    showWorkspaceModal().catch((error) => appendMessage("system", `프로젝트 목록을 열지 못했습니다: ${error.message}`));
  });
});

document.querySelectorAll("[data-action='toggle-theme']").forEach((button) => {
  button.addEventListener("click", cycleTheme);
});
document.querySelectorAll("[data-select-command]").forEach((button) => {
  button.addEventListener("click", () => {
    const command = button.dataset.selectCommand || "";
    requestSelectCommand(command).catch((error) => {
      appendMessage("system", `Selection failed: ${error.message}`);
      setBusy(false, STATUS_LABELS.error);
    });
  });
});

document.querySelectorAll("[data-action='new-chat']").forEach((button) => {
  button.addEventListener("click", () => {
    clearChat().catch((error) => appendMessage("system", `채팅을 초기화하지 못했습니다: ${error.message}`));
  });
});

document.querySelectorAll("[data-action='toggle-sidebar']").forEach((button) => {
  button.addEventListener("click", () => {
    setSidebarCollapsed(!els.appShell?.classList.contains("sidebar-collapsed"));
  });
});

applyTheme(localStorage.getItem("openharness:theme") || "light");
setSidebarCollapsed(localStorage.getItem("openharness:sidebarCollapsed") === "1");

async function boot() {
  await initializeWorkspace();
  await startSession();
}

boot().catch((error) => {
  appendMessage("system", `백엔드 시작 실패: ${error.message}`);
  setStatus(STATUS_LABELS.startFailed);
});

window.addEventListener("beforeunload", () => {
  if (!state.sessionId) {
    return;
  }
  navigator.sendBeacon(
    "/api/shutdown",
    new Blob([JSON.stringify({ sessionId: state.sessionId })], { type: "application/json" }),
  );
});
