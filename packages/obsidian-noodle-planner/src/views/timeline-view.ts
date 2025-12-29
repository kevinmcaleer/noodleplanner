/**
 * Timeline View - Horizontal milestone timeline with progress bar
 */

import { NoodleTask, NoodleSettings } from '../types/task';
import { BaseView, TaskUpdateCallback } from './base-view';

interface MilestonePosition {
  pos: number;
  offset: number;
}

/**
 * Timeline view renders a horizontal line with milestones and progress
 */
export class TimelineView extends BaseView {
  private showPhases: boolean = true;
  private timelineContainer: HTMLElement | null = null;

  constructor(
    container: HTMLElement,
    tasks: NoodleTask[],
    settings: NoodleSettings,
    onTaskUpdate: TaskUpdateCallback
  ) {
    super(container, tasks, settings, onTaskUpdate);
  }

  render(): void {
    this.container.empty();
    this.container.addClass('noodle-timeline-view');

    if (this.tasks.length === 0) {
      const empty = this.container.createDiv({ cls: 'noodle-empty-message' });
      empty.setText('No tasks to display');
      return;
    }

    // Toolbar
    this.renderToolbar();

    // Timeline container
    this.timelineContainer = this.container.createDiv({ cls: 'noodle-timeline-content' });

    // Render timeline
    this.renderTimeline();
  }

  /**
   * Render toolbar with phase toggle
   */
  private renderToolbar(): void {
    const toolbar = this.container.createDiv({ cls: 'noodle-timeline-toolbar' });

    const label = toolbar.createEl('label', { cls: 'noodle-toggle-label' });

    const checkbox = label.createEl('input', { type: 'checkbox' });
    checkbox.checked = this.showPhases;
    checkbox.addEventListener('change', () => {
      this.showPhases = checkbox.checked;
      this.renderTimeline();
    });

    label.appendText(' Show phases');
  }

  /**
   * Render the timeline
   */
  private renderTimeline(): void {
    if (!this.timelineContainer) return;

    this.timelineContainer.empty();

    // Get milestones (zero-duration tasks and optionally phases)
    const milestones = this.tasks.filter(t => {
      if (!t.finish) return false;
      // Always include 0-duration milestones
      if (t.durationDays === 0 && !t.isSummary) return true;
      // Include summary tasks (phases) only if toggle is on
      if (t.isSummary && this.showPhases) return true;
      return false;
    });

    if (milestones.length === 0) {
      const empty = this.timelineContainer.createDiv({ cls: 'noodle-empty-message' });
      empty.setText('No milestones found. Add tasks with 0 duration to create milestones.');
      return;
    }

    // Calculate date range
    const allDates = milestones.map(t => t.finish as Date);
    let minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
    let maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));

    // Add padding
    minDate = new Date(minDate);
    minDate.setDate(minDate.getDate() - 7);
    maxDate = new Date(maxDate);
    maxDate.setDate(maxDate.getDate() + 7);

    const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Calculate overall completion
    const overallCompletion = this.calculateOverallCompletion();

    // Timeline wrapper
    const wrapper = this.timelineContainer.createDiv({ cls: 'noodle-timeline-wrapper' });

    // Title
    const title = wrapper.createDiv({ cls: 'noodle-timeline-title' });
    title.setText('Project Timeline');

    // Completion percentage
    const completionLabel = wrapper.createDiv({ cls: 'noodle-timeline-completion' });
    completionLabel.setText(`Overall Progress: ${Math.round(overallCompletion)}%`);

    // Timeline line container
    const lineWrapper = wrapper.createDiv({ cls: 'noodle-timeline-line-wrapper' });

    // Timeline line
    const timelineLine = lineWrapper.createDiv({ cls: 'noodle-timeline-line' });

    // Progress bar
    const progressBar = timelineLine.createDiv({ cls: 'noodle-timeline-progress' });
    progressBar.style.width = `${overallCompletion}%`;

    // Date labels
    const startLabel = timelineLine.createDiv({ cls: 'noodle-timeline-date-label noodle-timeline-start-date' });
    startLabel.setText(this.formatDateISO(minDate));

    const endLabel = timelineLine.createDiv({ cls: 'noodle-timeline-date-label noodle-timeline-end-date' });
    endLabel.setText(this.formatDateISO(maxDate));

    // Milestones container
    const milestonesContainer = lineWrapper.createDiv({ cls: 'noodle-timeline-milestones' });

    // Track positions for overlap prevention
    const positions: MilestonePosition[] = [];
    const minSpacing = 120;
    const maxLevels = 4;

    // Render milestones
    for (const task of milestones) {
      if (!task.finish) continue;

      const daysFromStart = Math.floor((task.finish.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
      const positionPercent = (daysFromStart / totalDays) * 100;

      // Find vertical level without overlap
      let labelOffset = 0;
      let foundLevel = false;

      for (let level = 0; level < maxLevels && !foundLevel; level++) {
        labelOffset = level * -45;
        foundLevel = true;

        for (const prevPos of positions) {
          if (prevPos.offset === labelOffset && Math.abs(positionPercent - prevPos.pos) < (minSpacing / 8)) {
            foundLevel = false;
            break;
          }
        }
      }

      if (!foundLevel) continue;

      positions.push({ pos: positionPercent, offset: labelOffset });

      // Create milestone element
      const milestoneDiv = milestonesContainer.createDiv({ cls: 'noodle-timeline-milestone' });
      milestoneDiv.style.left = `${positionPercent}%`;

      // Connector line if offset
      if (labelOffset !== 0) {
        const connector = milestoneDiv.createDiv({ cls: 'noodle-timeline-connector' });
        connector.style.height = `${Math.abs(labelOffset)}px`;
      }

      // Marker
      const marker = milestoneDiv.createDiv({ cls: 'noodle-timeline-marker' });
      const isComplete = task.percent >= 100;

      if (task.isSummary) {
        marker.addClass('noodle-timeline-diamond');
      } else {
        marker.addClass('noodle-timeline-circle');
        if (isComplete) {
          marker.addClass('complete');
          marker.innerHTML = '<svg viewBox="0 0 20 20"><path d="M6 10 L9 13 L14 7" stroke="currentColor" stroke-width="2.5" fill="none"/></svg>';
        }
      }

      // Label
      const label = milestoneDiv.createDiv({ cls: 'noodle-timeline-milestone-label' });
      label.style.top = `${labelOffset - 30}px`;

      const nameSpan = label.createDiv({ cls: 'noodle-milestone-name' });
      nameSpan.setText(task.description);

      const dateSpan = label.createDiv({ cls: 'noodle-milestone-date' });
      dateSpan.setText(this.formatDateShort(task.finish));
    }

    // Date scale
    this.renderDateScale(timelineLine, minDate, maxDate, totalDays);
  }

  /**
   * Render date scale markers
   */
  private renderDateScale(container: HTMLElement, minDate: Date, maxDate: Date, totalDays: number): void {
    const scale = container.createDiv({ cls: 'noodle-timeline-scale' });

    // Determine scale interval based on total days
    let interval: number;
    let dateFormat: 'day' | 'week' | 'month';

    if (totalDays <= 30) {
      interval = 7; // Weekly
      dateFormat = 'day';
    } else if (totalDays <= 90) {
      interval = 14; // Bi-weekly
      dateFormat = 'day';
    } else if (totalDays <= 365) {
      interval = 30; // Monthly
      dateFormat = 'month';
    } else {
      interval = 90; // Quarterly
      dateFormat = 'month';
    }

    const current = new Date(minDate);
    // Align to interval
    current.setDate(current.getDate() + (interval - (current.getDate() % interval)));

    while (current < maxDate) {
      const daysFromStart = Math.floor((current.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
      const positionPercent = (daysFromStart / totalDays) * 100;

      if (positionPercent > 5 && positionPercent < 95) {
        const marker = scale.createDiv({ cls: 'noodle-timeline-scale-marker' });
        marker.style.left = `${positionPercent}%`;

        const tick = marker.createDiv({ cls: 'noodle-timeline-scale-tick' });

        const label = marker.createDiv({ cls: 'noodle-timeline-scale-label' });
        if (dateFormat === 'month') {
          label.setText(current.toLocaleString('default', { month: 'short' }));
        } else {
          label.setText(`${current.getDate()}`);
        }
      }

      current.setDate(current.getDate() + interval);
    }
  }

  /**
   * Calculate overall project completion
   */
  private calculateOverallCompletion(): number {
    let totalTasks = 0;
    let completedWeight = 0;

    for (const task of this.tasks) {
      if (!task.isSummary && task.durationDays > 0) {
        totalTasks++;
        completedWeight += task.percent;
      }
    }

    return totalTasks > 0 ? completedWeight / totalTasks : 0;
  }

  /**
   * Format date as ISO (YYYY-MM-DD)
   */
  private formatDateISO(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  destroy(): void {
    this.container.empty();
    this.timelineContainer = null;
  }
}
