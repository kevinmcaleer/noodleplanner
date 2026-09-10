/**
 * A realistic ~10-project portfolio, for profiling the PowerPoint export
 * (issue #778).
 *
 * The issue asks for "a portfolio with ~10 projects". Nothing in the repo
 * had one, so this builds it: ten plans in the app's Markdown format --
 * YAML front matter, an indented task outline, then the `---highlights---`
 * and `---raid log---` back matter -- shaped like the delivery plans the
 * export is actually used on.
 *
 * Generation is deterministic (a seeded PRNG, fixed base dates), so the
 * before/after numbers in the profile are comparable run to run.
 */

/** mulberry32: a small deterministic PRNG, so every run gets the same plans. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROJECT_NAMES = [
  "Silverfort Rollout",
  "Website Redesign",
  "Warehouse Automation",
  "Customer Data Platform",
  "Payments Migration",
  "Field Service App",
  "ERP Upgrade",
  "Network Refresh",
  "Compliance Programme",
  "Analytics Foundation",
];

const MANAGERS = ["Kevin McAleer", "Katie Fox", "Adam Price", "Priya Nair", "Tom Ellis"];
const SPONSORS = ["Dana Reid", "Marcus Webb", "Ines Duarte", "Ray Okafor"];

const PHASES = [
  ["Discovery", ["Stakeholder interviews", "Current-state assessment", "Requirements workshop", "Scope baseline", "Vendor shortlist"]],
  ["Design", ["Solution architecture", "Integration design", "Data model", "Security review", "Design authority sign-off"]],
  ["Build", ["Environment provisioning", "Core configuration", "Interface development", "Data migration scripts", "Unit testing", "Build hardening"]],
  ["Test", ["System integration testing", "Performance testing", "Security testing", "User acceptance testing", "Defect remediation"]],
  ["Deploy", ["Cutover rehearsal", "Production deployment", "Hypercare", "Handover to service"]],
  ["Close", ["Benefits review", "Lessons learned", "Financial closure"]],
];

const RESOURCES = [
  ["@pm", "Project Manager, Delivery"],
  ["@ba", "Business Analyst, Requirements"],
  ["@dev", "Lead Developer, Engineering"],
  ["@qa", "QA Engineer, Test"],
  ["@ops", "Operations Engineer, Run"],
  ["@sec", "Security Architect, Assurance"],
];

const RAID_TITLES = [
  ["risk", "Vendor slippage", "Vendor may miss the agreed delivery date", "Weekly supplier call and contractual milestone"],
  ["issue", "Licence shortfall", "Procured licence tier does not cover all users", "Renegotiate with supplier; interim manual process"],
  ["risk", "Resource contention", "Key engineers shared with another programme", "Ring-fence two days a week, escalate to portfolio board"],
  ["risk", "Data quality", "Source records incomplete for legacy accounts", "Profiling run before migration; cleanse backlog"],
  ["issue", "Environment availability", "Test environment unavailable during build", "Borrow staging; stagger test windows"],
  ["risk", "Change fatigue", "Business teams absorbing three changes at once", "Sequence go-lives; comms plan agreed"],
  ["risk", "Regulatory timing", "Assurance review may not complete before cutover", "Early engagement, provisional evidence pack"],
];

const STATUSES = ["On track", "On track", "Behind schedule", "At risk", "On track", "Ahead of schedule"];

/** ISO date `days` after `base`, as YYYY-MM-DD. */
function isoDate(base, days) {
  const d = new Date(base.getTime() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

/** One plan's Markdown, in the app's own format. */
function buildPlan(index, name, random) {
  const manager = MANAGERS[index % MANAGERS.length];
  const sponsor = SPONSORS[index % SPONSORS.length];
  const status = STATUSES[index % STATUSES.length];
  const budget = 45000 + Math.floor(random() * 40) * 5000;
  const start = new Date(Date.UTC(2026, 0, 6 + index * 7));

  const lines = [];
  lines.push("---");
  lines.push(`title: ${name}`);
  lines.push(`project manager: ${manager}`);
  lines.push(`sponsor: ${sponsor}`);
  lines.push(`budget: £${budget.toLocaleString("en-GB")}`);
  lines.push(`status: ${status}`);
  lines.push(`start: ${isoDate(start, 0)}`);
  lines.push("Resources:");
  for (const [tag, role] of RESOURCES) lines.push(`- ${tag}: ${role}`);
  lines.push(`labels: [portfolio, delivery, wave-${(index % 3) + 1}]`);
  lines.push("---");
  lines.push("");

  // The task outline: six phases, each a summary task with children, and a
  // closing milestone per phase so the swimlane has both bars and dots.
  let previousMilestone = null;
  for (const [phaseName, tasks] of PHASES) {
    lines.push(phaseName);
    for (const task of tasks) {
      const days = 2 + Math.floor(random() * 8);
      const percent = Math.min(100, Math.floor(random() * 130));
      const owner = RESOURCES[Math.floor(random() * RESOURCES.length)][0];
      const depends = previousMilestone ? ` [depends ${previousMilestone}]` : "";
      lines.push(`  ${task} ${owner} ${days}days${depends} ${percent}% "${task} for ${name}"`);
      previousMilestone = null;
    }
    const milestone = `${phaseName} complete`;
    lines.push(`  ${milestone} @pm 0days ${Math.floor(random() * 130) > 100 ? 100 : 0}% "${phaseName} gate"`);
    previousMilestone = milestone;
    lines.push("");
  }

  // Highlights: what the weekly report slide draws from.
  lines.push("---highlights---");
  for (let week = 0; week < 3; week++) {
    lines.push(`## ${isoDate(start, 21 + week * 7)} @${manager.split(" ")[0].toLowerCase()}`);
    lines.push("**Progress**");
    lines.push(`- ${PHASES[week % PHASES.length][1][0]} completed`);
    lines.push(`- ${PHASES[(week + 1) % PHASES.length][1][0]} under way`);
    lines.push("");
    lines.push(`Next: confirm the ${PHASES[(week + 2) % PHASES.length][0].toLowerCase()} gate.`);
  }
  lines.push("---end-highlights---");
  lines.push("");

  // RAID: the risk slides read open risks and issues from here.
  lines.push("---raid log---");
  lines.push("| ID | Type | Title | Description | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status |");
  lines.push("|----|------|-------|-------------|-----------|-------|--------------------|--------|------------|-------|--------|");
  const raidCount = 4 + Math.floor(random() * 3);
  for (let i = 0; i < raidCount; i++) {
    const [type, title, description, mitigation] = RAID_TITLES[(index + i) % RAID_TITLES.length];
    const impact = 1 + Math.floor(random() * 5);
    const likelihood = 1 + Math.floor(random() * 5);
    const state = i === raidCount - 1 ? "closed" : "open";
    lines.push(
      `| ${i + 1} | ${type} | ${title} | ${description} | ${manager.split(" ")[0]} | ${sponsor.split(" ")[0]} | ` +
        `${mitigation} | ${impact} | ${likelihood} | ${impact * likelihood} | ${state} |`
    );
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * `count` projects in the shape `localStorage['noodleplanner_projects']` holds:
 * an id-keyed map of { id, name, planText, createdAt, updatedAt }.
 */
export function makePortfolio(count = 10) {
  const random = rng(0x778c0de);
  const projects = {};
  for (let i = 0; i < count; i++) {
    const name = PROJECT_NAMES[i % PROJECT_NAMES.length] + (i >= PROJECT_NAMES.length ? ` ${Math.floor(i / PROJECT_NAMES.length) + 1}` : "");
    const id = `project-bench-${String(i).padStart(2, "0")}`;
    projects[id] = {
      id,
      name,
      planText: buildPlan(i, name, random),
      createdAt: 1767225600000 + i * 1000,
      updatedAt: 1767225600000 + i * 1000,
    };
  }
  return projects;
}

export default makePortfolio;
