/** Pure regression tests for issue #876's ephemeral collaboration chat. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const planModel = require(path.join(root, 'packages/noodle-web/src/noodle_web/static/plan-model.js'));
const source = fs.readFileSync(
    path.join(root, 'packages/noodle-web/src/noodle_web/static/collab-session.js'),
    'utf8',
);

const sandbox = {
    console,
    NoodlePlanModel: planModel,
    crypto: { randomUUID: () => 'generated-id' },
};
vm.createContext(sandbox);
vm.runInContext(source + `\n;globalThis.__chatTest = {
    buildCollabChatEntry, collabChatTranscript, appendCollabTaskComment
};`, sandbox);

const { buildCollabChatEntry, collabChatTranscript, appendCollabTaskComment } = sandbox.__chatTest;
let failures = 0;
function assert(condition, message) {
    if (!condition) {
        failures++;
        console.error('FAIL:', message);
    } else {
        console.log('PASS:', message);
    }
}

const chat = buildCollabChatEntry('chat', 'Alex\nAdmin', '  hello\0 team  ', 'm1', 1000);
assert(chat.sender === 'Alex Admin', 'sender is constrained to one display line');
assert(chat.text === 'hello team', 'message strips NUL bytes and surrounding whitespace');
assert(chat.id === 'm1' && chat.timestamp === 1000, 'wire identity and timestamp are preserved');
assert(buildCollabChatEntry('unknown', 'Alex', 'hello') === null, 'unknown frame types are rejected');
assert(buildCollabChatEntry('chat', 'Alex', '   ') === null, 'blank messages are rejected');

const activity = buildCollabChatEntry('activity', 'Alex', 'updated task “Build”', 'a1', 2000);
const transcript = collabChatTranscript([chat, activity]);
assert(transcript.includes('Alex Admin: hello team'), 'chat transcript records sender and text');
assert(transcript.includes('* Alex updated task “Build”'), 'activity transcript remains visually distinct');

const plan = `---
title: Chat test
---

Phase
  Build 2d @alex "Existing note" [depends Review]
  Review 1d
`;
const appended = appendCollabTaskComment(plan, 'build', '[Alex] It is ready\n"today"');
assert(appended.ok, 'message can be promoted using a case-insensitive task name');
assert(appended.text.includes('"Existing note · [Alex] It is ready \'today\'"'),
    'promotion appends safely to an existing task comment without creating a line');
assert(appended.text.includes('[depends Review]'), 'promotion preserves unrelated task metadata');
assert(appendCollabTaskComment(plan, 'Missing', 'hello').reason === 'unknown_task',
    'unknown task is a safe no-op');

if (failures) process.exit(1);
console.log('All collaboration chat tests passed.');
