"""Build the Python CA bundle used on POSCO-managed Windows machines."""

from __future__ import annotations

import argparse
import os
import ssl
from pathlib import Path


DEFAULT_POSCO_CERT = Path("C:/POSCO_CA.crt")
BUNDLE_RELATIVE_PATH = Path("certs/posco-ca-bundle.pem")
OPENSSL_CIPHER_STRING = "DEFAULT@SECLEVEL=1"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--posco-cert", type=Path, default=DEFAULT_POSCO_CERT)
    parser.add_argument("--bundle", type=Path, default=None)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    cert_path = args.posco_cert.expanduser()
    bundle_path = args.bundle.expanduser() if args.bundle else repo_root / BUNDLE_RELATIVE_PATH

    if not cert_path.is_file():
        print(f"[INFO] POSCO certificate not found: {cert_path}")
        return 0

    base_ca = _base_ca_bundle_path(bundle_path, cert_path)
    if base_ca is None:
        print("[ERROR] Could not find certifi or a system CA bundle.")
        return 1

    bundle_path.parent.mkdir(parents=True, exist_ok=True)
    parts = [base_ca.read_bytes().rstrip(), cert_path.read_bytes().rstrip()]
    temp_path = bundle_path.with_suffix(bundle_path.suffix + ".tmp")
    temp_path.write_bytes(b"\n\n".join(part for part in parts if part) + b"\n")
    os.replace(temp_path, bundle_path)

    context = ssl.create_default_context()
    _lower_openssl_security_level(context)
    if hasattr(ssl, "VERIFY_X509_STRICT"):
        context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    context.load_verify_locations(cafile=str(bundle_path))

    print(f"[INFO] certifi/system CA: {base_ca}")
    print(f"[INFO] POSCO CA: {cert_path}")
    print(f"[INFO] Python CA bundle: {bundle_path}")
    print(f"[INFO] OpenSSL: {ssl.OPENSSL_VERSION}")
    return 0


def _base_ca_bundle_path(bundle_path: Path, cert_path: Path) -> Path | None:
    candidates = (_certifi_ca_bundle(), ssl.get_default_verify_paths().cafile)
    ignored = {_safe_resolve(bundle_path), _safe_resolve(cert_path)}
    for value in candidates:
        if not value:
            continue
        candidate = Path(value).expanduser()
        if _safe_resolve(candidate) in ignored:
            continue
        if candidate.is_file():
            return candidate
    return None


def _certifi_ca_bundle() -> str | None:
    try:
        import certifi
    except ImportError:
        try:
            from pip._vendor import certifi  # type: ignore[import-not-found]
        except ImportError:
            return None
    return certifi.where()


def _lower_openssl_security_level(context: ssl.SSLContext) -> None:
    try:
        context.set_ciphers(OPENSSL_CIPHER_STRING)
    except ssl.SSLError:
        pass


def _safe_resolve(path: Path) -> Path:
    try:
        return path.resolve()
    except OSError:
        return path


if __name__ == "__main__":
    raise SystemExit(main())
