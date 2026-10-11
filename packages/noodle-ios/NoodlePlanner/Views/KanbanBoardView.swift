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
                    .font(NP.heading(.subheadline))
                    .foregroundStyle(NP.ink)
                Spacer()
                NPChip(text: "\(tasks.count)", foreground: NP.body, background: NP.selected)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(NP.surfaceAlt)
            .clipShape(RoundedRectangle(cornerRadius: NP.Radius.lg))

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
                .foregroundStyle(NP.ink)
                .lineLimit(2)

            // Progress bar
            if task.percent > 0 {
                ProgressView(value: Double(task.percent), total: 100)
                    .tint(task.percent >= 100 ? NP.success : NP.accent)
            }

            HStack(spacing: 6) {
                // Resources
                if !task.resources.isEmpty {
                    ForEach(task.resources, id: \.self) { resource in
                        NPChip(text: "@\(resource)", foreground: NP.infoInk, background: NP.infoTint)
                    }
                }

                Spacer()

                // Duration
                if task.durationDays > 0 {
                    Text("\(task.durationDays)d")
                        .font(NP.data(.caption2))
                        .foregroundStyle(NP.muted)
                } else {
                    Image(systemName: "diamond.fill")
                        .font(.caption2)
                        .foregroundStyle(NP.purple)
                }
            }

            // Due date and priority
            HStack {
                if let start = task.start {
                    Text(start, format: .dateTime.month(.abbreviated).day())
                        .font(NP.data(.caption2))
                        .foregroundStyle(NP.muted)
                }
                Spacer()
                priorityBadge
            }

            // Comment
            if !task.comment.isEmpty {
                Text(task.comment)
                    .font(.caption2)
                    .foregroundStyle(NP.muted)
                    .lineLimit(2)
            }
        }
        .padding(12)
        .npCard()
    }

    @ViewBuilder
    private var priorityBadge: some View {
        if task.priority != .low {
            NPChip(text: task.priority.rawValue, foreground: priorityInk, background: priorityTint)
        }
    }

    private var priorityInk: Color {
        switch task.priority {
        case .urgent: return NP.dangerInk
        case .important, .medium: return NP.accentInk
        case .low: return NP.body
        }
    }

    private var priorityTint: Color {
        switch task.priority {
        case .urgent: return NP.dangerTint
        case .important, .medium: return NP.accentTint
        case .low: return NP.sunken
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
