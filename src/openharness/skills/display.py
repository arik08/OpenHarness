"""User-facing skill display helpers."""

from __future__ import annotations

from typing import Any


_KO_SKILL_DESCRIPTIONS_BY_NAME: dict[str, str] = {
    "dot-skill": "인물이나 자료에 대한 원문을 재사용 가능한 AI 스킬로 바꾸기 위한 영어 우선 메타 스킬입니다.",
    "insane-search": (
        "차단된 웹사이트를 자동으로 우회하기 위해 가능한 방법을 순차적으로 시도합니다. "
        "WebFetch가 402/403/차단 오류를 반환하거나 X/Twitter, Reddit, YouTube, GitHub, "
        "Mastodon, Medium, Substack, Stack Overflow, Threads, Naver, Coupang, LinkedIn처럼 "
        "WAF나 봇 보호가 있는 플랫폼에 접근할 때 사용합니다. yt-dlp, Jina Reader, 공개 API, "
        "TLS 위장, 모바일 URL 변환, Playwright 실제 Chrome 체인을 활용합니다."
    ),
    "playwright-capture": (
        "Playwright/Chromium으로 로컬 또는 원격 HTML 페이지를 렌더링하고 스크린샷이나 PDF로 내보냅니다. "
        "웹페이지 캡처, HTML의 PNG/PDF 변환, 브라우저 렌더링 결과 점검, PPT용 스크린샷 생성, "
        "반응형 뷰포트 테스트, 시각적 HTML 파일의 실제 열림/내보내기 검증에 사용합니다."
    ),
    "skill-creator": (
        "효과적인 스킬을 만들거나 기존 스킬을 업데이트하는 절차를 안내합니다. "
        "전문 지식, 워크플로, 도구 통합으로 Codex의 기능을 확장하려는 요청에 사용합니다."
    ),
    "ui-design-essence": (
        "페이지, 컴포넌트, 대시보드, 보고서, 프로토타입, 랜딩 페이지, HTML 프리뷰를 만들거나 개선할 때의 "
        "시각 UI 디자인 기준입니다. 시각적 위계, 스타일 방향, 디자인 토큰, 반응형/접근성/밀도/모션 점검에 사용합니다."
    ),
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
