/**
 * Browser-side proof for #964: exercises the actual functions in
 * static/collab-crypto.js directly (no browser needed -- Node's built-in
 * `node:crypto` webcrypto implementation exposes the same `crypto.subtle`
 * surface real browsers do, which is exactly why collab-crypto.js only
 * uses that standard API).
 *
 * Two simulated parties derive the same session key from the same
 * handshake secret + session id, encrypt a message on one side and decrypt
 * it correctly on the other, and -- the critical negative tests -- a wrong
 * secret fails to authenticate the handshake at all, so no session key is
 * ever derived with the mismatched party. Post-security-review, this file
 * also specifically proves the exact scenario Finding 1 exploited: a party
 * who has everything the relay legitimately has (join_code + session_id)
 * but NOT handshake_secret cannot forge a valid handshake announcement --
 * see `deriveConnectKey`/`handshake_secret` in collab-crypto.js's module
 * docstring for the full two-secret design this guards. It also exercises
 * `classifyFrameType`, the fix for Finding 2 (spoofed/unrecognized frames
 * must never be treated as genuine peer content).
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
    classifyFrameType,
} from '../packages/noodle-web/src/noodle_web/static/collab-crypto.js';

test('KDF_ITERATIONS matches the documented OWASP-anchored parameter', () => {
    assert.equal(KDF_ITERATIONS, 600_000);
});

test('two parties with the same handshake secret + session id derive the same session key and round-trip a message', async () => {
    const sessionId = 'sess-abc123';
    // Realistic shape: a long, random, fragment-only secret -- NOT the
    // six-digit join_code (see the security-review note above).
    const handshakeSecret = 'Smul1ni5ZytoflU4-S00BLsL9oVZ8YBvSQZCz1zMgKo';

    const hostConnectKey = await deriveConnectKey(handshakeSecret, sessionId);
    const joinerConnectKey = await deriveConnectKey(handshakeSecret, sessionId);

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
    const handshakeSecret = 'nonce-check-secret-1122334455';
    const connectKey = await deriveConnectKey(handshakeSecret, sessionId);
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

test('wrong handshake secret: the handshake MAC does not verify, so no session key is derived with the impostor', async () => {
    const sessionId = 'sess-abc123';
    const realSecret = 'the-real-fragment-secret-abcdef123456';
    const wrongSecret = 'a-completely-different-guess-000000';

    const hostConnectKey = await deriveConnectKey(realSecret, sessionId);
    const attackerConnectKey = await deriveConnectKey(wrongSecret, sessionId);

    const hostKeyPair = await generateEphemeralKeyPair();
    const hostAnnouncement = await buildPubkeyAnnouncement('host_pubkey', hostConnectKey, hostKeyPair);

    // The attacker (who guessed/mistyped the secret) tries to verify the
    // host's real announcement using their own (wrong) connect key.
    const result = await parsePubkeyAnnouncement('host_pubkey', attackerConnectKey, hostAnnouncement);
    assert.equal(result, null, 'a wrong handshake secret must never verify a real announcement');
});

test('Finding 1 regression: a party who knows join_code + session_id (everything the relay legitimately has) but NOT handshake_secret cannot forge a valid handshake', async () => {
    // This is the exact scenario a security review found exploitable in
    // the first cut of #964: the relay necessarily learns join_code (to
    // admit joiners) and already knows session_id (it generated it), so if
    // the ECDH handshake had been authenticated with join_code, the relay
    // itself could recompute the same connect key and transparently MITM
    // the "encrypted" channel. It must not be able to, now that the
    // handshake is authenticated by handshake_secret instead -- a secret
    // the relay is never sent on any request (see collab-crypto.js's and
    // collab_session.py's module docstrings).
    const sessionId = 'sess-relay-mitm-check';
    const joinCode = '482913'; // what the relay legitimately has
    const handshakeSecret = 'the-real-fragment-only-secret-never-sent-to-server';

    // The legitimate host authenticates its announcement with the real
    // handshake secret, as collab-session.js now does.
    const hostConnectKey = await deriveConnectKey(handshakeSecret, sessionId);
    const hostKeyPair = await generateEphemeralKeyPair();
    const hostAnnouncement = await buildPubkeyAnnouncement('host_pubkey', hostConnectKey, hostKeyPair);

    // The "relay" -- or anyone else who only has join_code + session_id --
    // tries to derive the same connect key using join_code instead. This
    // is exactly the forgery Finding 1 described.
    const relayConnectKey = await deriveConnectKey(joinCode, sessionId);
    const forgedAnnouncement = await buildPubkeyAnnouncement('host_pubkey', relayConnectKey, await generateEphemeralKeyPair());

    // Neither direction of forgery succeeds: the relay can't verify the
    // real host's announcement...
    const relayVerifiesRealHost = await parsePubkeyAnnouncement('host_pubkey', relayConnectKey, hostAnnouncement);
    assert.equal(relayVerifiesRealHost, null, 'the relay must not be able to verify a genuine handshake announcement');

    // ...and a real joiner (who correctly used handshake_secret) must not
    // accept a MAC the relay forged using only join_code.
    const joinerConnectKey = await deriveConnectKey(handshakeSecret, sessionId);
    const joinerAcceptsForgery = await parsePubkeyAnnouncement('host_pubkey', joinerConnectKey, forgedAnnouncement);
    assert.equal(joinerAcceptsForgery, null, 'a real joiner must reject a handshake forged from join_code alone');
});

test('wrong handshake secret: a different session id also fails to verify (salt binding)', async () => {
    const handshakeSecret = 'salt-binding-check-secret-998877';
    const hostConnectKey = await deriveConnectKey(handshakeSecret, 'session-one');
    const otherConnectKey = await deriveConnectKey(handshakeSecret, 'session-two');

    const hostKeyPair = await generateEphemeralKeyPair();
    const announcement = await buildPubkeyAnnouncement('host_pubkey', hostConnectKey, hostKeyPair);

    const result = await parsePubkeyAnnouncement('host_pubkey', otherConnectKey, announcement);
    assert.equal(result, null);
});

test('decryption fails (throws) under the wrong session key', async () => {
    const sessionId = 'sess-decrypt-fail';
    const handshakeSecret = 'decrypt-fail-check-secret-556677';
    const connectKey = await deriveConnectKey(handshakeSecret, sessionId);

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
    const handshakeSecret = 'tamper-check-secret-334455';
    const connectKey = await deriveConnectKey(handshakeSecret, sessionId);
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

test('Finding 2 regression: classifyFrameType only ever recognizes the real envelope/control types', () => {
    assert.equal(classifyFrameType('{"type":"host_pubkey","key":"x","mac":"y"}'), 'host_pubkey');
    assert.equal(classifyFrameType('{"type":"joiner_pubkey","key":"x","mac":"y"}'), 'joiner_pubkey');
    assert.equal(classifyFrameType('{"type":"enc","iv":"x","ct":"y"}'), 'enc');
    // #966: the host's presence panel is fed by a fourth, unencrypted
    // control type the server sends directly -- see this file's module
    // docstring point 5 and app.py's `_broadcast_presence`.
    assert.equal(classifyFrameType('{"type":"presence","joiners":[]}'), 'presence');
});

test('Finding 2 regression: an injected/spoofed frame never classifies as a real content type', () => {
    // The exact shape of attack Finding 2 described: a frame crafted to
    // *look* like peer content, injected by anyone who can write to the
    // socket (trivially, the relay itself).
    assert.equal(
        classifyFrameType('{"type":"chat","from":"peer","text":"pretend this is a real decrypted message"}'),
        'unrecognized'
    );
    assert.equal(classifyFrameType('not json at all'), 'unrecognized');
    assert.equal(classifyFrameType('{"no_type_field": true}'), 'unrecognized');
    assert.equal(classifyFrameType('null'), 'unrecognized');
    assert.equal(classifyFrameType('42'), 'unrecognized');
    assert.equal(classifyFrameType('"just a plain string"'), 'unrecognized');
    assert.equal(classifyFrameType('[]'), 'unrecognized');
    assert.equal(classifyFrameType('{"type":"joined","display_name":"Alice"}'), 'unrecognized');
});
