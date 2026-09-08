/**
 * collab-crypto.js -- end-to-end encryption for collab-session traffic
 * over the #963 WebSocket relay (#964, part of the #766 epic).
 *
 * The relay (app.py / collab_session.py) forwards every message byte-for-
 * byte between host and joiner without ever parsing or storing it -- see
 * collab_session.py's module docstring. This module is what makes that
 * safe: it turns a per-session secret + session id into a real per-session
 * symmetric key via an authenticated ephemeral ECDH exchange, and
 * encrypts/decrypts every application payload with it. The relay only ever
 * sees the ciphertext envelopes this module produces (plus the two
 * public-key handshake announcements, which are not secret -- see below).
 *
 * TWO SEPARATE SECRETS, ON PURPOSE (post-security-review design -- read
 * this before touching anything below): the six-digit `join_code` the PM
 * reads out loud and `handshake_secret` (a 256-bit secret from
 * collab_session.py, delivered only via the `#k=...` URL fragment of the
 * holding link -- see collab_session.py's module docstring) are NOT the
 * same thing and must never be conflated again. `join_code` is checked by
 * the *relay itself* to admit a joiner's WebSocket (unchanged from #963) --
 * which means the relay legitimately learns it, so it can never be what
 * authenticates this module's ECDH handshake: an earlier version of this
 * file used `join_code` for that, and a security review found the relay
 * could therefore recompute the same connect key itself and transparently
 * MITM the "encrypted" channel (establish separate session keys with the
 * host and the joiner, decrypting and re-forwarding everything). URL
 * fragments are never sent to a server in any HTTP request (browser
 * behaviour, not something either party has to enforce), which is what
 * makes `handshake_secret` different: the relay never sees it on any
 * request, so it cannot forge a valid handshake announcement. `join_code`
 * now plays no cryptographic role at all -- see `deriveConnectKey` below.
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
 * 1. Why neither secret is ever the encryption key directly
 *    `join_code` (~1,000,000 possibilities) would be trivially brute-
 *    forceable offline against captured ciphertext if used directly as a
 *    key -- and, as explained above, it's also relay-visible, so it's
 *    excluded from the crypto entirely. `handshake_secret` (256 bits,
 *    fragment-only) is high-entropy and relay-invisible, but it still
 *    isn't used to encrypt content directly: it is stretched through
 *    PBKDF2 into a "connect key" used only to *authenticate* the ECDH
 *    exchange (see step 3). The actual content-encryption key comes out of
 *    that ECDH exchange (step 3's `deriveSessionKey`), not out of PBKDF2.
 *
 * 2. KDF: PBKDF2-HMAC-SHA256, 600,000 iterations
 *    `deriveConnectKey(handshakeSecret, sessionId)` runs PBKDF2-HMAC-SHA256
 *    over the UTF-8 `handshakeSecret` with iterations = KDF_ITERATIONS =
 *    600,000 -- OWASP's current (2023+) Password Storage Cheat Sheet
 *    minimum recommendation for PBKDF2-HMAC-SHA256, chosen as a concrete,
 *    citable anchor rather than a guessed number. (`handshakeSecret` is
 *    already 256 bits of CSPRNG entropy on its own -- unlike a real
 *    low-entropy password, it doesn't strictly *need* PBKDF2's brute-force
 *    resistance -- but running it through the same KDF costs nothing and
 *    keeps this function's shape uniform regardless of what's fed into it.)
 *    Salt = the UTF-8 bytes of the session id. Session ids are generated
 *    server-side with `secrets.token_urlsafe(32)` (256 bits of CSPRNG
 *    entropy, see collab_session.py) and are already unique and
 *    unguessable per session, so reusing the session id as the PBKDF2 salt
 *    needs no extra salt generation, storage, or transmission -- both
 *    sides already know it before the handshake begins. The 256-bit output
 *    is imported as a non-extractable HMAC-SHA256 key -- this "connect
 *    key" authenticates the handshake (step 3); it is never used to
 *    encrypt plan content directly.
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
 *    "a separate value authenticates the handshake" piece from the design
 *    brief. Public EC keys are not secret, so the announcement is
 *    authenticated (MAC'd), not encrypted -- confidentiality against a
 *    purely passive relay/network eavesdropper is already guaranteed by
 *    ECDH itself (nobody's private key ever leaves this module, let alone
 *    crosses the relay). What the MAC actually buys is protection against
 *    an *active* attacker trying to substitute their own ephemeral public
 *    key into the exchange (a MITM) -- critically, including the relay
 *    itself, which is exactly the attacker a MITM-resistant design here
 *    has to cover, since the relay is the one party that sees every frame
 *    of every session: without `handshake_secret` (which never crosses the
 *    relay -- see the top of this file) an attacker cannot produce a MAC
 *    the other side's `parsePubkeyAnnouncement` will accept, so the
 *    handshake is rejected and no session key is ever derived with the
 *    impostor. This is exactly what tests/test_collab_crypto.mjs's
 *    wrong-secret test demonstrates, and what
 *    tests/test_collab_encryption.py's
 *    `test_relay_who_knows_join_code_and_session_id_cannot_forge_handshake`
 *    proves specifically for a party who has everything the relay has
 *    (`join_code` + `session_id`) but not `handshake_secret`.
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
 *    per-joiner keys is real future work for #967, not this issue --
 *    see this issue's own scope note about keeping "what does a
 *    plan-editing message look like" out of scope. #966's presence panel
 *    doesn't need this: the server tracks per-joiner identity itself (see
 *    collab_session.py's `Joiner`/`SessionState.presence_snapshot()`) and
 *    tells the host directly via `{"type": "presence", ...}` -- it never
 *    has to be inferred from this module's encrypted channel.
 *
 * 6. Callers must never display an unrecognized frame as peer content
 *    (post-security-review requirement). This module's own functions
 *    already refuse to do anything unsafe with a malformed/unrecognized
 *    message (`parsePubkeyAnnouncement` and `decryptMessage` both reject
 *    anything that isn't exactly their expected shape), but a security
 *    review found that the *callers* (collab-session.js's
 *    `handleCollabMessage`, collab_join.html's socket `message` handler)
 *    fell through, for any frame they didn't recognize, to logging it
 *    verbatim with the same "peer said this" log format used for genuinely
 *    decrypted content -- letting anyone who can write a frame into the
 *    socket (trivially, the relay itself) inject fake "peer" messages with
 *    zero decryption or authentication. Both callers now drop/ignore any
 *    frame that isn't a known, explicitly-handled envelope type instead of
 *    ever rendering it as if it came from the authenticated peer -- both
 *    now go through `classifyFrameType` (below) to make that decision,
 *    rather than each ad hoc re-checking `JSON.parse(...).type` themselves.
 *    tests/test_collab_crypto.mjs exercises `classifyFrameType` directly.
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
 * Stretch `handshakeSecret` into a 256-bit "connect key" (a
 * non-extractable HMAC-SHA256 CryptoKey) via PBKDF2-HMAC-SHA256. See the
 * module docstring (point 2) for the iteration count and salt rationale.
 * This key authenticates the ECDH handshake; it is never the content key.
 *
 * `handshakeSecret` MUST be the fragment-only secret from
 * collab_session.py's `SessionInfo.handshake_secret` (delivered via the
 * `#k=...` URL fragment) -- NEVER `join_code` (the six-digit code). See
 * the top of this file's module docstring for why: `join_code` is
 * legitimately visible to the relay (it has to be, for admission), so
 * using it here would let the relay forge this exact handshake.
 */
export async function deriveConnectKey(handshakeSecret, sessionId) {
    const secretKeyMaterial = await crypto.subtle.importKey(
        'raw', textEncoder.encode(handshakeSecret), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            hash: 'SHA-256',
            salt: textEncoder.encode(sessionId),
            iterations: KDF_ITERATIONS,
        },
        secretKeyMaterial,
        256
    );
    return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/**
 * A fresh ephemeral ECDH keypair (P-256), one per session per side.
 * `extractable: false`: per the Web Crypto spec, EC key-pair generation
 * always produces a public key with `extractable: true` regardless of this
 * flag (public keys aren't sensitive), so `exportPublicKeyRaw` below still
 * works -- only the *private* key's extractability is controlled by this
 * argument, and there is never a reason for this module to export a
 * private key, so it's locked down.
 */
export async function generateEphemeralKeyPair() {
    return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: ECDH_CURVE }, false, ['deriveBits']);
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

// The only frame `type`s this scheme (plus #966's presence panel) ever
// produces. Anything else -- including a well-formed-but-wrong-role frame,
// e.g. a "host_pubkey" arriving at the host itself -- is not one of these
// and must never be treated as content. See `classifyFrameType` below.
//
// 'presence' (#966) is the one entry here that isn't part of #964's
// encrypted-content scheme -- it's a plaintext control message the server
// itself sends directly to the host (see app.py's `_broadcast_presence`),
// never encrypted and never sent to joiners. It still has to be listed
// here: classifyFrameType is the single gate collab-session.js's
// handleCollabMessage uses to decide a frame's type at all, so an
// unlisted 'presence' would be silently dropped as 'unrecognized' before
// ever reaching the presence-panel handling below.
const KNOWN_FRAME_TYPES = new Set(['host_pubkey', 'joiner_pubkey', 'enc', 'presence']);

/**
 * Classify a raw WebSocket frame's `type` discriminator. Returns one of
 * `KNOWN_FRAME_TYPES`'s members, or `'unrecognized'` for anything else
 * (unparseable JSON, not an object, no recognizable `type`, or a `type`
 * this scheme doesn't produce). This is the single gate both
 * collab-session.js and collab_join.html use to decide whether a frame is
 * ever eligible to be treated as content -- the fix for a security-review
 * finding (spoofed/injected frames used to fall through to being displayed
 * verbatim with the same UI treatment as genuinely decrypted peer
 * content). Callers must still separately verify a MAC or decrypt the
 * frame before trusting it -- this function only rules out frames that
 * couldn't possibly be genuine, it doesn't authenticate the ones that
 * could be.
 */
export function classifyFrameType(rawText) {
    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        return 'unrecognized';
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'unrecognized';
    return KNOWN_FRAME_TYPES.has(parsed.type) ? parsed.type : 'unrecognized';
}

/**
 * Parse and verify a peer's pubkey announcement. Returns the verified
 * base64 raw public key on success, or `null` if the message is
 * malformed, the wrong `type`, or -- critically -- the MAC doesn't verify
 * (which is exactly what happens if the sender used the wrong
 * `handshake_secret` -- including an attacker, such as the relay itself,
 * who only has `join_code` and forges a message using that instead: their
 * connect key differs, so their MAC won't match ours).
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
