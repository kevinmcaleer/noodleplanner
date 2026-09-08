/**
 * collab-crypto.js -- end-to-end encryption for collab-session traffic
 * over the #963 WebSocket relay (#964, part of the #766 epic).
 *
 * The relay (app.py / collab_session.py) forwards every message byte-for-
 * byte between host and joiner without ever parsing or storing it -- see
 * collab_session.py's module docstring. This module is what makes that
 * safe: it turns the six-digit join code + session id into a real
 * per-session symmetric key via an authenticated ephemeral ECDH exchange,
 * and encrypts/decrypts every application payload with it. The relay only
 * ever sees the ciphertext envelopes this module produces (plus the two
 * public-key handshake announcements, which are not secret -- see below).
 *
 * Uses ONLY the browser's native Web Crypto API (`crypto.subtle`) -- no
 * hand-rolled cryptographic primitives, no dependency. Node's built-in
 * `node:crypto` webcrypto implementation exposes the same `crypto.subtle`
 * surface, which is what lets tests/test_collab_crypto.mjs exercise this
 * exact file with `node --test` instead of a browser.
 *
 * ---------------------------------------------------------------------
 * DESIGN, PARAMETERS AND WIRE FORMAT (read this before touching the file)
 * ---------------------------------------------------------------------
 *
 * 1. Why the six-digit code is never the encryption key
 *    A six-digit code is ~1,000,000 possibilities -- trivially brute-
 *    forceable offline against captured ciphertext if used directly as a
 *    key. Instead it only ever does two things: (a) it is stretched
 *    through PBKDF2 into a "connect key" used to *authenticate* the key
 *    exchange (see step 3), and (b) the relay itself independently checks
 *    it server-side to admit a joiner's WebSocket at all (unchanged from
 *    #963). It is never used as, or to derive without an ECDH step, the
 *    key that encrypts plan content.
 *
 * 2. KDF: PBKDF2-HMAC-SHA256, 600,000 iterations
 *    `deriveConnectKey(code, sessionId)` runs PBKDF2-HMAC-SHA256 over the
 *    UTF-8 code with iterations = KDF_ITERATIONS = 600,000 -- OWASP's
 *    current (2023+) Password Storage Cheat Sheet minimum recommendation
 *    for PBKDF2-HMAC-SHA256, chosen as a concrete, citable anchor rather
 *    than a guessed number. Salt = the UTF-8 bytes of the session id.
 *    Session ids are generated server-side with `secrets.token_urlsafe(32)`
 *    (256 bits of CSPRNG entropy, see collab_session.py) and are already
 *    unique and unguessable per session, so reusing the session id as the
 *    PBKDF2 salt needs no extra salt generation, storage, or transmission
 *    -- both sides already know it (it's in the joiner's URL / the host's
 *    /api/collab/start response) before the handshake begins. The 256-bit
 *    output is imported as a non-extractable HMAC-SHA256 key -- this
 *    "connect key" authenticates the handshake (step 3); it is never used
 *    to encrypt plan content directly.
 *
 * 3. Key exchange: ephemeral ECDH on P-256, authenticated by the connect key
 *    Each side calls `generateEphemeralKeyPair()` (ECDH, NIST P-256 /
 *    secp256r1 -- chosen over X25519 for the widest, most uniform
 *    `crypto.subtle` support across current browsers) once per session.
 *    Each side then announces its *public* key to the other as a small
 *    JSON message: `{"type": "host_pubkey"|"joiner_pubkey", "key":
 *    <base64 raw EC point>, "mac": <base64 HMAC-SHA256(connectKey, key)>}`
 *    -- see `buildPubkeyAnnouncement` / `parsePubkeyAnnouncement`. The
 *    `mac` is computed with the PBKDF2-derived connect key: this is the
 *    "PBKDF2-derived value authenticates the handshake" piece from the
 *    design brief. Public EC keys are not secret, so the announcement is
 *    authenticated (MAC'd), not encrypted -- confidentiality against a
 *    purely passive relay/network eavesdropper is already guaranteed by
 *    ECDH itself (nobody's private key ever leaves this module, let alone
 *    crosses the relay). What the MAC actually buys is protection against
 *    an *active* attacker (e.g. a compromised or malicious relay) trying
 *    to substitute their own ephemeral public key into the exchange
 *    (a MITM): without the real code they cannot produce a MAC the other
 *    side's `parsePubkeyAnnouncement` will accept, so the handshake is
 *    rejected and no session key is ever derived with the impostor. This
 *    is exactly what tests/test_collab_crypto.mjs's wrong-code test
 *    demonstrates.
 *
 *    Once both public keys are verified, `deriveSessionKey(privateKey,
 *    peerPublicKeyRawBase64, sessionId)` computes the raw ECDH shared
 *    secret (`crypto.subtle.deriveBits`) and immediately runs it through
 *    HKDF-SHA256 (`crypto.subtle.deriveKey` with algorithm "HKDF") --
 *    salt = the session id (again, already unique/unguessable, no extra
 *    plumbing needed), info = the fixed context string HKDF_INFO below,
 *    for domain separation from any other use of this scheme -- to
 *    produce the actual AES-256-GCM key used for message content. The
 *    raw ECDH output is never used directly as a cipher key.
 *
 * 4. AEAD: AES-256-GCM, a fresh random 96-bit nonce per message
 *    `encryptMessage(sessionKey, plaintext, sessionId)` draws a brand new
 *    random 12-byte (96-bit) nonce with `crypto.getRandomValues` for
 *    *every single message* and never reuses one -- nonce reuse is the
 *    classic, catastrophic AES-GCM mistake (it breaks both
 *    confidentiality and the authentication tag), so this is called out
 *    explicitly, not left implicit. The session id is passed as GCM
 *    additional authenticated data (AAD): not secret, but binds each
 *    ciphertext to the session it was encrypted for so a captured
 *    envelope can't be silently replayed into a different session.
 *
 *    Wire format (what actually crosses the relay for content messages):
 *      { "type": "enc", "iv": "<base64, 12 bytes>", "ct": "<base64>" }
 *    `ct` is exactly what `crypto.subtle.encrypt` returns -- ciphertext
 *    with the 16-byte GCM authentication tag appended, per the Web Crypto
 *    spec. `decryptMessage` is the exact inverse and throws if the tag
 *    doesn't verify (wrong key, wrong AAD, or tampered ciphertext).
 *
 * 5. Scope note (documented, not hidden): the current #963 relay has no
 *    sender-id envelope on joiner -> host messages (a joiner's message is
 *    just forwarded to "the host", with no tag saying which joiner sent
 *    it), so this module derives one host<->joiner session key per pair
 *    but callers (collab-session.js / collab_join.html) only track a
 *    single active peer key at a time. Multi-joiner fan-out with distinct
 *    per-joiner keys is real future work for #966/#967, not this issue --
 *    see this issue's own scope note about keeping "what does a
 *    plan-editing message look like" out of scope.
 */

export const KDF_ITERATIONS = 600_000;
export const ECDH_CURVE = 'P-256';
export const AES_KEY_LENGTH = 256;
export const GCM_IV_BYTES = 12; // 96 bits -- the standard/recommended AES-GCM nonce size
export const HKDF_INFO = 'noodleplanner-collab-session-key-v1';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function fromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/**
 * Stretch the six-digit join code into a 256-bit "connect key" (a
 * non-extractable HMAC-SHA256 CryptoKey) via PBKDF2-HMAC-SHA256. See the
 * module docstring (point 2) for the iteration count and salt rationale.
 * This key authenticates the ECDH handshake; it is never the content key.
 */
export async function deriveConnectKey(code, sessionId) {
    const codeKeyMaterial = await crypto.subtle.importKey(
        'raw', textEncoder.encode(code), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            hash: 'SHA-256',
            salt: textEncoder.encode(sessionId),
            iterations: KDF_ITERATIONS,
        },
        codeKeyMaterial,
        256
    );
    return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/**
 * A fresh ephemeral ECDH keypair (P-256), one per session per side.
 * `extractable: true` is required by Web Crypto so the *public* key can be
 * exported and sent to the peer -- this module never calls `exportKey` on
 * the private half, so the private key itself is never serialized or
 * leaves this module.
 */
export async function generateEphemeralKeyPair() {
    return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: ECDH_CURVE }, true, ['deriveBits']);
}

/** Export an ECDH public key as the base64 of its raw (uncompressed point) encoding. */
export async function exportPublicKeyRaw(publicKey) {
    const raw = await crypto.subtle.exportKey('raw', publicKey);
    return toBase64(raw);
}

/** Import a peer's raw (base64) ECDH public key back into a usable CryptoKey. */
export async function importPeerPublicKey(rawBase64) {
    return crypto.subtle.importKey(
        'raw', fromBase64(rawBase64), { name: 'ECDH', namedCurve: ECDH_CURVE }, true, []
    );
}

/** HMAC-SHA256(connectKey, message) -> base64. Authenticates a handshake announcement. */
export async function signHandshake(connectKey, message) {
    const sig = await crypto.subtle.sign('HMAC', connectKey, textEncoder.encode(message));
    return toBase64(sig);
}

/** Constant-time-verified HMAC check. Never throws -- returns false on any failure. */
export async function verifyHandshake(connectKey, message, macBase64) {
    try {
        return await crypto.subtle.verify('HMAC', connectKey, fromBase64(macBase64), textEncoder.encode(message));
    } catch {
        return false;
    }
}

/**
 * Build the `{"type": "host_pubkey"|"joiner_pubkey", "key", "mac"}`
 * announcement one side sends to publish its ephemeral ECDH public key,
 * authenticated with the PBKDF2-derived connect key.
 */
export async function buildPubkeyAnnouncement(type, connectKey, keyPair) {
    const key = await exportPublicKeyRaw(keyPair.publicKey);
    const mac = await signHandshake(connectKey, key);
    return JSON.stringify({ type, key, mac });
}

/**
 * Parse and verify a peer's pubkey announcement. Returns the verified
 * base64 raw public key on success, or `null` if the message is
 * malformed, the wrong `type`, or -- critically -- the MAC doesn't verify
 * (which is exactly what happens if the peer used the wrong six-digit
 * code: their connect key differs, so their MAC won't match ours).
 */
export async function parsePubkeyAnnouncement(expectedType, connectKey, jsonText) {
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        return null;
    }
    if (!parsed || parsed.type !== expectedType || typeof parsed.key !== 'string' || typeof parsed.mac !== 'string') {
        return null;
    }
    const ok = await verifyHandshake(connectKey, parsed.key, parsed.mac);
    return ok ? parsed.key : null;
}

/**
 * Derive the actual AES-256-GCM session key from our ECDH private key and
 * the peer's (already-verified) raw public key: ECDH -> HKDF-SHA256
 * (salt = session id, info = HKDF_INFO) -> AES-GCM key. See module
 * docstring point 3.
 */
export async function deriveSessionKey(privateKey, peerPublicKeyRawBase64, sessionId) {
    const peerPublicKey = await importPeerPublicKey(peerPublicKeyRawBase64);
    const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerPublicKey }, privateKey, 256);
    const hkdfKeyMaterial = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: textEncoder.encode(sessionId),
            info: textEncoder.encode(HKDF_INFO),
        },
        hkdfKeyMaterial,
        { name: 'AES-GCM', length: AES_KEY_LENGTH },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypt `plaintext` with AES-256-GCM under `sessionKey`, using a fresh
 * random 96-bit nonce (never reused -- see module docstring point 4) and
 * the session id as additional authenticated data. Returns the JSON wire
 * envelope string to send over the WebSocket.
 */
export async function encryptMessage(sessionKey, plaintext, sessionId) {
    const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
    const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: textEncoder.encode(sessionId) },
        sessionKey,
        textEncoder.encode(plaintext)
    );
    return JSON.stringify({ type: 'enc', iv: toBase64(iv), ct: toBase64(ct) });
}

/**
 * Inverse of `encryptMessage`. Throws (via `crypto.subtle.decrypt`) if the
 * GCM authentication tag doesn't verify -- wrong key, wrong session id, or
 * a tampered/corrupted envelope.
 */
export async function decryptMessage(sessionKey, envelopeJsonText, sessionId) {
    const envelope = JSON.parse(envelopeJsonText);
    if (!envelope || envelope.type !== 'enc' || typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string') {
        throw new Error('not a recognizable encrypted envelope');
    }
    const iv = fromBase64(envelope.iv);
    const ct = fromBase64(envelope.ct);
    const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: textEncoder.encode(sessionId) },
        sessionKey,
        ct
    );
    return textDecoder.decode(pt);
}
