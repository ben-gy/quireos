#!/usr/bin/env python3
"""Generate x509_crt_bundle.bin, the CA bundle WiFiClientSecure::setCACertBundle() expects.

Format (esp_crt_bundle.c in arduino-esp32 2.0.x, same as ESP-IDF 4.4's gen_crt_bundle.py output):
    u16 count
    per certificate, sorted by subject DER (the verifier binary-searches on it):
        u16 name_len, u16 key_len, subject Name DER, SubjectPublicKeyInfo DER

Usage:  uv run --with certifi --with cryptography python3 gen_crt_bundle.py [cacert.pem] [out.bin]
        (no input given: certifi's copy of the Mozilla CA bundle)
"""
import struct
import sys

from cryptography import x509
from cryptography.hazmat.primitives import serialization

BEGIN = b"-----BEGIN CERTIFICATE-----"
END = b"-----END CERTIFICATE-----"


def load_pems(path):
    data = open(path, "rb").read()
    certs = []
    for block in data.split(END):
        i = block.find(BEGIN)
        if i < 0:
            continue
        try:
            certs.append(x509.load_pem_x509_certificate(block[i:] + END + b"\n"))
        except Exception as e:  # noqa: BLE001
            print("skipped one certificate:", e, file=sys.stderr)
    return certs


def main():
    src = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != "-" else None
    out = sys.argv[2] if len(sys.argv) > 2 else "x509_crt_bundle.bin"
    origin = src
    if src is None:
        import certifi
        src = certifi.where()
        origin = f"certifi {getattr(certifi, '__version__', '?')} ({src})"
    entries = []
    for c in load_pems(src):
        name = c.subject.public_bytes()
        key = c.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        entries.append((name, key))
    entries.sort(key=lambda e: e[0])
    blob = struct.pack(">H", len(entries))
    for name, key in entries:
        blob += struct.pack(">HH", len(name), len(key)) + name + key
    with open(out, "wb") as f:
        f.write(blob)
    print(f"{len(entries)} certificates, {len(blob)} bytes -> {out}\nsource: {origin}")


if __name__ == "__main__":
    main()
