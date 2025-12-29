/**
 * Natural language to structured task parser - ported from scheduling_engine.py natural_language_to_yaml()
 */

import { ParsedNode, NestedTaskDict } from '../types/task';

/**
 * Parse natural language task text into a hierarchical structure.
 * Supports arbitrary nesting levels via indentation.
 * A task without details and with indented tasks below it is a summary task.
 *
 * @param text - The raw plan text
 * @param projectName - Optional project name for the root
 * @returns Nested dict structure for scheduling
 */
export function parseNoodleText(text: string, projectName: string = 'Project'): Record<string, NestedTaskDict[]> {
  const lines = text.split('\n');

  // Build tree structure using a stack
  const root: ParsedNode = {
    children: [],
    indent: -1,
    text: '',
    name: projectName,
    fullName: projectName,
    hasDetails: false,
    level: 0
  };
  const stack: ParsedNode[] = [root];

  // Track line numbers for source sync
  let lineNumber = 0;

  for (const line of lines) {
    lineNumber++;

    if (!line.trim()) {
      continue;
    }

    const indentLevel = line.length - line.trimStart().length;
    const stripped = line.trim();

    // Check if has task details
    const hasDuration = /\b\d+[dwm]\b/.test(stripped);
    const hasQuotes = stripped.includes('"') || stripped.includes("'");
    const hasDetails = stripped.includes('@') ||
      stripped.includes('%') ||
      stripped.includes('!') ||
      stripped.includes('#') ||
      /202[4-6]-/.test(stripped) || // Date patterns
      hasDuration ||
      hasQuotes;

    // Extract task name (everything before metadata)
    let taskName: string;

    if (hasDetails) {
      // Find where metadata starts
      let metadataStart = stripped.length;

      for (const char of ['@', '%', '#', '!']) {
        const pos = stripped.indexOf(char);
        if (pos > 0) {
          metadataStart = Math.min(metadataStart, pos);
        }
      }

      // Check for dates
      const dateMatch = stripped.match(/\d{4}-\d{2}-\d{2}/);
      if (dateMatch && dateMatch.index !== undefined && dateMatch.index > 0) {
        metadataStart = Math.min(metadataStart, dateMatch.index);
      }

      // Check for durations
      const durationMatch = stripped.match(/\d+[dwm]/);
      if (durationMatch && durationMatch.index !== undefined && durationMatch.index > 0) {
        metadataStart = Math.min(metadataStart, durationMatch.index);
      }

      taskName = stripped.slice(0, metadataStart).trim().replace(/^\*/, '');
    } else {
      // No metadata, entire line is the task name
      taskName = stripped.replace(/^\*/, '');
    }

    const fullName = taskName;

    // Create node
    const node: ParsedNode = {
      indent: indentLevel,
      text: stripped, // Keep original text with * marker
      name: taskName,
      fullName: fullName,
      hasDetails: hasDetails,
      children: [],
      level: 0
    };

    // Store line number as custom property for sync
    (node as any).lineNumber = lineNumber;

    // Find parent (pop stack until we find item with lower indent)
    while (stack.length > 1 && stack[stack.length - 1].indent >= indentLevel) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    node.level = parent.level + 1;
    parent.children.push(node);
    stack.push(node);
  }

  // Convert tree to nested dict structure
  const resultDict = treeToNestedDict(root);

  // Remove root markers
  if (resultDict._level !== undefined) {
    delete resultDict._level;
  }
  if (resultDict._is_summary !== undefined) {
    delete resultDict._is_summary;
  }

  return { [projectName]: resultDict && Object.keys(resultDict).length > 0 ? [resultDict] : [] };
}

/**
 * Recursively convert tree to nested dicts
 */
function treeToNestedDict(node: ParsedNode): NestedTaskDict {
  if (node.children.length === 0) {
    // Leaf node - return text with level marker
    const result: NestedTaskDict = {
      _text: node.text,
      _level: node.level
    };
    // Store line number for sync
    if ((node as any).lineNumber) {
      (result as any)._lineNumber = (node as any).lineNumber;
    }
    return result;
  }

  // Has children - create nested dict
  const result: NestedTaskDict = {};

  for (const child of node.children) {
    const childResult = treeToNestedDict(child);

    if (childResult._text !== undefined) {
      // Leaf task
      result[child.name] = childResult;
    } else {
      // Summary task with children
      result[child.fullName] = childResult;
    }
  }

  // Mark as summary with level
  result._level = node.level;
  result._is_summary = true;

  return result;
}

/**
 * Parse task lines and preserve line numbers for bidirectional sync
 *
 * @param text - The raw plan text
 * @returns Array of { lineNumber, indent, text, name } for each task line
 */
export function parseTaskLines(text: string): Array<{
  lineNumber: number;
  indent: number;
  text: string;
  name: string;
}> {
  const lines = text.split('\n');
  const tasks: Array<{
    lineNumber: number;
    indent: number;
    text: string;
    name: string;
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }

    const indentLevel = line.length - line.trimStart().length;
    const stripped = line.trim();

    // Extract task name
    let taskName: string;
    const hasDetails = stripped.includes('@') ||
      stripped.includes('%') ||
      stripped.includes('#') ||
      /\d+[dwm]/.test(stripped);

    if (hasDetails) {
      let metadataStart = stripped.length;
      for (const char of ['@', '%', '#', '!']) {
        const pos = stripped.indexOf(char);
        if (pos > 0) {
          metadataStart = Math.min(metadataStart, pos);
        }
      }
      const durationMatch = stripped.match(/\d+[dwm]/);
      if (durationMatch && durationMatch.index !== undefined && durationMatch.index > 0) {
        metadataStart = Math.min(metadataStart, durationMatch.index);
      }
      taskName = stripped.slice(0, metadataStart).trim().replace(/^\*/, '');
    } else {
      taskName = stripped.replace(/^\*/, '');
    }

    tasks.push({
      lineNumber: i + 1, // 1-indexed
      indent: indentLevel,
      text: stripped,
      name: taskName
    });
  }

  return tasks;
}
