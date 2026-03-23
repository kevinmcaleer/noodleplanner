/**
 * Tests for checkResourceCapitalization fix (issue #644).
 *
 * Verifies that email addresses are excluded from the resource shortname
 * capitalization checker and that only front matter + task lines are checked.
 *
 * Run with: node tests/test_resource_capitalization.js
 */

// Inline the function under test (extracted from script.js)
function checkResourceCapitalization(planText, resourceMap) {
    const issues = [];
    const lines = planText.split('\n');
    let inFrontMatter = false;
    let frontMatterSeen = false;
    let inExcludedSection = false;

    lines.forEach((line, idx) => {
        const trimmed = line.trim();

        if (trimmed === '---') {
            if (!frontMatterSeen) {
                inFrontMatter = true;
                frontMatterSeen = true;
            } else if (inFrontMatter) {
                inFrontMatter = false;
            }
            return;
        }

        if (trimmed === '---highlights---' || trimmed === '---raid log---' ||
            trimmed === '---budget---' || trimmed === '---baseline---') {
            inExcludedSection = true;
            return;
        }
        if (trimmed === '---end-highlights---') {
            inExcludedSection = false;
            return;
        }

        if (inExcludedSection) return;
        if (!inFrontMatter && (!trimmed || trimmed.startsWith('#') || trimmed.includes('==='))) return;

        const matches = line.match(/(?<!\w)@(\w+)/g);
        if (matches) {
            matches.forEach(match => {
                const shortname = match.replace(/^@/, '');
                if (shortname[0] === shortname[0].toLowerCase()) {
                    issues.push('Line ' + (idx + 1) + ': "' + match + '" should be capitalized (e.g., "@' + (shortname.charAt(0).toUpperCase() + shortname.slice(1)) + '")');
                }
            });
        }
    });

    return issues;
}

// Test framework
let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log('  PASS: ' + message);
    } else {
        failed++;
        console.log('  FAIL: ' + message);
    }
}

function assertEqual(actual, expected, message) {
    if (actual === expected) {
        passed++;
        console.log('  PASS: ' + message);
    } else {
        failed++;
        console.log('  FAIL: ' + message + ' (expected ' + expected + ', got ' + actual + ')');
    }
}

// --- Tests ---

console.log('Test: Email addresses are excluded from capitalization check');
{
    const planText = [
        '---',
        'title: Test Project',
        'resources:',
        '  - @kev: Kevin McAleer',
        '---',
        'Task with email user@example.com 5d @Kev',
    ].join('\n');

    const issues = checkResourceCapitalization(planText, {});
    // @kev in front matter should be flagged, but user@example.com should NOT
    const emailIssues = issues.filter(i => i.includes('example'));
    assertEqual(emailIssues.length, 0, 'Email address user@example.com is not flagged');
}

console.log('\nTest: Resource shortnames in front matter are checked');
{
    const planText = [
        '---',
        'title: Test Project',
        'resources:',
        '  - @kev: Kevin McAleer',
        '---',
        'Task 1 5d @Kev',
    ].join('\n');

    const issues = checkResourceCapitalization(planText, {});
    const kevIssues = issues.filter(i => i.includes('@kev'));
    assertEqual(kevIssues.length, 1, 'Lowercase @kev in front matter is flagged');
}

console.log('\nTest: Task lines are checked for capitalization');
{
    const planText = [
        '---',
        'title: Test Project',
        '---',
        'Task 1 5d @kev',
    ].join('\n');

    const issues = checkResourceCapitalization(planText, {});
    assertEqual(issues.length, 1, 'Lowercase @kev in task line is flagged');
}

console.log('\nTest: Capitalized shortnames are not flagged');
{
    const planText = [
        '---',
        'title: Test Project',
        '---',
        'Task 1 5d @Kev',
    ].join('\n');

    const issues = checkResourceCapitalization(planText, {});
    assertEqual(issues.length, 0, 'Capitalized @Kev is not flagged');
}

console.log('\nTest: Email addresses in task lines are excluded');
{
    const planText = [
        '---',
        'title: Test Project',
        '---',
        'Send email to admin@company.org 2d @Kev',
    ].join('\n');

    const issues = checkResourceCapitalization(planText, {});
    const emailIssues = issues.filter(i => i.includes('company') || i.includes('admin'));
    assertEqual(emailIssues.length, 0, 'Email admin@company.org in task is not flagged');
}

console.log('\nTest: Highlights section is excluded from check');
{
    const planText = [
        '---',
        'title: Test Project',
        '---',
        'Task 1 5d @Kev',
        '---highlights---',
        'Contact @admin for details',
        '---end-highlights---',
    ].join('\n');

    const issues = checkResourceCapitalization(planText, {});
    const highlightIssues = issues.filter(i => i.includes('@admin'));
    assertEqual(highlightIssues.length, 0, 'Content in highlights section is not checked');
}

console.log('\nTest: RAID log section is excluded from check');
{
    const planText = [
        '---',
        'title: Test Project',
        '---',
        'Task 1 5d @Kev',
        '---raid log---',
        'Risk: @bob needs training',
    ].join('\n');

    const issues = checkResourceCapitalization(planText, {});
    const raidIssues = issues.filter(i => i.includes('@bob'));
    assertEqual(raidIssues.length, 0, 'Content in RAID log section is not checked');
}

console.log('\nTest: Budget section is excluded from check');
{
    const planText = [
        '---',
        'title: Test Project',
        '---',
        'Task 1 5d @Kev',
        '---budget---',
        '@contractor: 5000',
    ].join('\n');

    const issues = checkResourceCapitalization(planText, {});
    const budgetIssues = issues.filter(i => i.includes('@contractor'));
    assertEqual(budgetIssues.length, 0, 'Content in budget section is not checked');
}

console.log('\nTest: Baseline section is excluded from check');
{
    const planText = [
        '---',
        'title: Test Project',
        '---',
        'Task 1 5d @Kev',
        '---baseline---',
        'Task 1 5d @kev',
    ].join('\n');

    const issues = checkResourceCapitalization(planText, {});
    const baselineIssues = issues.filter(i => i.includes('@kev'));
    assertEqual(baselineIssues.length, 0, 'Content in baseline section is not checked');
}

console.log('\nTest: Multiple email formats are all excluded');
{
    const planText = [
        '---',
        'title: Test Project',
        '---',
        'Email test@test.com and name.surname@domain.co.uk and a+b@gmail.com 3d @Kev',
    ].join('\n');

    const issues = checkResourceCapitalization(planText, {});
    assertEqual(issues.length, 0, 'Various email formats are all excluded');
}

console.log('\nTest: @ at start of line (resource shortname) is still checked');
{
    const planText = [
        '---',
        'title: Test Project',
        '  - @kev: Kevin McAleer',
        '---',
    ].join('\n');

    const issues = checkResourceCapitalization(planText, {});
    assertEqual(issues.length, 1, 'Standalone @kev at line start is still flagged');
}

// Summary
console.log('\n---');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
    process.exit(1);
}
