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
            RAGBadge(status: viewModel.ragStatus)

            Spacer()

            let leafCount = viewModel.scheduledTasks.filter { !$0.isSummary }.count
            Text("\(leafCount) tasks")
                .font(NP.data())
                .foregroundStyle(NP.muted)

            Text("\(viewModel.overallPercent)% complete")
                .font(NP.data())
                .foregroundStyle(NP.muted)

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
        .background(NP.surfaceAlt)
    }

    // MARK: - Editor

    private var editorPanel: some View {
        VStack(spacing: 0) {
            if let error = viewModel.parseError {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(NP.accentInk)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(NP.body)
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.vertical, 6)
                .background(NP.accentTint)
            }

            TextEditor(text: Binding(
                get: { viewModel.plan.rawText },
                set: { viewModel.updateText($0) }
            ))
            .font(NP.data(.body))
            .foregroundStyle(NP.ink)
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
                Section(header: Text(phase).font(NP.heading(.headline)).foregroundStyle(NP.ink)) {
                    let tasks = viewModel.tasksByPhase[phase] ?? []
                    ForEach(tasks) { task in
                        TaskRowView(task: task)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
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
                        .foregroundStyle(task.percent >= 100 ? NP.successInk : NP.accentInk)
                }
            }

            HStack(spacing: 8) {
                if !task.resources.isEmpty {
                    Label(task.resources.joined(separator: ", "), systemImage: "person")
                        .font(.caption2)
                        .foregroundStyle(NP.infoInk)
                }
                if task.durationDays > 0 {
                    Label("\(task.durationDays)d", systemImage: "clock")
                        .font(.caption2)
                        .foregroundStyle(NP.muted)
                } else {
                    Label("Milestone", systemImage: "diamond")
                        .font(.caption2)
                        .foregroundStyle(NP.purple)
                }
                if let start = task.start {
                    Text(start, format: .dateTime.month(.abbreviated).day())
                        .font(.caption2)
                        .foregroundStyle(NP.muted)
                }
                if !task.comment.isEmpty {
                    Label(task.comment, systemImage: "text.bubble")
                        .font(.caption2)
                        .foregroundStyle(NP.muted)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 2)
    }
}
