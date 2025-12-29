/**
 * Source updater - handles bidirectional sync between views and markdown source
 */

import { App, TFile } from 'obsidian';
import { NoodleTask } from '../types/task';
import { updateTaskLine } from '../core/metadata-extractor';

/**
 * Source information for a code block
 */
export interface SourceInfo {
  file: TFile;
  blockStart: number; // Line number where ```noodle starts (0-indexed)
  blockEnd: number;   // Line number where ``` ends (0-indexed)
}

/**
 * Handles updating the source markdown when views change
 */
export class SourceUpdater {
  private app: App;
  private isUpdating: boolean = false;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Update a task in the source markdown
   *
   * @param sourceInfo - Information about the code block location
   * @param task - The task being updated
   * @param changes - The changes to apply
   */
  async updateTaskInSource(
    sourceInfo: SourceInfo,
    task: NoodleTask,
    changes: Partial<NoodleTask>
  ): Promise<void> {
    if (this.isUpdating) {
      return;
    }

    this.isUpdating = true;

    try {
      const content = await this.app.vault.read(sourceInfo.file);
      const lines = content.split('\n');

      // Calculate actual line number in file
      // task.lineNumber is relative to code block content (1-indexed)
      // blockStart is the line with ```noodle (0-indexed)
      // So actual line is: blockStart + task.lineNumber
      const actualLineIndex = sourceInfo.blockStart + task.lineNumber;

      if (actualLineIndex < 0 || actualLineIndex >= lines.length) {
        console.error('Invalid line number for task:', task.name, actualLineIndex);
        return;
      }

      // Get the original line
      const originalLine = lines[actualLineIndex];

      // Preserve indentation
      const indentMatch = originalLine.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : '';

      // Apply changes to the line content (without indent)
      const lineContent = originalLine.trim();
      const updatedContent = updateTaskLine(lineContent, {
        resources: changes.resources?.join(', '),
        percent: changes.percent,
        duration: changes.durationDays,
        start: changes.start || undefined,
        comment: changes.comment
      });

      // Reconstruct line with original indent
      lines[actualLineIndex] = indent + updatedContent;

      // Write back to file
      await this.app.vault.modify(sourceInfo.file, lines.join('\n'));
    } catch (error) {
      console.error('Error updating source:', error);
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Move a task to a different position (for Kanban drag-drop)
   */
  async moveTask(
    sourceInfo: SourceInfo,
    task: NoodleTask,
    targetPhase: string,
    targetIndex: number
  ): Promise<void> {
    if (this.isUpdating) {
      return;
    }

    this.isUpdating = true;

    try {
      const content = await this.app.vault.read(sourceInfo.file);
      const lines = content.split('\n');

      // Calculate actual line numbers
      const sourceLineIndex = sourceInfo.blockStart + task.lineNumber;

      if (sourceLineIndex < 0 || sourceLineIndex >= lines.length) {
        return;
      }

      // Extract the line (preserving indent)
      const taskLine = lines[sourceLineIndex];

      // Remove from original position
      lines.splice(sourceLineIndex, 1);

      // Find target position based on phase
      // This is simplified - a full implementation would need to find
      // the correct position within the phase based on targetIndex
      let insertIndex = sourceLineIndex;

      // For now, just update the indent to match the target phase level
      const targetIndent = '  '.repeat(task.level);
      const updatedLine = targetIndent + taskLine.trim();

      // Insert at target position
      lines.splice(insertIndex, 0, updatedLine);

      await this.app.vault.modify(sourceInfo.file, lines.join('\n'));
    } catch (error) {
      console.error('Error moving task:', error);
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Update task dates (for Gantt bar drag)
   */
  async updateTaskDates(
    sourceInfo: SourceInfo,
    task: NoodleTask,
    newStart: Date,
    newDuration: number
  ): Promise<void> {
    await this.updateTaskInSource(sourceInfo, task, {
      start: newStart,
      durationDays: newDuration
    });
  }

  /**
   * Update task percent (for progress changes)
   */
  async updateTaskPercent(
    sourceInfo: SourceInfo,
    task: NoodleTask,
    newPercent: number
  ): Promise<void> {
    await this.updateTaskInSource(sourceInfo, task, {
      percent: newPercent
    });
  }

  /**
   * Update task resources (for Kanban resource view drag)
   */
  async updateTaskResources(
    sourceInfo: SourceInfo,
    task: NoodleTask,
    newResources: string[]
  ): Promise<void> {
    await this.updateTaskInSource(sourceInfo, task, {
      resources: newResources
    });
  }
}
