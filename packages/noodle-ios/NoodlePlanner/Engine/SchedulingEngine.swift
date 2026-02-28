import Foundation

/// Port of noodle-core scheduling_engine.py — all on-device, no server needed.
struct SchedulingEngine {

    // MARK: - Working Day Helpers

    /// Returns the next working day (Mon-Fri) on or after `date`.
    static func nextWorkingDay(from date: Date) -> Date {
        let calendar = Calendar.current
        var current = calendar.startOfDay(for: date)
        for _ in 0..<366 {
            let weekday = calendar.component(.weekday, from: current)
            if weekday != 1 && weekday != 7 { // not Sun(1) or Sat(7)
                return current
            }
            current = calendar.date(byAdding: .day, value: 1, to: current)!
        }
        return current
    }

    /// Add `numDays` working days to `startDate`. Finish date is exclusive
    /// (one day after the last working day) to match noodle-core convention.
    static func addWorkingDays(to startDate: Date, days numDays: Int) -> Date {
        let calendar = Calendar.current
        if numDays == 0 { return startDate } // milestones

        var current = nextWorkingDay(from: startDate)
        var added = 1
        while added < numDays {
            current = calendar.date(byAdding: .day, value: 1, to: current)!
            let weekday = calendar.component(.weekday, from: current)
            if weekday != 1 && weekday != 7 {
                added += 1
            }
        }
        // Exclusive finish date
        return calendar.date(byAdding: .day, value: 1, to: current)!
    }

    // MARK: - Duration Parsing

    /// Parse "10d", "2w", "3m", "1y" to calendar days.
    static func parseDurationToDays(_ s: String) -> Int? {
        let pattern = #"^(\d+)([dwmy])$"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
              let numRange = Range(match.range(at: 1), in: s),
              let unitRange = Range(match.range(at: 2), in: s),
              let value = Int(s[numRange]) else { return nil }

        let unit = String(s[unitRange])
        switch unit {
        case "d": return value
        case "w": return value * 7
        case "m": return value * 30
        case "y": return value * 365
        default: return nil
        }
    }

    /// Parse lag/lead offset like "+2d", "-1w" to signed days.
    static func parseLagLead(_ s: String) -> Int {
        let pattern = #"^([+\-])(\d+)([dwmy])$"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
              let signRange = Range(match.range(at: 1), in: s),
              let numRange = Range(match.range(at: 2), in: s),
              let unitRange = Range(match.range(at: 3), in: s),
              let value = Int(s[numRange]) else { return 0 }

        let multipliers: [String: Int] = ["d": 1, "w": 7, "m": 30, "y": 365]
        let days = value * (multipliers[String(s[unitRange])] ?? 1)
        return String(s[signRange]) == "+" ? days : -days
    }

    // MARK: - Dependency Loop Detection

    struct LoopResult {
        var hasLoops: Bool = false
        var loops: [String] = []
        var affectedTasks: Set<String> = []
    }

    static func detectDependencyLoops(in tasks: [ScheduledTask]) -> LoopResult {
        var result = LoopResult()
        let taskMap = Dictionary(tasks.map { ($0.name.lowercased(), $0) }, uniquingKeysWith: { first, _ in first })

        // Build adjacency list
        var graph: [String: Set<String>] = [:]
        for task in tasks {
            let key = task.name.lowercased()
            graph[key] = Set(task.depends.compactMap { dep in
                let low = dep.lowercased()
                return taskMap[low] != nil ? low : nil
            })
        }

        var visited = Set<String>()
        var recStack = Set<String>()

        func dfs(_ node: String, _ path: [String]) {
            visited.insert(node)
            recStack.insert(node)
            var path = path + [node]

            for neighbor in graph[node] ?? [] {
                if !visited.contains(neighbor) {
                    dfs(neighbor, path)
                } else if recStack.contains(neighbor) {
                    if let idx = path.firstIndex(of: neighbor) {
                        let cycle = Array(path[idx...]) + [neighbor]
                        result.loops.append(cycle.joined(separator: " -> "))
                        result.hasLoops = true
                        cycle.dropLast().forEach { result.affectedTasks.insert($0) }
                    }
                }
            }
            recStack.remove(node)
        }

        for taskName in graph.keys where !visited.contains(taskName) {
            dfs(taskName, [])
        }
        return result
    }

    // MARK: - RAG Status

    static func calculateRAG(for tasks: [ScheduledTask]) -> RAGStatus {
        let leafTasks = tasks.filter { !$0.isSummary }
        guard !leafTasks.isEmpty else { return .green }

        let today = Calendar.current.startOfDay(for: Date())
        var overdue = 0
        var atRisk = 0

        for task in leafTasks {
            guard let finish = task.finish else { continue }
            if task.percent >= 100 { continue }

            if finish < today {
                overdue += 1
            } else if let warning = Calendar.current.date(byAdding: .day, value: -3, to: finish),
                      today >= warning {
                atRisk += 1
            }
        }

        if overdue > 0 { return .red }
        if atRisk > 0 { return .amber }
        return .green
    }

    // MARK: - Schedule Tasks

    /// Schedule a flat list of parsed tasks, resolving dependencies and computing dates.
    static func schedule(_ tasks: inout [ScheduledTask]) {
        let nameLookup = Dictionary(
            tasks.enumerated().map { ($1.name.lowercased(), $0) },
            uniquingKeysWith: { first, _ in first }
        )

        let today = Calendar.current.startOfDay(for: Date())

        for idx in tasks.indices {
            if tasks[idx].isSummary { continue }

            let durationDays = tasks[idx].durationDays
            let isMilestone = durationDays == 0

            if tasks[idx].isSequential {
                // Find previous non-summary task
                var prev: ScheduledTask?
                for j in stride(from: idx - 1, through: 0, by: -1) {
                    if !tasks[j].isSummary {
                        prev = tasks[j]
                        break
                    }
                }

                if let prevTask = prev, let prevFinish = prevTask.finish {
                    // Record resolved sequential dependency
                    if !tasks[idx].depends.contains(prevTask.name) {
                        tasks[idx].depends.append(prevTask.name)
                    }
                    if isMilestone {
                        tasks[idx].start = prevFinish
                        tasks[idx].finish = prevFinish
                    } else {
                        tasks[idx].start = nextWorkingDay(from: prevFinish)
                    }
                } else {
                    tasks[idx].start = nextWorkingDay(from: today)
                }

                if !isMilestone || tasks[idx].finish == nil {
                    tasks[idx].finish = addWorkingDays(to: tasks[idx].start!, days: max(durationDays, 1))
                }

            } else if !tasks[idx].depends.isEmpty {
                // Dependency-based scheduling
                var depFinishes: [Date] = []
                for dep in tasks[idx].depends {
                    if let depIdx = nameLookup[dep.lowercased()],
                       let depFinish = tasks[depIdx].finish {
                        depFinishes.append(depFinish)
                    }
                }

                if let latestFinish = depFinishes.max() {
                    if isMilestone {
                        tasks[idx].start = latestFinish
                        tasks[idx].finish = latestFinish
                    } else {
                        let depStart = nextWorkingDay(from: latestFinish)
                        if let explicit = tasks[idx].start, explicit > depStart {
                            // explicit start acts as "not before" constraint
                        } else {
                            tasks[idx].start = depStart
                        }
                    }
                } else if tasks[idx].start == nil {
                    tasks[idx].start = nextWorkingDay(from: today)
                }

                if !isMilestone || tasks[idx].finish == nil {
                    tasks[idx].finish = addWorkingDays(to: tasks[idx].start ?? today, days: max(durationDays, 1))
                }

            } else if tasks[idx].start != nil {
                // Explicit start date
                tasks[idx].finish = addWorkingDays(to: tasks[idx].start!, days: max(durationDays, 1))

            } else {
                // Default: parallel start
                let parentName = tasks[idx].parent
                if let parentName {
                    if let sibling = tasks.first(where: { $0.parent == parentName && !$0.isSummary && $0.start != nil }) {
                        tasks[idx].start = sibling.start
                    } else {
                        tasks[idx].start = nextWorkingDay(from: today)
                    }
                } else {
                    tasks[idx].start = nextWorkingDay(from: today)
                }
                tasks[idx].finish = addWorkingDays(to: tasks[idx].start!, days: max(durationDays, 1))
            }
        }

        // Calculate summary task dates from children
        calculateSummaryDates(&tasks)
    }

    private static func calculateSummaryDates(_ tasks: inout [ScheduledTask]) {
        // Process summaries bottom-up: deepest first
        let summaryIndices = tasks.indices.filter { tasks[$0].isSummary }

        for idx in summaryIndices.reversed() {
            let name = tasks[idx].name
            let children = tasks.filter { $0.parent == name }
            let starts = children.compactMap(\.start)
            let finishes = children.compactMap(\.finish)

            if let earliest = starts.min() { tasks[idx].start = earliest }
            if let latest = finishes.max() { tasks[idx].finish = latest }

            // Aggregate percent from children
            let leafChildren = children.filter { !$0.isSummary }
            if !leafChildren.isEmpty {
                let total = leafChildren.reduce(0) { $0 + $1.percent }
                tasks[idx].percent = total / leafChildren.count
            }
        }
    }
}
