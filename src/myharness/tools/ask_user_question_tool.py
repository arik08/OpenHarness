"""Tool for asking the interactive user a follow-up question."""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable

from pydantic import BaseModel, Field

from myharness.tools.base import BaseTool, ToolExecutionContext, ToolResult


AskUserPrompt = Callable[..., Awaitable[str]]


class AskUserQuestionChoice(BaseModel):
    """One structured answer the user can select."""

    value: str = Field(description="The exact answer value to return if selected")
    label: str | None = Field(default=None, description="Short text shown to the user")
    description: str | None = Field(default=None, description="Optional detail shown below the label")


class AskUserQuestionToolInput(BaseModel):
    """Arguments for asking the user a question."""

    question: str = Field(
        description=(
            "The exact question to ask the user. Batch all necessary clarification into this "
            "one question instead of asking a series of small follow-ups. If there are multiple "
            "items, label each item as (1/N), (2/N), etc."
        )
    )
    choices: list[AskUserQuestionChoice] = Field(
        default_factory=list,
        description=(
            "Optional structured multiple-choice answers. Use this JSON array instead of "
            "embedding answer choices in the question text. Each choice.value is the exact "
            "answer returned when selected."
        ),
    )


class AskUserQuestionTool(BaseTool):
    """Ask the interactive user a question and return the answer."""

    name = "ask_user_question"
    description = (
        "Ask the interactive user a follow-up question and return the answer. Use this only "
        "when the missing information would make the work meaningfully wrong, destructive, "
        "or wasteful. If a reasonable default exists, state the assumption and proceed. When "
        "a question is necessary, batch the choices into one prompt and avoid approval-only "
        "questions like asking whether to proceed after a reasonable plan. If several "
        "clarifications are needed, label each item as (1/N), (2/N), etc. After the user "
        "answers, continue the original task without restating the plan or asking for another "
        "confirmation unless there is a new concrete blocker. Do not ask another clarification "
        "immediately after the user answers unless proceeding would be impossible, destructive, "
        "or clearly wrong."
    )
    input_model = AskUserQuestionToolInput

    def is_read_only(self, arguments: AskUserQuestionToolInput) -> bool:
        del arguments
        return True

    async def execute(
        self,
        arguments: AskUserQuestionToolInput,
        context: ToolExecutionContext,
    ) -> ToolResult:
        prompt = context.metadata.get("ask_user_prompt")
        if not callable(prompt):
            return ToolResult(
                output="ask_user_question is unavailable in this session",
                is_error=True,
            )
        choices = [
            choice.model_dump(exclude_none=True)
            for choice in arguments.choices
            if choice.value.strip()
        ]
        answer = str(await _call_user_prompt(prompt, arguments.question, choices)).strip()
        if not answer:
            return ToolResult(output="(no response)")
        return ToolResult(output=answer)


async def _call_user_prompt(prompt: AskUserPrompt, question: str, choices: list[dict[str, str]]) -> str:
    """Call old one-argument prompts or newer prompts that accept structured choices."""
    if not choices:
        return await prompt(question)
    try:
        signature = inspect.signature(prompt)
    except (TypeError, ValueError):
        return await prompt(question, choices=choices)

    parameters = list(signature.parameters.values())
    accepts_kwargs = any(param.kind == inspect.Parameter.VAR_KEYWORD for param in parameters)
    accepts_args = any(param.kind == inspect.Parameter.VAR_POSITIONAL for param in parameters)
    accepts_choices_kw = any(param.name == "choices" for param in parameters)
    positional_capacity = sum(
        1
        for param in parameters
        if param.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    )
    if accepts_kwargs or accepts_choices_kw:
        return await prompt(question, choices=choices)
    if accepts_args or positional_capacity >= 2:
        return await prompt(question, choices)
    return await prompt(question)
