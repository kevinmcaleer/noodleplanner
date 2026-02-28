import SwiftUI
import SwiftData

struct ProjectListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Plan.updatedAt, order: .reverse) private var plans: [Plan]
    @State private var showingNewPlan = false
    @State private var showingTemplates = false
    @State private var newPlanTitle = ""

    var body: some View {
        NavigationStack {
            Group {
                if plans.isEmpty {
                    emptyState
                } else {
                    planList
                }
            }
            .navigationTitle("Noodle Planner")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("Blank Plan") { showingNewPlan = true }
                        Button("From Template...") { showingTemplates = true }
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .alert("New Plan", isPresented: $showingNewPlan) {
                TextField("Plan title", text: $newPlanTitle)
                Button("Create") { createPlan() }
                Button("Cancel", role: .cancel) { newPlanTitle = "" }
            } message: {
                Text("Enter a name for your new plan.")
            }
            .sheet(isPresented: $showingTemplates) {
                TemplatePickerView { title, content in
                    createPlan(title: title, content: content)
                }
            }
        }
    }

    // MARK: - Subviews

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No Plans Yet", systemImage: "doc.text")
        } description: {
            Text("Create a new plan to get started with project scheduling.")
        } actions: {
            Button("Create Plan") { showingNewPlan = true }
                .buttonStyle(.borderedProminent)
            Button("Use a Template") { showingTemplates = true }
                .buttonStyle(.bordered)
        }
    }

    private var planList: some View {
        List {
            ForEach(plans) { plan in
                NavigationLink(destination: PlanDetailView(plan: plan)) {
                    PlanRowView(plan: plan)
                }
            }
            .onDelete(perform: deletePlans)
        }
    }

    // MARK: - Actions

    private func createPlan(title: String? = nil, content: String? = nil) {
        let planTitle = title ?? newPlanTitle
        guard !planTitle.isEmpty else { return }
        let plan = Plan(title: planTitle, rawText: content ?? "")
        modelContext.insert(plan)
        newPlanTitle = ""
    }

    private func deletePlans(at offsets: IndexSet) {
        for index in offsets {
            modelContext.delete(plans[index])
        }
    }
}

// MARK: - Plan Row

struct PlanRowView: View {
    let plan: Plan

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(plan.title)
                    .font(.headline)
                Spacer()
                ragBadge
            }
            Text(plan.updatedAt, style: .relative)
                .font(.caption)
                .foregroundStyle(.secondary)
            if !plan.rawText.isEmpty {
                let vm = PlanViewModel(plan: plan)
                HStack(spacing: 12) {
                    Label("\(vm.scheduledTasks.filter { !$0.isSummary }.count) tasks", systemImage: "checklist")
                    Label("\(vm.overallPercent)%", systemImage: "chart.bar.fill")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private var ragBadge: some View {
        let vm = PlanViewModel(plan: plan)
        return Text(vm.ragStatus.emoji)
            .font(.title3)
    }
}

#Preview {
    ProjectListView()
        .modelContainer(for: [Plan.self], inMemory: true)
}
