/**
 * Milestone View - Table display of summary tasks and milestones
 */

import { NoodleTask, NoodleSettings } from '../types/task';
import { BaseView, TaskUpdateCallback } from './base-view';

/**
 * Milestone view renders a table of summary tasks and zero-duration milestones
 */
export class MilestoneView extends BaseView {
  private table: HTMLTableElement | null = null;

  constructor(
    container: HTMLElement,
    tasks: NoodleTask[],
    settings: NoodleSettings,
    onTaskUpdate: TaskUpdateCallback
  ) {
    super(container, tasks, settings, onTaskUpdate);
  }

  /**
   * Get tasks that should appear in milestone view
   * (summary tasks and zero-duration milestones)
   */
  private getMilestoneTasks(): NoodleTask[] {
    return this.tasks.filter(t => t.isSummary || t.durationDays === 0);
  }

  render(): void {
    // Clear container
    this.container.empty();
    this.container.addClass('noodle-milestone-view');

    const milestoneTasks = this.getMilestoneTasks();

    if (milestoneTasks.length === 0) {
      const empty = this.container.createDiv({ cls: 'noodle-empty-message' });
      empty.setText('No milestones or summary tasks found');
      return;
    }

    // Create table
    this.table = this.container.createEl('table', { cls: 'noodle-milestone-table' });

    // Header
    const thead = this.table.createEl('thead');
    const headerRow = thead.createEl('tr');

    const headers = ['ID', 'Task Name', 'Start', 'Finish', '%', 'RAG', 'Comment'];
    for (const header of headers) {
      const th = headerRow.createEl('th');
      th.setText(header);
    }

    // Body
    const tbody = this.table.createEl('tbody');

    for (const task of milestoneTasks) {
      const row = tbody.createEl('tr', { cls: 'noodle-milestone-row' });
      row.setAttribute('data-task-id', task.id);

      // ID
      const idCell = row.createEl('td', { cls: 'noodle-col-id' });
      idCell.setText(task.id);

      // Task Name (with indent)
      const nameCell = row.createEl('td', { cls: 'noodle-col-name' });
      nameCell.appendChild(this.createIndent(task.level));
      const nameSpan = nameCell.createSpan();
      nameSpan.setText(task.description);
      if (task.isSummary) {
        nameSpan.addClass('noodle-summary-task');
      }

      // Start
      const startCell = row.createEl('td', { cls: 'noodle-col-date' });
      startCell.setText(this.formatDate(task.start));

      // Finish
      const finishCell = row.createEl('td', { cls: 'noodle-col-date' });
      finishCell.setText(this.formatDate(task.finish));

      // Percent
      const percentCell = row.createEl('td', { cls: 'noodle-col-percent' });
      percentCell.appendChild(this.createProgressBar(task.percent));
      const percentLabel = percentCell.createSpan({ cls: 'noodle-percent-label' });
      percentLabel.setText(`${task.percent}%`);

      // RAG
      const ragCell = row.createEl('td', { cls: 'noodle-col-rag' });
      const ragBadge = ragCell.createSpan({ cls: `noodle-rag-badge ${this.getRagClass(task.rag)}` });
      ragBadge.setText(task.rag);

      // Comment
      const commentCell = row.createEl('td', { cls: 'noodle-col-comment' });
      commentCell.setText(task.comment || '-');

      // Click handler for editing
      row.addEventListener('click', () => this.handleRowClick(task));
    }
  }

  /**
   * Handle row click - open task editor
   */
  private handleRowClick(task: NoodleTask): void {
    // For now, just toggle a selected class
    // Full implementation would open an edit modal
    const rows = this.container.querySelectorAll('.noodle-milestone-row');
    rows.forEach(r => r.removeClass('selected'));

    const row = this.container.querySelector(`[data-task-id="${task.id}"]`);
    if (row) {
      row.addClass('selected');
    }
  }

  destroy(): void {
    this.container.empty();
    this.table = null;
  }
}
