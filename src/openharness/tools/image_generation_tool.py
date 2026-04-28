"""Generate images with the OpenAI Images API."""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Literal

import httpx
from openai import AsyncOpenAI
from pydantic import BaseModel, Field, field_validator

from openharness.api.codex_client import _build_codex_headers, _resolve_codex_url
from openharness.auth.external import CODEX_PROVIDER, default_binding_for_provider, load_external_credential
from openharness.auth.storage import load_external_binding
from openharness.auth.storage import load_credential
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult
from openharness.utils.fs import atomic_write_bytes


DEFAULT_IMAGE_MODEL = "gpt-image-2"
DEFAULT_CODEX_IMAGE_MODEL = "gpt-5.5"
ImageQuality = Literal["auto", "low", "medium", "high"]
ImageFormat = Literal["png", "jpeg", "webp"]
ImageBackground = Literal["auto", "opaque", "transparent"]


class ImageGenerationToolInput(BaseModel):
    """Arguments for generating a single image."""

    prompt: str = Field(description="Text prompt describing the image to generate", min_length=1)
    path: str | None = Field(
        default=None,
        description="Optional output image path. Defaults to generated-images/<prompt-slug>.png",
    )
    model: str = Field(default=DEFAULT_IMAGE_MODEL, description="OpenAI image model to use")
    size: str = Field(
        default="1024x1024",
        description='Image size. Use "auto" or a WIDTHxHEIGHT value such as 1024x1024.',
    )
    quality: ImageQuality = Field(default="auto")
    output_format: ImageFormat = Field(default="png")
    background: ImageBackground = Field(default="auto")

    @field_validator("size")
    @classmethod
    def validate_size(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized == "auto":
            return normalized
        parts = normalized.split("x", 1)
        if len(parts) != 2 or not all(part.isdigit() for part in parts):
            raise ValueError('size must be "auto" or a WIDTHxHEIGHT value such as 1024x1024')
        width, height = (int(part) for part in parts)
        if width <= 0 or height <= 0:
            raise ValueError("size dimensions must be positive")
        return f"{width}x{height}"


class ImageGenerationTool(BaseTool):
    """Generate a local image file from a text prompt."""

    name = "generate_image"
    description = (
        "Generate one image from a text prompt and save it as a local image file. "
        "Uses the OpenAI Images API when an API key is configured, or Codex/ChatGPT "
        "OAuth via the Responses image_generation tool when Codex auth is available. "
        "Defaults to gpt-image-2 for the Images API."
    )
    input_model = ImageGenerationToolInput

    async def execute(
        self,
        arguments: ImageGenerationToolInput,
        context: ToolExecutionContext,
    ) -> ToolResult:
        path = _resolve_output_path(context.cwd, arguments)

        from openharness.sandbox.session import is_docker_sandbox_active

        if is_docker_sandbox_active():
            from openharness.sandbox.path_validator import validate_sandbox_path

            allowed, reason = validate_sandbox_path(path, context.cwd)
            if not allowed:
                return ToolResult(output=f"Sandbox: {reason}", is_error=True)

        api_key = _resolve_api_key()
        if not api_key:
            if not _is_codex_provider_context(context):
                return ToolResult(
                    output=(
                        "generate_image failed: no OpenAI API key found for the active provider. "
                        "Codex OAuth image generation is only used when the active provider is Codex. "
                        "Set OPENHARNESS_IMAGE_API_KEY/OPENAI_API_KEY, or switch to the codex provider."
                    ),
                    is_error=True,
                )
            return await _generate_with_codex_oauth(arguments, path, context)

        return await _generate_with_images_api(
            arguments,
            path,
            api_key=api_key,
            backend_label="OpenAI Images API",
            backend_id="openai_images_api",
        )


async def _generate_with_images_api(
    arguments: ImageGenerationToolInput,
    path: Path,
    *,
    api_key: str,
    backend_label: str,
    backend_id: str,
    base_url: str | None = None,
    default_headers: dict[str, str] | None = None,
) -> ToolResult:
        client_kwargs: dict[str, object] = {"api_key": api_key}
        resolved_base_url = (base_url or os.environ.get("OPENHARNESS_IMAGE_BASE_URL", "")).strip()
        if resolved_base_url:
            client_kwargs["base_url"] = resolved_base_url
        if default_headers:
            client_kwargs["default_headers"] = default_headers
        client = AsyncOpenAI(**client_kwargs)

        try:
            response = await client.images.generate(**_generation_kwargs(arguments))
        except Exception as exc:
            return ToolResult(output=f"generate_image failed: {exc}", is_error=True)

        image_data = getattr(response.data[0], "b64_json", None) if response.data else None
        if not image_data:
            return ToolResult(output="generate_image failed: API response did not include image data", is_error=True)

        try:
            image_bytes = base64.b64decode(image_data)
        except Exception as exc:
            return ToolResult(output=f"generate_image failed: invalid image data: {exc}", is_error=True)

        atomic_write_bytes(path, image_bytes)
        return ToolResult(
            output=(
                f"Generated image saved to: {path}\n"
                f"Backend: {backend_label}\n"
                f"Requested image model: {arguments.model} ({_image_model_label(arguments.model)})\n"
                f"Size: {arguments.size}\n"
                f"Format: {arguments.output_format}"
            ),
            metadata={
                "path": str(path),
                "mime_type": f"image/{arguments.output_format}",
                "backend": backend_id,
                "image_model": arguments.model,
                "image_model_label": _image_model_label(arguments.model),
                "base_url": resolved_base_url,
            },
        )


async def _generate_with_codex_oauth(
    arguments: ImageGenerationToolInput,
    path: Path,
    context: ToolExecutionContext,
) -> ToolResult:
    try:
        token = _resolve_codex_oauth_token()
    except ValueError as exc:
        return ToolResult(
            output=(
                "generate_image failed: no OpenAI API key or Codex OAuth credential found. "
                "Set OPENHARNESS_IMAGE_API_KEY/OPENAI_API_KEY, or run `oh auth codex-login` "
                f"after signing in with Codex. Details: {exc}"
            ),
            is_error=True,
        )

    url = _resolve_codex_url(os.environ.get("OPENHARNESS_CODEX_BASE_URL"))
    model = _resolve_codex_request_model(context)
    body = {
        "model": model,
        "store": False,
        "stream": True,
        "instructions": "Generate the requested image and return the image result.",
        "input": [
            {
                "role": "user",
                "content": arguments.prompt,
            }
        ],
        "tools": [_codex_image_generation_tool(arguments)],
        "tool_choice": "auto",
    }
    try:
        headers = _build_codex_headers(
            token,
            session_id=str(context.metadata.get("session_id", "") or "") or None,
        )
        headers.setdefault("version", "0.122.0")
        headers["originator"] = "codex_cli_rs"
        async with httpx.AsyncClient(timeout=180.0, follow_redirects=True) as client:
            async with client.stream("POST", url, headers=headers, json=body) as response:
                if response.status_code >= 400:
                    payload = await response.aread()
                    message = payload.decode("utf-8", "replace").strip()
                    raise httpx.HTTPStatusError(
                        message or f"Codex request failed with status {response.status_code}",
                        request=response.request,
                        response=response,
                    )
                image_data = await _read_codex_image_stream(response)
    except Exception as exc:
        return ToolResult(output=f"generate_image failed via Codex OAuth: {exc}", is_error=True)
    if not image_data:
        return ToolResult(
            output="generate_image failed via Codex OAuth: response did not include image data",
            is_error=True,
        )

    try:
        image_bytes = base64.b64decode(image_data)
    except Exception as exc:
        return ToolResult(output=f"generate_image failed: invalid image data: {exc}", is_error=True)

    atomic_write_bytes(path, image_bytes)
    return ToolResult(
        output=(
            f"Generated image saved to: {path}\n"
            "Backend: Codex OAuth Responses image_generation\n"
            "Effective image model: gpt-image-2 via Codex image_generation\n"
            f"Requested image model hint: {arguments.model} ({_image_model_label(arguments.model)})\n"
            f"Codex model: {model}\n"
            f"Size: {arguments.size}\n"
            f"Format: {arguments.output_format}"
        ),
        metadata={
            "path": str(path),
            "mime_type": f"image/{arguments.output_format}",
            "backend": "codex_oauth_responses_image_generation",
            "image_model": "gpt-image-2",
            "image_model_label": "GPT Image 2",
            "requested_image_model_hint": arguments.model,
            "codex_model": model,
        },
    )


def _resolve_api_key() -> str:
    return (
        os.environ.get("OPENHARNESS_IMAGE_API_KEY", "").strip()
        or os.environ.get("OPENAI_API_KEY", "").strip()
        or (load_credential("openai", "api_key") or "").strip()
    )


def _is_codex_provider_context(context: ToolExecutionContext) -> bool:
    provider = str(context.metadata.get("provider", "") or "").strip().lower()
    active_profile = str(context.metadata.get("active_profile", "") or "").strip().lower()
    return provider == CODEX_PROVIDER or active_profile == "codex"


def _resolve_codex_oauth_token() -> str:
    binding = load_external_binding(CODEX_PROVIDER) or default_binding_for_provider(CODEX_PROVIDER)
    credential = load_external_credential(binding)
    return credential.value.strip()


def _resolve_codex_request_model(context: ToolExecutionContext) -> str:
    configured = os.environ.get("OPENHARNESS_CODEX_IMAGE_MODEL", "").strip()
    if configured:
        return configured
    runtime_model = str(context.metadata.get("runtime_model", "") or "").strip()
    return runtime_model or DEFAULT_CODEX_IMAGE_MODEL


def _generation_kwargs(arguments: ImageGenerationToolInput) -> dict[str, object]:
    kwargs: dict[str, object] = {
        "model": arguments.model,
        "prompt": arguments.prompt,
        "size": arguments.size,
        "quality": arguments.quality,
        "output_format": arguments.output_format,
        "background": arguments.background,
        "n": 1,
    }
    if arguments.model.strip().lower().startswith("dall-e"):
        kwargs["response_format"] = "b64_json"
    return kwargs


def _codex_image_generation_tool(arguments: ImageGenerationToolInput) -> dict[str, object]:
    tool: dict[str, object] = {
        "type": "image_generation",
        "size": arguments.size,
        "quality": arguments.quality,
        "output_format": arguments.output_format,
    }
    if arguments.background != "auto":
        tool["background"] = arguments.background
    return tool


def _extract_codex_image_result(payload: dict[str, object]) -> str:
    output = payload.get("output")
    if not isinstance(output, list):
        return ""
    for item in output:
        if not isinstance(item, dict):
            continue
        if item.get("type") != "image_generation_call":
            continue
        result = item.get("result")
        if isinstance(result, str) and result.strip():
            return result.strip()
    return ""


async def _read_codex_image_stream(response: httpx.Response) -> str:
    data_lines: list[str] = []
    async for line in response.aiter_lines():
        if line == "":
            if data_lines:
                payload = "\n".join(data_lines).strip()
                data_lines = []
                image_data = _extract_codex_image_event(payload)
                if image_data:
                    return image_data
            continue
        if line.startswith("data:"):
            data_lines.append(line[5:].strip())
    if data_lines:
        return _extract_codex_image_event("\n".join(data_lines).strip())
    return ""


def _extract_codex_image_event(payload: str) -> str:
    if not payload or payload == "[DONE]":
        return ""
    try:
        event = json.loads(payload)
    except json.JSONDecodeError:
        return ""
    if not isinstance(event, dict):
        return ""
    result = event.get("result") or event.get("b64_json")
    if isinstance(result, str) and result.strip():
        return result.strip()
    item = event.get("item")
    if isinstance(item, dict) and item.get("type") == "image_generation_call":
        item_result = item.get("result")
        if isinstance(item_result, str) and item_result.strip():
            return item_result.strip()
    return ""


def _image_model_label(model: str) -> str:
    normalized = model.strip().lower()
    if normalized.startswith("gpt-image-2"):
        return "GPT Image 2"
    if normalized.startswith("gpt-image-1.5"):
        return "GPT Image 1.5"
    if normalized.startswith("gpt-image-1-mini"):
        return "GPT Image 1 Mini"
    if normalized.startswith("gpt-image-1"):
        return "GPT Image 1"
    if normalized.startswith("dall-e-3"):
        return "DALL-E 3"
    if normalized.startswith("dall-e-2"):
        return "DALL-E 2"
    return "custom image model"


def _resolve_output_path(cwd: Path, arguments: ImageGenerationToolInput) -> Path:
    if arguments.path and arguments.path.strip():
        path = Path(arguments.path).expanduser()
        if not path.is_absolute():
            path = cwd / path
        return path.resolve()

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    slug = _slugify(arguments.prompt)
    return (cwd / "generated-images" / f"{timestamp}-{slug}.{arguments.output_format}").resolve()


def _slugify(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    cleaned = "-".join(part for part in cleaned.split("-") if part)
    return cleaned[:48].strip("-") or "image"
