"""Tests for image generation tool."""

from __future__ import annotations

import base64
from pathlib import Path

import pytest

from openharness.tools import create_default_tool_registry
from openharness.tools.base import ToolExecutionContext
from openharness.tools.image_generation_tool import (
    DEFAULT_IMAGE_MODEL,
    ImageGenerationTool,
    ImageGenerationToolInput,
    _extract_codex_image_result,
    _generation_kwargs,
    _image_model_label,
)


class _FakeImage:
    b64_json = base64.b64encode(b"fake-png").decode("ascii")


class _FakeImages:
    def __init__(self) -> None:
        self.kwargs: dict[str, object] | None = None

    async def generate(self, **kwargs: object) -> object:
        self.kwargs = kwargs
        return type("Response", (), {"data": [_FakeImage()]})()


class _FakeOpenAI:
    last_instance: "_FakeOpenAI | None" = None

    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs
        self.images = _FakeImages()
        _FakeOpenAI.last_instance = self


class _FakeCredential:
    value = "codex-token"


class _FakeResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload
        self.status_code = 200
        self.request = None

    async def __aenter__(self) -> "_FakeResponse":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def aiter_lines(self):
        yield "data: " + json_dumps(self.payload)
        yield ""

class _FakeHttpClient:
    last_post: dict[str, object] | None = None

    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs

    async def __aenter__(self) -> "_FakeHttpClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    def stream(self, method: str, url: str, **kwargs: object) -> _FakeResponse:
        assert method == "POST"
        _FakeHttpClient.last_post = {"url": url, **kwargs}
        return _FakeResponse(
            {
                "type": "response.output_item.done",
                "item": 
                    {
                        "type": "image_generation_call",
                        "result": base64.b64encode(b"codex-png").decode("ascii"),
                    }
            }
        )


def json_dumps(value: object) -> str:
    import json

    return json.dumps(value)


@pytest.mark.asyncio
async def test_generate_image_saves_api_image(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENHARNESS_IMAGE_API_KEY", "sk-test")
    monkeypatch.setattr("openharness.tools.image_generation_tool.AsyncOpenAI", _FakeOpenAI)

    result = await ImageGenerationTool().execute(
        ImageGenerationToolInput(prompt="small red cube", path="out/cube.png"),
        ToolExecutionContext(cwd=tmp_path),
    )

    assert result.is_error is False
    assert (tmp_path / "out" / "cube.png").read_bytes() == b"fake-png"
    assert "Generated image saved to" in result.output
    assert result.metadata["path"] == str((tmp_path / "out" / "cube.png").resolve())

    client = _FakeOpenAI.last_instance
    assert client is not None
    assert client.kwargs == {"api_key": "sk-test"}
    assert client.images.kwargs is not None
    assert client.images.kwargs["model"] == DEFAULT_IMAGE_MODEL
    assert client.images.kwargs["prompt"] == "small red cube"
    assert "response_format" not in client.images.kwargs


@pytest.mark.asyncio
async def test_generate_image_requires_api_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("OPENHARNESS_IMAGE_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr("openharness.tools.image_generation_tool.load_credential", lambda *_: None)
    monkeypatch.setattr(
        "openharness.tools.image_generation_tool.load_external_credential",
        lambda *_: (_ for _ in ()).throw(ValueError("missing codex auth")),
    )

    result = await ImageGenerationTool().execute(
        ImageGenerationToolInput(prompt="small red cube"),
        ToolExecutionContext(cwd=tmp_path),
    )

    assert result.is_error is True
    assert "Codex OAuth image generation is only used when the active provider is Codex" in result.output


@pytest.mark.asyncio
async def test_generate_image_reports_missing_codex_auth_for_codex_provider(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.delenv("OPENHARNESS_IMAGE_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr("openharness.tools.image_generation_tool.load_credential", lambda *_: None)
    monkeypatch.setattr(
        "openharness.tools.image_generation_tool.load_external_credential",
        lambda *_: (_ for _ in ()).throw(ValueError("missing codex auth")),
    )

    result = await ImageGenerationTool().execute(
        ImageGenerationToolInput(prompt="small red cube"),
        ToolExecutionContext(cwd=tmp_path, metadata={"provider": "openai_codex"}),
    )

    assert result.is_error is True
    assert "no OpenAI API key or Codex OAuth credential" in result.output


@pytest.mark.asyncio
async def test_generate_image_uses_codex_oauth_when_api_key_missing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.delenv("OPENHARNESS_IMAGE_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr("openharness.tools.image_generation_tool.load_credential", lambda *_: None)
    monkeypatch.setattr("openharness.tools.image_generation_tool.load_external_binding", lambda *_: None)
    monkeypatch.setattr(
        "openharness.tools.image_generation_tool.load_external_credential",
        lambda *_: _FakeCredential(),
    )
    monkeypatch.setattr(
        "openharness.tools.image_generation_tool._build_codex_headers",
        lambda token, **_: {"Authorization": f"Bearer {token}"},
    )
    monkeypatch.setattr("openharness.tools.image_generation_tool.httpx.AsyncClient", _FakeHttpClient)

    result = await ImageGenerationTool().execute(
        ImageGenerationToolInput(prompt="small red cube", path="out/codex.png", size="2048x1152"),
        ToolExecutionContext(cwd=tmp_path, metadata={"active_profile": "codex"}),
    )

    assert result.is_error is False
    assert (tmp_path / "out" / "codex.png").read_bytes() == b"codex-png"
    assert "Codex OAuth" in result.output

    post = _FakeHttpClient.last_post
    assert post is not None
    body = post["json"]
    assert isinstance(body, dict)
    assert body["tools"] == [
        {
            "type": "image_generation",
            "size": "2048x1152",
            "quality": "auto",
            "output_format": "png",
        }
    ]


def test_default_registry_includes_generate_image():
    registry = create_default_tool_registry()

    assert registry.get("generate_image") is not None


def test_dalle_generation_requests_base64_json():
    kwargs = _generation_kwargs(ImageGenerationToolInput(prompt="cube", model="dall-e-3"))

    assert kwargs["response_format"] == "b64_json"


def test_image_size_accepts_future_flexible_resolution():
    arguments = ImageGenerationToolInput(prompt="cube", size="2048x1152")

    assert arguments.size == "2048x1152"


def test_image_size_rejects_invalid_value():
    with pytest.raises(ValueError, match="WIDTHxHEIGHT"):
        ImageGenerationToolInput(prompt="cube", size="wide")


def test_extract_codex_image_result():
    encoded = base64.b64encode(b"image").decode("ascii")
    payload = {"output": [{"type": "message"}, {"type": "image_generation_call", "result": encoded}]}

    assert _extract_codex_image_result(payload) == encoded


@pytest.mark.parametrize(
    ("model", "label"),
    [
        ("gpt-image-2", "GPT Image 2"),
        ("gpt-image-1.5", "GPT Image 1.5"),
        ("gpt-image-1", "GPT Image 1"),
        ("gpt-image-1-mini", "GPT Image 1 Mini"),
    ],
)
def test_image_model_label(model: str, label: str):
    assert _image_model_label(model) == label
