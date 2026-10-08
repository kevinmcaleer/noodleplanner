/**
 * Tests for the programme markdown export (#742): generateProgrammeMarkdown()
 * in programme.js turns a programme and its owned-data record into one
 * markdown document.
 *
 * Run with: node tests/test_programme_export.js
 */
const path = require('path');
const { generateProgrammeMarkdown } = require(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'static', 'programme.js'));

let failures = 0;
function assertTrue(cond, msg) {
    if (!cond) { failures++; console.error('FAIL:', msg); } else { console.log('PASS:', msg); }
}

const programme = { name: 'Estate Renewal', slug: 'estate-renewal', projects: [{ name: 'Roof' }, { name: 'Boiler' }] };

const bare = generateProgrammeMarkdown(programme, null, '2026-10-08');
assertTrue(bare.startsWith('---\nname: "Estate Renewal"\nslug: "estate-renewal"\nexported: "2026-10-08"\n---\n'), 'front matter has name, slug and export date');
assertTrue(bare.includes('# Estate Renewal'), 'has a title');
assertTrue(bare.includes('## Member projects\n\n- Roof\n- Boiler'), 'lists member projects');
assertTrue(!/## (Outcomes|Finance|Stakeholders|Information)/.test(bare), 'sections with no data are omitted');
assertTrue(!bare.includes('sro:'), 'no sro line when none is set');

const full = generateProgrammeMarkdown(programme, {
    sro: 'Ann "the boss" Lee',
    vision: 'Safe homes',
    outcomes: [{ id: 1, name: 'Warmer', description: 'Less heat loss' }],
    benefitLinks: [{ outcomeId: 1 }, { outcomeId: 1 }, { outcomeId: 2 }],
    funding: { envelope: 500000, currency: '£' },
    stakeholders: [{ name: 'Bo | Co', role: 'Tenant rep', organisation: 'Council', influence: 'high', interest: 'high', notes: 'line1\nline2' }],
    information: [{ title: 'Charter', owner: 'Ann', location: 'wiki/charter', reviewDate: '2026-12-01', notes: '' }],
}, '2026-10-08');
assertTrue(full.includes('sro: "Ann \\"the boss\\" Lee"'), 'front matter values are quoted and escaped');
assertTrue(full.includes('vision: "Safe homes"'), 'vision is in the front matter');
assertTrue(full.includes('| Warmer | Less heat loss | 2 |'), 'outcomes show their linked-benefit count');
assertTrue(full.includes('Funding envelope: £500000'), 'finance shows the envelope with currency');
assertTrue(full.includes('| Bo \\| Co | Tenant rep | Council | high | high | line1 line2 |'), 'table cells escape pipes and flatten line breaks');
assertTrue(full.includes('| Charter | Ann | wiki/charter | 2026-12-01 |  |'), 'information register is exported');
assertTrue(generateProgrammeMarkdown(programme, { funding: { envelope: null, currency: '£' } }).includes('Funding envelope: not set'), 'a currency with no envelope reads as not set');

if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('All programme export tests passed');
