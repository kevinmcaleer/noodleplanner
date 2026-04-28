/**
 * Tests for incrementVersion (issue #717).
 *
 * Verifies that the minor number rolls over to major+1 minor 0
 * once the minor reaches 20. e.g. 5.20 -> 6.0.
 *
 * Run with: node tests/test_version_increment.js
 */

// Inline the function under test (extracted from script.js)
function incrementVersion(ver) {
    if (!ver) return '1.1';
    const parts = ver.split('.');
    if (parts.length === 1) {
        const major = parseInt(parts[0], 10);
        if (isNaN(major)) return '1.1';
        return major + '.1';
    }
    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);
    if (isNaN(major)) return '1.1';
    if (isNaN(minor)) return major + '.1';
    // Roll over: when minor reaches 20, the next save bumps the major
    // and resets the minor to 0. e.g. 5.20 -> 6.0.
    if (minor >= 20) return (major + 1) + '.0';
    return major + '.' + (minor + 1);
}

// Test framework
let passed = 0;
let failed = 0;

function assertEqual(actual, expected, message) {
    if (actual === expected) {
        passed++;
        console.log('  PASS: ' + message);
    } else {
        failed++;
        console.log('  FAIL: ' + message + ' (expected "' + expected + '", got "' + actual + '")');
    }
}

// --- Tests ---

console.log('Test: Normal minor bump (no rollover)');
assertEqual(incrementVersion('1.5'), '1.6', '1.5 -> 1.6');
assertEqual(incrementVersion('1.0'), '1.1', '1.0 -> 1.1');
assertEqual(incrementVersion('0.0'), '0.1', '0.0 -> 0.1');
assertEqual(incrementVersion('3.10'), '3.11', '3.10 -> 3.11');

console.log('\nTest: Approaching rollover threshold');
assertEqual(incrementVersion('5.18'), '5.19', '5.18 -> 5.19');
assertEqual(incrementVersion('5.19'), '5.20', '5.19 -> 5.20 (still no rollover)');

console.log('\nTest: Rollover at minor 20');
assertEqual(incrementVersion('5.20'), '6.0', '5.20 -> 6.0 (rollover from issue example)');
assertEqual(incrementVersion('9.20'), '10.0', '9.20 -> 10.0 (rollover crosses double digit)');
assertEqual(incrementVersion('0.20'), '1.0', '0.20 -> 1.0 (rollover from major 0)');

console.log('\nTest: Above-threshold minor (defensive)');
assertEqual(incrementVersion('5.25'), '6.0', '5.25 -> 6.0 (defensive rollover)');
assertEqual(incrementVersion('5.99'), '6.0', '5.99 -> 6.0 (defensive rollover)');

console.log('\nTest: Edge cases');
assertEqual(incrementVersion(''), '1.1', 'empty string -> 1.1 (default)');
assertEqual(incrementVersion(null), '1.1', 'null -> 1.1 (default)');
assertEqual(incrementVersion('2'), '2.1', 'no minor -> bumps to .1');
assertEqual(incrementVersion('2.abc'), '2.1', 'non-numeric minor -> bumps to .1');

// Summary
console.log('\n---');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
    process.exit(1);
}
