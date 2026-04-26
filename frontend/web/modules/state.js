export const state = {
  sessionId: null,
  clientId: localStorage.getItem("openharness:clientId") || "",
  chatSlots: new Map(),
  activeFrontendId: "",
  ready: false,
  busy: false,
  busyVisual: false,
  assistantNode: null,
  source: null,
  chatTitle: "MyHarness",
  activeHistoryId: null,
  commands: [],
  skills: [],
  mcpServers: [],
  plugins: [],
  projectFiles: [],
  projectFilesLoadedForSession: "",
  slashMenuOpen: false,
  slashMenuIndex: 0,
  slashMenuMode: "command",
  restoringHistory: false,
  batchingHistoryRestore: false,
  pendingScrollRestoreId: null,
  suppressNextLineCompleteScroll: false,
  ignoreScrollSave: false,
  autoFollowMessages: true,
  autoScrollUntil: 0,
  editingTitle: false,
  model: "-",
  effort: "-",
  provider: "-",
  permissionMode: "-",
  planModePinned: null,
  systemPrompt: localStorage.getItem("openharness:systemPrompt") || "",
  workspaceName: localStorage.getItem("openharness:workspaceName") || "",
  workspacePath: "",
  workspaces: [],
  switchingWorkspace: false,
  returnToSettingsOnDismiss: false,
  workflowNode: null,
  workflowList: null,
  workflowSummary: null,
  workflowSteps: [],
  workflowTimer: 0,
  workflowRestoredElapsedMs: 0,
  artifacts: [],
  activeArtifact: null,
  activeArtifactRaw: "",
  artifactPanelOpen: false,
  attachments: [],
  pastedTexts: [],
  composerToken: null,
};

if (!state.clientId) {
  state.clientId = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem("openharness:clientId", state.clientId);
}

export const els = {
  appShell: document.querySelector(".app-shell"),
  sidebar: document.querySelector(".sidebar"),
  messages: document.querySelector("#messages"),
  composer: document.querySelector("#composer"),
  composerBox: document.querySelector(".composer-box"),
  input: document.querySelector("#promptInput"),
  send: document.querySelector("#sendButton"),
  sessionStatus: document.querySelector("#sessionStatus"),
  sessionId: document.querySelector("#sessionId"),
  readyPill: document.querySelector("#readyPill"),
  model: document.querySelector("#modelValue"),
  provider: document.querySelector("#providerValue"),
  cwd: document.querySelector("#cwdValue"),
  toolList: document.querySelector("#toolList"),
  taskList: document.querySelector("#taskList"),
  modalHost: document.querySelector("#modalHost"),
  historyList: document.querySelector("#historyList"),
  chatTitleButton: document.querySelector("#chatTitle"),
  chatTitle: document.querySelector("#chatTitle span"),
  projectFilesButton: document.querySelector("#projectFilesButton"),
  themeToggle: document.querySelector("[data-action='toggle-theme']"),
  planModeIndicator: document.querySelector("#planModeIndicator"),
  slashMenu: document.querySelector("#slashMenu"),
  attachmentTray: document.querySelector("#attachmentTray"),
  pastedTextTray: document.querySelector("#pastedTextTray"),
  composerToken: document.querySelector("#composerToken"),
  workspaceNames: document.querySelectorAll("[data-workspace-name]"),
  artifactPanel: document.querySelector("#artifactPanel"),
  artifactPanelTitle: document.querySelector("#artifactPanelTitle"),
  artifactPanelMeta: document.querySelector("#artifactPanelMeta"),
  artifactPanelCopy: document.querySelector("#artifactPanelCopy"),
  artifactPanelFullscreen: document.querySelector("#artifactPanelFullscreen"),
  artifactPanelClose: document.querySelector("#artifactPanelClose"),
  artifactResizeHandle: document.querySelector("#artifactResizeHandle"),
  artifactViewer: document.querySelector("#artifactViewer"),
};

if (els.input) {
  els.input.spellcheck = false;
  els.input.setAttribute("spellcheck", "false");
  els.input.setAttribute("autocorrect", "off");
  els.input.setAttribute("autocapitalize", "off");
}

export const STATUS_LABELS = {
  connecting: "연결 중",
  startingBackend: "백엔드 시작 중",
  ready: "준비됨",
  thinking: "생각 중",
  sending: "전송 중",
  processing: "처리 중",
  restoring: "복원 중",
  error: "오류",
  stopped: "백엔드 중지됨",
  startFailed: "시작 실패",
  connectionError: "연결 오류",
};

export const COMMAND_DESCRIPTIONS = {
  "/agents": "에이전트와 팀 작업을 조회합니다",
  "/autopilot": "저장소 자동 작업 입력과 컨텍스트를 관리합니다",
  "/branch": "Git 브랜치 정보를 보여줍니다",
  "/bridge": "브리지 헬퍼와 브리지 세션을 확인합니다",
  "/clear": "현재 대화 기록을 지웁니다",
  "/commit": "Git 상태를 보거나 커밋을 생성합니다",
  "/compact": "오래된 대화 기록을 압축합니다",
  "/config": "설정을 보거나 변경합니다",
  "/context": "현재 런타임 시스템 프롬프트를 보여줍니다",
  "/continue": "중단된 도구 루프를 이어서 실행합니다",
  "/copy": "최근 응답이나 입력한 텍스트를 복사합니다",
  "/cost": "토큰 사용량과 예상 비용을 보여줍니다",
  "/diff": "Git diff 출력을 보여줍니다",
  "/doctor": "환경 진단 정보를 보여줍니다",
  "/effort": "추론 강도를 보거나 변경합니다",
  "/exit": "MyHarness를 종료합니다",
  "/export": "현재 대화 기록을 내보냅니다",
  "/fast": "빠른 모드를 보거나 변경합니다",
  "/feedback": "CLI 피드백을 로컬 로그에 저장합니다",
  "/files": "현재 작업공간의 파일을 나열합니다",
  "/help": "사용 가능한 명령어를 보여줍니다",
  "/hooks": "설정된 훅을 보여줍니다",
  "/init": "프로젝트 MyHarness 파일을 초기화합니다",
  "/issue": "프로젝트 이슈 컨텍스트를 보거나 변경합니다",
  "/keybindings": "적용된 키 바인딩을 보여줍니다",
  "/login": "인증 상태를 보거나 API 키를 저장합니다",
  "/logout": "저장된 API 키를 지웁니다",
  "/mcp": "MCP 상태를 보여줍니다",
  "/memory": "프로젝트 메모리를 확인하고 관리합니다",
  "/model": "기본 모델을 보거나 변경합니다",
  "/onboarding": "빠른 시작 안내를 보여줍니다",
  "/output-style": "출력 스타일을 보거나 변경합니다",
  "/passes": "추론 반복 횟수를 보거나 변경합니다",
  "/permissions": "권한 모드를 보거나 변경합니다",
  "/plan": "계획 모드를 켜거나 끕니다",
  "/plugin": "플러그인을 관리합니다",
  "/pr_comments": "PR 코멘트 컨텍스트를 보거나 변경합니다",
  "/privacy-settings": "로컬 개인정보와 저장 설정을 보여줍니다",
  "/provider": "프로바이더 프로필을 보거나 전환합니다",
  "/rate-limit-options": "요청 제한을 줄이는 방법을 보여줍니다",
  "/release-notes": "최근 릴리스 노트를 보여줍니다",
  "/reload-plugins": "이 작업공간의 플러그인 검색을 다시 실행합니다",
  "/resume": "최근 저장된 세션을 복원합니다",
  "/rewind": "최근 대화 턴을 되돌립니다",
  "/session": "현재 세션 저장 정보를 확인합니다",
  "/share": "공유 가능한 대화 스냅샷을 만듭니다",
  "/ship": "ohmo 기반 저장소 작업을 큐에 넣고 실행합니다",
  "/skills": "사용 가능한 스킬을 보거나 자세히 확인합니다",
  "/stats": "세션 통계를 보여줍니다",
  "/status": "세션 상태를 보여줍니다",
  "/subagents": "서브에이전트 사용량과 작업을 확인합니다",
  "/summary": "대화 기록을 요약합니다",
  "/tag": "현재 세션의 이름 있는 스냅샷을 만듭니다",
  "/tasks": "백그라운드 작업을 관리합니다",
  "/theme": "TUI 테마를 보거나 변경합니다",
  "/turns": "최대 에이전트 턴 수를 보거나 변경합니다",
  "/upgrade": "업그레이드 안내를 보여줍니다",
  "/usage": "사용량과 토큰 추정치를 보여줍니다",
  "/version": "설치된 MyHarness 버전을 보여줍니다",
  "/vim": "Vim 모드를 보거나 변경합니다",
  "/voice": "음성 모드를 보거나 변경합니다",
};

export function commandDescription(command, fallback = "") {
  return COMMAND_DESCRIPTIONS[command] || fallback || "명령어를 실행합니다";
}

export function updateState(snapshot = {}) {
  state.model = snapshot.model || "-";
  state.effort = snapshot.effort || "-";
  state.provider = snapshot.provider || "-";
  const snapshotPermissionMode = snapshot.permission_mode || "-";
  state.permissionMode = state.planModePinned === null
    ? snapshotPermissionMode
    : state.planModePinned
      ? "Plan Mode"
      : "Default";
  const providerLabel = formatProviderName(state.provider);
  const modelLabel = state.model || "-";
  const effortLabel = formatEffort(state.effort);
  const loading = providerLabel === "-" && modelLabel === "-" && effortLabel === "-";
  els.provider.textContent = loading ? "Provider: 불러오는 중..." : `Provider: ${providerLabel}`;
  els.model.textContent = loading ? "Model: 불러오는 중..." : `Model: ${modelLabel}, Effort: ${effortLabel}`;
  els.provider.title = els.provider.textContent;
  els.model.title = els.model.textContent;
  els.cwd.textContent = snapshot.cwd || "-";
  updatePlanModeIndicator();
}

export function setPlanModeIndicatorActive(active) {
  state.planModePinned = Boolean(active);
  state.permissionMode = active ? "Plan Mode" : "Default";
  updatePlanModeIndicator();
}

function updatePlanModeIndicator() {
  if (!els.planModeIndicator) {
    return;
  }
  const mode = String(state.permissionMode || "").trim().toLowerCase().replace(/\s+/g, "_");
  const active = mode === "plan" || mode === "plan_mode" || mode === "permissionmode.plan";
  els.planModeIndicator.classList.toggle("hidden", !active);
  els.planModeIndicator.setAttribute("aria-pressed", active ? "true" : "false");
}

export function formatProviderName(value) {
  const normalized = String(value || "").trim();
  const labels = {
    posco_gpt: "P-GPT",
    "openai-codex": "Codex",
    openai_codex: "Codex",
    github_copilot: "GitHub Copilot",
    anthropic: "Anthropic",
    "claude-subscription": "Claude",
    minimax: "MiniMax",
    gemini: "Gemini",
    moonshot: "Moonshot",
  };
  return labels[normalized] || normalized || "-";
}

export function formatEffort(value) {
  const normalized = String(value || "").trim();
  const labels = {
    none: "Auto",
    auto: "Auto",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
  };
  return labels[normalized] || normalized || "-";
}
