/**
 * Front matter: the keys, the resources and their calendars, the
 * stakeholders and the programme dependencies (issue #793).
 *
 * A port of noodle_web/plan_service.parse_front_matter,
 * noodle_core/exporters.parse_resource_* and
 * noodle_core/front_matter_parser.FrontMatterParser.
 *
 * The Python reader is deliberately simple — it splits on the first colon and
 * keeps what it finds, which is why a plan whose front matter YAML would not
 * load (an `@` starts a resource line) still parses. This reproduces that
 * reading rather than being a better YAML parser: the two engines have to
 * agree, and `front_matter` is compared key for key by the conformance test.
 */
import { dayOf } from "./date-math.js";

/** The raw front-matter lines, between the first pair of `---` markers. */
export function frontMatterLines(planText) {
  const lines = [];
  let inFrontMatter = false;
  for (const line of String(planText || "").split("\n")) {
    if (line.trim() === "---") {
      if (!inFrontMatter) {
        inFrontMatter = true;
        continue;
      }
      break;
    }
    if (inFrontMatter) lines.push(line);
  }
  return lines;
}

/**
 * parse_front_matter: `key: value` pairs, lowercased keys, values as written.
 *
 * A nested `settings:` block becomes `front_matter.settings`. Everything else
 * is flat, including the `- @kev: …` lines of a `Resources:` list, whose key
 * really is `- @kev` — that is what the server returns and what the views
 * have always been handed.
 */
export function parseFrontMatter(planText) {
  const frontMatter = {};
  const settings = {};
  let inFrontMatter = false;
  let inSettings = false;

  for (const line of String(planText || "").split("\n")) {
    if (line.trim() === "---") {
      if (!inFrontMatter) {
        inFrontMatter = true;
        continue;
      }
      break;
    }
    if (!inFrontMatter) continue;

    const stripped = line.trim();

    if (stripped.toLowerCase() === "settings:") {
      inSettings = true;
      continue;
    }

    if (inSettings) {
      if (line.startsWith("  ") && stripped.includes(":")) {
        const idx = stripped.indexOf(":");
        const key = stripped.slice(0, idx).trim();
        const value = stripped.slice(idx + 1).trim();
        if (value.toLowerCase() === "true") settings[key] = true;
        else if (value.toLowerCase() === "false") settings[key] = false;
        else settings[key] = value;
        continue;
      }
      inSettings = false;
    }

    if (line.includes(":")) {
      const idx = line.indexOf(":");
      frontMatter[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
  }

  if (Object.keys(settings).length) frontMatter.settings = settings;
  return frontMatter;
}

/** _is_valid_yaml_value: reject an obviously unfinished collection. */
function isValidYamlValue(value) {
  if (value.startsWith("[") && !value.endsWith("]")) return false;
  if (value.startsWith("{") && !value.endsWith("}")) return false;
  return true;
}

/**
 * extract_title_from_frontmatter: the `title:` key, or null.
 *
 * The Python loads the front matter as YAML and only falls back to reading
 * the line when that fails (which it does for any plan with a resource list,
 * because `@` opens a reserved YAML indicator). This does the line reading
 * always, and unquotes a quoted title the way YAML would, so both paths agree
 * for every title a user can reasonably write.
 */
export function extractTitleFromFrontMatter(planText) {
  for (const line of frontMatterLines(planText)) {
    if (!line.includes(":")) continue;
    const idx = line.indexOf(":");
    if (line.slice(0, idx).trim().toLowerCase() !== "title") continue;

    const title = line.slice(idx + 1).trim();
    if (!title) continue;
    const quoted = /^(["'])([\s\S]*)\1$/.exec(title);
    if (quoted) return quoted[2];
    if (isValidYamlValue(title)) return title;
  }
  return null;
}

const RESOURCE_LINE = /^\s*-\s*@(\w+):\s*(.+)$/;
const NON_WORKING_SUFFIX = /,?\s*non-working\s*\[([^\]]*)\]\s*$/;

/** Walk the `Resources:` list, handing each entry to `visit`. */
function eachResourceLine(planText, visit) {
  let inFrontMatter = false;
  let inResources = false;

  for (const line of String(planText || "").split("\n")) {
    if (line.trim() === "---") {
      if (!inFrontMatter) {
        inFrontMatter = true;
        continue;
      }
      break;
    }
    if (!inFrontMatter) continue;

    if (line.trim().startsWith("Resources:")) {
      inResources = true;
      continue;
    }
    if (inResources && line && !line.startsWith(" ") && !line.startsWith("-")) inResources = false;
    if (!inResources || !line.trim().startsWith("-")) continue;

    const match = RESOURCE_LINE.exec(line);
    if (match) visit(match[1], match[2].trim());
  }
}

/** A `non-working [...]` suffix as day numbers (_parse_non_working_suffix). */
export function parseNonWorkingSuffix(suffix) {
  const days = new Set();
  if (!suffix) return days;

  const addRange = (startIso, endIso) => {
    const start = dayOf(startIso);
    const end = dayOf(endIso);
    if (start === null || end === null) return;
    for (let day = start; day <= end; day++) days.add(day);
  };

  for (const part of String(suffix).split(",")) {
    const entry = part.trim();
    if (!entry) continue;

    const named = /^([^:]+?):\s*(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?\s*$/.exec(entry);
    if (named) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(named[1].trim())) addRange(named[1].trim(), named[2]);
      else if (named[3]) addRange(named[2], named[3]);
      else days.add(dayOf(named[2]));
      continue;
    }

    if (entry.includes(":")) {
      const [start, end] = entry.split(/:(.*)/s);
      addRange(start.trim(), (end || "").trim());
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(entry)) {
      days.add(dayOf(entry));
    }
  }
  return days;
}

/**
 * parse_resource_mappings: shortname (lowercased) to display name, and the
 * per-resource non-working days those lines carry.
 *
 * @returns {{resourceMap: object, resourceNonWorkingDays: Map<string, Set<number>>}}
 */
export function parseResourceMappings(planText) {
  const resourceMap = {};
  const resourceNonWorkingDays = new Map();

  eachResourceLine(planText, (shortName, info) => {
    let fullInfo = info;
    const nwd = NON_WORKING_SUFFIX.exec(fullInfo);
    if (nwd) {
      const days = parseNonWorkingSuffix(nwd[1]);
      if (days.size) resourceNonWorkingDays.set(shortName.toLowerCase(), days);
      fullInfo = fullInfo.slice(0, nwd.index).trim().replace(/,+$/, "").trim();
    }
    resourceMap[shortName.toLowerCase()] = fullInfo.split(",")[0].trim();
  });

  return { resourceMap, resourceNonWorkingDays };
}

/** parse_resource_roles: everything after the first comma of a resource line. */
export function parseResourceRoles(planText) {
  const roles = {};
  eachResourceLine(planText, (shortName, info) => {
    let fullInfo = info;
    const nwd = NON_WORKING_SUFFIX.exec(fullInfo);
    if (nwd) fullInfo = fullInfo.slice(0, nwd.index).trim().replace(/,+$/, "").trim();
    const parts = fullInfo.split(",").map((part) => part.trim());
    if (parts.length > 1) roles[shortName.toLowerCase()] = parts.slice(1).join(", ");
  });
  return roles;
}

const STAKEHOLDER_KV = /^(interest|influence):\s*(high|low)$/i;

/** _parse_stakeholder_entry: "@kev: Kevin, Sponsor, interest:high". */
export function parseStakeholderEntry(entry) {
  if (!entry || !entry.startsWith("@")) return null;

  const colon = entry.indexOf(":");
  if (colon === -1) {
    const raw = entry.slice(1).trim();
    const first = raw.split(/\s+/)[0];
    return {
      shortname: raw ? first.toLowerCase() : raw,
      name: raw,
      role: "",
      interest: "low",
      influence: "low",
    };
  }

  const shortname = entry.slice(1, colon).trim().toLowerCase();
  const textParts = [];
  let interest = "low";
  let influence = "low";

  for (const part of entry.slice(colon + 1).trim().split(",")) {
    const value = part.trim();
    const kv = STAKEHOLDER_KV.exec(value);
    if (kv) {
      if (kv[1].toLowerCase() === "interest") interest = kv[2].toLowerCase();
      else influence = kv[2].toLowerCase();
    } else if (value) {
      textParts.push(value);
    }
  }

  return {
    shortname,
    name: textParts.length ? textParts[0] : shortname,
    role: textParts.length > 1 ? textParts.slice(1).join(", ") : "",
    interest,
    influence,
  };
}

/** parse_stakeholders_from_frontmatter: the `Stakeholders:` list. */
export function parseStakeholders(planText) {
  const stakeholders = [];
  let inFrontMatter = false;
  let inStakeholders = false;

  for (const line of String(planText || "").split("\n")) {
    if (line.trim() === "---") {
      if (!inFrontMatter) {
        inFrontMatter = true;
        continue;
      }
      break;
    }
    if (!inFrontMatter) continue;

    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();
    if (lower === "stakeholders:" || lower === "key stakeholders:") {
      inStakeholders = true;
      continue;
    }
    if (inStakeholders && trimmed && !trimmed.startsWith("-") && /^[a-zA-Z\s]+:/.test(trimmed)) {
      inStakeholders = false;
    }
    if (inStakeholders && trimmed.startsWith("- @")) {
      const item = parseStakeholderEntry(trimmed.slice(2).trim());
      if (item) stakeholders.push(item);
    }
  }
  return stakeholders;
}

/**
 * FrontMatterParser.parse_dependencies: the programme-level `dependencies:`
 * list, which links this plan's tasks to other plans' tasks.
 */
export function parseProgrammeDependencies(planText) {
  const entries = [];
  let inDeps = false;
  let current = null;

  const assign = (entry, rawKey, rawValue) => {
    const key = rawKey.trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(entry, key)) return;
    let value = rawValue.trim();
    if (key === "lag") {
      const parsed = Number.parseInt(value, 10);
      value = Number.isNaN(parsed) || !/^[+-]?\d+$/.test(value.trim()) ? 0 : parsed;
    }
    entry[key] = value;
  };

  for (const line of frontMatterLines(planText)) {
    const stripped = line.trim();
    if (stripped.toLowerCase() === "dependencies:") {
      inDeps = true;
      continue;
    }
    if (!inDeps) continue;

    if (stripped.startsWith("- ")) {
      if (current !== null) entries.push(current);
      current = { from: "", task: "", to_task: "", type: "FS", lag: 0 };
      const remainder = stripped.slice(2).trim();
      if (remainder.includes(":")) {
        const idx = remainder.indexOf(":");
        assign(current, remainder.slice(0, idx), remainder.slice(idx + 1));
      }
    } else if (stripped && stripped.includes(":") && current !== null) {
      const idx = stripped.indexOf(":");
      assign(current, stripped.slice(0, idx), stripped.slice(idx + 1));
    } else if (stripped && !stripped.startsWith("#") && !stripped.startsWith("-")) {
      if (!stripped.includes(":")) {
        inDeps = false;
        if (current !== null) {
          entries.push(current);
          current = null;
        }
      }
    }
  }

  if (current !== null) entries.push(current);
  return entries;
}

/**
 * FrontMatterParser.parse_non_working_days: the project calendar, as day
 * numbers. Both the named list form and the legacy flat form are read.
 */
export function parseNonWorkingDays(planText) {
  const days = new Set();
  const lines = frontMatterLines(planText);
  let inList = false;
  let foundList = false;

  const addRange = (startIso, endIso) => {
    const start = dayOf(startIso);
    const end = endIso ? dayOf(endIso) : start;
    if (start === null || end === null) return;
    for (let day = start; day <= end; day++) days.add(day);
  };

  for (const line of lines) {
    const stripped = line.trim();
    const lower = stripped.toLowerCase();
    if (lower === "non-working-days:" || lower === "holidays:") {
      inList = true;
      continue;
    }
    if (!inList) continue;

    if (stripped.startsWith("- ")) {
      foundList = true;
      const entry = stripped.slice(2).trim();
      const named = /^(.+?):\s*(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?\s*$/.exec(entry);
      if (named) {
        addRange(named[2], named[3]);
      } else {
        const bare = /^(\d{4}-\d{2}-\d{2})\s*$/.exec(entry);
        if (bare) addRange(bare[1], null);
      }
    } else if (stripped && !stripped.startsWith("#")) {
      inList = false;
    }
  }

  if (!foundList) {
    const keyValues = parseFrontMatter(planText);
    for (const key of ["non-working-days", "holidays"]) {
      const value = keyValues[key];
      if (!value || typeof value !== "string") continue;
      for (const match of value.matchAll(/\d{4}-\d{2}-\d{2}/g)) {
        const day = dayOf(match[0]);
        if (day !== null) days.add(day);
      }
    }
  }

  return days;
}

/** parse_named_non_working_days: the same list, names and ranges kept. */
export function parseNamedNonWorkingDays(planText) {
  const entries = [];
  let inList = false;

  for (const line of frontMatterLines(planText)) {
    const stripped = line.trim();
    const lower = stripped.toLowerCase();
    if (lower === "non-working-days:" || lower === "holidays:") {
      inList = true;
      continue;
    }
    if (!inList) continue;

    if (stripped.startsWith("- ")) {
      const entry = stripped.slice(2).trim();
      const named = /^(.+?):\s*(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?\s*$/.exec(entry);
      if (named) {
        entries.push({ name: named[1].trim(), start: named[2], finish: named[3] || "" });
      } else {
        const bare = /^(\d{4}-\d{2}-\d{2})\s*$/.exec(entry);
        if (bare) entries.push({ name: "", start: bare[1], finish: "" });
      }
    } else if (stripped && !stripped.startsWith("#")) {
      inList = false;
    }
  }
  return entries;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    frontMatterLines, parseFrontMatter, extractTitleFromFrontMatter,
    parseResourceMappings, parseResourceRoles, parseNonWorkingSuffix,
    parseStakeholders, parseStakeholderEntry, parseProgrammeDependencies,
    parseNonWorkingDays, parseNamedNonWorkingDays,
  };
}
