"""Corporate certificate bundle support."""

from __future__ import annotations

import logging
import os
import ssl
from pathlib import Path

from myharness.config.paths import get_data_dir
from myharness.utils.fs import atomic_write_bytes

log = logging.getLogger(__name__)

POSCO_CERT_FILE = Path("C:/POSCO_CA.crt")
_BUNDLE_FILE_NAME = "posco-ca-bundle.pem"
_PYTHON_CA_ENV_VARS = ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "PIP_CERT")
_NODE_CA_ENV_VAR = "NODE_EXTRA_CA_CERTS"
_NPM_CA_ENV_VAR = "npm_config_cafile"
_OPENSSL_CIPHER_STRING = "DEFAULT@SECLEVEL=1"
_configured_bundle: str | None = None


def configure_posco_certificate() -> str | None:
    """Configure process-wide CA bundle settings when C:/POSCO_CA.crt exists."""
    return _configure_certificate(POSCO_CERT_FILE)


def httpx_verify_argument() -> bool | str | ssl.SSLContext:
    """Return the verify value to use for httpx clients that ignore env vars."""
    if _configured_bundle:
        return ssl_context_for_bundle(_configured_bundle)
    bundle = configure_posco_certificate()
    return ssl_context_for_bundle(bundle) if bundle else True


def _configure_certificate(cert_path: Path) -> str | None:
    global _configured_bundle

    cert_path = cert_path.expanduser()
    if not cert_path.is_file():
        return None

    bundle_path = _write_combined_bundle(cert_path)
    bundle = str(bundle_path)
    cert = str(cert_path)

    for key in _PYTHON_CA_ENV_VARS:
        os.environ[key] = bundle
    os.environ.setdefault(_NODE_CA_ENV_VAR, cert)
    os.environ.setdefault(_NPM_CA_ENV_VAR, cert)

    log.info("Using POSCO certificate bundle: %s", bundle)
    _configured_bundle = bundle
    return bundle


def ssl_context_for_bundle(bundle_path: str | os.PathLike[str]) -> ssl.SSLContext:
    """Create an SSL context for POSCO's CA bundle without OpenSSL strict mode."""
    context = ssl.create_default_context()
    _lower_openssl_security_level(context)
    if hasattr(ssl, "VERIFY_X509_STRICT"):
        context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    context.load_verify_locations(cafile=str(bundle_path))
    return context


def _lower_openssl_security_level(context: ssl.SSLContext) -> None:
    try:
        context.set_ciphers(_OPENSSL_CIPHER_STRING)
    except ssl.SSLError as exc:
        log.debug("Could not lower OpenSSL security level for POSCO certificate support: %s", exc)


def _write_combined_bundle(cert_path: Path) -> Path:
    bundle_path = get_data_dir() / "certs" / _BUNDLE_FILE_NAME
    parts = []
    base_path = _base_ca_bundle_path(bundle_path, cert_path)
    if base_path is not None:
        parts.append(base_path.read_bytes().rstrip())
    parts.append(cert_path.read_bytes().rstrip())
    atomic_write_bytes(bundle_path, b"\n\n".join(part for part in parts if part) + b"\n")
    return bundle_path


def _base_ca_bundle_path(bundle_path: Path, cert_path: Path) -> Path | None:
    for value in (os.environ.get("SSL_CERT_FILE"), _certifi_ca_bundle(), ssl.get_default_verify_paths().cafile):
        if not value:
            continue
        candidate = Path(value).expanduser()
        try:
            resolved = candidate.resolve()
        except OSError:
            resolved = candidate
        if resolved in {bundle_path.resolve(), cert_path.resolve()}:
            continue
        if candidate.is_file():
            return candidate
    return None


def _certifi_ca_bundle() -> str | None:
    try:
        import certifi
    except ImportError:
        return None
    return certifi.where()
