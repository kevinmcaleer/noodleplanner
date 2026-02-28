import SwiftUI

/// Three-mode Kanban board: Phase, Resource, or Progress view.
struct KanbanBoardView: View {
    @Bindable var viewModel: PlanViewModel
    @State private var kanbanMode: KanbanMode = .phase

    var body: some View {
        VStack(spacing: 0) {
            // Mode picker
            Picker("Group by", selection: $kanbanMode) {
                ForEach(KanbanMode.allCases, id: \.self) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 8)

            if viewModel.scheduledTasks.filter({ !$0.isSummary }).isEmpty {
                ContentUnavailableView("No Tasks", systemImage: "rectangle.split.3x1",
                                       description: Text("Add tasks in the editor to see the Kanban board."))
            } else {
                boardContent
            }
        }
    }

    // MARK: - Board Content

    private var boardContent: some View {
        let columns = columnsForMode()
        return ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(columns, id: \.title) { column in
                    KanbanColumnView(title: column.title, tasks: column.tasks)
                }
            }
            .padding()
        }
    }

    private struct KanbanColumn {
        let title: String
        let tasks: [ScheduledTask]
    }

    private func columnsForMode() -> [KanbanColumn] {
        switch kanbanMode {
        case .phase:
            return viewModel.phases.map { phase in
                KanbanColumn(title: phase, tasks: viewModel.tasksByPhase[phase] ?? [])
            }
        case .resource:
            let resources = viewModel.tasksByResource
            return resources.keys.sorted().map { key in
                KanbanColumn(title: key, tasks: resources[key] ?? [])
            }
        case .progress:
            return ["Not Started", "In Progress", "Complete"].map { bucket in
                KanbanColumn(title: bucket, tasks: viewModel.tasksByProgress[bucket] ?? [])
            }
        }
    }
}

// MARK: - Kanban Column

struct KanbanColumnView: View {
    let title: String
    let tasks: [ScheduledTask]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Column header
            HStack {
                Text(title)
                    .font(.subheadline.bold())
                Spacer()
                Text("\(tasks.count)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Color(.tertiarySystemFill)))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 8))

            // Cards
            ScrollView(.vertical) {
                LazyVStack(spacing: 8) {
                    ForEach(tasks) { task in
                        KanbanCardView(task: task)
                    }
                }
            }
        }
        .frame(width: 260)
    }
}

// MARK: - Kanban Card

struct KanbanCardView: View {
    let task: ScheduledTask

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Title
            Text(task.name)
                .font(.subheadline)
                .fontWeight(.medium)
                .lineLimit(2)

            // Progress bar
            if task.percent > 0 {
                ProgressView(value: Double(task.percent), total: 100)
                    .tint(task.percent >= 100 ? .green : .blue)
            }

            HStack(spacing: 6) {
                // Resources
                if !task.resources.isEmpty {
                    ForEach(task.resources, id: \.self) { resource in
                        Text("@\(resource)")
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(Color.blue.opacity(0.15)))
                    }
                }

                Spacer()

                // Duration
                if task.durationDays > 0 {
                    Text("\(task.durationDays)d")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Image(systemName: "diamond.fill")
                        .font(.caption2)
                        .foregroundStyle(.purple)
                }
            }

            // Due date and priority
            HStack {
                if let start = task.start {
                    Text(start, format: .dateTime.month(.abbreviated).day())
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                priorityBadge
            }

            // Comment
            if !task.comment.isEmpty {
                Text(task.comment)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(12)
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .shadow(color: .black.opacity(0.08), radius: 3, y: 1)
    }

    @ViewBuilder
    private var priorityBadge: some View {
        if task.priority != .low {
            Text(task.priority.rawValue)
                .font(.caption2)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Capsule().fill(priorityColor.opacity(0.15)))
                .foregroundStyle(priorityColor)
        }
    }

    private var priorityColor: Color {
        switch task.priority {
        case .urgent: return .red
        case .important: return .orange
        case .medium: return .yellow
        case .low: return .gray
        }
    }
}

// MARK: - Mode

enum KanbanMode: String, CaseIterable {
    case phase
    case resource
    case progress

    var title: String {
        switch self {
        case .phase: return "Phase"
        case .resource: return "Resource"
        case .progress: return "Progress"
        }
    }
}
