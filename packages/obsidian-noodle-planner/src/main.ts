/**
 * Noodle Planner - Obsidian Plugin
 *
 * Interactive project planning with Gantt, Kanban, and Milestone views
 */

import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  MarkdownPostProcessorContext,
  TFile
} from 'obsidian';

import { NoodleTask, NoodleSettings, DEFAULT_SETTINGS } from './types/task';
import { parseNoodleText } from './core/parser';
import { scheduleTasks, rescheduleAfterChange } from './core/scheduler';
import { SourceUpdater, SourceInfo } from './sync/source-updater';
import { MilestoneView } from './views/milestone-view';
import { GanttView } from './views/gantt-view';
import { KanbanView } from './views/kanban-view';
import { TimelineView } from './views/timeline-view';
import { BaseView, TaskUpdateCallback } from './views/base-view';

type ViewType = 'milestone' | 'gantt' | 'kanban' | 'timeline';

/**
 * Main plugin class
 */
export default class NoodlePlannerPlugin extends Plugin {
  settings: NoodleSettings = DEFAULT_SETTINGS;
  private sourceUpdater: SourceUpdater | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.sourceUpdater = new SourceUpdater(this.app);

    // Register code block processor for ```noodle blocks
    this.registerMarkdownCodeBlockProcessor('noodle', this.processNoodleBlock.bind(this));

    // Add settings tab
    this.addSettingTab(new NoodleSettingTab(this.app, this));

    // Add commands
    this.addCommand({
      id: 'insert-noodle-block',
      name: 'Insert Noodle Plan Block',
      editorCallback: (editor) => {
        const template = `\`\`\`noodle
Project Phase 1
  Task 1 @resource 3d
  Task 2 @resource 2d #Task 1
  *Task 3 @resource 1d

Project Phase 2
  Task 4 5d
  Task 5 2d
\`\`\``;
        editor.replaceSelection(template);
      }
    });

    this.addCommand({
      id: 'switch-to-gantt',
      name: 'Switch to Gantt View',
      callback: () => {
        this.settings.defaultView = 'gantt';
        this.saveSettings();
      }
    });

    this.addCommand({
      id: 'switch-to-kanban',
      name: 'Switch to Kanban View',
      callback: () => {
        this.settings.defaultView = 'kanban';
        this.saveSettings();
      }
    });

    this.addCommand({
      id: 'switch-to-milestone',
      name: 'Switch to Milestone View',
      callback: () => {
        this.settings.defaultView = 'milestone';
        this.saveSettings();
      }
    });
  }

  /**
   * Process a ```noodle code block
   */
  private async processNoodleBlock(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    // Parse and schedule tasks
    const parsed = parseNoodleText(source);
    let tasks = scheduleTasks(parsed);

    // Get source info for bidirectional sync
    const sourceInfo = this.getSourceInfo(el, ctx);

    // Track current view
    let currentView: ViewType = this.settings.defaultView;
    let viewInstance: BaseView | null = null;

    // Create task update callback
    const onTaskUpdate: TaskUpdateCallback = async (task, changes) => {
      if (sourceInfo && this.sourceUpdater) {
        await this.sourceUpdater.updateTaskInSource(sourceInfo, task, changes);

        // Reschedule dependent tasks
        tasks = rescheduleAfterChange(tasks, task.name);

        // Re-render view
        if (viewInstance) {
          viewInstance.update(tasks);
        }
      }
    };

    // Create container
    const container = el.createDiv({ cls: 'noodle-planner-container' });

    // View switcher
    const switcherContainer = container.createDiv({ cls: 'noodle-view-switcher' });
    this.renderViewSwitcher(switcherContainer, currentView, (newView) => {
      currentView = newView;
      renderView();
    });

    // View container
    const viewContainer = container.createDiv({ cls: 'noodle-view-container' });

    // Render function
    const renderView = (): void => {
      // Destroy previous view
      if (viewInstance) {
        viewInstance.destroy();
      }

      viewContainer.empty();

      switch (currentView) {
        case 'milestone':
          viewInstance = new MilestoneView(viewContainer, tasks, this.settings, onTaskUpdate);
          break;
        case 'gantt':
          viewInstance = new GanttView(viewContainer, tasks, this.settings, onTaskUpdate);
          break;
        case 'kanban':
          viewInstance = new KanbanView(viewContainer, tasks, this.settings, onTaskUpdate);
          break;
        case 'timeline':
          viewInstance = new TimelineView(viewContainer, tasks, this.settings, onTaskUpdate);
          break;
      }

      viewInstance.render();
    };

    // Initial render
    renderView();
  }

  /**
   * Render view switcher tabs
   */
  private renderViewSwitcher(
    container: HTMLElement,
    currentView: ViewType,
    onSwitch: (view: ViewType) => void
  ): void {
    const views: Array<{ type: ViewType; label: string }> = [
      { type: 'milestone', label: 'Milestones' },
      { type: 'gantt', label: 'Gantt' },
      { type: 'kanban', label: 'Kanban' },
      { type: 'timeline', label: 'Timeline' }
    ];

    for (const view of views) {
      const tab = container.createEl('button', {
        cls: `noodle-tab ${currentView === view.type ? 'active' : ''}`
      });
      tab.setText(view.label);

      tab.addEventListener('click', () => {
        // Update active state
        container.querySelectorAll('.noodle-tab').forEach(t => {
          t.removeClass('active');
        });
        tab.addClass('active');

        onSwitch(view.type);
      });
    }
  }

  /**
   * Get source info for the code block
   */
  private getSourceInfo(el: HTMLElement, ctx: MarkdownPostProcessorContext): SourceInfo | null {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    const sectionInfo = ctx.getSectionInfo(el);

    if (file instanceof TFile && sectionInfo) {
      return {
        file,
        blockStart: sectionInfo.lineStart,
        blockEnd: sectionInfo.lineEnd
      };
    }

    return null;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

/**
 * Settings tab
 */
class NoodleSettingTab extends PluginSettingTab {
  plugin: NoodlePlannerPlugin;

  constructor(app: App, plugin: NoodlePlannerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Noodle Planner Settings' });

    new Setting(containerEl)
      .setName('Default View')
      .setDesc('Choose which view to show by default')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('gantt', 'Gantt')
          .addOption('kanban', 'Kanban')
          .addOption('milestone', 'Milestone')
          .addOption('timeline', 'Timeline')
          .setValue(this.plugin.settings.defaultView)
          .onChange(async (value) => {
            this.plugin.settings.defaultView = value as ViewType;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Gantt Scale')
      .setDesc('Default zoom level for Gantt chart')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('days', 'Days')
          .addOption('weeks', 'Weeks')
          .addOption('months', 'Months')
          .addOption('quarters', 'Quarters')
          .addOption('years', 'Years')
          .setValue(this.plugin.settings.ganttScale)
          .onChange(async (value) => {
            this.plugin.settings.ganttScale = value as NoodleSettings['ganttScale'];
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Kanban View Mode')
      .setDesc('Default grouping for Kanban board')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('phase', 'By Phase')
          .addOption('resource', 'By Resource')
          .addOption('progress', 'By Progress')
          .addOption('label', 'By Label')
          .setValue(this.plugin.settings.kanbanViewMode)
          .onChange(async (value) => {
            this.plugin.settings.kanbanViewMode = value as NoodleSettings['kanbanViewMode'];
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Show Weekends')
      .setDesc('Display weekend days in Gantt chart')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showWeekends)
          .onChange(async (value) => {
            this.plugin.settings.showWeekends = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Working Days Per Week')
      .setDesc('Number of working days in a week')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('5', '5 days (Mon-Fri)')
          .addOption('6', '6 days (Mon-Sat)')
          .addOption('7', '7 days (All week)')
          .setValue(String(this.plugin.settings.workingDaysPerWeek))
          .onChange(async (value) => {
            this.plugin.settings.workingDaysPerWeek = parseInt(value) as 5 | 6 | 7;
            await this.plugin.saveSettings();
          })
      );
  }
}
