"""Authentication helpers for P-GPT's OpenAI-compatible endpoint."""

from __future__ import annotations

import base64
import json
import os


def resolve_pgpt_employee_no() -> str | None:
    """Resolve the employee/system code used in P-GPT bearer tokens."""
    return (
        os.environ.get("PGPT_EMPLOYEE_NO")
        or os.environ.get("PGPT_SYSTEM_CODE")
        or os.environ.get("POSCO_EMP_NO")
    )


def resolve_pgpt_company_code() -> str:
    """Resolve the company code used in P-GPT bearer tokens."""
    return (
        os.environ.get("PGPT_COMPANY_CODE")
        or os.environ.get("POSCO_COMP_NO")
        or "30"
    )


def build_pgpt_auth_token(api_key: str, employee_no: str, company_code: str = "30") -> str:
    """Build the bearer token expected by P-GPT's OpenAI-compatible API."""
    payload = json.dumps(
        {
            "apiKey": api_key,
            "companyCode": company_code,
            "systemCode": employee_no,
        },
        ensure_ascii=False,
    )
    return base64.b64encode(payload.encode("utf-8")).decode("utf-8")
