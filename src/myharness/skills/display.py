"""User-facing skill display helpers."""

from __future__ import annotations

from typing import Any


_KO_SKILL_DESCRIPTIONS_BY_NAME: dict[str, str] = {
    "brainstorming": "창의적 작업, 기능 생성, 컴포넌트 구축, 기능 추가, 동작 수정처럼 구현 전에 의도와 요구사항, 설계를 먼저 탐색해야 할 때 사용합니다.",
    "debug": "버그를 체계적으로 진단하고 수정할 때 사용합니다.",
    "design-md": "특정 회사나 제품의 스타일, 콘셉트, 시각 언어, 브랜드 느낌을 반영한 보고서, HTML 산출물, 대시보드, 페이지, UI, 시각 문서를 요청받았을 때 사용합니다.",
    "diagnose": "에이전트 실행이 실패했거나, 회귀가 생겼거나, 예상과 다른 결과가 나온 이유를 직감이 아니라 증거 기반으로 진단해야 할 때 사용합니다.",
    "dispatching-parallel-agents": "공유 상태나 순차 의존성이 없는 2개 이상의 독립 작업을 병렬로 처리할 수 있을 때 사용합니다.",
    "dot-skill": "인물이나 자료에 대한 원문을 재사용 가능한 AI 스킬로 바꾸기 위한 영어 우선 메타 스킬입니다.",
    "executing-plans": "검토 체크포인트가 포함된 작성된 구현 계획을 별도 세션에서 실행할 때 사용합니다.",
    "finishing-a-development-branch": "구현이 완료되고 모든 테스트가 통과한 뒤, 병합·PR·정리 등 개발 브랜치 통합 방식을 결정해야 할 때 사용합니다.",
    "insane-search": (
        "차단된 웹사이트를 자동으로 우회하기 위해 가능한 방법을 순차적으로 시도합니다. "
        "WebFetch가 402/403/차단 오류를 반환하거나 X/Twitter, Reddit, YouTube, GitHub, "
        "Mastodon, Medium, Substack, Stack Overflow, Threads, Naver, Coupang, LinkedIn처럼 "
        "WAF나 봇 보호가 있는 플랫폼에 접근할 때 사용합니다. yt-dlp, Jina Reader, 공개 API, "
        "TLS 위장, 모바일 URL 변환, Playwright 실제 Chrome 체인을 활용합니다."
    ),
    "plan": "코딩 전에 구현 계획을 설계해야 할 때 사용합니다.",
    "playwright-capture": (
        "Playwright/Chromium으로 로컬 또는 원격 HTML 페이지를 렌더링하고 스크린샷이나 PDF로 내보냅니다. "
        "웹페이지 캡처, HTML의 PNG/PDF 변환, 브라우저 렌더링 결과 점검, PPT용 스크린샷 생성, "
        "반응형 뷰포트 테스트, 시각적 HTML 파일의 실제 열림/내보내기 검증에 사용합니다."
    ),
    "receiving-code-review": "코드 리뷰 피드백을 받은 뒤 제안을 구현하기 전에 사용합니다. 특히 피드백이 불명확하거나 기술적으로 의심스러울 때 맹목적으로 따르지 않고 검증하는 데 사용합니다.",
    "requesting-code-review": "작업 완료, 주요 기능 구현, 병합 전 단계에서 요구사항 충족 여부를 확인하기 위해 코드 리뷰가 필요할 때 사용합니다.",
    "review": "버그, 보안 문제, 품질 이슈를 찾기 위해 코드를 검토할 때 사용합니다.",
    "simplify": "코드를 더 단순하고 유지보수하기 쉽게 리팩터링할 때 사용합니다.",
    "skill-creator": (
        "효과적인 스킬을 만들거나 기존 스킬을 업데이트하는 절차를 안내합니다. "
        "전문 지식, 워크플로, 도구 통합으로 Codex의 기능을 확장하려는 요청에 사용합니다."
    ),
    "subagent-driven-development": "현재 세션에서 독립 작업이 포함된 구현 계획을 실행할 때 사용합니다.",
    "systematic-debugging": "버그, 테스트 실패, 예기치 않은 동작을 만났을 때 수정안을 제안하기 전에 사용합니다.",
    "test": "코드 테스트를 작성하고 실행할 때 사용합니다.",
    "test-driven-development": "기능이나 버그 수정을 구현하기 전, 구현 코드 작성 전에 사용합니다.",
    "ui-design-essence": (
        "페이지, 컴포넌트, 대시보드, 보고서, 프로토타입, 랜딩 페이지, HTML 프리뷰를 만들거나 개선할 때의 "
        "시각 UI 디자인 기준입니다. 시각적 위계, 스타일 방향, 디자인 토큰, 반응형/접근성/밀도/모션 점검에 사용합니다."
    ),
    "using-git-worktrees": "현재 작업공간과 분리된 기능 작업이 필요하거나 구현 계획을 실행하기 전에 안전한 git worktree를 만들 때 사용합니다.",
    "using-superpowers": "대화를 시작할 때 스킬을 찾고 사용하는 방식을 정하며, 답변이나 질문 전 관련 스킬을 먼저 불러와야 할 때 사용합니다.",
    "verification-before-completion": "작업 완료, 수정 완료, 테스트 통과를 주장하기 직전에 검증 명령을 실행하고 결과를 확인해야 할 때 사용합니다.",
    "visual-artifact": (
        "보고서, 대시보드, 인포그래픽, 원페이지, 슬라이드형 웹페이지, 시각 요약, 비교 페이지, 타임라인, "
        "인터랙티브 프리뷰 같은 단일 HTML 시각 산출물을 만듭니다. 브라우저에서 열거나 PPT/PDF로 캡처할 "
        "재사용 가능한 시각 자료가 필요할 때 사용합니다."
    ),
    "visual-review": (
        "브라우저에서 렌더링된 시각 산출물의 레이아웃, 내보내기, 접근성, 발표 품질을 검토합니다. "
        "HTML 보고서, 대시보드, 인포그래픽, 슬라이드형 페이지, 스크린샷, PDF, PPT용 시각 자료를 만든 뒤 "
        "잘림/넘침, PDF/스크린샷 준비 상태, 전반적인 완성도를 점검할 때 사용합니다."
    ),
    "writing-plans": "다단계 작업의 명세나 요구사항이 있고 코드를 만지기 전에 구현 계획을 작성해야 할 때 사용합니다.",
    "writing-skills": "새 스킬을 만들거나 기존 스킬을 편집하거나 배포 전 스킬 동작을 검증할 때 사용합니다.",
}

_KO_DESCRIPTION_BY_TEXT: dict[str, str] = {
    "English-first meta-skill for turning source material about a person into a reusable AI skill.": (
        "인물이나 자료에 대한 원문을 재사용 가능한 AI 스킬로 바꾸기 위한 영어 우선 메타 스킬입니다."
    ),
    "Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends Codex's capabilities with specialized knowledge, workflows, or tool integrations.": (
        "효과적인 스킬을 만들거나 기존 스킬을 업데이트하는 절차를 안내합니다. 전문 지식, 워크플로, 도구 통합으로 "
        "Codex의 기능을 확장하려는 요청에 사용합니다."
    ),
}

def display_skill_description(skill: Any) -> str:
    """Return a Korean UI description without mutating the loaded skill."""
    name = str(getattr(skill, "name", "") or "").strip()
    description = str(getattr(skill, "description", "") or "").strip()
    return translate_skill_description(name, description)


def translate_skill_description(name: str, description: str) -> str:
    """Translate known skill descriptions for user-facing UI."""
    normalized_name = name.strip().lower()
    normalized_description = " ".join(description.split())

    if normalized_description in _KO_DESCRIPTION_BY_TEXT:
        return _KO_DESCRIPTION_BY_TEXT[normalized_description]

    if normalized_name in _KO_SKILL_DESCRIPTIONS_BY_NAME:
        return _KO_SKILL_DESCRIPTIONS_BY_NAME[normalized_name]

    return description
