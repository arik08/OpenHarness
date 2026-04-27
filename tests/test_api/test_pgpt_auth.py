import base64
import json

from openharness.api.pgpt_auth import build_pgpt_auth_token


def test_build_pgpt_auth_token_uses_openai_compatible_payload_keys():
    token = build_pgpt_auth_token("api-key", "E12345", "30")
    payload = json.loads(base64.b64decode(token).decode("utf-8"))

    assert payload == {
        "apiKey": "api-key",
        "companyCode": "30",
        "systemCode": "E12345",
    }
