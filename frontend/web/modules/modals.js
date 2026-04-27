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
  function readWorkspaceScopeSettings(...args) { return ctx.readWorkspaceScopeSettings(...args); }
  function changeWorkspaceScope(...args) { return ctx.changeWorkspaceScope(...args); }
  function restartSessionForWorkspace(...args) { return ctx.restartSessionForWorkspace(...args); }
  function formatEffort(...args) { return ctx.formatEffort(...args); }
  function formatProviderName(...args) { return ctx.formatProviderName(...args); }

function showSettingsModal() {
  closeRuntimePicker();
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

function streamingSettingsLabel() {
  const scrollDuration = state.appSettings?.streamScrollDurationMs ?? 2000;
  const startBuffer = state.appSettings?.streamStartBufferMs ?? 180;
  const followLead = state.appSettings?.streamFollowLeadPx ?? 60;
  const revealDuration = state.appSettings?.streamRevealDurationMs ?? 420;
  const revealWipe = state.appSettings?.streamRevealWipePercent ?? 180;
  return `따라가기 ${scrollDuration} ms / 버퍼 ${startBuffer} ms / 앞섬 ${followLead}px / 닦아내기 ${revealDuration}ms ${revealWipe}%`;
}

function workspaceScopeLabel() {
  const mode = state.workspaceScope?.mode || "shared";
  return mode === "ip" ? "IP별 프로젝트 분리" : "공용 shared 프로젝트";
}

function setAppSettingsDismissAction() {
  els.modalHost.dataset.dismissible = "true";
  els.modalHost.dataset.dismissAction = "app-settings";
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

function numericSettingField({ label, helperText, min, max, step, value }) {
  const field = settingField(label, helperText);
  const control = document.createElement("div");
  control.className = "range-input-pair";
  const range = document.createElement("input");
  range.type = "range";
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(value);
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const clampValue = (nextValue) => {
    const parsed = Number(nextValue);
    if (!Number.isFinite(parsed)) {
      return min;
    }
    return Math.max(min, Math.min(max, parsed));
  };
  const sync = (source) => {
    const nextValue = clampValue(source.value);
    range.value = String(nextValue);
    input.value = String(nextValue);
  };
  range.addEventListener("input", () => sync(range));
  input.addEventListener("input", () => {
    if (input.value === "") {
      return;
    }
    sync(input);
  });
  input.addEventListener("blur", () => sync(input));
  control.append(range, input);
  field.append(control);
  return { field, input, range };
}

function settingSection(title, helperText, ...fields) {
  const section = document.createElement("section");
  section.className = "setting-section";
  const header = document.createElement("div");
  header.className = "setting-section-header";
  const heading = document.createElement("h3");
  heading.textContent = title;
  header.append(heading);
  if (helperText) {
    const helper = document.createElement("p");
    helper.textContent = helperText;
    header.append(helper);
  }
  section.append(header, ...fields);
  return section;
}

function showSettingsModal() {
  closeRuntimePicker();
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
    settingsButton("스트리밍 스크롤", streamingSettingsLabel(), showBehaviorSettingsModal),
    settingsButton("파일 저장", downloadModeLabel(), showDownloadSettingsModal),
    settingsButton("작업공간 범위", workspaceScopeLabel(), showWorkspaceScopeSettingsModal),
    settingsButton("P-GPT 키", "API Key / 사번 / 회사번호", showPgptSettingsModal),
  );

  card.append(title, body, list);
  els.modalHost.append(card);
}

function showSystemPromptModal() {
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  setAppSettingsDismissAction();

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
  setAppSettingsDismissAction();

  const card = document.createElement("div");
  card.className = "modal-card settings-card app-settings-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.append(modalCloseButton(showSettingsModal));

  const title = document.createElement("h2");
  title.textContent = "스트리밍 스크롤";
  const body = document.createElement("p");
  body.textContent = "답변이 스트리밍될 때 표시와 스크롤 흐름을 조절합니다.";

  const {
    field: bufferField,
    input: bufferInput,
  } = numericSettingField({
    label: "버퍼 시간",
    helperText: "첫 표시 전 텍스트를 잠깐 모으는 시간입니다. 0~2000ms 사이 값을 조절하세요.",
    min: 0,
    max: 2000,
    step: 10,
    value: state.appSettings?.streamStartBufferMs ?? 180,
  });

  const {
    field: revealDurationField,
    input: revealDurationInput,
  } = numericSettingField({
    label: "닦아내기 시간",
    helperText: "새로 표시되는 텍스트가 좌에서 우로 드러나는 애니메이션 시간입니다.",
    min: 0,
    max: 2000,
    step: 20,
    value: state.appSettings?.streamRevealDurationMs ?? 420,
  });

  const {
    field: revealWipeField,
    input: revealWipeInput,
  } = numericSettingField({
    label: "닦아내기 폭",
    helperText: "좌→우 마스크가 움직이는 폭입니다. 값이 클수록 더 길게 쓸고 지나갑니다.",
    min: 100,
    max: 400,
    step: 10,
    value: state.appSettings?.streamRevealWipePercent ?? 180,
  });

  const {
    field: followField,
    input: followInput,
  } = numericSettingField({
    label: "따라가기 시간",
    helperText: "아래로 따라가는 애니메이션 시간입니다. 0~5000ms 사이 값을 조절하세요.",
    min: 0,
    max: 5000,
    step: 100,
    value: state.appSettings?.streamScrollDurationMs ?? 2000,
  });

  const {
    field: leadField,
    input: leadInput,
  } = numericSettingField({
    label: "따라가기 앞섬",
    helperText: "스크롤이 답변 꼬리보다 아래쪽 여백을 얼마나 미리 확보할지 조절합니다. 값이 클수록 더 앞서 따라갑니다.",
    min: 0,
    max: 220,
    step: 5,
    value: state.appSettings?.streamFollowLeadPx ?? 60,
  });

  const horizontalSection = settingSection(
    "가로 스트리밍 표시",
    "텍스트가 좌에서 우로 표시되는 흐름을 조절합니다.",
    bufferField,
    revealDurationField,
    revealWipeField,
  );

  const verticalSection = settingSection(
    "세로 스크롤 따라가기",
    "답변이 길어질 때 아래쪽으로 따라가는 스크롤 흐름을 조절합니다.",
    followField,
    leadField,
  );

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  actions.append(
    modalButton("뒤로", false, showSettingsModal),
    modalButton("저장", true, () => {
      saveAppSettings({
        streamScrollDurationMs: Number(followInput.value),
        streamStartBufferMs: Number(bufferInput.value),
        streamFollowLeadPx: Number(leadInput.value),
        streamRevealDurationMs: Number(revealDurationInput.value),
        streamRevealWipePercent: Number(revealWipeInput.value),
      });
      showSettingsModal();
    }),
  );
  card.append(title, body, horizontalSection, verticalSection, actions);
  els.modalHost.append(card);
  followInput.focus();
}

async function showWorkspaceScopeSettingsModal() {
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  setAppSettingsDismissAction();

  const card = document.createElement("div");
  card.className = "modal-card settings-card app-settings-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.append(modalCloseButton(showSettingsModal));

  const title = document.createElement("h2");
  title.textContent = "작업공간 범위";
  const body = document.createElement("p");
  body.textContent = "프로젝트와 대화 기록을 모든 접속자가 함께 볼지, 접속 IP별로 나눌지 정합니다.";
  const loading = document.createElement("p");
  loading.className = "settings-helper";
  loading.textContent = "설정을 불러오는 중...";
  card.append(title, body, loading);
  els.modalHost.append(card);

  try {
    const current = await readWorkspaceScopeSettings();
    loading.remove();
    let selectedMode = current.mode === "ip" ? "ip" : "shared";

    const control = document.createElement("div");
    control.className = "scope-segmented-control";
    control.setAttribute("role", "radiogroup");
    control.setAttribute("aria-label", "작업공간 범위");

    const sharedButton = scopeModeButton("shared", "Shared", "모든 접속자가 같은 프로젝트와 기록을 봅니다.");
    const ipButton = scopeModeButton("ip", "IP별", "접속 IP마다 별도 프로젝트와 기록을 봅니다.");
    const buttons = [sharedButton, ipButton];
    const syncButtons = () => {
      for (const button of buttons) {
        const active = button.dataset.mode === selectedMode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-checked", active ? "true" : "false");
      }
    };
    for (const button of buttons) {
      button.addEventListener("click", () => {
        selectedMode = button.dataset.mode;
        syncButtons();
      });
    }
    control.append(sharedButton, ipButton);
    syncButtons();

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    actions.append(
      modalButton("뒤로", false, showSettingsModal),
      modalButton("저장", true, async () => {
        try {
          await changeWorkspaceScope(selectedMode);
          showSettingsModal();
          appendMessage("system", selectedMode === "ip"
            ? "작업공간 범위를 IP별 분리 모드로 변경했습니다."
            : "작업공간 범위를 shared 공용 모드로 변경했습니다.");
        } catch (error) {
          appendMessage("system", `작업공간 범위 저장 실패: ${error.message}`);
        }
      }),
    );

    card.append(control, actions);
  } catch (error) {
    loading.textContent = `작업공간 범위 설정을 불러오지 못했습니다: ${error.message}`;
  }
}

function scopeModeButton(mode, label, helperText) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "scope-mode-option";
  button.dataset.mode = mode;
  button.setAttribute("role", "radio");
  const marker = document.createElement("span");
  marker.className = "scope-mode-marker";
  marker.setAttribute("aria-hidden", "true");
  const title = document.createElement("strong");
  title.textContent = label;
  const helper = document.createElement("small");
  helper.textContent = helperText;
  const copy = document.createElement("span");
  copy.className = "scope-mode-copy";
  copy.append(title, helper);
  button.append(marker, copy);
  return button;
}

function showDownloadSettingsModal() {
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  setAppSettingsDismissAction();

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

  const folderField = settingField("지정 폴더", "찾아보기를 눌러 저장할 폴더를 선택하세요.");
  const folderPicker = document.createElement("div");
  folderPicker.className = "folder-picker";
  const folder = document.createElement("input");
  folder.type = "text";
  folder.placeholder = "선택된 폴더가 없습니다";
  folder.readOnly = true;
  folder.value = state.appSettings?.downloadFolderPath || "";
  const browse = modalButton("찾아보기", false, async () => {
    browse.disabled = true;
    browse.textContent = "여는 중...";
    try {
      const selected = await postJson("/api/dialog/folder", { initialPath: folder.value });
      if (!selected.canceled && selected.folderPath) {
        folder.value = selected.folderPath;
        mode.value = "folder";
      }
    } catch (error) {
      appendMessage("system", `폴더 선택 실패: ${error.message}`);
    } finally {
      browse.disabled = false;
      browse.textContent = "찾아보기";
    }
  });
  folderPicker.append(folder, browse);
  folderField.append(folderPicker);

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

async function showPgptSettingsModal() {
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  setAppSettingsDismissAction();

  const card = document.createElement("div");
  card.className = "modal-card settings-card app-settings-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.append(modalCloseButton(showSettingsModal));

  const title = document.createElement("h2");
  title.textContent = "P-GPT 키";
  const body = document.createElement("p");
  body.textContent = "P-GPT OpenAI-compatible 연결에 필요한 값을 저장합니다.";
  const loading = document.createElement("p");
  loading.className = "settings-helper";
  loading.textContent = "불러오는 중...";
  card.append(title, body, loading);
  els.modalHost.append(card);

  try {
    const current = await getJson("/api/settings/pgpt");
    loading.remove();
    const apiKeyField = settingField("API Key");
    const apiKey = document.createElement("input");
    apiKey.type = "password";
    apiKey.placeholder = "00000000-0000-0000-0000-000000000000";
    apiKey.autocomplete = "off";
    apiKeyField.append(apiKey);

    const employeeField = settingField("직원번호");
    const employeeNo = document.createElement("input");
    employeeNo.type = "text";
    employeeNo.value = current.employeeNo || "";
    employeeNo.placeholder = "600000";
    employeeField.append(employeeNo);

    const companyField = settingField("회사번호");
    const companyCode = document.createElement("input");
    companyCode.type = "text";
    companyCode.value = current.companyCode || "30";
    companyCode.placeholder = "30";
    companyField.append(companyCode);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    actions.append(
      modalButton("뒤로", false, showSettingsModal),
      modalButton("저장", true, async () => {
        try {
          await postJson("/api/settings/pgpt", {
            apiKey: apiKey.value,
            employeeNo: employeeNo.value,
            companyCode: companyCode.value,
          });
          showSettingsModal();
        } catch (error) {
          appendMessage("system", `P-GPT 설정 저장 실패: ${error.message}`);
        }
      }),
    );
    card.append(apiKeyField, employeeField, companyField, actions);
    apiKey.focus();
  } catch (error) {
    loading.textContent = `P-GPT 설정을 불러오지 못했습니다: ${error.message}`;
  }
}

function showModelSettingsModal() {
  closeRuntimePicker();
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  els.modalHost.dataset.dismissible = "true";
  els.modalHost.dataset.modalKind = "model-settings";
  delete els.modalHost.dataset.dismissAction;

  const card = document.createElement("div");
  card.className = "modal-card settings-card model-settings-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.append(modalCloseButton(closeModal));

  const title = document.createElement("h2");
  title.textContent = "모델 설정";
  const body = document.createElement("p");
  body.textContent = "Provider, 모델, 추론 노력을 변경할 수 있습니다.";
  card.append(title, body);

  const layout = document.createElement("div");
  layout.className = "model-settings-layout";

  const list = document.createElement("div");
  list.className = "settings-list";

  const detail = document.createElement("div");
  detail.className = "model-settings-detail";
  detail.dataset.modelSettingsDetail = "true";

  function selectCommand(command) {
    list.querySelectorAll(".settings-row").forEach((row) => {
      row.classList.toggle("active", row.dataset.settingCommand === command);
    });
    detail.innerHTML = "";
    const loading = document.createElement("p");
    loading.className = "model-settings-empty";
    loading.textContent = "불러오는 중...";
    detail.append(loading);
    state.returnToSettingsOnDismiss = true;
    requestSelectCommand(command).catch((error) => {
      detail.textContent = "";
      const errorNode = document.createElement("p");
      errorNode.className = "model-settings-empty";
      errorNode.textContent = `Selection failed: ${error.message}`;
      detail.append(errorNode);
    });
  }

  list.append(
    settingsButton("Provider", formatProviderName(state.provider), () => selectCommand("provider"), "provider"),
    settingsButton("모델", state.model, () => selectCommand("model"), "model"),
    settingsButton("추론 노력", formatEffort(state.effort), () => selectCommand("effort"), "effort"),
  );

  layout.append(list, detail);
  card.append(layout);

  els.modalHost.append(card);
  selectCommand("provider");
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

function settingsButton(label, value, onClick, command = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-row";
  if (command) {
    button.dataset.settingCommand = command;
  }
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  title.textContent = label;
  const current = document.createElement("small");
  if (command) {
    current.dataset.settingValue = command;
  }
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
  if (modal.kind === "question") {
    showInlineQuestion(modal);
    return;
  }
  closeInlineQuestion();
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

function showImagePreview(image) {
  const src = image?.src || "";
  if (!src) {
    return;
  }
  closeRuntimePicker();
  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  els.modalHost.dataset.dismissible = "true";
  els.modalHost.dataset.modalKind = "image-preview";
  delete els.modalHost.dataset.dismissAction;

  const card = document.createElement("div");
  card.className = "image-preview-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", image.name || image.alt || "첨부 이미지 미리보기");

  const close = modalCloseButton(closeModal);
  const figure = document.createElement("figure");
  figure.className = "image-preview-figure";

  const fullImage = document.createElement("img");
  fullImage.src = src;
  fullImage.alt = image.alt || image.name || "첨부 이미지";

  figure.append(close, fullImage);
  card.append(figure);
  els.modalHost.append(card);
}

function showInlineQuestion(modal) {
  closeRuntimePicker();
  closeModal();
  closeInlineQuestion();

  const question = String(modal.question || "").trim() || "추가 정보가 필요합니다.";
  const root = document.createElement("section");
  root.className = "inline-question-card";
  root.setAttribute("role", "group");
  root.setAttribute("aria-live", "polite");
  root.dataset.requestId = modal.request_id || "";

  const choices = normalizeQuestionChoices(modal, question);
  const conciseQuestion = stripQuestionChoiceLines(question, choices);
  const header = document.createElement("div");
  header.className = "inline-question-header";
  const label = document.createElement("strong");
  const labelCopy = document.createElement("span");
  labelCopy.className = "inline-question-label-copy";
  labelCopy.textContent = `질문: ${conciseQuestion}`;
  label.dataset.tooltipText = `질문: ${question}`;
  label.append(labelCopy);
  const helper = document.createElement("small");
  helper.textContent = "에이전트가 답변을 기다리고 있습니다.";
  header.append(label, helper);

  const choiceList = document.createElement("div");
  choiceList.className = "inline-question-choices";
  choices.forEach((choice, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inline-question-choice";
    button.dataset.tooltipText = choice.label;
    const number = document.createElement("span");
    number.className = "inline-question-number";
    number.textContent = `${index + 1}.`;
    const copy = document.createElement("span");
    copy.className = "inline-question-choice-copy";
    copy.textContent = choice.label;
    button.append(number, copy);
    button.addEventListener("click", () => {
      submitInlineQuestion(modal, choice.value, root.querySelectorAll("button, textarea"));
    });
    choiceList.append(button);
  });

  const form = document.createElement("form");
  form.className = "inline-question-form";
  const formNumber = document.createElement("span");
  formNumber.className = "inline-question-number";
  formNumber.textContent = `${choices.length + 1}.`;
  const input = document.createElement("textarea");
  input.rows = 1;
  input.placeholder = "직접 답변 입력...";
  input.autocomplete = "off";
  input.spellcheck = false;
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "inline-question-submit";
  submit.textContent = "답변";
  submit.disabled = true;

  input.addEventListener("input", () => {
    submit.disabled = input.value.trim().length === 0;
    input.style.height = "auto";
    input.style.height = `${Math.min(92, Math.max(24, input.scrollHeight))}px`;
  });
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.isComposing) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const answer = input.value.trim();
      if (answer) {
        submitInlineQuestion(modal, answer, root.querySelectorAll("button, textarea"));
      }
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const answer = input.value.trim();
    if (!answer) {
      input.focus();
      return;
    }
    submitInlineQuestion(modal, answer, root.querySelectorAll("button, textarea"));
  });

  form.append(formNumber, input, submit);
  root.append(header);
  if (choices.length) {
    root.append(choiceList);
  }
  root.append(form);

  els.composerBox?.before(root);
  state.inlineQuestion = { root, modal };
  requestAnimationFrame(() => updateInlineQuestionTooltips(root));
  input.focus();
}

function updateInlineQuestionTooltips(root) {
  const candidates = [
    [root.querySelector(".inline-question-header strong"), root.querySelector(".inline-question-label-copy")],
    ...Array.from(root.querySelectorAll(".inline-question-choice")).map((button) => [
      button,
      button.querySelector(".inline-question-choice-copy"),
    ]),
  ];
  for (const [host, copy] of candidates) {
    if (!host || !copy) {
      continue;
    }
    host.removeAttribute("title");
    const isTruncated = copy.scrollWidth > copy.clientWidth + 1 || copy.scrollHeight > copy.clientHeight + 1;
    if (isTruncated) {
      host.dataset.fullText = host.dataset.tooltipText || copy.textContent || "";
    } else {
      delete host.dataset.fullText;
    }
  }
}

function normalizeQuestionChoices(modal, question) {
  const rawSources = [
    modal.choices,
    modal.options,
    modal.suggestions,
    modal.select_options,
  ];
  const choices = [];
  for (const source of rawSources) {
    if (!Array.isArray(source)) {
      continue;
    }
    for (const item of source) {
      const choice = normalizeQuestionChoice(item);
      if (choice) {
        choices.push(choice);
      }
    }
  }
  if (!choices.length) {
    choices.push(...extractQuestionChoices(question));
  }
  if (!choices.length) {
    choices.push(...defaultQuestionChoices(question));
  }
  const seen = new Set();
  return choices.filter((choice) => {
    const key = choice.value.trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function stripQuestionChoiceLines(question, choices) {
  const text = String(question || "").trim();
  if (!text || !choices.length) {
    return text;
  }
  let next = text;
  for (const choice of choices) {
    const escaped = escapeRegExp(choice.value);
    next = next.replace(new RegExp(`\\s*(?:[-*]|\\d+[.)]|[A-Za-z][.)]|[가-힣][.)])?\\s*${escaped}\\s*`, "g"), " ");
  }
  return next.replace(/\s+/g, " ").trim() || text.split(/\r?\n/)[0] || text;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeQuestionChoice(item) {
  if (typeof item === "string") {
    const value = item.trim();
    return value ? { label: value, value, description: "" } : null;
  }
  if (!item || typeof item !== "object") {
    return null;
  }
  const value = String(item.value ?? item.answer ?? item.label ?? item.title ?? "").trim();
  if (!value) {
    return null;
  }
  return {
    label: String(item.label ?? item.title ?? value).trim() || value,
    value,
    description: String(item.description ?? item.detail ?? "").trim(),
  };
}

function extractQuestionChoices(question) {
  return String(question || "")
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:[-*]|\d+[.)]|[A-Za-z][.)]|[가-힣][.)])\s+(.+?)\s*$/)?.[1] || "")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((value) => ({ label: value, value, description: "" }));
}

function defaultQuestionChoices(question) {
  const text = String(question || "");
  if (/(예|아니오|yes|no|할까요|원하시나요|진행할까요|괜찮을까요|맞나요)/i.test(text)) {
    return [
      { label: "네, 진행해주세요", value: "네, 진행해주세요", description: "" },
      { label: "아니요", value: "아니요", description: "" },
      { label: "선택지를 더 보여주세요", value: "선택지를 더 보여주세요", description: "" },
    ];
  }
  return [
    { label: "추천안으로 진행", value: "추천안으로 진행해주세요", description: "" },
    { label: "선택지 더 제안", value: "선택지를 더 제안해주세요", description: "" },
    { label: "적절히 판단", value: "잘 모르겠습니다. 적절히 판단해주세요", description: "" },
  ];
}

async function submitInlineQuestion(modal, answer, controls = []) {
  for (const control of controls) {
    control.disabled = true;
  }
  try {
    closeInlineQuestion();
    await respond({ type: "question_response", request_id: modal.request_id, answer });
  } catch (error) {
    appendMessage("system", `질문 응답 실패: ${error.message}`);
  }
}

function closeInlineQuestion() {
  state.inlineQuestion?.root?.remove();
  state.inlineQuestion = null;
}

function showSelect(event) {
  const modal = event.modal || {};
  if (renderRuntimePickerSelect(event)) {
    return;
  }
  const shouldEmbedInModelSettings = state.returnToSettingsOnDismiss
    && ["provider", "model", "effort"].includes(String(modal.command || "").trim().toLowerCase());
  const embeddedDetail = els.modalHost.querySelector("[data-model-settings-detail='true']");
  if (shouldEmbedInModelSettings && embeddedDetail) {
    state.returnToSettingsOnDismiss = false;
    els.modalHost.dataset.dismissAction = "settings";
    renderModelSettingsSelect(event, embeddedDetail);
    return;
  }

  els.modalHost.classList.remove("hidden");
  els.modalHost.textContent = "";
  els.modalHost.dataset.dismissible = "true";
  delete els.modalHost.dataset.modalKind;
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
      button.disabled = true;
      const ok = await applySelectChoice(modal, normalizedOption, { closeBeforeRequest: true });
      if (ok && returnToSettings) {
        showModelSettingsModal();
      } else if (!ok) {
        button.disabled = false;
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

function ensureRuntimePicker() {
  if (!state.runtimePicker) {
    state.runtimePicker = {
      open: false,
      root: null,
      anchor: null,
      providerModal: null,
      modelModal: null,
      providerOptions: null,
      modelOptions: null,
      providerError: "",
      modelError: "",
      modelOpen: false,
      pendingCommand: "",
      dismissedCommands: new Set(),
      listenersInstalled: false,
    };
  }
  return state.runtimePicker;
}

function toggleRuntimePicker(targetOrEvent) {
  const event = targetOrEvent?.currentTarget ? targetOrEvent : null;
  const anchor = event?.currentTarget || targetOrEvent;
  event?.stopPropagation();
  const picker = ensureRuntimePicker();
  if (picker.open) {
    closeRuntimePicker();
    return;
  }
  showRuntimePicker(anchor);
}

function showRuntimePicker(anchor) {
  if (!anchor) {
    showModelSettingsModal();
    return;
  }
  closeModal();
  const picker = ensureRuntimePicker();
  picker.open = true;
  picker.anchor = anchor;
  picker.providerModal = null;
  picker.modelModal = null;
  picker.providerOptions = null;
  picker.modelOptions = null;
  picker.providerError = "";
  picker.modelError = "";
  picker.modelOpen = false;
  picker.pendingCommand = "provider";
  anchor.setAttribute("aria-expanded", "true");
  renderRuntimePicker();
  requestRuntimePickerCommand("provider");
}

function requestRuntimePickerCommand(command) {
  const picker = ensureRuntimePicker();
  const normalizedCommand = String(command || "").trim().toLowerCase();
  picker.pendingCommand = normalizedCommand;
  if (!state.sessionId) {
    setRuntimePickerError(normalizedCommand, "세션이 준비되면 선택할 수 있습니다.");
    return;
  }
  if (state.busy) {
    setRuntimePickerError(normalizedCommand, "응답이 끝난 뒤 선택할 수 있습니다.");
    return;
  }
  requestSelectCommand(normalizedCommand).catch((error) => {
    setRuntimePickerError(normalizedCommand, `불러오기 실패: ${error.message}`);
  });
}

function setRuntimePickerError(command, message) {
  const picker = ensureRuntimePicker();
  if (command === "model") {
    picker.modelError = message;
  } else {
    picker.providerError = message;
  }
  picker.pendingCommand = "";
  renderRuntimePicker();
}

function renderRuntimePickerSelect(event) {
  const picker = ensureRuntimePicker();
  const modal = event.modal || {};
  const command = String(modal.command || "").trim().toLowerCase();
  if (!picker.open && picker.dismissedCommands?.has(command)) {
    picker.dismissedCommands.delete(command);
    return true;
  }
  if (!picker.open || !["provider", "model"].includes(command)) {
    return false;
  }
  const options = (event.select_options || []).map((option) => normalizeSelectOption(modal, option));
  if (command === "provider") {
    picker.providerModal = modal;
    picker.providerOptions = options;
    picker.providerError = "";
  } else {
    picker.modelModal = modal;
    picker.modelOptions = options;
    picker.modelError = "";
    picker.modelOpen = true;
  }
  picker.pendingCommand = "";
  renderRuntimePicker();
  return true;
}

function renderRuntimePicker() {
  const picker = ensureRuntimePicker();
  if (!picker.open) {
    return;
  }
  if (!picker.root) {
    picker.root = document.createElement("div");
    picker.root.className = "runtime-picker-layer";
    picker.root.dataset.runtimePicker = "true";
    document.body.append(picker.root);
  }
  installRuntimePickerListeners();
  positionRuntimePicker();
  picker.root.textContent = "";

  const providerPanel = document.createElement("section");
  providerPanel.className = "runtime-picker-panel";
  providerPanel.setAttribute("aria-label", "Provider 선택");
  providerPanel.append(runtimePickerHeader("Provider", formatProviderName(state.provider)));

  const providerList = document.createElement("div");
  providerList.className = "runtime-picker-list";
  if (picker.providerError) {
    providerList.append(runtimePickerEmpty(picker.providerError));
  } else if (!picker.providerOptions) {
    providerList.append(runtimePickerEmpty("불러오는 중..."));
  } else {
    for (const option of picker.providerOptions) {
      providerList.append(runtimePickerOption(picker.providerModal, option, "›", async (button) => {
        button.disabled = true;
        const ok = await applySelectChoice(picker.providerModal, option, { closeBeforeRequest: false });
        if (ok) {
          picker.modelOpen = true;
          picker.modelOptions = null;
          picker.modelError = "";
          renderRuntimePicker();
          requestRuntimePickerCommand("model");
        } else {
          button.disabled = false;
        }
      }));
    }
  }
  providerPanel.append(providerList);
  picker.root.append(providerPanel);

  if (picker.modelOpen) {
    const modelPanel = document.createElement("section");
    modelPanel.className = "runtime-picker-panel runtime-picker-model-panel";
    modelPanel.setAttribute("aria-label", "모델 선택");
    modelPanel.append(runtimePickerHeader("모델", state.model || "-"));

    const modelList = document.createElement("div");
    modelList.className = "runtime-picker-list";
    if (picker.modelError) {
      modelList.append(runtimePickerEmpty(picker.modelError));
    } else if (!picker.modelOptions) {
      modelList.append(runtimePickerEmpty("불러오는 중..."));
    } else {
      for (const option of picker.modelOptions) {
        modelList.append(runtimePickerOption(picker.modelModal, option, "", async (button) => {
          button.disabled = true;
          const ok = await applySelectChoice(picker.modelModal, option, { closeBeforeRequest: false });
          if (ok) {
            closeRuntimePicker();
          } else {
            button.disabled = false;
          }
        }));
      }
    }
    modelPanel.append(modelList);
    picker.root.append(modelPanel);
  }
  positionRuntimePicker();
}

function runtimePickerHeader(title, value) {
  const header = document.createElement("div");
  header.className = "runtime-picker-header";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const small = document.createElement("small");
  small.textContent = value || "-";
  header.append(strong, small);
  return header;
}

function runtimePickerEmpty(text) {
  const node = document.createElement("p");
  node.className = "runtime-picker-empty";
  node.textContent = text;
  return node;
}

function runtimePickerOption(modal, option, suffix, onClick) {
  const command = String(modal?.command || "").trim().toLowerCase();
  const selectedOption = { ...option };
  if (command === "provider") {
    selectedOption.active = String(option.value || "") === String(state.provider || "");
  } else if (command === "model") {
    selectedOption.active = String(option.value || "") === String(state.model || "");
  }
  const button = createSelectOptionButton(modal, selectedOption, () => onClick(button));
  button.classList.add("runtime-picker-option", `runtime-picker-option-${command || "item"}`);
  button.dataset.runtimeCommand = command;
  const check = button.querySelector(".select-check");
  if (check && suffix && !selectedOption.active) {
    check.textContent = suffix;
  }
  return button;
}

function positionRuntimePicker() {
  const picker = ensureRuntimePicker();
  if (!picker.root || !picker.anchor) {
    return;
  }
  const rect = picker.anchor.getBoundingClientRect();
  const gap = 8;
  const viewportPad = 8;
  const bottomLimit = Math.max(viewportPad, rect.top - gap);
  const providerPanel = picker.root.querySelector(".runtime-picker-panel:not(.runtime-picker-model-panel)");
  const modelPanel = picker.root.querySelector(".runtime-picker-model-panel");
  const providerHeight = providerPanel?.offsetHeight || picker.root.offsetHeight || 0;
  const modelHeight = modelPanel?.offsetHeight || providerHeight;
  const topAlignedTop = Math.max(viewportPad, bottomLimit - providerHeight);
  const shouldBottomAlign = Boolean(modelPanel && topAlignedTop + modelHeight > bottomLimit);

  picker.root.style.left = `${Math.max(8, rect.left + 4)}px`;
  picker.root.classList.toggle("align-bottom", shouldBottomAlign);
  if (shouldBottomAlign) {
    picker.root.style.top = "";
    picker.root.style.bottom = `${Math.max(viewportPad, window.innerHeight - bottomLimit)}px`;
  } else {
    picker.root.style.bottom = "";
    picker.root.style.top = `${topAlignedTop}px`;
  }
}

function installRuntimePickerListeners() {
  const picker = ensureRuntimePicker();
  if (picker.listenersInstalled) {
    return;
  }
  picker.listenersInstalled = true;
  document.addEventListener("click", handleRuntimePickerOutsideClick);
  document.addEventListener("keydown", handleRuntimePickerKeydown);
  window.addEventListener("resize", positionRuntimePicker);
  window.addEventListener("scroll", positionRuntimePicker, true);
}

function uninstallRuntimePickerListeners() {
  const picker = ensureRuntimePicker();
  if (!picker.listenersInstalled) {
    return;
  }
  picker.listenersInstalled = false;
  document.removeEventListener("click", handleRuntimePickerOutsideClick);
  document.removeEventListener("keydown", handleRuntimePickerKeydown);
  window.removeEventListener("resize", positionRuntimePicker);
  window.removeEventListener("scroll", positionRuntimePicker, true);
}

function handleRuntimePickerOutsideClick(event) {
  const picker = ensureRuntimePicker();
  if (!picker.open) {
    return;
  }
  if (picker.root?.contains(event.target) || picker.anchor?.contains(event.target)) {
    return;
  }
  closeRuntimePicker();
}

function handleRuntimePickerKeydown(event) {
  if (event.key === "Escape" && ensureRuntimePicker().open) {
    event.preventDefault();
    closeRuntimePicker();
  }
}

function closeRuntimePicker() {
  const picker = ensureRuntimePicker();
  if (picker.pendingCommand) {
    picker.dismissedCommands?.add(picker.pendingCommand);
  }
  picker.anchor?.setAttribute("aria-expanded", "false");
  picker.root?.remove();
  picker.open = false;
  picker.root = null;
  picker.anchor = null;
  picker.providerModal = null;
  picker.modelModal = null;
  picker.providerOptions = null;
  picker.modelOptions = null;
  picker.pendingCommand = "";
  uninstallRuntimePickerListeners();
}

function renderModelSettingsSelect(event, detail) {
  const modal = event.modal || {};
  const command = String(modal.command || "").trim().toLowerCase();
  detail.textContent = "";

  const list = document.createElement("div");
  list.className = "select-list model-settings-select-list";
  for (const option of event.select_options || []) {
    const normalizedOption = normalizeSelectOption(modal, option);
    const button = createSelectOptionButton(modal, normalizedOption, async () => {
      button.disabled = true;
      const ok = await applySelectChoice(modal, normalizedOption, { closeBeforeRequest: false });
      if (ok) {
        list.querySelectorAll(".select-option").forEach((item) => {
          item.classList.remove("active");
          const check = item.querySelector(".select-check");
          if (check) {
            check.textContent = "";
          }
        });
        button.classList.add("active");
        const check = button.querySelector(".select-check");
        if (check) {
          check.textContent = "✓";
        }
        updateModelSettingsRows();
        if (command === "provider") {
          const modelRow = els.modalHost.querySelector("[data-setting-command='model']");
          modelRow?.classList.remove("active");
        }
      }
      button.disabled = false;
    });
    list.append(button);
  }

  detail.append(list);
}

function createSelectOptionButton(modal, normalizedOption, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `select-option${normalizedOption.active ? " active" : ""}`;
  button.addEventListener("click", onClick);
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
  return button;
}

async function applySelectChoice(modal, normalizedOption, options = {}) {
  const previousProvider = state.provider;
  const previousModel = state.model;
  const previousEffort = state.effort;
  applySelectOptimistic(modal.command, normalizedOption.value);
  try {
    if (options.closeBeforeRequest) {
      await respond({ type: "apply_select_command", command: modal.command, value: normalizedOption.value });
    } else {
      await postJson("/api/respond", {
        sessionId: state.sessionId,
        payload: { type: "apply_select_command", command: modal.command, value: normalizedOption.value },
      });
    }
    updateModelSettingsRows();
    return true;
  } catch (error) {
    state.provider = previousProvider;
    state.model = previousModel;
    state.effort = previousEffort;
    refreshProviderSummary();
    refreshModelSummary();
    updateModelSettingsRows();
    appendMessage("system", `Selection failed: ${error.message}`);
    return false;
  }
}

function updateModelSettingsRows() {
  const provider = els.modalHost.querySelector("[data-setting-value='provider']");
  if (provider) {
    provider.textContent = formatProviderName(state.provider);
  }
  const model = els.modalHost.querySelector("[data-setting-value='model']");
  if (model) {
    model.textContent = state.model || "-";
  }
  const effort = els.modalHost.querySelector("[data-setting-value='effort']");
  if (effort) {
    effort.textContent = formatEffort(state.effort);
  }
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
  } else if (normalizedCommand === "provider") {
    state.provider = normalizedValue;
    refreshProviderSummary();
  }
}

function refreshProviderSummary() {
  if (!els.provider) {
    return;
  }
  const text = `Provider: ${formatProviderName(state.provider)}`;
  els.provider.textContent = text;
  els.provider.title = text;
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
  delete els.modalHost.dataset.modalKind;
}

function dismissModal() {
  if (els.modalHost.dataset.dismissAction === "app-settings") {
    showSettingsModal();
    return;
  }
  if (els.modalHost.dataset.dismissAction === "settings") {
    showModelSettingsModal();
    return;
  }
  closeModal();
}

  return {
    showSettingsModal,
    showModelSettingsModal,
    toggleRuntimePicker,
    closeRuntimePicker,
    showWorkspaceModal,
    settingsButton,
    showModal,
    showSelect,
    modalCloseButton,
    modalButton,
    respond,
    showImagePreview,
    updateModelSettingsRows,
    closeModal,
    dismissModal,
  };
}
