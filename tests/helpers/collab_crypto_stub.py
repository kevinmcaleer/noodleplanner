"""Python stand-in for the browser-side crypto in
packages/noodle-web/src/noodle_web/static/collab-crypto.js (#964).

Used ONLY to drive the "client" side of
tests/test_collab_encryption.py's server-side relay-opacity test, via the
FastAPI TestClient -- which is a Python HTTP/WebSocket client, not a
browser, so it cannot run the real collab-crypto.js. Real users' browsers
never execute this file; production encryption/decryption for actual
collab sessions runs entirely client-side via the native Web Crypto API
(`crypto.subtle`) -- see collab-crypto.js's module docstring for the full
design writeup. tests/test_collab_crypto.mjs is the genuine proof that the
real JS implementation works and interoperates; this module exists so the
Python-side relay test isn't limited to asserting things about a scheme it
never actually exercises.

Mirrors collab-crypto.js parameter-for-parameter:

- KDF: PBKDF2-HMAC-SHA256, 600,000 iterations, salt = UTF-8 session id.
- Key exchange: ephemeral ECDH on NIST P-256 (secp256r1), public keys
  exchanged as raw (uncompressed point) bytes, each announcement
  authenticated with an HMAC-SHA256 tag keyed by the PBKDF2 output.
- Session key: ECDH shared secret -> HKDF-SHA256 (salt = session id,
  info = HKDF_INFO) -> 256-bit AES-GCM key.
- AEAD: AES-256-GCM, a fresh random 96-bit nonce per message, additional
  authenticated data = UTF-8 session id.
- Wire format: JSON envelope ``{"type": "enc", "iv": <base64>, "ct": <base64>}``.

Uses only the audited `cryptography` library's primitives -- no hand-rolled
crypto here either.
"""

from __future__ import annotations

import base64
import hashlib
import hmac as hmac_mod
import json
import os
from dataclasses import dataclass

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

KDF_ITERATIONS = 600_000
HKDF_INFO = b"noodleplanner-collab-session-key-v1"
GCM_NONCE_BYTES = 12


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.b64decode(text)


def derive_connect_key(code: str, session_id: str) -> bytes:
    """PBKDF2-HMAC-SHA256(code, salt=session_id, 600_000 iterations) -> 32 bytes."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=session_id.encode("utf-8"),
        iterations=KDF_ITERATIONS,
    )
    return kdf.derive(code.encode("utf-8"))


def sign_handshake(connect_key: bytes, message: str) -> str:
    mac = hmac_mod.new(connect_key, message.encode("utf-8"), hashlib.sha256).digest()
    return _b64(mac)


def verify_handshake(connect_key: bytes, message: str, mac_b64: str) -> bool:
    expected = hmac_mod.new(connect_key, message.encode("utf-8"), hashlib.sha256).digest()
    try:
        given = _unb64(mac_b64)
    except Exception:
        return False
    return hmac_mod.compare_digest(expected, given)


@dataclass
class Party:
    """One side (host or joiner) of a simulated encrypted session."""

    private_key: ec.EllipticCurvePrivateKey
    connect_key: bytes

    @classmethod
    def create(cls, code: str, session_id: str) -> "Party":
        return cls(
            private_key=ec.generate_private_key(ec.SECP256R1()),
            connect_key=derive_connect_key(code, session_id),
        )

    def public_key_raw_b64(self) -> str:
        raw = self.private_key.public_key().public_bytes(
            encoding=serialization.Encoding.X962,
            format=serialization.PublicFormat.UncompressedPoint,
        )
        return _b64(raw)

    def build_announcement(self, msg_type: str) -> str:
        """Build the {"type", "key", "mac"} handshake announcement."""
        key_b64 = self.public_key_raw_b64()
        mac = sign_handshake(self.connect_key, key_b64)
        return json.dumps({"type": msg_type, "key": key_b64, "mac": mac})

    def parse_announcement(self, expected_type: str, text: str) -> str | None:
        """Verify a peer's announcement; return their raw pubkey b64, or None."""
        try:
            parsed = json.loads(text)
        except (TypeError, ValueError):
            return None
        if not isinstance(parsed, dict) or parsed.get("type") != expected_type:
            return None
        key_b64, mac = parsed.get("key"), parsed.get("mac")
        if not isinstance(key_b64, str) or not isinstance(mac, str):
            return None
        if not verify_handshake(self.connect_key, key_b64, mac):
            return None
        return key_b64

    def derive_session_key(self, peer_public_key_b64: str, session_id: str) -> bytes:
        peer_raw = _unb64(peer_public_key_b64)
        peer_public_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), peer_raw)
        shared_secret = self.private_key.exchange(ec.ECDH(), peer_public_key)
        hkdf = HKDF(algorithm=hashes.SHA256(), length=32, salt=session_id.encode("utf-8"), info=HKDF_INFO)
        return hkdf.derive(shared_secret)


def encrypt_message(session_key: bytes, plaintext: str, session_id: str) -> str:
    nonce = os.urandom(GCM_NONCE_BYTES)
    ciphertext = AESGCM(session_key).encrypt(nonce, plaintext.encode("utf-8"), session_id.encode("utf-8"))
    return json.dumps({"type": "enc", "iv": _b64(nonce), "ct": _b64(ciphertext)})


def decrypt_message(session_key: bytes, envelope_text: str, session_id: str) -> str:
    envelope = json.loads(envelope_text)
    if not isinstance(envelope, dict) or envelope.get("type") != "enc":
        raise ValueError("not a recognizable encrypted envelope")
    nonce = _unb64(envelope["iv"])
    ciphertext = _unb64(envelope["ct"])
    plaintext = AESGCM(session_key).decrypt(nonce, ciphertext, session_id.encode("utf-8"))
    return plaintext.decode("utf-8")
