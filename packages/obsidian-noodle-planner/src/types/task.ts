/**
 * RAG (Red/Amber/Green) status for task health
 */
export type RagStatus = 'RED' | 'AMBER' | 'GREEN';

/**
 * Core task interface representing a scheduled task
 */
export interface NoodleTask {
  /** Unique identifier (e.g., "1.1", "2.3.1") */
  id: string;
  /** Internal task name (identifier) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Calculated or explicit start date */
  start: Date | null;
  /** Calculated finish date (exclusive - day after last working day) */
  finish: Date | null;
  /** Duration in working days */
  durationDays: number;
  /** Assigned resources (e.g., ["john", "jane"]) */
  resources: string[];
  /** Completion percentage (0-100) */
  percent: number;
  /** Health status */
  rag: RagStatus;
  /** Task comment/notes */
  comment: string;
  /** Hierarchy level (0 = top level) */
  level: number;
  /** Whether this is a summary/parent task */
  isSummary: boolean;
  /** Parent phase/section name */
  phase: string;
  /** Parent task name */
  parent: string | null;
  /** List of dependency task names */
  depends: string[];
  /** Lag/lead time for dependencies (e.g., {"TaskA": "+2d"}) */
  lagLead: Record<string, string>;
  /** Dependency types (e.g., {"TaskA": "SS"}). FS is default and omitted. */
  dependencyTypes: Record<string, string>;
  /** Whether task is marked sequential (*) */
  sequential: boolean;
  /** Original line number in source (1-indexed) */
  lineNumber: number;
  /** Original raw text from source */
  rawText: string;
}

/**
 * Parsed metadata from a task line
 */
export interface TaskMetadata {
  name?: string;
  description?: string;
  resources?: string;
  depends?: string[];
  lagLead?: Record<string, string>;
  duration?: number; // in days
  percent?: number;
  comment?: string;
  start?: Date;
  sequential?: boolean;
}

/**
 * Node in the parsed task tree
 */
export interface ParsedNode {
  indent: number;
  text: string;
  name: string;
  fullName: string;
  hasDetails: boolean;
  children: ParsedNode[];
  level: number;
}

/**
 * Nested dict structure from parser
 */
export interface NestedTaskDict {
  _text?: string;
  _level?: number;
  _is_summary?: boolean;
  [key: string]: NestedTaskDict | string | number | boolean | undefined;
}

/**
 * Plugin settings
 */
export interface NoodleSettings {
  defaultView: 'gantt' | 'kanban' | 'milestone' | 'timeline';
  ganttScale: 'days' | 'weeks' | 'months' | 'quarters' | 'years';
  showWeekends: boolean;
  kanbanViewMode: 'phase' | 'resource' | 'progress' | 'label';
  workingDaysPerWeek: 5 | 6 | 7;
}

export const DEFAULT_SETTINGS: NoodleSettings = {
  defaultView: 'gantt',
  ganttScale: 'weeks',
  showWeekends: true,
  kanbanViewMode: 'phase',
  workingDaysPerWeek: 5
};
