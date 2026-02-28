import Foundation
import SwiftData
import Combine

/// ViewModel for a single plan — parses text, schedules tasks, powers all views.
@Observable
final class PlanViewModel {
    var plan: Plan
    var scheduledTasks: [ScheduledTask] = []
    var ragStatus: RAGStatus = .green
    var parseError: String?

    init(plan: Plan) {
        self.plan = plan
        reparse()
    }

    // MARK: - Parsing & Scheduling

    func reparse() {
        let parsed = PlanParser.parse(plan.rawText)
        if let title = parsed.title, plan.title.isEmpty {
            plan.title = title
        }
        var tasks = parsed.tasks
        SchedulingEngine.schedule(&tasks)
        scheduledTasks = tasks
        ragStatus = SchedulingEngine.calculateRAG(for: tasks)

        // Check for dependency loops
        let loops = SchedulingEngine.detectDependencyLoops(in: tasks)
        if loops.hasLoops {
            parseError = "Circular dependency detected: \(loops.loops.first ?? "")"
        } else {
            parseError = nil
        }
    }

    func updateText(_ newText: String) {
        plan.rawText = newText
        plan.updatedAt = Date()
        reparse()
    }

    // MARK: - Derived Data for Views

    /// Unique phase names in order.
    var phases: [String] {
        var seen = Set<String>()
        return scheduledTasks.compactMap { task in
            let phase = task.phase
            guard !phase.isEmpty, !seen.contains(phase) else { return nil }
            seen.insert(phase)
            return phase
        }
    }

    /// Tasks grouped by phase for Kanban.
    var tasksByPhase: [String: [ScheduledTask]] {
        Dictionary(grouping: scheduledTasks.filter { !$0.isSummary }, by: \.phase)
    }

    /// Tasks grouped by resource.
    var tasksByResource: [String: [ScheduledTask]] {
        var result: [String: [ScheduledTask]] = [:]
        for task in scheduledTasks where !task.isSummary {
            if task.resources.isEmpty {
                result["Unassigned", default: []].append(task)
            } else {
                for resource in task.resources {
                    result[resource, default: []].append(task)
                }
            }
        }
        return result
    }

    /// Tasks grouped by progress bucket.
    var tasksByProgress: [String: [ScheduledTask]] {
        var result: [String: [ScheduledTask]] = [
            "Not Started": [],
            "In Progress": [],
            "Complete": []
        ]
        for task in scheduledTasks where !task.isSummary {
            if task.percent >= 100 {
                result["Complete"]?.append(task)
            } else if task.percent > 0 {
                result["In Progress"]?.append(task)
            } else {
                result["Not Started"]?.append(task)
            }
        }
        return result
    }

    /// Unique resources across all tasks.
    var allResources: [String] {
        let resources = Set(scheduledTasks.flatMap(\.resources))
        return Array(resources).sorted()
    }

    /// Overall percent complete.
    var overallPercent: Int {
        let leaves = scheduledTasks.filter { !$0.isSummary }
        guard !leaves.isEmpty else { return 0 }
        return leaves.reduce(0) { $0 + $1.percent } / leaves.count
    }

    /// Date range for the entire plan.
    var dateRange: (start: Date, finish: Date)? {
        let starts = scheduledTasks.compactMap(\.start)
        let finishes = scheduledTasks.compactMap(\.finish)
        guard let earliest = starts.min(), let latest = finishes.max() else { return nil }
        return (earliest, latest)
    }
}
