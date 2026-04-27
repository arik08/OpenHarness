export function createHistory(ctx) {
  const { state, els, STATUS_LABELS } = ctx;
  function closeModal(...args) { return ctx.closeModal(...args); }
  function saveScrollPosition(...args) { return ctx.saveScrollPosition(...args); }
  function setChatTitle(...args) { return ctx.setChatTitle(...args); }
  function setBusy(...args) { return ctx.setBusy(...args); }
  function sendBackendRequest(...args) { return ctx.sendBackendRequest(...args); }
  function deleteHistorySession(...args) { return ctx.deleteHistorySession(...args); }
  function deleteLiveChatSlot(...args) { return ctx.deleteLiveChatSlot?.(...args); }
  function appendMessage(...args) { return ctx.appendMessage(...args); }
  function switchChatSlot(...args) { return ctx.switchChatSlot?.(...args); }
  function openHistorySession(...args) { return ctx.openHistorySession?.(...args); }

function liveHistoryOptions() {
  const slots = [...state.chatSlots.values()].filter(slotBelongsToCurrentWorkspace);
  const isEmptyDraft = (slot) => Boolean(
    slot
      && slot.showInHistory
      && !slot.busy
      && !slot.container?.querySelector(".message")
      && (slot.title === "새 채팅" || slot.title === "New Chat" || !slot.savedSessionId)
  );
  const activeDraft = isEmptyDraft(state.chatSlots.get(state.activeFrontendId))
    ? state.activeFrontendId
    : "";
  const firstDraft = slots.find((slot) => isEmptyDraft(slot))?.frontendId || "";
  const visibleDraftId = activeDraft || firstDraft;
  return slots
    .filter((slot) =>
      slot.busy
      || (slot.showInHistory && (!isEmptyDraft(slot) || slot.frontendId === visibleDraftId))
    )
    .map((slot) => ({
      value: `live:${slot.frontendId}`,
      label: slot.showInHistory && !slot.hasConversation ? "새 채팅" : slot.title || (slot.busy ? "진행 중인 채팅" : "새 채팅"),
      description: slot.busy ? "진행 중" : "새 채팅",
      liveSlotId: slot.frontendId,
      savedSessionId: slot.savedSessionId || "",
      workspace: slot.workspace || null,
      busy: Boolean(slot.busy),
      busyVisual: Boolean(slot.busyVisual),
    }));
}

function slotBelongsToCurrentWorkspace(slot) {
  if (!slot) {
    return false;
  }
  const currentPath = String(state.workspacePath || "").trim();
  const slotPath = String(slot.workspace?.path || "").trim();
  if (currentPath && slotPath) {
    return slotPath === currentPath;
  }
  const currentName = String(state.workspaceName || "").trim();
  const slotName = String(slot.workspace?.name || "").trim();
  if (currentName && slotName) {
    return slotName === currentName;
  }
  return true;
}

function historyOptionBelongsToCurrentWorkspace(option) {
  const currentPath = String(state.workspacePath || "").trim();
  const optionPath = String(option?.workspace?.path || "").trim();
  if (currentPath && optionPath) {
    return optionPath === currentPath;
  }
  const currentName = String(state.workspaceName || "").trim();
  const optionName = String(option?.workspace?.name || "").trim();
  if (currentName && optionName) {
    return optionName === currentName;
  }
  return true;
}

function renderHistory(options) {
  els.historyList.textContent = "";
  const savedOptions = (Array.isArray(options) ? options : []).filter(historyOptionBelongsToCurrentWorkspace);
  const savedById = new Map(savedOptions.map((option) => [String(option.value || ""), option]));
  const liveOptions = liveHistoryOptions().map((option) => {
    const saved = option.savedSessionId ? savedById.get(String(option.savedSessionId)) : null;
    if (!saved) {
      return option;
    }
    return {
      ...option,
      label: saved.label || option.label,
      description: option.busy ? "진행 중" : saved.description || option.description,
    };
  });
  const liveSavedIds = new Set(liveOptions.map((option) => option.savedSessionId).filter(Boolean));
  const mergedOptions = [
    ...liveOptions,
    ...savedOptions.filter((option) => !liveSavedIds.has(String(option.value || ""))),
  ];
  if (!mergedOptions.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "저장된 세션이 아직 없습니다.";
    els.historyList.append(empty);
    return;
  }

  for (const option of mergedOptions) {
    const item = document.createElement("div");
    const isLive = Boolean(option.liveSlotId);
    const isActive = isLive
      ? state.activeFrontendId === option.liveSlotId
      : state.activeHistoryId === option.value;
    const isBusy = Boolean(option.busyVisual || (isActive && state.busyVisual));
    item.className = `history-item${isActive ? " active" : ""}${isBusy ? " busy" : ""}`;
    item.dataset.sessionId = option.value || "";
    if (isLive) {
      item.dataset.liveSlotId = option.liveSlotId;
    }

    const formattedTitle = formatHistoryTitle(option.label || option.value || "저장된 세션");
    if (isActive && !isLive && formattedTitle && formattedTitle !== state.chatTitle) {
      setChatTitle(formattedTitle);
    }
    const title = document.createElement("span");
    title.className = "history-title";
    title.textContent = formattedTitle;
    const detail = document.createElement("small");
    detail.textContent = option.description || option.label || "저장된 대화";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "history-open";
    openButton.append(title, detail);
    openButton.addEventListener("click", async () => {
      closeModal();
      if (isLive) {
        switchChatSlot(option.liveSlotId);
        return;
      }
      await openHistorySession(option.value || "", formattedTitle, option);
    });

    const busySpinner = document.createElement("span");
    busySpinner.className = "history-busy-spinner";
    busySpinner.setAttribute("aria-hidden", "true");

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "history-delete";
    deleteButton.setAttribute("aria-label", "기록 삭제");
    deleteButton.title = "기록 삭제";
    deleteButton.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M10 11v6"></path>
        <path d="M14 11v6"></path>
        <path d="M4 7h16"></path>
        <path d="M6 7l1 14h10l1-14"></path>
        <path d="M9 7V4h6v3"></path>
      </svg>
    `;
    if (isBusy) {
      deleteButton.disabled = true;
    } else {
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (isLive) {
          deleteLiveHistorySlot(option.liveSlotId, item).catch((error) => {
            appendMessage("system", `Chat close failed: ${error.message}`);
            setBusy(false, STATUS_LABELS.error);
          });
          return;
        }
        deleteHistorySession(option.value || "", item, option).catch((error) => {
          item.classList.remove("deleting");
          appendMessage("system", `기록 삭제 실패: ${error.message}`);
          setBusy(false, STATUS_LABELS.error);
        });
      });
    }

    item.append(openButton, busySpinner, deleteButton);
    els.historyList.append(item);
  }
}

function formatHistoryTitle(label) {
  const withoutPrefix = String(label || "")
    .replace(/^\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s+\d+\s*msg\s*/i, "")
    .replace(/^\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s*/i, "")
    .trim();
  return withoutPrefix || "저장된 대화";
}

function markActiveHistory() {
  els.historyList.querySelectorAll(".history-item").forEach((item) => {
    const liveSlot = item.dataset.liveSlotId ? state.chatSlots.get(item.dataset.liveSlotId) : null;
    const isActive = liveSlot
      ? item.dataset.liveSlotId === state.activeFrontendId
      : item.dataset.sessionId === state.activeHistoryId;
    item.classList.toggle("active", isActive);
    item.classList.toggle("busy", Boolean(liveSlot?.busyVisual) || (isActive && state.busyVisual));
  });
}

async function deleteLiveHistorySlot(frontendId, item) {
  const slot = state.chatSlots.get(frontendId);
  if (!slot || slot.busy) {
    return;
  }
  item?.remove();
  await deleteLiveChatSlot(frontendId);
  markActiveHistory();
  if (!els.historyList.querySelector(".history-item")) {
    renderHistory([]);
  }
}

  return {
    renderHistory,
    formatHistoryTitle,
    markActiveHistory,
  };
}
