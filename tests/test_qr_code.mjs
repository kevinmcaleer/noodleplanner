/**
 * The QR encoder behind <np-qr-code> (#1389, epic #1376): qrcode-generator,
 * vendored into static/vendor/qrcode by scripts/vendor-qrcode.mjs.
 *
 * The vendored copy is the pinned release, and it draws a real QR code for a
 * session's join link: the size a link that long needs, with the three finder
 * patterns in their corners. The component on the page, and the session
 * dialog it sits in, are covered by tests/ui/test_phone_join.py.
 *
 * Run with: node --test tests/test_qr_code.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendored = join(repo, 'packages/noodle-web/src/noodle_web/static/vendor/qrcode');
const pinned = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).devDependencies['qrcode-generator'];

const { default: qrcode } = await import(join(vendored, 'qrcode.mjs'));

test('the vendored copy is the pinned release', () => {
    assert.equal(readFileSync(join(vendored, 'VERSION'), 'utf8').trim(), pinned, 'run `npm run vendor:qrcode`');
    const installed = join(repo, 'node_modules/qrcode-generator/dist/qrcode.mjs');
    if (!existsSync(installed)) return; // `npm install` not run here; VERSION is the check
    assert.equal(
        readFileSync(join(vendored, 'qrcode.mjs'), 'utf8'),
        readFileSync(installed, 'utf8'),
        'the vendored qrcode.mjs differs from the npm release',
    );
});

function matrixOf(text) {
    const code = qrcode(0, 'M');
    code.addData(text, 'Byte');
    code.make();
    const n = code.getModuleCount();
    return Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_, col) => code.isDark(row, col)));
}

/** A finder pattern: a dark 7x7 ring, a light ring inside it, a dark 3x3 core. */
function isFinder(m, top, left) {
    for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
            const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
            const dark = ring === 3 || ring <= 1;
            if (m[top + r][left + c] !== dark) return false;
        }
    }
    return true;
}

test('a join link is a version 3 or 4 code with its three finder patterns', () => {
    const m = matrixOf('https://noodleplanner.example/join#code=482913');
    const n = m.length;
    assert.ok(n === 29 || n === 33, `unexpected size ${n}`);
    assert.ok(isFinder(m, 0, 0), 'top-left finder');
    assert.ok(isFinder(m, 0, n - 7), 'top-right finder');
    assert.ok(isFinder(m, n - 7, 0), 'bottom-left finder');
    assert.ok(!isFinder(m, n - 7, n - 7), 'no finder bottom-right');
});

test('a different code draws a different QR code', () => {
    const a = matrixOf('https://noodleplanner.example/join#code=482913');
    const b = matrixOf('https://noodleplanner.example/join#code=482914');
    assert.notDeepEqual(a, b);
});
