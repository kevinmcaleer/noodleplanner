/**
 * Kanban View - Board with drag-and-drop cards
 */

import { NoodleTask, NoodleSettings } from '../types/task';
import { BaseView, TaskUpdateCallback } from './base-view';

type KanbanViewMode = 'phase' | 'resource' | 'progress' | 'label';

interface KanbanColumn {
  id: string;
  title: string;
  tasks: NoodleTask[];
}

interface DragState {
  task: NoodleTask;
  sourceColumn: string;
  ghost: HTMLElement | null;
}

/**
 * Kanban view renders tasks in columns with drag-and-drop support
 */
export class KanbanView extends BaseView {
  private viewMode: KanbanViewMode;
  private columns: KanbanColumn[] = [];
  private dragState: DragState | null = null;
  private boardContainer: HTMLElement | null = null;

  // Breadcrumb for hierarchy navigation
  private breadcrumb: Array<{ name: string; task: NoodleTask | null }> = [];
  private currentParentTask: NoodleTask | null = null;

  constructor(
    container: HTMLElement,
    tasks: NoodleTask[],
    settings: NoodleSettings,
    onTaskUpdate: TaskUpdateCallback
  ) {
    super(container, tasks, settings, onTaskUpdate);
    this.viewMode = settings.kanbanViewMode;
    this.breadcrumb = [{ name: 'All Tasks', task: null }];
  }

  render(): void {
    this.container.empty();
    this.container.addClass('noodle-kanban-view');

    if (this.tasks.length === 0) {
      const empty = this.container.createDiv({ cls: 'noodle-empty-message' });
      empty.setText('No tasks to display');
      return;
    }

    // Toolbar
    this.renderToolbar();

    // Breadcrumb
    this.renderBreadcrumb();

    // Board
    this.boardContainer = this.container.createDiv({ cls: 'noodle-kanban-board' });

    // Group tasks by view mode
    this.columns = this.groupTasksByViewMode();

    // Render columns
    for (const column of this.columns) {
      this.renderColumn(column);
    }

    // Setup drag listeners
    this.setupDragListeners();
  }

  /**
   * Render toolbar with view mode selector
   */
  private renderToolbar(): void {
    const toolbar = this.container.createDiv({ cls: 'noodle-kanban-toolbar' });

    const label = toolbar.createSpan({ cls: 'noodle-toolbar-label' });
    label.setText('Group by:');

    const select = toolbar.createEl('select', { cls: 'noodle-viewmode-select' });

    const modes: Array<{ value: KanbanViewMode; label: string }> = [
      { value: 'phase', label: 'Phase' },
      { value: 'resource', label: 'Resource' },
      { value: 'progress', label: 'Progress' },
      { value: 'label', label: 'Label' }
    ];

    for (const mode of modes) {
      const option = select.createEl('option', { value: mode.value });
      option.setText(mode.label);
      if (mode.value === this.viewMode) {
        option.selected = true;
      }
    }

    select.addEventListener('change', () => {
      this.viewMode = select.value as KanbanViewMode;
      // Reset breadcrumb when changing mode
      this.breadcrumb = [{ name: 'All Tasks', task: null }];
      this.currentParentTask = null;
      this.render();
    });
  }

  /**
   * Render breadcrumb for hierarchy navigation
   */
  private renderBreadcrumb(): void {
    const breadcrumbContainer = this.container.createDiv({ cls: 'noodle-kanban-breadcrumb' });

    for (let i = 0; i < this.breadcrumb.length; i++) {
      const item = this.breadcrumb[i];

      if (i > 0) {
        const separator = breadcrumbContainer.createSpan({ cls: 'noodle-breadcrumb-separator' });
        separator.setText(' > ');
      }

      const link = breadcrumbContainer.createEl('a', { cls: 'noodle-breadcrumb-item' });
      link.setText(item.name);
      link.href = '#';

      if (i < this.breadcrumb.length - 1) {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          this.navigateToLevel(i);
        });
      } else {
        link.addClass('current');
      }
    }
  }

  /**
   * Navigate to a specific breadcrumb level
   */
  private navigateToLevel(index: number): void {
    this.breadcrumb = this.breadcrumb.slice(0, index + 1);
    this.currentParentTask = this.breadcrumb[index].task;
    this.render();
  }

  /**
   * Drill down into a task's children
   */
  private drillDown(task: NoodleTask): void {
    this.breadcrumb.push({ name: task.description, task });
    this.currentParentTask = task;
    this.render();
  }

  /**
   * Group tasks by the current view mode
   */
  private groupTasksByViewMode(): KanbanColumn[] {
    // Get tasks to display (children of current parent or top-level)
    let tasksToGroup: NoodleTask[];

    if (this.currentParentTask) {
      tasksToGroup = this.tasks.filter(t => t.parent === this.currentParentTask?.name);
    } else {
      // Top level tasks (no parent or first-level)
      tasksToGroup = this.tasks.filter(t => t.level <= 1);
    }

    switch (this.viewMode) {
      case 'phase':
        return this.groupByPhase(tasksToGroup);
      case 'resource':
        return this.groupByResource(tasksToGroup);
      case 'progress':
        return this.groupByProgress(tasksToGroup);
      case 'label':
        return this.groupByLabel(tasksToGroup);
      default:
        return this.groupByPhase(tasksToGroup);
    }
  }

  /**
   * Group tasks by phase
   */
  private groupByPhase(tasks: NoodleTask[]): KanbanColumn[] {
    const phaseMap = new Map<string, NoodleTask[]>();

    for (const task of tasks) {
      const phase = task.phase || 'Unassigned';
      if (!phaseMap.has(phase)) {
        phaseMap.set(phase, []);
      }
      phaseMap.get(phase)!.push(task);
    }

    return Array.from(phaseMap.entries()).map(([phase, tasks]) => ({
      id: phase,
      title: phase,
      tasks
    }));
  }

  /**
   * Group tasks by resource
   */
  private groupByResource(tasks: NoodleTask[]): KanbanColumn[] {
    const resourceMap = new Map<string, NoodleTask[]>();

    // Collect all unique resources first
    const allResources = new Set<string>();
    for (const task of tasks) {
      if (task.resources.length === 0) {
        allResources.add('Unassigned');
      } else {
        for (const r of task.resources) {
          allResources.add(r);
        }
      }
    }

    // Initialize columns
    for (const resource of allResources) {
      resourceMap.set(resource, []);
    }

    // Assign tasks to columns
    for (const task of tasks) {
      if (task.resources.length === 0) {
        resourceMap.get('Unassigned')!.push(task);
      } else {
        for (const r of task.resources) {
          resourceMap.get(r)!.push(task);
        }
      }
    }

    return Array.from(resourceMap.entries()).map(([resource, tasks]) => ({
      id: resource,
      title: resource,
      tasks
    }));
  }

  /**
   * Group tasks by progress status
   */
  private groupByProgress(tasks: NoodleTask[]): KanbanColumn[] {
    const columns: KanbanColumn[] = [
      { id: 'not_started', title: 'Not Started', tasks: [] },
      { id: 'in_progress', title: 'In Progress', tasks: [] },
      { id: 'complete', title: 'Complete', tasks: [] }
    ];

    for (const task of tasks) {
      if (task.percent === 0) {
        columns[0].tasks.push(task);
      } else if (task.percent >= 100) {
        columns[2].tasks.push(task);
      } else {
        columns[1].tasks.push(task);
      }
    }

    return columns;
  }

  /**
   * Group tasks by label (parsed from comments or custom syntax)
   */
  private groupByLabel(tasks: NoodleTask[]): KanbanColumn[] {
    const labelMap = new Map<string, NoodleTask[]>();
    labelMap.set('Unlabeled', []);

    // Simple label extraction - look for #tags in comments
    for (const task of tasks) {
      const labels = this.extractLabels(task);

      if (labels.length === 0) {
        labelMap.get('Unlabeled')!.push(task);
      } else {
        for (const label of labels) {
          if (!labelMap.has(label)) {
            labelMap.set(label, []);
          }
          labelMap.get(label)!.push(task);
        }
      }
    }

    return Array.from(labelMap.entries()).map(([label, tasks]) => ({
      id: label,
      title: label,
      tasks
    }));
  }

  /**
   * Extract labels from task (from comment or raw text)
   */
  private extractLabels(task: NoodleTask): string[] {
    const labels: string[] = [];

    // Look for [label:value] patterns
    const labelPattern = /\[label:([^\]]+)\]/gi;
    const text = task.rawText + ' ' + task.comment;

    let match;
    while ((match = labelPattern.exec(text)) !== null) {
      labels.push(match[1].trim());
    }

    return labels;
  }

  /**
   * Render a column
   */
  private renderColumn(column: KanbanColumn): void {
    if (!this.boardContainer) return;

    const columnEl = this.boardContainer.createDiv({ cls: 'noodle-kanban-column' });
    columnEl.setAttribute('data-column-id', column.id);

    // Header
    const header = columnEl.createDiv({ cls: 'noodle-column-header' });
    const title = header.createSpan({ cls: 'noodle-column-title' });
    title.setText(column.title);

    const count = header.createSpan({ cls: 'noodle-column-count' });
    count.setText(`(${column.tasks.length})`);

    // Cards container
    const cards = columnEl.createDiv({ cls: 'noodle-column-cards' });

    for (const task of column.tasks) {
      this.renderCard(cards, task);
    }
  }

  /**
   * Render a task card
   */
  private renderCard(container: HTMLElement, task: NoodleTask): void {
    const card = container.createDiv({ cls: 'noodle-kanban-card' });
    card.setAttribute('data-task-id', task.id);
    card.setAttribute('draggable', 'true');

    // RAG indicator
    const ragIndicator = card.createDiv({ cls: `noodle-card-rag ${this.getRagClass(task.rag)}` });

    // Card content
    const content = card.createDiv({ cls: 'noodle-card-content' });

    // Title
    const title = content.createDiv({ cls: 'noodle-card-title' });
    title.setText(task.description);

    // If summary task, add drill-down icon
    if (task.isSummary) {
      const drillIcon = title.createSpan({ cls: 'noodle-drill-icon' });
      drillIcon.setText(' \u25B6'); // Right arrow
      drillIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        this.drillDown(task);
      });
    }

    // Meta row (resources, percent)
    const meta = content.createDiv({ cls: 'noodle-card-meta' });

    if (task.resources.length > 0) {
      const resources = meta.createSpan({ cls: 'noodle-card-resources' });
      resources.setText(task.resources.map(r => `@${r}`).join(' '));
    }

    // Progress
    const progressContainer = meta.createDiv({ cls: 'noodle-card-progress' });
    progressContainer.appendChild(this.createProgressBar(task.percent));

    const percentLabel = progressContainer.createSpan({ cls: 'noodle-percent-label' });
    percentLabel.setText(`${task.percent}%`);

    // Dates
    if (task.start && task.finish) {
      const dates = content.createDiv({ cls: 'noodle-card-dates' });
      dates.setText(`${this.formatDateShort(task.start)} - ${this.formatDateShort(task.finish)}`);
    }
  }

  /**
   * Setup drag and drop listeners
   */
  private setupDragListeners(): void {
    if (!this.boardContainer) return;

    // Card drag start
    this.boardContainer.addEventListener('dragstart', (e) => {
      const card = (e.target as HTMLElement).closest('.noodle-kanban-card') as HTMLElement;
      if (!card) return;

      const taskId = card.getAttribute('data-task-id');
      const task = this.tasks.find(t => t.id === taskId);
      if (!task) return;

      const column = card.closest('.noodle-kanban-column');
      const columnId = column?.getAttribute('data-column-id') || '';

      this.dragState = {
        task,
        sourceColumn: columnId,
        ghost: null
      };

      card.addClass('dragging');

      // Set drag data
      e.dataTransfer?.setData('text/plain', taskId || '');
    });

    // Card drag end
    this.boardContainer.addEventListener('dragend', (e) => {
      const card = (e.target as HTMLElement).closest('.noodle-kanban-card');
      if (card) {
        card.removeClass('dragging');
      }
      this.dragState = null;

      // Remove drop indicators
      this.boardContainer?.querySelectorAll('.drop-target').forEach(el => {
        el.removeClass('drop-target');
      });
    });

    // Column drag over
    this.boardContainer.addEventListener('dragover', (e) => {
      e.preventDefault();

      const column = (e.target as HTMLElement).closest('.noodle-kanban-column');
      if (column) {
        column.addClass('drop-target');
      }
    });

    // Column drag leave
    this.boardContainer.addEventListener('dragleave', (e) => {
      const column = (e.target as HTMLElement).closest('.noodle-kanban-column');
      if (column) {
        column.removeClass('drop-target');
      }
    });

    // Column drop
    this.boardContainer.addEventListener('drop', async (e) => {
      e.preventDefault();

      const column = (e.target as HTMLElement).closest('.noodle-kanban-column') as HTMLElement;
      if (!column || !this.dragState) return;

      const targetColumnId = column.getAttribute('data-column-id');
      if (!targetColumnId || targetColumnId === this.dragState.sourceColumn) return;

      // Apply the change based on view mode
      await this.handleDrop(this.dragState.task, targetColumnId);

      column.removeClass('drop-target');
    });
  }

  /**
   * Handle drop - update task based on view mode
   */
  private async handleDrop(task: NoodleTask, targetColumnId: string): Promise<void> {
    switch (this.viewMode) {
      case 'resource':
        // Update task resources
        const newResources = targetColumnId === 'Unassigned' ? [] : [targetColumnId];
        await this.onTaskUpdate(task, { resources: newResources });
        break;

      case 'progress':
        // Update task percent
        let newPercent: number;
        if (targetColumnId === 'not_started') {
          newPercent = 0;
        } else if (targetColumnId === 'in_progress') {
          newPercent = task.percent === 0 ? 50 : task.percent;
        } else {
          newPercent = 100;
        }
        await this.onTaskUpdate(task, { percent: newPercent });
        break;

      case 'phase':
        // Phase changes require moving lines in source - more complex
        // For now, just re-render
        break;

      case 'label':
        // Label changes require updating comment - more complex
        break;
    }

    this.render();
  }

  destroy(): void {
    this.container.empty();
    this.boardContainer = null;
    this.dragState = null;
  }
}
