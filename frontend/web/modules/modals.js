export function createModals(ctx) {
  const { state, els } = ctx;
  function requestSelectCommand(...args) { return ctx.requestSelectCommand(...args); }
  function appendMessage(...args) { return ctx.appendMessage(...args); }
  function respond(...args) { return ctx.respond(...args); }
  function postJson(...args) { return ctx.postJson(...args); }
  function getJson(...args) { return ctx.getJson(...args); }
  function setSystemPrompt(...args) { return ctx.setSystemPrompt(...args); }
  function saveAppSettings(...args) { return ctx.saveAppSettings(...args); }
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

function downloadModeLabel() {
  const settings = state.appSettings || {};
  if (settings.downloadMode === "folder") {
    return settings.downloadFolderPath ? `지정 폴더: ${settings.downloadFolderPath}` : "지정 폴더 필요";
  }
  return "매번 저장 위치 선택";
}

function settingField(label, helperText = "") {
  const wrap = document.createElement("label");
  wrap.className = "setting-field";
  const title = document.createElement("span");
  title.className = "setting-field-label";
  title.textContent = label;
  wrap.append(title);
  if (helperText) {
    const helper = document.createElement("small");
    helper.textContent = helperText;
    wrap.append(helper);
  }
  return wrap;
}

function showSettingsModal() {
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  els.modalHost.dataset.dismissible = "true";
  delete els.modalHost.dataset.dismissAction;

  const card = document.createElement("div");
  card.className = "modal-card settings-card app-settings-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.append(modalCloseButton(closeModal));

  const title = document.createElement("h2");
  title.textContent = "설정";
  const body = document.createElement("p");
  body.textContent = "자주 바꾸는 동작과 연결 정보를 한 곳에서 관리합니다.";

  const list = document.createElement("div");
  list.className = "settings-list";
  list.append(
    settingsButton("프롬프트", state.systemPrompt ? "사용자 프롬프트 적용 중" : "기본값", showSystemPromptModal),
    settingsButton("스트리밍 스크롤", `${state.appSettings?.streamScrollDurationMs ?? 1200} ms`, showBehaviorSettingsModal),
    settingsButton("파일 저장", downloadModeLabel(), showDownloadSettingsModal),
    settingsButton("P-GPT 키", "API Key / 사번 / 회사번호", showPoscoGptSettingsModal),
  );

  card.append(title, body, list);
  els.modalHost.append(card);
}

function showSystemPromptModal() {
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  els.modalHost.dataset.dismissible = "true";
  delete els.modalHost.dataset.dismissAction;

  const card = document.createElement("div");
  card.className = "modal-card system-settings-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.append(modalCloseButton(showSettingsModal));

  const title = document.createElement("h2");
  title.textContent = "프롬프트";
  const body = document.createElement("p");
  body.textContent = "에이전트에 항상 붙일 기본 지시문을 저장합니다.";
  const input = document.createElement("textarea");
  input.className = "system-prompt-input";
  input.rows = 7;
  input.placeholder = "예: 항상 한국어 존댓말로 답하고, 변경 전후를 짧게 정리해줘.";
  input.value = state.systemPrompt || "";
  const helper = document.createElement("p");
  helper.className = "settings-helper";
  helper.textContent = "비워두면 기본 프롬프트를 사용합니다. 저장한 내용은 다음 메시지부터 적용됩니다.";
  const actions = document.createElement("div");
  actions.className = "modal-actions";
  actions.append(
    modalButton("뒤로", false, showSettingsModal),
    modalButton("초기화", false, () => {
      input.value = "";
      input.focus();
    }),
    modalButton("저장", true, async () => {
      try {
        await setSystemPrompt(input.value);
        showSettingsModal();
        if (!state.sessionId) {
          appendMessage("system", "프롬프트 설정을 저장했습니다.");
        }
      } catch (error) {
        appendMessage("system", `프롬프트 저장 실패: ${error.message}`);
      }
    }),
  );
  card.append(title, body, input, helper, actions);
  els.modalHost.append(card);
  input.focus();
}

function showBehaviorSettingsModal() {
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  els.modalHost.dataset.dismissible = "true";
  delete els.modalHost.dataset.dismissAction;

  const card = document.createElement("div");
  card.className = "modal-card settings-card app-settings-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.append(modalCloseButton(showSettingsModal));

  const title = document.createElement("h2");
  title.textContent = "스트리밍 스크롤";
  const body = document.createElement("p");
  body.textContent = "답변이 스트리밍될 때 아래로 따라가는 애니메이션 시간을 조절합니다.";
  const field = settingField("따라가기 시간", "0~5000ms 사이 값을 입력하세요.");
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.max = "5000";
  input.step = "50";
  input.value = String(state.appSettings?.streamScrollDurationMs ?? 1200);
  field.append(input);
  const actions = document.createElement("div");
  actions.className = "modal-actions";
  actions.append(
    modalButton("뒤로", false, showSettingsModal),
    modalButton("저장", true, () => {
      saveAppSettings({ streamScrollDurationMs: Number(input.value) });
      showSettingsModal();
    }),
  );
  card.append(title, body, field, actions);
  els.modalHost.append(card);
  input.focus();
}

function showDownloadSettingsModal() {
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  els.modalHost.dataset.dismissible = "true";
  delete els.modalHost.dataset.dismissAction;

  const card = document.createElement("div");
  card.className = "modal-card settings-card app-settings-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.append(modalCloseButton(showSettingsModal));

  const title = document.createElement("h2");
  title.textContent = "파일 저장";
  const body = document.createElement("p");
  body.textContent = "다운로드할 때마다 위치를 물어볼지, 지정 폴더에 바로 저장할지 선택합니다.";

  const modeField = settingField("저장 방식", "지정 폴더 저장은 앱 서버가 해당 경로로 파일을 복사합니다.");
  const mode = document.createElement("select");
  mode.innerHTML = `
    <option value="ask">매번 저장 위치 선택</option>
    <option value="folder">지정 폴더에 자동 저장</option>
  `;
  mode.value = state.appSettings?.downloadMode || "ask";
  modeField.append(mode);

  const folderField = settingField("지정 폴더 경로", "예: C:\\Users\\me\\Downloads\\OpenHarness");
  const folder = document.createElement("input");
  folder.type = "text";
  folder.placeholder = "C:\\Users\\...\\Downloads";
  folder.value = state.appSettings?.downloadFolderPath || "";
  folderField.append(folder);

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  actions.append(
    modalButton("뒤로", false, showSettingsModal),
    modalButton("저장", true, () => {
      saveAppSettings({
        downloadMode: mode.value,
        downloadFolderPath: folder.value,
      });
      showSettingsModal();
    }),
  );
  card.append(title, body, modeField, folderField, actions);
  els.modalHost.append(card);
  mode.focus();
}

async function showPoscoGptSettingsModal() {
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  els.modalHost.dataset.dismissible = "true";
  delete els.modalHost.dataset.dismissAction;

  const card = document.createElement("div");
  card.className = "modal-card settings-card app-settings-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.append(modalCloseButton(showSettingsModal));

  const title = document.createElement("h2");
  title.textContent = "P-GPT 키";
  const body = document.createElement("p");
  body.textContent = "P-GPT 연결에 필요한 API Key, 사번, 회사번호를 저장합니다.";
  const loading = document.createElement("p");
  loading.className = "settings-helper";
  loading.textContent = "불러오는 중...";
  card.append(title, body, loading);
  els.modalHost.append(card);

  try {
    const current = await getJson("/api/settings/posco-gpt");
    loading.remove();
    const apiKeyField = settingField("API Key", current.apiKeyConfigured ? `현재 저장됨: ${current.apiKeyMasked}` : "새 API Key를 입력하세요.");
    const apiKey = document.createElement("input");
    apiKey.type = "password";
    apiKey.placeholder = current.apiKeyConfigured ? "변경할 때만 입력" : "API Key";
    apiKey.autocomplete = "off";
    apiKeyField.append(apiKey);

    const empField = settingField("사번", "emp_no");
    const empNo = document.createElement("input");
    empNo.type = "text";
    empNo.value = current.empNo || "";
    empNo.placeholder = "628703";
    empField.append(empNo);

    const compField = settingField("회사번호", "comp_no");
    const compNo = document.createElement("input");
    compNo.type = "text";
    compNo.value = current.compNo || "30";
    compNo.placeholder = "30";
    compField.append(compNo);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    actions.append(
      modalButton("뒤로", false, showSettingsModal),
      modalButton("저장", true, async () => {
        try {
          await postJson("/api/settings/posco-gpt", {
            apiKey: apiKey.value,
            empNo: empNo.value,
            compNo: compNo.value,
          });
          showSettingsModal();
        } catch (error) {
          appendMessage("system", `P-GPT 설정 저장 실패: ${error.message}`);
        }
      }),
    );
    card.append(apiKeyField, empField, compField, actions);
    apiKey.focus();
  } catch (error) {
    loading.textContent = `P-GPT 설정을 불러오지 못했습니다: ${error.message}`;
  }
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
    button.addEventListener("click", async () => {
      const returnToSettings = els.modalHost.dataset.dismissAction === "settings";
      const previousModel = state.model;
      const previousEffort = state.effort;
      button.disabled = true;
      applySelectOptimistic(modal.command, normalizedOption.value);
      try {
        await respond({ type: "apply_select_command", command: modal.command, value: normalizedOption.value });
      } catch (error) {
        state.model = previousModel;
        state.effort = previousEffort;
        refreshModelSummary();
        appendMessage("system", `Selection failed: ${error.message}`);
      } finally {
        if (returnToSettings) {
          showModelSettingsModal();
        }
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

function applySelectOptimistic(command, value) {
  const normalizedCommand = String(command || "").trim().toLowerCase();
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return;
  }
  if (normalizedCommand === "effort") {
    state.effort = normalizedValue;
    refreshModelSummary();
  } else if (normalizedCommand === "model") {
    state.model = normalizedValue;
    refreshModelSummary();
  }
}

function refreshModelSummary() {
  if (!els.model) {
    return;
  }
  const modelLabel = state.model || "-";
  const effortLabel = formatEffort(state.effort);
  const text = `Model: ${modelLabel}, Effort: ${effortLabel}`;
  els.model.textContent = text;
  els.model.title = text;
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
