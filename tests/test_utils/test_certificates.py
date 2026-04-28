"""Tests for corporate CA certificate helpers."""

from __future__ import annotations

from pathlib import Path

from openharness.utils import certificates


def test_configure_certificate_returns_none_when_cert_is_missing(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(certificates, "_configured_bundle", None)
    for key in certificates._PYTHON_CA_ENV_VARS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.delenv("NODE_EXTRA_CA_CERTS", raising=False)
    monkeypatch.delenv("npm_config_cafile", raising=False)

    result = certificates._configure_certificate(tmp_path / "missing.crt")

    assert result is None
    for key in certificates._PYTHON_CA_ENV_VARS:
        assert key not in certificates.os.environ


def test_configure_certificate_writes_combined_bundle(tmp_path: Path, monkeypatch) -> None:
    base_ca = tmp_path / "base-ca.pem"
    posco_cert = tmp_path / "POSCO.crt"
    data_dir = tmp_path / "data"
    base_ca.write_text("BASE CERT\n", encoding="utf-8")
    posco_cert.write_text("POSCO CERT\n", encoding="utf-8")

    monkeypatch.setattr(certificates, "_configured_bundle", None)
    monkeypatch.setenv("OPENHARNESS_DATA_DIR", str(data_dir))
    for key in certificates._PYTHON_CA_ENV_VARS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.delenv("NODE_EXTRA_CA_CERTS", raising=False)
    monkeypatch.delenv("npm_config_cafile", raising=False)
    monkeypatch.setattr(certificates, "_certifi_ca_bundle", lambda: str(base_ca))

    result = certificates._configure_certificate(posco_cert)

    bundle_path = data_dir / "certs" / "posco-ca-bundle.pem"
    assert result == str(bundle_path)
    assert bundle_path.read_text(encoding="utf-8") == "BASE CERT\n\nPOSCO CERT\n"
    for key in certificates._PYTHON_CA_ENV_VARS:
        assert certificates.os.environ[key] == str(bundle_path)
    assert certificates.os.environ["NODE_EXTRA_CA_CERTS"] == str(posco_cert)
    assert certificates.os.environ["npm_config_cafile"] == str(posco_cert)


def test_httpx_verify_argument_uses_configured_ca_bundle(monkeypatch, tmp_path: Path) -> None:
    bundle = tmp_path / "bundle.pem"
    bundle.write_text("CERT\n", encoding="utf-8")
    monkeypatch.setattr(certificates, "_configured_bundle", str(bundle))

    assert certificates.httpx_verify_argument() == str(bundle)
