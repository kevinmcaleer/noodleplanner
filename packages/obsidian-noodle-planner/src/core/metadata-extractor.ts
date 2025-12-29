/**
 * Metadata extraction from task lines - ported from scheduling_engine.py extract_metadata()
 */

import { TaskMetadata } from '../types/task';
import { parseISODate } from './working-days';

/**
 * Regex patterns for parsing task metadata
 */
const PATTERNS = {
  // Resources: @john @jane
  resource: /@(\w+)/g,

  // Dependencies using # syntax: #taskname (up to next @ % # ! or end)
  hashDependency: /#([^@%#!]+?)(?=\s+[@%#!]|$)/g,

  // Dependencies using bracket syntax: [depends task1, task2 +2d]
  bracketDependency: /\[depends\s+([^\]]+)\]/gi,

  // Lag/lead time in dependency: "TaskName +2d" or "TaskName -1w"
  lagLead: /^(.+?)\s+([+\-]\d+[dwmy])$/,

  // Duration: 10d, 2w, 3m
  duration: /\b(\d+)([dwm])\b/,

  // Percent (new format): 50%
  percentNew: /(\d{1,3})%/,

  // Percent (old format): p50
  percentOld: /\bp(\d{1,3})\b/,

  // ISO Date: 2025-01-15
  date: /(\d{4}-\d{2}-\d{2})/,

  // Comment with bang: !"text" or !'text'
  commentBang: /!(?:"([^"]+)"|'([^']+)')/,

  // Plain quoted comment: "text"
  commentDouble: /"([^"]+)"/,

  // Single quoted comment: 'text'
  commentSingle: /'([^']+)'/,

  // Sequential marker: * at start (after optional whitespace)
  sequential: /^\s*\*/
};

/**
 * Extract metadata from a task string.
 *
 * Parses: @resource, #dependency, [depends ...], duration (2d/3w/1m),
 * percent (50% or p50), dates (2025-01-15), comments (!"text" or "text"),
 * and sequential marker (*)
 *
 * @param taskStr - The raw task line text
 * @param taskName - Optional task name to set
 * @returns Parsed metadata object
 */
export function extractMetadata(taskStr: string, taskName?: string): TaskMetadata {
  const meta: TaskMetadata = {};

  // Extract resources (@john @jane)
  const resourceMatches = taskStr.matchAll(PATTERNS.resource);
  const resources: string[] = [];
  for (const match of resourceMatches) {
    resources.push(match[1]);
  }
  if (resources.length > 0) {
    meta.resources = resources.join(', ');
  }

  // Extract dependencies using # syntax
  const depends: string[] = [];
  const lagLeadMap: Record<string, string> = {};

  const hashDepMatches = taskStr.matchAll(PATTERNS.hashDependency);
  for (const match of hashDepMatches) {
    depends.push(match[1].trim());
  }

  // Extract dependencies using [depends ...] syntax with lag/lead
  const bracketMatch = taskStr.match(PATTERNS.bracketDependency);
  if (bracketMatch) {
    const depSpecs = bracketMatch[1].split(',');

    for (const depSpec of depSpecs) {
      const trimmed = depSpec.trim();
      const lagLeadMatch = trimmed.match(PATTERNS.lagLead);

      if (lagLeadMatch) {
        const depTaskName = lagLeadMatch[1].trim();
        const lagLeadStr = lagLeadMatch[2];
        depends.push(depTaskName);
        lagLeadMap[depTaskName] = lagLeadStr;
      } else {
        depends.push(trimmed);
      }
    }
  }

  if (depends.length > 0) {
    meta.depends = depends;
  }
  if (Object.keys(lagLeadMap).length > 0) {
    meta.lagLead = lagLeadMap;
  }

  // Check for sequential marker (*)
  if (PATTERNS.sequential.test(taskStr)) {
    meta.sequential = true;
  }

  // Extract comment (!"text" or "text" or 'text')
  let commentMatch = taskStr.match(PATTERNS.commentBang);
  if (commentMatch) {
    meta.comment = commentMatch[1] ?? commentMatch[2];
  } else {
    commentMatch = taskStr.match(PATTERNS.commentDouble);
    if (commentMatch) {
      meta.comment = commentMatch[1];
    } else {
      commentMatch = taskStr.match(PATTERNS.commentSingle);
      if (commentMatch) {
        meta.comment = commentMatch[1];
      }
    }
  }

  // Extract percent (50% or p50)
  let percentMatch = taskStr.match(PATTERNS.percentNew);
  if (percentMatch) {
    meta.percent = parseInt(percentMatch[1], 10);
  } else {
    percentMatch = taskStr.match(PATTERNS.percentOld);
    if (percentMatch) {
      meta.percent = parseInt(percentMatch[1], 10);
    }
  }

  // Extract date (2025-01-15)
  const dateMatch = taskStr.match(PATTERNS.date);
  if (dateMatch) {
    const parsedDate = parseISODate(dateMatch[1]);
    if (parsedDate) {
      meta.start = parsedDate;
    }
  }

  // Extract duration (10d, 2w, 3m)
  const durationMatch = taskStr.match(PATTERNS.duration);
  if (durationMatch) {
    const value = parseInt(durationMatch[1], 10);
    const unit = durationMatch[2];

    if (unit === 'd') {
      meta.duration = value;
    } else if (unit === 'w') {
      meta.duration = value * 7;
    } else if (unit === 'm') {
      meta.duration = value * 30; // Approximate month as 30 days
    }
  }

  // Extract description (everything before metadata)
  const descMatch = taskStr.match(/^\*?(.*?)(?:@|#|!|"|\d{4}-\d{2}-\d{2}|:p\d+d|\d+[dwm]|\d+%|$)/);
  if (descMatch) {
    meta.description = descMatch[1].trim();
  }

  // Set task name if provided
  if (taskName) {
    meta.name = taskName;
  }

  return meta;
}

/**
 * Update a task line with new metadata values.
 * Preserves original formatting where possible.
 *
 * @param line - Original task line
 * @param changes - Changes to apply
 * @returns Updated line
 */
export function updateTaskLine(line: string, changes: Partial<TaskMetadata>): string {
  let updated = line;

  // Update resources
  if (changes.resources !== undefined) {
    // Remove existing resources
    updated = updated.replace(/@\w+/g, '').trim();
    // Add new resources at the end (before any comment)
    if (changes.resources) {
      const resources = changes.resources.split(',').map(r => `@${r.trim()}`).join(' ');
      // Insert before comment if exists
      const commentMatch = updated.match(/(!?"[^"]+"|!'[^']+'|"[^"]+"|'[^']+')$/);
      if (commentMatch) {
        const beforeComment = updated.slice(0, commentMatch.index).trimEnd();
        updated = `${beforeComment} ${resources} ${commentMatch[0]}`;
      } else {
        updated = `${updated} ${resources}`;
      }
    }
  }

  // Update percent
  if (changes.percent !== undefined) {
    // Remove existing percent
    updated = updated.replace(/\d{1,3}%/g, '').replace(/\bp\d{1,3}\b/g, '').trim();
    // Add new percent
    if (changes.percent >= 0) {
      updated = `${updated} ${changes.percent}%`;
    }
  }

  // Update duration
  if (changes.duration !== undefined) {
    // Remove existing duration
    updated = updated.replace(/\b\d+[dwm]\b/g, '').trim();
    // Add new duration
    if (changes.duration > 0) {
      updated = `${updated} ${changes.duration}d`;
    }
  }

  // Update start date
  if (changes.start !== undefined) {
    // Remove existing date
    updated = updated.replace(/\d{4}-\d{2}-\d{2}/g, '').trim();
    // Add new date
    if (changes.start) {
      const dateStr = changes.start.toISOString().split('T')[0];
      updated = `${updated} ${dateStr}`;
    }
  }

  // Update comment
  if (changes.comment !== undefined) {
    // Remove existing comment
    updated = updated.replace(/!?"[^"]+"/g, '').replace(/!'[^']+'/g, '').replace(/"[^"]+"/g, '').trim();
    // Add new comment
    if (changes.comment) {
      updated = `${updated} !"${changes.comment}"`;
    }
  }

  // Clean up extra spaces
  updated = updated.replace(/\s+/g, ' ').trim();

  return updated;
}
