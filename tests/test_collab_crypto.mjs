/**
 * Browser-side proof for #964: exercises the actual functions in
 * static/collab-crypto.js directly (no browser needed -- Node's built-in
 * `node:crypto` webcrypto implementation exposes the same `crypto.subtle`
 * surface real browsers do, which is exactly why collab-crypto.js only
 * uses that standard API).
 *
 * Two simulated parties derive the same session key from the same code +
 * session id, encrypt a message on one side and decrypt it correctly on
 * the other, and -- the critical negative test -- a wrong code fails to
 * authenticate the handshake at all, so no session key is ever derived
 * with the mismatched party.
 *
 * See tests/test_collab_encryption.py for the server-side proof that the
 * relay only ever sees the ciphertext this module produces (driven there
 * by a Python port of this same scheme, since that test exercises the
 * FastAPI TestClient rather than a browser).
 *
 * Run with: node --test tests/test_collab_crypto.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    KDF_ITERATIONS,
    deriveConnectKey,
    generateEphemeralKeyPair,
    buildPubkeyAnnouncement,
    parsePubkeyAnnouncement,
    deriveSessionKey,
    encryptMessage,
    decryptMessage,
} from '../packages/noodle-web/src/noodle_web/static/collab-crypto.js';

test('KDF_ITERATIONS matches the documented OWASP-anchored parameter', () => {
    assert.equal(KDF_ITERATIONS, 600_000);
});

test('two parties with the same code + session id derive the same session key and round-trip a message', async () => {
    const sessionId = 'sess-abc123';
    const code = '482913';

    const hostConnectKey = await deriveConnectKey(code, sessionId);
    const joinerConnectKey = await deriveConnectKey(code, sessionId);

    const hostKeyPair = await generateEphemeralKeyPair();
    const joinerKeyPair = await generateEphemeralKeyPair();

    const hostAnnouncement = await buildPubkeyAnnouncement('host_pubkey', hostConnectKey, hostKeyPair);
    const joinerAnnouncement = await buildPubkeyAnnouncement('joiner_pubkey', joinerConnectKey, joinerKeyPair);

    const hostPubkeyForJoiner = await parsePubkeyAnnouncement('host_pubkey', joinerConnectKey, hostAnnouncement);
    const joinerPubkeyForHost = await parsePubkeyAnnouncement('joiner_pubkey', hostConnectKey, joinerAnnouncement);
    assert.ok(hostPubkeyForJoiner, 'joiner should verify the host announcement');
    assert.ok(joinerPubkeyForHost, 'host should verify the joiner announcement');

    const joinerSessionKey = await deriveSessionKey(joinerKeyPair.privateKey, hostPubkeyForJoiner, sessionId);
    const hostSessionKey = await deriveSessionKey(hostKeyPair.privateKey, joinerPubkeyForHost, sessionId);

    const plaintext = 'Sprint 14: migrate billing to Stripe, owner Dana, due 2026-10-03';
    const envelope = await encryptMessage(hostSessionKey, plaintext, sessionId);

    // The envelope is JSON ciphertext -- the plaintext must not appear in it.
    assert.ok(!envelope.includes('Stripe'));
    assert.ok(!envelope.includes('Dana'));

    const decrypted = await decryptMessage(joinerSessionKey, envelope, sessionId);
    assert.equal(decrypted, plaintext);
});

test('a fresh random nonce is used for every message (never reused)', async () => {
    const sessionId = 'sess-nonce-check';
    const code = '111222';
    const connectKey = await deriveConnectKey(code, sessionId);
    const keyPair = await generateEphemeralKeyPair();
    const peerKeyPair = await generateEphemeralKeyPair();
    const peerAnnouncement = await buildPubkeyAnnouncement('host_pubkey', connectKey, peerKeyPair);
    const peerKey = await parsePubkeyAnnouncement('host_pubkey', connectKey, peerAnnouncement);
    const sessionKey = await deriveSessionKey(keyPair.privateKey, peerKey, sessionId);

    const envelopes = await Promise.all(
        Array.from({ length: 20 }, () => encryptMessage(sessionKey, 'same plaintext every time', sessionId))
    );
    const ivs = envelopes.map((e) => JSON.parse(e).iv);
    assert.equal(new Set(ivs).size, ivs.length, 'every nonce must be distinct');
});

test('wrong code: the handshake MAC does not verify, so no session key is derived with the impostor', async () => {
    const sessionId = 'sess-abc123';
    const realCode = '482913';
    const wrongCode = '111111';

    const hostConnectKey = await deriveConnectKey(realCode, sessionId);
    const attackerConnectKey = await deriveConnectKey(wrongCode, sessionId);

    const hostKeyPair = await generateEphemeralKeyPair();
    const hostAnnouncement = await buildPubkeyAnnouncement('host_pubkey', hostConnectKey, hostKeyPair);

    // The attacker (who guessed/mistyped the code) tries to verify the
    // host's real announcement using their own (wrong) connect key.
    const result = await parsePubkeyAnnouncement('host_pubkey', attackerConnectKey, hostAnnouncement);
    assert.equal(result, null, 'a wrong code must never verify a real announcement');
});

test('wrong code: a different session id also fails to verify (salt binding)', async () => {
    const code = '482913';
    const hostConnectKey = await deriveConnectKey(code, 'session-one');
    const otherConnectKey = await deriveConnectKey(code, 'session-two');

    const hostKeyPair = await generateEphemeralKeyPair();
    const announcement = await buildPubkeyAnnouncement('host_pubkey', hostConnectKey, hostKeyPair);

    const result = await parsePubkeyAnnouncement('host_pubkey', otherConnectKey, announcement);
    assert.equal(result, null);
});

test('decryption fails (throws) under the wrong session key', async () => {
    const sessionId = 'sess-decrypt-fail';
    const code = '482913';
    const connectKey = await deriveConnectKey(code, sessionId);

    const keyPairA = await generateEphemeralKeyPair();
    const keyPairB = await generateEphemeralKeyPair();
    const keyPairAttacker = await generateEphemeralKeyPair();

    const announcementA = await buildPubkeyAnnouncement('host_pubkey', connectKey, keyPairA);
    const pubkeyA = await parsePubkeyAnnouncement('host_pubkey', connectKey, announcementA);
    const sessionKeyB = await deriveSessionKey(keyPairB.privateKey, pubkeyA, sessionId);

    // An "attacker" who never went through the real ECDH exchange derives
    // an unrelated key using their own ephemeral keypair against A's
    // public key -- simulating "guessed/forged key material".
    const sessionKeyAttacker = await deriveSessionKey(keyPairAttacker.privateKey, pubkeyA, sessionId);

    const envelope = await encryptMessage(sessionKeyB, 'confidential plan content', sessionId);

    await assert.rejects(() => decryptMessage(sessionKeyAttacker, envelope, sessionId));
});

test('decryption fails (throws) under a tampered ciphertext', async () => {
    const sessionId = 'sess-tamper-check';
    const code = '482913';
    const connectKey = await deriveConnectKey(code, sessionId);
    const keyPairA = await generateEphemeralKeyPair();
    const keyPairB = await generateEphemeralKeyPair();

    const announcementA = await buildPubkeyAnnouncement('host_pubkey', connectKey, keyPairA);
    const pubkeyA = await parsePubkeyAnnouncement('host_pubkey', connectKey, announcementA);
    const sessionKeyA = await deriveSessionKey(keyPairA.privateKey, pubkeyA, sessionId);
    // (symmetric key -- deriving "the other side" isn't needed for this test)

    const envelope = await encryptMessage(sessionKeyA, 'do not tamper with me', sessionId);
    const parsed = JSON.parse(envelope);
    // Flip a bit in the ciphertext.
    const ctBytes = Buffer.from(parsed.ct, 'base64');
    ctBytes[0] ^= 0xff;
    parsed.ct = ctBytes.toString('base64');
    const tampered = JSON.stringify(parsed);

    await assert.rejects(() => decryptMessage(sessionKeyA, tampered, sessionId));
});
