import SwiftUI

/// Main tabbed view for a single plan — Editor, Gantt, Kanban.
struct PlanDetailView: View {
    let plan: Plan
    @State private var viewModel: PlanViewModel
    @State private var selectedTab: PlanTab = .editor

    init(plan: Plan) {
        self.plan = plan
        self._viewModel = State(initialValue: PlanViewModel(plan: plan))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Tab picker
            Picker("View", selection: $selectedTab) {
                ForEach(PlanTab.allCases, id: \.self) { tab in
                    Label(tab.title, systemImage: tab.icon).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.top, 8)

            // Tab content
            Group {
                switch selectedTab {
                case .editor:
                    PlanEditorView(viewModel: viewModel)
                case .gantt:
                    GanttChartView(viewModel: viewModel)
                case .kanban:
                    KanbanBoardView(viewModel: viewModel)
                }
            }
        }
        .navigationTitle(plan.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    ShareLink(
                        item: plan.rawText,
                        subject: Text(plan.title),
                        message: Text("Shared from Noodle Planner")
                    )
                } label: {
                    Image(systemName: "square.and.arrow.up")
                }
            }
        }
    }
}

enum PlanTab: String, CaseIterable {
    case editor
    case gantt
    case kanban

    var title: String {
        switch self {
        case .editor: return "Editor"
        case .gantt: return "Gantt"
        case .kanban: return "Kanban"
        }
    }

    var icon: String {
        switch self {
        case .editor: return "doc.text"
        case .gantt: return "chart.bar.xaxis"
        case .kanban: return "rectangle.split.3x1"
        }
    }
}
