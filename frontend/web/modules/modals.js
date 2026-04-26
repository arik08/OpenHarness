export function createModals(ctx) {
  const { state, els } = ctx;
  function requestSelectCommand(...args) { return ctx.requestSelectCommand(...args); }
  function appendMessage(...args) { return ctx.appendMessage(...args); }
  function respond(...args) { return ctx.respond(...args); }
  function postJson(...args) { return ctx.postJson(...args); }
  function setSystemPrompt(...args) { return ctx.setSystemPrompt(...args); }
  function loadWorkspaces(...args) { return ctx.loadWorkspaces(...args); }
  function createWorkspace(...args) { return ctx.createWorkspace(...args); }
  function deleteWorkspace(...args) { return ctx.deleteWorkspace(...args); }
  function restartSessionForWorkspace(...args) { return ctx.restartSessionForWorkspace(...args); }
  function formatEffort(...args) { return ctx.formatEffort(...args); }

function showSettingsModal() {
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  els.modalHost.dataset.dismissible = "true";
  delete els.modalHost.dataset.dismissAction;

  const card = document.createElement("div");
  card.className = "modal-card system-settings-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.append(modalCloseButton(closeModal));

  const title = document.createElement("h2");
  title.textContent = "설정";
  const body = document.createElement("p");
  body.textContent = "시스템 프롬프트를 입력하면 에이전트의 기본 응답 방향에 반영됩니다.";
  const input = document.createElement("textarea");
  input.className = "system-prompt-input";
  input.rows = 7;
  input.placeholder = "예: 항상 한국어로 답변하고, 회사 업무에 맞게 간결하게 정리해줘.";
  input.value = state.systemPrompt || "";
  const helper = document.createElement("p");
  helper.className = "settings-helper";
  helper.textContent = "비워두면 기본 시스템 프롬프트를 사용합니다. 저장 후 다음 메시지부터 적용됩니다.";
  const actions = document.createElement("div");
  actions.className = "modal-actions";
  actions.append(
    modalButton("초기화", false, () => {
      input.value = "";
      input.focus();
    }),
    modalButton("저장", true, async () => {
      try {
        await setSystemPrompt(input.value);
        closeModal();
        if (!state.sessionId) {
          appendMessage("system", "시스템 프롬프트 설정을 저장했습니다.");
        }
      } catch (error) {
        appendMessage("system", `시스템 프롬프트 저장 실패: ${error.message}`);
      }
    }),
  );
  card.append(title, body, input, helper, actions);
  els.modalHost.append(card);
  input.focus();
}

function showModelSettingsModal() {
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  els.modalHost.dataset.dismissible = "true";
  delete els.modalHost.dataset.dismissAction;

  const card = document.createElement("div");
  card.className = "modal-card settings-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.append(modalCloseButton(closeModal));

  const title = document.createElement("h2");
  title.textContent = "모델 설정";
  const body = document.createElement("p");
  body.textContent = "Provider, 모델, 추론 노력을 변경할 수 있습니다.";
  card.append(title, body);

  const list = document.createElement("div");
  list.className = "settings-list";
  list.append(
    settingsButton("Provider", state.provider, () => {
      closeModal();
      state.returnToSettingsOnDismiss = true;
      requestSelectCommand("provider").catch((error) => appendMessage("system", `Selection failed: ${error.message}`));
    }),
    settingsButton("모델", state.model, () => {
      closeModal();
      state.returnToSettingsOnDismiss = true;
      requestSelectCommand("model").catch((error) => appendMessage("system", `Selection failed: ${error.message}`));
    }),
    settingsButton("추론 노력", formatEffort(state.effort), () => {
      closeModal();
      state.returnToSettingsOnDismiss = true;
      requestSelectCommand("effort").catch((error) => appendMessage("system", `Selection failed: ${error.message}`));
    }),
  );
  card.append(list);

  els.modalHost.append(card);
}

async function showWorkspaceModal() {
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  els.modalHost.dataset.dismissible = "true";
  delete els.modalHost.dataset.dismissAction;

  const card = document.createElement("div");
  card.className = "modal-card workspace-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.append(modalCloseButton(closeModal));

  const title = document.createElement("h2");
  title.textContent = "프로젝트";
  const body = document.createElement("p");
  body.textContent = "Playground 안에서 작업할 프로젝트를 선택하거나 새로 만듭니다.";

  const list = document.createElement("div");
  list.className = "workspace-list";

  const form = document.createElement("form");
  form.className = "workspace-create";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "새 프로젝트 이름";
  input.autocomplete = "off";
  input.spellcheck = false;
  const createButton = modalButton("만들기", true, () => {});
  createButton.type = "submit";
  form.append(input, createButton);

  const error = document.createElement("p");
  error.className = "settings-helper workspace-error";
  error.textContent = "";

  card.append(title, body, list, form, error);
  els.modalHost.append(card);

  function setError(message) {
    error.textContent = message || "";
  }

  let pendingDeleteWorkspace = "";

  function setDeleteIcon(button, armed = false) {
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
  }

  function clearPendingDelete() {
    pendingDeleteWorkspace = "";
    list.querySelectorAll(".workspace-row.delete-ready").forEach((row) => {
      row.classList.remove("delete-ready");
      const deleteButton = row.querySelector(".workspace-delete");
      if (deleteButton) {
        deleteButton.title = "프로젝트 삭제";
        deleteButton.setAttribute("aria-label", `${deleteButton.dataset.workspaceName || ""} 삭제`);
        setDeleteIcon(deleteButton, false);
      }
    });
  }

  function renderList(workspaces) {
    pendingDeleteWorkspace = "";
    list.textContent = "";
    for (const workspace of workspaces) {
      const isActive = workspace.name === state.workspaceName;
      const row = document.createElement("div");
      row.className = `workspace-row${isActive ? " active" : ""}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `workspace-option${isActive ? " active" : ""}`;
      button.disabled = state.switchingWorkspace;
      const copy = document.createElement("span");
      const label = document.createElement("strong");
      label.textContent = workspace.name;
      copy.append(label);
      button.append(copy);
      button.addEventListener("click", async () => {
        if (workspace.name === state.workspaceName) {
          closeModal();
          return;
        }
        try {
          closeModal();
          await restartSessionForWorkspace(workspace);
        } catch (err) {
          appendMessage("system", `프로젝트 전환 실패: ${err.message}`);
        }
      });
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "workspace-delete";
      deleteButton.disabled = state.switchingWorkspace;
      deleteButton.setAttribute("aria-label", `${workspace.name} 삭제`);
      deleteButton.title = "프로젝트 삭제";
      deleteButton.dataset.workspaceName = workspace.name;
      deleteButton.setAttribute("aria-label", `${workspace.name} 삭제`);
      deleteButton.title = "프로젝트 삭제";
      setDeleteIcon(deleteButton, false);
      deleteButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        setError("");
        if (pendingDeleteWorkspace !== workspace.name) {
          clearPendingDelete();
          pendingDeleteWorkspace = workspace.name;
          row.classList.add("delete-ready");
          deleteButton.title = "한 번 더 누르면 삭제됩니다";
          deleteButton.setAttribute("aria-label", `${workspace.name} 삭제 확인`);
          setDeleteIcon(deleteButton, true);
          return;
        }
        deleteButton.disabled = true;
        row.classList.add("deleting");
        try {
          const wasActive = workspace.name === state.workspaceName;
          if (wasActive) {
            const currentWorkspaces = Array.isArray(state.workspaces) && state.workspaces.length
              ? state.workspaces
              : await loadWorkspaces();
            const nextWorkspace =
              currentWorkspaces.find((item) => item.name === "Default" && item.name !== workspace.name)
              || currentWorkspaces.find((item) => item.name !== workspace.name);
            if (!nextWorkspace) {
              throw new Error("Last project cannot be deleted.");
            }
            closeModal();
            await restartSessionForWorkspace(nextWorkspace);
            await deleteWorkspace(workspace.name);
            await loadWorkspaces();
            return;
          }
          const result = await deleteWorkspace(workspace.name);
          const workspaces = Array.isArray(result.workspaces) ? result.workspaces : await loadWorkspaces();
          renderList(workspaces);
        } catch (err) {
          row.classList.remove("deleting");
          row.classList.remove("delete-ready");
          pendingDeleteWorkspace = "";
          setDeleteIcon(deleteButton, false);
          deleteButton.disabled = false;
          setError(`프로젝트 삭제 실패: ${err.message}`);
        }
      });
      row.append(button, deleteButton);
      list.append(row);
    }
  }

  try {
    renderList(await loadWorkspaces());
  } catch (err) {
    setError(`프로젝트 목록을 불러오지 못했습니다: ${err.message}`);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) {
      setError("프로젝트 이름을 입력하세요.");
      input.focus();
      return;
    }
    createButton.disabled = true;
    setError("");
    try {
      const workspace = await createWorkspace(name);
      closeModal();
      await restartSessionForWorkspace(workspace);
    } catch (err) {
      createButton.disabled = false;
      setError(err.message || "프로젝트를 만들지 못했습니다.");
      input.focus();
    }
  });
}

function settingsButton(label, value, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-row";
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  title.textContent = label;
  const current = document.createElement("small");
  current.textContent = value || "-";
  copy.append(title, current);
  const arrow = document.createElement("span");
  arrow.className = "settings-row-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = ">";
  button.append(copy, arrow);
  button.addEventListener("click", onClick);
  return button;
}

function showModal(modal) {
  const question = modal.question || `${modal.tool_name || "이 도구"} 실행을 허용할까요?`;
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  delete els.modalHost.dataset.dismissible;
  delete els.modalHost.dataset.dismissAction;

  const card = document.createElement("div");
  card.className = "modal-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");

  const title = document.createElement("h2");
  title.textContent = modal.kind === "question" ? "질문" : "권한 요청";
  const body = document.createElement("p");
  body.textContent = question;
  const actions = document.createElement("div");
  actions.className = "modal-actions";

  card.append(title, body);

  if (modal.kind === "question") {
    const input = document.createElement("textarea");
    input.rows = 3;
    input.placeholder = "답변을 입력하세요...";
    const submit = modalButton("제출", true, () => {
      respond({ type: "question_response", request_id: modal.request_id, answer: input.value });
    });
    actions.append(submit);
    card.append(input, actions);
    els.modalHost.append(card);
    input.focus();
    return;
  }

  actions.append(
    modalButton("거부", false, () =>
      respond({ type: "permission_response", request_id: modal.request_id, allowed: false }),
    ),
    modalButton("허용", true, () =>
      respond({ type: "permission_response", request_id: modal.request_id, allowed: true }),
    ),
  );
  card.append(actions);
  els.modalHost.append(card);
}

function showSelect(event) {
  const modal = event.modal || {};
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  els.modalHost.dataset.dismissible = "true";
  delete els.modalHost.dataset.dismissAction;
  if (state.returnToSettingsOnDismiss) {
    els.modalHost.dataset.dismissAction = "settings";
    state.returnToSettingsOnDismiss = false;
  }

  const card = document.createElement("div");
  card.className = "modal-card select-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.append(modalCloseButton(closeModal));

  const title = document.createElement("h2");
  title.textContent = modal.title || "선택";
  const body = document.createElement("p");
  body.textContent = "현재 세션에 적용할 값을 선택하세요.";
  card.append(title, body);

  const list = document.createElement("div");
  list.className = "select-list";
  for (const option of event.select_options || []) {
    const normalizedOption = normalizeSelectOption(modal, option);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `select-option${normalizedOption.active ? " active" : ""}`;
    button.addEventListener("click", () => {
      const returnToSettings = els.modalHost.dataset.dismissAction === "settings";
      respond({ type: "apply_select_command", command: modal.command, value: normalizedOption.value });
      if (returnToSettings) {
        window.setTimeout(showModelSettingsModal, 0);
      }
    });
    button.title = normalizedOption.description || "";
    const copy = document.createElement("span");
    const label = document.createElement("strong");
    label.textContent = normalizedOption.label || normalizedOption.value;
    const description = document.createElement("small");
    description.textContent = normalizedOption.description || normalizedOption.value || "";
    copy.append(label, description);
    const check = document.createElement("span");
    check.className = "select-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = normalizedOption.active ? "✓" : "";
    button.append(copy, check);
    list.append(button);
  }
  card.append(list);

  els.modalHost.append(card);
}

function normalizeSelectOption(modal, option) {
  const normalized = { ...option };
  if (modal?.command !== "effort") {
    return normalized;
  }
  const value = String(normalized.value || "").trim().toLowerCase();
  if (value === "none" || value === "auto") {
    normalized.label = "Auto";
    normalized.description = "Provider default";
  }
  return normalized;
}

function modalCloseButton(onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "modal-close";
  button.setAttribute("aria-label", "닫기");
  button.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M6 6l12 12"></path>
      <path d="M18 6L6 18"></path>
    </svg>
  `;
  button.addEventListener("click", onClick);
  return button;
}

function modalButton(label, primary, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (primary) {
    button.classList.add("primary");
  }
  button.addEventListener("click", onClick);
  return button;
}

async function respond(payload) {
  closeModal();
  await postJson("/api/respond", { sessionId: state.sessionId, payload });
}

function closeModal() {
  state.returnToSettingsOnDismiss = false;
  els.modalHost.classList.add("hidden");
  els.modalHost.textContent = "";
  delete els.modalHost.dataset.dismissible;
  delete els.modalHost.dataset.dismissAction;
}

  return {
    showSettingsModal,
    showModelSettingsModal,
    showWorkspaceModal,
    settingsButton,
    showModal,
    showSelect,
    modalCloseButton,
    modalButton,
    respond,
    closeModal,
  };
}
