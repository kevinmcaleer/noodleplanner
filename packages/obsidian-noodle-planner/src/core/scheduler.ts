/**
 * Task scheduler - ported from scheduling_engine.py schedule_tasks()
 */

import { NoodleTask, NestedTaskDict, RagStatus } from '../types/task';
import { extractMetadata } from './metadata-extractor';
import { getNextWorkingDay, addWorkingDays, parseDurationToDays, workingDaysBetween } from './working-days';

/**
 * Internal task representation during scheduling
 */
interface InternalTask {
  name: string;
  description: string;
  level: number;
  parent: string | null;
  phase: string;
  summary: boolean;
  resources: string;
  percent: number;
  comment: string;
  depends: string[];
  lagLead: Record<string, string>;
  dependencyTypes: Record<string, string>;
  sequential: boolean;
  duration: number; // in days
  start?: Date;
  finish?: Date;
  lineNumber?: number;
  rawText?: string;
}

/**
 * Schedule tasks from a parsed nested structure.
 *
 * @param phases - Nested dict structure from parseNoodleText
 * @returns Array of scheduled NoodleTask objects
 */
export function scheduleTasks(phases: Record<string, NestedTaskDict[]>): NoodleTask[] {
  const allTasks: InternalTask[] = [];

  /**
   * Recursively traverse nested dict and extract tasks
   */
  function traverseNestedDict(
    node: NestedTaskDict | NestedTaskDict[],
    parentName: string | null = null,
    parentLevel: number = -1
  ): void {
    // Handle array at top level
    if (Array.isArray(node)) {
      for (const item of node) {
        traverseNestedDict(item, parentName, parentLevel);
      }
      return;
    }

    if (!node || typeof node !== 'object') {
      return;
    }

    // Check if this is a leaf task
    if (node._text !== undefined) {
      const text = node._text as string;
      const level = (node._level as number) ?? parentLevel + 1;

      // Find task name from keys
      let taskName: string | null = null;
      for (const key of Object.keys(node)) {
        if (!key.startsWith('_')) {
          taskName = key;
          break;
        }
      }

      // Extract task name from text if not found
      if (!taskName) {
        const parts = text.split(/\s+/);
        if (parts.length > 0) {
          taskName = parts[0].replace(/^\*/, '');
        } else {
          taskName = text;
        }
      }

      const meta = extractMetadata(text, taskName);

      const task: InternalTask = {
        name: meta.name || taskName,
        description: meta.description || taskName,
        level: level,
        parent: parentName,
        phase: parentName || '',
        summary: false,
        resources: meta.resources || '',
        percent: meta.percent || 0,
        comment: meta.comment || '',
        depends: meta.depends || [],
        lagLead: meta.lagLead || {},
        dependencyTypes: {},
        sequential: meta.sequential || false,
        duration: meta.duration || 1,
        lineNumber: (node as any)._lineNumber,
        rawText: text
      };

      if (meta.start) {
        task.start = meta.start;
      }

      allTasks.push(task);
      return;
    }

    // This is a summary task with children
    const level = (node._level as number) ?? parentLevel + 1;

    // Process each child
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('_')) {
        continue;
      }

      if (typeof value === 'object' && value !== null) {
        const childNode = value as NestedTaskDict;

        if (childNode._text !== undefined) {
          // Leaf task
          const meta = extractMetadata(childNode._text as string, key);

          const task: InternalTask = {
            name: meta.name || key,
            description: meta.description || key,
            level: (childNode._level as number) ?? level + 1,
            parent: parentName,
            phase: parentName || '',
            summary: false,
            resources: meta.resources || '',
            percent: meta.percent || 0,
            comment: meta.comment || '',
            depends: meta.depends || [],
            lagLead: meta.lagLead || {},
            sequential: meta.sequential || false,
            duration: meta.duration || 1,
            lineNumber: (childNode as any)._lineNumber,
            rawText: childNode._text as string
          };

          if (meta.start) {
            task.start = meta.start;
          }

          allTasks.push(task);
        } else if (childNode._is_summary || hasNestedChildren(childNode)) {
          // Summary task with children
          const summaryTask: InternalTask = {
            name: key,
            description: key,
            level: (childNode._level as number) ?? level + 1,
            parent: parentName,
            phase: parentName || '',
            summary: true,
            resources: '',
            percent: 0,
            comment: '',
            depends: [],
            lagLead: {},
            dependencyTypes: {},
            sequential: false,
            duration: 0
          };

          allTasks.push(summaryTask);
          traverseNestedDict(childNode, key, (childNode._level as number) ?? level + 1);
        } else {
          // Single key-value that might be a simple dict
          traverseNestedDict(childNode, key, level + 1);
        }
      }
    }
  }

  // Start traversal
  for (const [, phaseList] of Object.entries(phases)) {
    traverseNestedDict(phaseList);
  }

  // Schedule leaf tasks (non-summary tasks)
  // Use lowercase keys for case-insensitive task name lookup
  const nameLookup: Record<string, InternalTask> = {};
  for (const t of allTasks) {
    if (t.name) {
      nameLookup[t.name.toLowerCase()] = t;
    }
  }

  const now = new Date();

  for (let idx = 0; idx < allTasks.length; idx++) {
    const t = allTasks[idx];

    // Skip summary tasks - their dates will be calculated from children
    if (t.summary) {
      continue;
    }

    // Apply scheduling logic
    // Priority order: sequential > dependencies > explicit start > default parallel
    if (t.sequential) {
      // Find previous non-summary task
      let prev: InternalTask | null = null;
      for (let j = idx - 1; j >= 0; j--) {
        if (!allTasks[j].summary) {
          prev = allTasks[j];
          break;
        }
      }

      if (prev && prev.finish) {
        // Sequential tasks start the next working day after predecessor finishes
        t.start = getNextWorkingDay(prev.finish);
      } else {
        t.start = getNextWorkingDay(now);
      }

      t.finish = addWorkingDays(t.start, t.duration);
    } else if (t.depends.length > 0) {
      // Has dependencies
      const depFinishes: Date[] = [];

      for (const depName of t.depends) {
        const depNameLower = depName.toLowerCase();
        const depTask = nameLookup[depNameLower];

        if (depTask && depTask.finish) {
          let depFinish = depTask.finish;

          // Apply lag/lead time if specified
          if (t.lagLead[depName]) {
            const offsetDays = parseDurationToDays(t.lagLead[depName]);
            depFinish = addWorkingDays(depFinish, offsetDays);
          }

          depFinishes.push(depFinish);
        }
      }

      if (depFinishes.length > 0) {
        // Start the next working day after the latest dependency finishes
        const latestDepFinish = new Date(Math.max(...depFinishes.map(d => d.getTime())));
        t.start = getNextWorkingDay(latestDepFinish);
      } else {
        t.start = getNextWorkingDay(now);
      }

      t.finish = addWorkingDays(t.start, t.duration);
    } else if (t.start) {
      // Has explicit start date
      t.finish = addWorkingDays(t.start, t.duration);
    } else {
      // Default: start in parallel (at parent's start or now)
      const parentName = t.parent;

      if (parentName) {
        // Find first sibling
        let firstSibling: InternalTask | null = null;
        for (const task of allTasks) {
          if (task.parent === parentName && !task.summary && task.start) {
            firstSibling = task;
            break;
          }
        }

        if (firstSibling && firstSibling.start) {
          t.start = new Date(firstSibling.start);
        } else {
          t.start = getNextWorkingDay(now);
        }
      } else {
        t.start = getNextWorkingDay(now);
      }

      t.finish = addWorkingDays(t.start, t.duration);
    }

    // Ensure duration is set
    if (!t.duration) {
      t.duration = 1;
    }
  }

  // Calculate summary task dates from children
  function calculateSummaryDates(taskName: string): void {
    const children = allTasks.filter(t => t.parent === taskName);
    if (children.length === 0) {
      return;
    }

    // Recursively calculate for any summary children first
    for (const child of children) {
      if (child.summary) {
        calculateSummaryDates(child.name);
      }
    }

    // Get the summary task
    const summaryTask = allTasks.find(t => t.name === taskName && t.summary);
    if (!summaryTask) {
      return;
    }

    // Calculate from children's dates
    const starts = children.filter(c => c.start).map(c => c.start as Date);
    const finishes = children.filter(c => c.finish).map(c => c.finish as Date);

    if (starts.length > 0 && finishes.length > 0) {
      summaryTask.start = new Date(Math.min(...starts.map(d => d.getTime())));
      summaryTask.finish = new Date(Math.max(...finishes.map(d => d.getTime())));
      summaryTask.duration = workingDaysBetween(summaryTask.start, summaryTask.finish);

      // Calculate average percent complete
      const percents = children.map(c => c.percent);
      if (percents.length > 0) {
        summaryTask.percent = Math.round(percents.reduce((a, b) => a + b, 0) / percents.length);
      }
    }
  }

  // Calculate dates for all summary tasks
  for (const t of allTasks) {
    if (t.summary) {
      calculateSummaryDates(t.name);
    }
  }

  // Build properly ordered list with summary tasks before children
  const ordered = buildOrderedList(allTasks);

  // Convert to NoodleTask format with IDs
  return ordered.map((t, idx) => convertToNoodleTask(t, idx));
}

/**
 * Check if a node has nested dict children
 */
function hasNestedChildren(node: NestedTaskDict): boolean {
  for (const value of Object.values(node)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return true;
    }
  }
  return false;
}

/**
 * Build properly ordered list with summary tasks before children
 */
function buildOrderedList(allTasks: InternalTask[]): InternalTask[] {
  const ordered: InternalTask[] = [];
  const processed = new Set<string>();

  function addTaskAndChildren(task: InternalTask): void {
    if (!task.name || processed.has(task.name)) {
      return;
    }
    processed.add(task.name);
    ordered.push(task);

    // If summary task, add its children
    if (task.summary) {
      const children = allTasks.filter(t => t.parent === task.name);
      for (const child of children) {
        addTaskAndChildren(child);
      }
    }
  }

  // Start with top-level tasks (no parent)
  const topLevel = allTasks.filter(t => !t.parent);
  for (const task of topLevel) {
    addTaskAndChildren(task);
  }

  return ordered;
}

/**
 * Calculate RAG status for a task
 */
function calculateRagStatus(task: InternalTask): RagStatus {
  const now = new Date();

  if (!task.start || !task.finish) {
    return 'GREEN';
  }

  const percent = task.percent || 0;

  // If task is complete, it's green
  if (percent >= 100) {
    return 'GREEN';
  }

  // If task hasn't started yet
  if (now < task.start) {
    return 'GREEN';
  }

  // Calculate expected progress
  const totalDays = workingDaysBetween(task.start, task.finish);
  const elapsedDays = workingDaysBetween(task.start, now);
  const expectedPercent = totalDays > 0 ? (elapsedDays / totalDays) * 100 : 0;

  // Compare actual vs expected
  const variance = expectedPercent - percent;

  if (variance > 30) {
    return 'RED';
  } else if (variance > 15) {
    return 'AMBER';
  }

  return 'GREEN';
}

/**
 * Convert internal task to NoodleTask format
 */
function convertToNoodleTask(task: InternalTask, index: number): NoodleTask {
  // Generate hierarchical ID
  const id = `${index + 1}`;

  return {
    id,
    name: task.name,
    description: task.description,
    start: task.start || null,
    finish: task.finish || null,
    durationDays: task.duration,
    resources: task.resources ? task.resources.split(',').map(r => r.trim()) : [],
    percent: task.percent,
    rag: calculateRagStatus(task),
    comment: task.comment,
    level: task.level,
    isSummary: task.summary,
    phase: task.phase,
    parent: task.parent,
    depends: task.depends,
    lagLead: task.lagLead,
    dependencyTypes: task.dependencyTypes,
    sequential: task.sequential,
    lineNumber: task.lineNumber || 0,
    rawText: task.rawText || ''
  };
}

/**
 * Re-schedule tasks after a change (e.g., drag operation)
 * Only recalculates dependent tasks and summaries
 */
export function rescheduleAfterChange(
  tasks: NoodleTask[],
  changedTaskName: string
): NoodleTask[] {
  // Convert back to internal format
  const internal: InternalTask[] = tasks.map(t => ({
    name: t.name,
    description: t.description,
    level: t.level,
    parent: t.parent,
    phase: t.phase,
    summary: t.isSummary,
    resources: t.resources.join(', '),
    percent: t.percent,
    comment: t.comment,
    depends: t.depends,
    lagLead: t.lagLead,
    dependencyTypes: t.dependencyTypes,
    sequential: t.sequential,
    duration: t.durationDays,
    start: t.start || undefined,
    finish: t.finish || undefined,
    lineNumber: t.lineNumber,
    rawText: t.rawText
  }));

  // Find tasks that depend on the changed task
  const nameLookup: Record<string, InternalTask> = {};
  for (const t of internal) {
    nameLookup[t.name.toLowerCase()] = t;
  }

  // Reschedule dependent tasks
  for (const t of internal) {
    if (t.summary) continue;

    const dependsOnChanged = t.depends.some(
      d => d.toLowerCase() === changedTaskName.toLowerCase()
    );

    if (dependsOnChanged) {
      // Recalculate start from dependencies
      const depFinishes: Date[] = [];

      for (const depName of t.depends) {
        const depTask = nameLookup[depName.toLowerCase()];
        if (depTask && depTask.finish) {
          let depFinish = new Date(depTask.finish);
          if (t.lagLead[depName]) {
            const offsetDays = parseDurationToDays(t.lagLead[depName]);
            depFinish = addWorkingDays(depFinish, offsetDays);
          }
          depFinishes.push(depFinish);
        }
      }

      if (depFinishes.length > 0) {
        const latestDepFinish = new Date(Math.max(...depFinishes.map(d => d.getTime())));
        t.start = getNextWorkingDay(latestDepFinish);
        t.finish = addWorkingDays(t.start, t.duration);
      }
    }
  }

  // Recalculate summary dates
  function updateSummary(taskName: string): void {
    const children = internal.filter(t => t.parent === taskName);
    const summaryTask = internal.find(t => t.name === taskName && t.summary);

    if (!summaryTask || children.length === 0) return;

    const starts = children.filter(c => c.start).map(c => c.start as Date);
    const finishes = children.filter(c => c.finish).map(c => c.finish as Date);

    if (starts.length > 0 && finishes.length > 0) {
      summaryTask.start = new Date(Math.min(...starts.map(d => d.getTime())));
      summaryTask.finish = new Date(Math.max(...finishes.map(d => d.getTime())));
    }
  }

  for (const t of internal) {
    if (t.summary) {
      updateSummary(t.name);
    }
  }

  // Convert back to NoodleTask format
  return internal.map((t, idx) => convertToNoodleTask(t, idx));
}
