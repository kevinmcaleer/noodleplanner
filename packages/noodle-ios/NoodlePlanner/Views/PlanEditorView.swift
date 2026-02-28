import SwiftUI

/// Live text editor for plan.md content with a summary panel.
struct PlanEditorView: View {
    @Bindable var viewModel: PlanViewModel
    @State private var showingTaskList = false
    @FocusState private var editorFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Summary bar
            summaryBar

            if showingTaskList {
                taskListPanel
            } else {
                editorPanel
            }
        }
    }

    // MARK: - Summary Bar

    private var summaryBar: some View {
        HStack(spacing: 16) {
            Label(viewModel.ragStatus.emoji, systemImage: "circle.fill")
                .labelStyle(.titleOnly)

            Spacer()

            let leafCount = viewModel.scheduledTasks.filter { !$0.isSummary }.count
            Text("\(leafCount) tasks")
                .font(.caption)
                .foregroundStyle(.secondary)

            Text("\(viewModel.overallPercent)% complete")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button {
                showingTaskList.toggle()
            } label: {
                Image(systemName: showingTaskList ? "doc.text" : "list.bullet")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
    }

    // MARK: - Editor

    private var editorPanel: some View {
        VStack(spacing: 0) {
            if let error = viewModel.parseError {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.yellow)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.vertical, 6)
                .background(Color.yellow.opacity(0.1))
            }

            TextEditor(text: Binding(
                get: { viewModel.plan.rawText },
                set: { viewModel.updateText($0) }
            ))
            .font(.system(.body, design: .monospaced))
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .focused($editorFocused)
            .scrollContentBackground(.hidden)
            .padding(8)
        }
    }

    // MARK: - Task List (parsed output)

    private var taskListPanel: some View {
        List {
            ForEach(viewModel.phases, id: \.self) { phase in
                Section(header: Text(phase).font(.headline)) {
                    let tasks = viewModel.tasksByPhase[phase] ?? []
                    ForEach(tasks) { task in
                        TaskRowView(task: task)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }
}

// MARK: - Task Row

struct TaskRowView: View {
    let task: ScheduledTask

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(String(repeating: "  ", count: max(0, task.level - 1)))
                    + Text(task.name)
                        .font(.subheadline)
                        .fontWeight(task.isSummary ? .bold : .regular)
                Spacer()
                if task.percent > 0 {
                    Text("\(task.percent)%")
                        .font(.caption)
                        .foregroundStyle(task.percent >= 100 ? .green : .orange)
                }
            }

            HStack(spacing: 8) {
                if !task.resources.isEmpty {
                    Label(task.resources.joined(separator: ", "), systemImage: "person")
                        .font(.caption2)
                        .foregroundStyle(.blue)
                }
                if task.durationDays > 0 {
                    Label("\(task.durationDays)d", systemImage: "clock")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Label("Milestone", systemImage: "diamond")
                        .font(.caption2)
                        .foregroundStyle(.purple)
                }
                if let start = task.start {
                    Text(start, format: .dateTime.month(.abbreviated).day())
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if !task.comment.isEmpty {
                    Label(task.comment, systemImage: "text.bubble")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 2)
    }
}
