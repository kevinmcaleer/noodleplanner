/**
 * Gantt View - Timeline chart with draggable bars
 */

import { NoodleTask, NoodleSettings } from '../types/task';
import { BaseView, TaskUpdateCallback } from './base-view';
import { addWorkingDays, workingDaysBetween } from '../core/working-days';

type GanttScale = 'days' | 'weeks' | 'months' | 'quarters' | 'years';

interface DragState {
  task: NoodleTask;
  handleType: 'left' | 'right' | 'middle';
  startX: number;
  originalStart: Date;
  originalDuration: number;
}

/**
 * Gantt view renders a timeline chart with draggable task bars
 */
export class GanttView extends BaseView {
  private scale: GanttScale;
  private pixelsPerDay: number;
  private minDate: Date | null = null;
  private maxDate: Date | null = null;
  private dragState: DragState | null = null;
  private chartContainer: HTMLElement | null = null;

  // Pixels per day for each scale
  private static SCALE_PIXELS: Record<GanttScale, number> = {
    days: 40,
    weeks: 20,
    months: 10,
    quarters: 5,
    years: 2
  };

  constructor(
    container: HTMLElement,
    tasks: NoodleTask[],
    settings: NoodleSettings,
    onTaskUpdate: TaskUpdateCallback
  ) {
    super(container, tasks, settings, onTaskUpdate);
    this.scale = settings.ganttScale;
    this.pixelsPerDay = GanttView.SCALE_PIXELS[this.scale];
  }

  render(): void {
    this.container.empty();
    this.container.addClass('noodle-gantt-view');

    if (this.tasks.length === 0) {
      const empty = this.container.createDiv({ cls: 'noodle-empty-message' });
      empty.setText('No tasks to display');
      return;
    }

    // Calculate date range
    this.calculateDateRange();

    // Create toolbar
    this.renderToolbar();

    // Create main layout (table + chart)
    const layout = this.container.createDiv({ cls: 'noodle-gantt-layout' });

    // Left side: Task info table
    const tableContainer = layout.createDiv({ cls: 'noodle-gantt-table-side' });
    this.renderTaskTable(tableContainer);

    // Right side: Gantt chart
    this.chartContainer = layout.createDiv({ cls: 'noodle-gantt-chart-side' });
    this.renderChart(this.chartContainer);

    // Setup drag listeners
    this.setupDragListeners();
  }

  /**
   * Calculate min/max dates from tasks
   */
  private calculateDateRange(): void {
    const starts = this.tasks.filter(t => t.start).map(t => t.start as Date);
    const finishes = this.tasks.filter(t => t.finish).map(t => t.finish as Date);

    if (starts.length === 0) {
      this.minDate = new Date();
      this.maxDate = addWorkingDays(new Date(), 30);
      return;
    }

    this.minDate = new Date(Math.min(...starts.map(d => d.getTime())));
    this.maxDate = new Date(Math.max(...finishes.map(d => d.getTime())));

    // Add padding
    this.minDate.setDate(this.minDate.getDate() - 7);
    this.maxDate.setDate(this.maxDate.getDate() + 7);
  }

  /**
   * Render toolbar with scale selector
   */
  private renderToolbar(): void {
    const toolbar = this.container.createDiv({ cls: 'noodle-gantt-toolbar' });

    // Scale selector
    const scaleLabel = toolbar.createSpan({ cls: 'noodle-toolbar-label' });
    scaleLabel.setText('Scale:');

    const scaleSelect = toolbar.createEl('select', { cls: 'noodle-scale-select' });
    const scales: GanttScale[] = ['days', 'weeks', 'months', 'quarters', 'years'];

    for (const s of scales) {
      const option = scaleSelect.createEl('option', { value: s });
      option.setText(s.charAt(0).toUpperCase() + s.slice(1));
      if (s === this.scale) {
        option.selected = true;
      }
    }

    scaleSelect.addEventListener('change', () => {
      this.scale = scaleSelect.value as GanttScale;
      this.pixelsPerDay = GanttView.SCALE_PIXELS[this.scale];
      this.render();
    });

    // Today button
    const todayBtn = toolbar.createEl('button', { cls: 'noodle-today-btn' });
    todayBtn.setText('Today');
    todayBtn.addEventListener('click', () => this.scrollToToday());
  }

  /**
   * Render task info table
   */
  private renderTaskTable(container: HTMLElement): void {
    const table = container.createEl('table', { cls: 'noodle-gantt-info-table' });

    // Header
    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');

    const headers = ['ID', 'Task', 'Duration', 'Start', 'Finish', '%'];
    for (const h of headers) {
      headerRow.createEl('th').setText(h);
    }

    // Body
    const tbody = table.createEl('tbody');

    for (const task of this.tasks) {
      const row = tbody.createEl('tr');
      row.setAttribute('data-task-id', task.id);

      row.createEl('td', { cls: 'noodle-col-id' }).setText(task.id);

      const nameCell = row.createEl('td', { cls: 'noodle-col-name' });
      nameCell.appendChild(this.createIndent(task.level));
      const nameSpan = nameCell.createSpan();
      nameSpan.setText(task.description);
      if (task.isSummary) {
        nameSpan.addClass('noodle-summary-task');
      }

      row.createEl('td', { cls: 'noodle-col-duration' }).setText(`${task.durationDays}d`);
      row.createEl('td', { cls: 'noodle-col-date' }).setText(this.formatDateShort(task.start));
      row.createEl('td', { cls: 'noodle-col-date' }).setText(this.formatDateShort(task.finish));
      row.createEl('td', { cls: 'noodle-col-percent' }).setText(`${task.percent}%`);
    }
  }

  /**
   * Render the Gantt chart
   */
  private renderChart(container: HTMLElement): void {
    if (!this.minDate || !this.maxDate) return;

    // Header with dates
    const header = container.createDiv({ cls: 'noodle-gantt-header' });
    this.renderTimeHeader(header);

    // Rows with bars
    const body = container.createDiv({ cls: 'noodle-gantt-body' });

    for (const task of this.tasks) {
      this.renderTaskBar(body, task);
    }

    // Today marker
    this.renderTodayMarker(body);
  }

  /**
   * Render time header based on scale
   */
  private renderTimeHeader(header: HTMLElement): void {
    if (!this.minDate || !this.maxDate) return;

    const totalDays = Math.ceil((this.maxDate.getTime() - this.minDate.getTime()) / (1000 * 60 * 60 * 24));
    const totalWidth = totalDays * this.pixelsPerDay;

    header.style.width = `${totalWidth}px`;

    const current = new Date(this.minDate);

    if (this.scale === 'days') {
      while (current <= this.maxDate) {
        const cell = header.createDiv({ cls: 'noodle-header-cell noodle-header-day' });
        cell.style.width = `${this.pixelsPerDay}px`;
        cell.setText(current.getDate().toString());

        if (current.getDay() === 0 || current.getDay() === 6) {
          cell.addClass('weekend');
        }

        current.setDate(current.getDate() + 1);
      }
    } else if (this.scale === 'weeks') {
      while (current <= this.maxDate) {
        const cell = header.createDiv({ cls: 'noodle-header-cell noodle-header-week' });
        cell.style.width = `${this.pixelsPerDay * 7}px`;

        const weekStart = new Date(current);
        cell.setText(`W${this.getWeekNumber(weekStart)}`);

        current.setDate(current.getDate() + 7);
      }
    } else if (this.scale === 'months') {
      while (current <= this.maxDate) {
        const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
        const cell = header.createDiv({ cls: 'noodle-header-cell noodle-header-month' });
        cell.style.width = `${this.pixelsPerDay * daysInMonth}px`;
        cell.setText(current.toLocaleString('default', { month: 'short' }));

        current.setMonth(current.getMonth() + 1);
        current.setDate(1);
      }
    } else if (this.scale === 'quarters') {
      while (current <= this.maxDate) {
        const quarter = Math.floor(current.getMonth() / 3) + 1;
        const daysInQuarter = this.getDaysInQuarter(current.getFullYear(), quarter);
        const cell = header.createDiv({ cls: 'noodle-header-cell noodle-header-quarter' });
        cell.style.width = `${this.pixelsPerDay * daysInQuarter}px`;
        cell.setText(`Q${quarter}`);

        current.setMonth(current.getMonth() + 3);
        current.setDate(1);
      }
    } else {
      // Years
      while (current <= this.maxDate) {
        const year = current.getFullYear();
        const daysInYear = this.isLeapYear(year) ? 366 : 365;
        const cell = header.createDiv({ cls: 'noodle-header-cell noodle-header-year' });
        cell.style.width = `${this.pixelsPerDay * daysInYear}px`;
        cell.setText(year.toString());

        current.setFullYear(current.getFullYear() + 1);
        current.setMonth(0);
        current.setDate(1);
      }
    }
  }

  /**
   * Render a task bar
   */
  private renderTaskBar(body: HTMLElement, task: NoodleTask): void {
    if (!this.minDate || !task.start || !task.finish) return;

    const row = body.createDiv({ cls: 'noodle-gantt-row' });
    row.setAttribute('data-task-id', task.id);

    // For year scale, we need to handle tasks that span multiple years differently
    // We should render them as multiple bars or adjust the proportions correctly
    
    // Calculate the actual task start and finish, clamped to visible range
    let displayStart = new Date(task.start);
    let displayFinish = new Date(task.finish);
    
    // Ensure they're within the visible range
    if (displayStart < this.minDate) {
      displayStart = new Date(this.minDate);
    }
    if (displayFinish > this.maxDate) {
      displayFinish = new Date(this.maxDate);
    }
    
    // Calculate position and width based on ACTUAL display dates
    const startOffset = Math.ceil((displayStart.getTime() - this.minDate.getTime()) / (1000 * 60 * 60 * 24));
    const durationDays = Math.ceil((displayFinish.getTime() - displayStart.getTime()) / (1000 * 60 * 60 * 24));
    const duration = Math.max(1, durationDays);

    const left = startOffset * this.pixelsPerDay;
    const width = duration * this.pixelsPerDay;

    // Create bar
    const bar = row.createDiv({ cls: `noodle-gantt-bar ${this.getRagClass(task.rag)}` });
    bar.setAttribute('data-task-id', task.id);
    bar.style.left = `${left}px`;
    bar.style.width = `${width}px`;

    if (task.isSummary) {
      bar.addClass('noodle-summary-bar');
    }

    if (task.durationDays === 0) {
      // Milestone - render as diamond
      bar.addClass('noodle-milestone-marker');
      bar.setText('\u25C6'); // Diamond character
    } else {
      // Progress fill
      const progress = bar.createDiv({ cls: 'noodle-bar-progress' });
      progress.style.width = `${task.percent}%`;

      // Drag handles
      const leftHandle = bar.createDiv({ cls: 'noodle-drag-handle noodle-handle-left' });
      leftHandle.setAttribute('data-handle', 'left');

      const rightHandle = bar.createDiv({ cls: 'noodle-drag-handle noodle-handle-right' });
      rightHandle.setAttribute('data-handle', 'right');

      // Task label
      const label = bar.createSpan({ cls: 'noodle-bar-label' });
      label.setText(task.description);
    }
  }

  /**
   * Render today marker
   */
  private renderTodayMarker(body: HTMLElement): void {
    if (!this.minDate) return;

    const today = new Date();
    const offset = Math.ceil((today.getTime() - this.minDate.getTime()) / (1000 * 60 * 60 * 24));

    if (offset >= 0) {
      const marker = body.createDiv({ cls: 'noodle-today-marker' });
      marker.style.left = `${offset * this.pixelsPerDay}px`;
    }
  }

  /**
   * Setup drag listeners for bar resizing
   */
  private setupDragListeners(): void {
    if (!this.chartContainer) return;

    const onMouseMove = (e: MouseEvent) => {
      if (!this.dragState) return;

      const deltaX = e.clientX - this.dragState.startX;
      const deltaDays = Math.round(deltaX / this.pixelsPerDay);

      if (deltaDays === 0) return;

      // Preview the change (don't update source yet)
      this.previewDrag(deltaDays);
    };

    const onMouseUp = async () => {
      if (!this.dragState) return;

      // Apply the change to source
      await this.applyDragChange();

      this.dragState = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    this.chartContainer.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      const bar = target.closest('.noodle-gantt-bar') as HTMLElement;

      if (!bar) return;

      const taskId = bar.getAttribute('data-task-id');
      const task = this.tasks.find(t => t.id === taskId);

      if (!task || !task.start) return;

      const handle = target.getAttribute('data-handle') as 'left' | 'right' | null;

      this.dragState = {
        task,
        handleType: handle || 'middle',
        startX: e.clientX,
        originalStart: new Date(task.start),
        originalDuration: task.durationDays
      };

      e.preventDefault();
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  /**
   * Preview drag change without updating source
   */
  private previewDrag(deltaDays: number): void {
    if (!this.dragState || !this.chartContainer) return;

    const { task, handleType, originalStart, originalDuration } = this.dragState;
    const bar = this.chartContainer.querySelector(`[data-task-id="${task.id}"].noodle-gantt-bar`) as HTMLElement;

    if (!bar || !this.minDate) return;

    let newStart = new Date(originalStart);
    let newDuration = originalDuration;

    if (handleType === 'left') {
      // Adjust start date
      newStart.setDate(newStart.getDate() + deltaDays);
      newDuration = Math.max(1, originalDuration - deltaDays);
    } else if (handleType === 'right') {
      // Adjust duration
      newDuration = Math.max(1, originalDuration + deltaDays);
    } else {
      // Move entire bar
      newStart.setDate(newStart.getDate() + deltaDays);
    }

    const startOffset = Math.ceil((newStart.getTime() - this.minDate.getTime()) / (1000 * 60 * 60 * 24));
    const width = newDuration * this.pixelsPerDay;

    bar.style.left = `${startOffset * this.pixelsPerDay}px`;
    bar.style.width = `${width}px`;
  }

  /**
   * Apply drag change to source
   */
  private async applyDragChange(): Promise<void> {
    if (!this.dragState) return;

    const { task, handleType, originalStart, originalDuration, startX } = this.dragState;

    // Calculate final delta from bar position
    const bar = this.chartContainer?.querySelector(`[data-task-id="${task.id}"].noodle-gantt-bar`) as HTMLElement;
    if (!bar || !this.minDate) return;

    const left = parseInt(bar.style.left);
    const width = parseInt(bar.style.width);

    const newStartOffset = Math.round(left / this.pixelsPerDay);
    const newStart = new Date(this.minDate);
    newStart.setDate(newStart.getDate() + newStartOffset);

    const newDuration = Math.round(width / this.pixelsPerDay);

    // Update via callback
    await this.onTaskUpdate(task, {
      start: newStart,
      durationDays: newDuration
    });
  }

  /**
   * Scroll to today's date
   */
  private scrollToToday(): void {
    if (!this.chartContainer || !this.minDate) return;

    const today = new Date();
    const offset = Math.ceil((today.getTime() - this.minDate.getTime()) / (1000 * 60 * 60 * 24));
    const scrollX = Math.max(0, offset * this.pixelsPerDay - this.chartContainer.clientWidth / 2);

    this.chartContainer.scrollLeft = scrollX;
  }

  /**
   * Get ISO week number
   */
  private getWeekNumber(date: Date): number {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  /**
   * Get days in a quarter
   */
  private getDaysInQuarter(year: number, quarter: number): number {
    const startMonth = (quarter - 1) * 3;
    const endMonth = startMonth + 3;

    let days = 0;
    for (let m = startMonth; m < endMonth; m++) {
      days += new Date(year, m + 1, 0).getDate();
    }
    return days;
  }

  /**
   * Check if year is a leap year
   */
  private isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  }

  destroy(): void {
    this.container.empty();
    this.chartContainer = null;
    this.dragState = null;
  }
}
