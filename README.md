# MyHarness

MyHarness는 OpenHarness 코드베이스를 기반으로 만든 사내용 AI Agent 접근성 프로젝트입니다.
회사 구성원이 AI Agent를 더 쉽게 시도하고, 이해하고, 실제 업무에 적용할 수 있도록 브라우저 UI, 투명한 작업 단계, 워크스페이스별 기록, 스킬, 파일 참조, 산출물 미리보기를 제공합니다.

원본 upstream OpenHarness README는 [`README.openharness.md`](README.openharness.md)에 보존되어 있습니다.

## 이 앱은 무엇인가요

MyHarness는 OpenHarness agent runtime을 브라우저 UI로 감싼 도구입니다. 목표는 AI Agent 업무 흐름을 사내에서 쉽게 체험하고 설명하고 확산할 수 있게 만드는 것입니다.

- `Playground/` 아래 선택한 워크스페이스에서 agent와 대화합니다.
- agent가 무엇을 하는지 숨기지 않고 단계별 활동을 보여줍니다.
- `/` 명령, `$` 스킬/MCP/plugin, `@` 현재 워크스페이스 파일 참조를 지원합니다.
- HTML, Markdown, 텍스트, JSON, CSV, 이미지, PDF 산출물을 오른쪽 패널에서 미리볼 수 있습니다.
- 대화 기록은 선택한 워크스페이스 맥락 안에 유지됩니다.
- 프로그램, 워크스페이스, 사용자 폴더의 스킬을 불러올 수 있습니다.

## 빠른 시작

처음 받은 PC에서는 이 폴더에서 아래 파일을 한 번 실행하세요.

```bat
Installer.bat
```

설치가 끝난 뒤, 또는 이미 설치된 PC에서는 아래 파일을 실행하세요.

```bat
run_openharness_web.bat
```

브라우저에서 아래 주소를 엽니다.

```text
http://localhost:4173
```

설치기와 런처는 모두 프로젝트 안의 `.openharness/` 폴더를 사용합니다. 그래서 폴더를 다른 PC로 옮겨도 사용자 홈 디렉터리 설정과 섞이지 않습니다.

런처는 Python 가상환경, Python 패키지, web 의존성, 기본 provider 설정을 확인합니다. 설치기를 먼저 실행하지 않았더라도 가능한 범위에서 자동으로 보정한 뒤 MyHarness web server를 시작합니다.

다른 포트를 쓰고 싶으면 다음처럼 실행하세요.

```bat
set PORT=4174
run_openharness_web.bat
```

## Provider 설정

초기 사용자에게 가장 중요한 설정 파일은 프로젝트 안의 아래 파일입니다.

```text
.openharness/settings.json
.openharness/credentials.json
.openharness/credentials.example.json
```

`run_openharness_web.bat`는 기본적으로 이 프로젝트-local `.openharness/` 폴더를 사용합니다. 그래서 이 폴더를 통째로 옮긴 뒤에도 사용자 홈 디렉터리에 인증 정보를 다시 만들지 않고 바로 실행할 수 있습니다.

- `.openharness/settings.json`: 기본 provider profile을 고릅니다. 배포 기본값은 OpenAI-compatible 방식의 `p-gpt`입니다.
- `.openharness/credentials.json`: API key 기반 provider의 사용자별 비밀 값을 저장합니다. 이 파일은 저장소에는 올리지 않습니다.
- `.openharness/credentials.example.json`: P-GPT 인증값 예시 구조를 보여줍니다. 실제 값은 `.openharness/credentials.json`에만 저장하세요.
- P-GPT endpoint는 built-in `p-gpt` profile에 `http://pgpt.posco.com/s0la01-gpt/v1`로 정의되어 있습니다.
- 브라우저 설정의 `P-GPT 키`에서 API Key, 사번, 회사번호를 저장하거나 `/login API_KEY EMPLOYEE_NO [COMPANY_CODE]`를 사용할 수 있습니다.
- 앱이 원하는 provider로 열리지 않으면 채팅창에서 `/provider` 명령을 사용하거나 `.openharness/settings.json`의 `active_profile`을 조정하세요.

## 워크스페이스 모델

워크스페이스는 아래 위치에 둡니다.

```text
Playground/shared/<project-name>/
```

기본값은 모든 접속자가 같은 `shared` 스코프를 보는 모드입니다. PC/IP별로 프로젝트와 대화 기록을 나누려면 서버 실행 전에 `OPENHARNESS_WORKSPACE_SCOPE=ip`를 설정하세요. 이 경우 경로는 `Playground/<client-ip>/<project-name>/` 형태가 됩니다.

워크스페이스 선택기는 이 폴더들을 보여줍니다. agent가 새로 만든 파일도 현재 워크스페이스 폴더 안에 생성되어야 `@`로 참조하거나 오른쪽 패널에서 미리볼 수 있습니다.

## 확장 기능

MyHarness는 세 위치에서 스킬을 찾습니다.

1. 프로그램 폴더: `.skills/`
2. 현재 워크스페이스 폴더: `Playground/<project-name>/.skills/`
3. 사용자 폴더: 사용자-level OpenHarness/Codex skill 위치

프로그램 폴더의 스킬은 MyHarness 기본 동작을 함께 배포하기 위한 위치입니다. 이 구조 덕분에 앱 폴더를 zip으로 묶거나 다른 PC로 옮겨도 같은 동작을 유지하기 쉽습니다.

채팅 입력창에서 `$`를 누르면 extension picker가 열립니다. 여기서 사용 가능한 custom skill, MCP server, plugin을 볼 수 있습니다.

프로그램-level 확장 폴더:

- `.skills/`: `SKILL.md`가 들어 있는 skill 폴더
- `.mcp/`: `mcpServers` 객체가 들어 있는 MCP JSON 설정 파일
- `.plugins/`: `plugin.json` 또는 `.claude-plugin/plugin.json`이 들어 있는 plugin 폴더

## 입력 단축키

- `/`: 명령 제안을 엽니다.
- `$`: 스킬 제안을 엽니다.
- `@`: 현재 워크스페이스 파일 제안을 엽니다.
- 5줄 이상을 붙여넣거나 입력하면, 원문은 그대로 backend에 보내되 입력창에서는 한 줄짜리 pasted-text chip으로 접습니다.

## 산출물 미리보기

최종 assistant 답변에 생성된 파일명이 나오면 MyHarness는 그 파일이 현재 워크스페이스에 있는지 확인합니다. 예를 들면 `market-analysis-dashboard.html`, `meeting-summary-2026-04.md`, `customer-feedback-sample.json`처럼 내용과 용도에 맞는 파일명을 사용할 수 있습니다.

파일이 있으면 답변 아래에 file card가 나타납니다. card를 클릭하면 오른쪽 preview panel에서 열립니다.

지원하는 미리보기:

- HTML: iframe preview
- Markdown/text/JSON/CSV: 읽기 전용 viewer
- 이미지: image preview
- PDF: embedded preview

## 프로세스 동작

web server는 필요할 때 Python backend session을 시작합니다.

MyHarness는 오래 남는 background process를 줄이기 위해 다음 동작을 합니다.

- 브라우저/EventSource 연결이 닫히면 짧은 유예 시간 뒤 관련 backend를 종료합니다.
- 모든 backend session이 사라지면 web server도 idle 상태에서 종료될 수 있습니다.
- `run_openharness_web.bat`는 설정된 포트를 이 앱이 우선 사용하도록 기존 프로세스를 정리하고 새로 시작합니다.

## 저장소 구조

```text
frontend/web/              브라우저 UI와 local web server
src/openharness/           Python agent runtime과 backend host
.openharness/              프로젝트-local 설정과 인증 정보
.skills/                   프로그램-level MyHarness 스킬
.mcp/                      프로그램-level MCP server 설정
.plugins/                  프로그램-level plugin
Playground/                워크스페이스 폴더와 생성 파일
run_openharness_web.bat    Windows 런처
Installer.bat              프로젝트-local 설치/복구 스크립트
README.openharness.md      보존된 upstream OpenHarness README
```

## 개발 확인 명령

간단한 확인 명령입니다.

```bat
node --check frontend/web/server.mjs
node --check frontend/web/script.js
node --check frontend/web/modules/commands.js
py -3 -m compileall src
```

일반 사용자는 아래 런처만 실행하면 됩니다.

```bat
run_openharness_web.bat
```
