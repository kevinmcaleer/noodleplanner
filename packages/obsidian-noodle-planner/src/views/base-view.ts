/**
 * Abstract base class for all views (Milestone, Gantt, Kanban)
 */

import { NoodleTask, NoodleSettings } from '../types/task';

/**
 * Callback for when a task is updated via the UI
 */
export type TaskUpdateCallback = (
  task: NoodleTask,
  changes: Partial<NoodleTask>
) => Promise<void>;

/**
 * Abstract base view class
 */
export abstract class BaseView {
  protected tasks: NoodleTask[];
  protected container: HTMLElement;
  protected settings: NoodleSettings;
  protected onTaskUpdate: TaskUpdateCallback;

  constructor(
    container: HTMLElement,
    tasks: NoodleTask[],
    settings: NoodleSettings,
    onTaskUpdate: TaskUpdateCallback
  ) {
    this.container = container;
    this.tasks = tasks;
    this.settings = settings;
    this.onTaskUpdate = onTaskUpdate;
  }

  /**
   * Render the view
   */
  abstract render(): void;

  /**
   * Clean up resources
   */
  abstract destroy(): void;

  /**
   * Update the view with new tasks
   */
  update(tasks: NoodleTask[]): void {
    this.tasks = tasks;
    this.render();
  }

  /**
   * Format a date for display
   */
  protected formatDate(date: Date | null): string {
    if (!date) return '-';
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    };
    return date.toLocaleDateString('en-US', options);
  }

  /**
   * Format date as short (Jan 15)
   */
  protected formatDateShort(date: Date | null): string {
    if (!date) return '-';
    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric'
    };
    return date.toLocaleDateString('en-US', options);
  }

  /**
   * Get CSS class for RAG status
   */
  protected getRagClass(rag: string): string {
    switch (rag) {
      case 'RED': return 'noodle-rag-red';
      case 'AMBER': return 'noodle-rag-amber';
      case 'GREEN': return 'noodle-rag-green';
      default: return '';
    }
  }

  /**
   * Create a progress bar element
   */
  protected createProgressBar(percent: number): HTMLElement {
    const container = document.createElement('div');
    container.className = 'noodle-progress-bar';

    const fill = document.createElement('div');
    fill.className = 'noodle-progress-fill';
    fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;

    container.appendChild(fill);
    return container;
  }

  /**
   * Create indent spacing for hierarchical display
   */
  protected createIndent(level: number): HTMLElement {
    const indent = document.createElement('span');
    indent.className = 'noodle-indent';
    indent.style.paddingLeft = `${level * 16}px`;
    return indent;
  }
}
