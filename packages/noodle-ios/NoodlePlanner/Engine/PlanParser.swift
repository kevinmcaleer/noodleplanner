import Foundation

/// Parses noodle plan.md text format into structured ScheduledTask arrays.
/// Mirrors the Python scheduling_engine.py parsing logic.
struct PlanParser {

    struct ParsedPlan {
        var title: String?
        var resources: [ResourceMapping] = []
        var tasks: [ScheduledTask] = []
    }

    struct ResourceMapping {
        let id: String
        let name: String
        let role: String
    }

    // MARK: - Public API

    static func parse(_ text: String) -> ParsedPlan {
        var plan = ParsedPlan()
        let lines = text.components(separatedBy: "\n")

        var inFrontmatter = false
        var frontmatterLines: [String] = []
        var currentPhase: String?
        var taskLines: [(line: String, level: Int, phase: String?)] = []

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // YAML front matter
            if trimmed == "---" {
                if !inFrontmatter {
                    inFrontmatter = true
                    continue
                } else {
                    inFrontmatter = false
                    plan.title = extractTitle(from: frontmatterLines)
                    plan.resources = extractResources(from: frontmatterLines)
                    continue
                }
            }
            if inFrontmatter {
                frontmatterLines.append(line)
                continue
            }

            // Skip highlights and raid log sections
            if trimmed.hasPrefix("---highlights---") || trimmed.hasPrefix("---raid log---") {
                break
            }

            // Skip empty lines
            if trimmed.isEmpty { continue }

            // Phase headers (no leading whitespace, no - prefix)
            if !line.hasPrefix(" ") && !line.hasPrefix("\t") && !trimmed.hasPrefix("-") && !trimmed.hasPrefix("*") && !trimmed.hasPrefix("#") {
                currentPhase = trimmed
                continue
            }

            // Markdown-style headers
            if trimmed.hasPrefix("# ") {
                plan.title = String(trimmed.dropFirst(2))
                continue
            }
            if trimmed.hasPrefix("## ") {
                currentPhase = String(trimmed.dropFirst(3))
                continue
            }

            // Resource definition lines
            if trimmed.hasPrefix("@") && trimmed.contains(":") && currentPhase == nil {
                // Resource line like "@pm: Project Manager, Project Coordination"
                continue
            }

            // Start date line
            if trimmed.lowercased().hasPrefix("start:") {
                continue
            }

            // Task lines (indented, with - or * prefix or just indented text)
            let indentCount = line.prefix(while: { $0 == " " }).count
            let level = indentCount / 2
            taskLines.append((line: trimmed, level: level, phase: currentPhase))
        }

        // Parse task lines into ScheduledTask objects
        var phaseStack: [(name: String, level: Int)] = []
        for (line, level, phase) in taskLines {
            let task = parseTaskLine(line, level: level, phase: phase, phaseStack: &phaseStack)
            plan.tasks.append(task)
        }

        return plan
    }

    // MARK: - Front Matter Parsing

    private static func extractTitle(from lines: [String]) -> String? {
        for line in lines {
            if line.lowercased().trimmingCharacters(in: .whitespaces).hasPrefix("title:") {
                let value = line.components(separatedBy: ":").dropFirst().joined(separator: ":").trimmingCharacters(in: .whitespaces)
                return value.isEmpty ? nil : value
            }
        }
        return nil
    }

    private static func extractResources(from lines: [String]) -> [ResourceMapping] {
        var resources: [ResourceMapping] = []
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "- ", with: "")
            guard trimmed.hasPrefix("@"), trimmed.contains(":") else { continue }
            let parts = trimmed.components(separatedBy: ":")
            let id = parts[0].trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "@", with: "")
            let rest = parts.dropFirst().joined(separator: ":").trimmingCharacters(in: .whitespaces)
            let restParts = rest.components(separatedBy: ",")
            let name = restParts.first?.trimmingCharacters(in: .whitespaces) ?? id
            let role = restParts.dropFirst().joined(separator: ",").trimmingCharacters(in: .whitespaces)
            resources.append(ResourceMapping(id: id, name: name, role: role))
        }
        return resources
    }

    // MARK: - Task Line Parsing

    private static func parseTaskLine(_ line: String, level: Int, phase: String?, phaseStack: inout [(name: String, level: Int)]) -> ScheduledTask {
        var text = line
        let isSequential = text.hasPrefix("*")
        if isSequential {
            text = String(text.dropFirst()).trimmingCharacters(in: .whitespaces)
        }

        // Strip list marker
        if text.hasPrefix("- ") { text = String(text.dropFirst(2)) }

        // Extract resources (@name)
        let resourcePattern = #"@(\w+)"#
        let resources = matches(for: resourcePattern, in: text).map { String($0.dropFirst()) }

        // Extract labels (#tag)
        let labelPattern = #"#([^@%#!\s]+)"#
        let labels = matches(for: labelPattern, in: text)

        // Extract dependencies [depends task1, task2]
        var depends: [String] = []
        let depPattern = #"\[depends\s*([^\]]*)\]"#
        if let depMatch = firstMatch(for: depPattern, in: text, group: 1) {
            depends = depMatch.components(separatedBy: ",").map {
                // Strip lag/lead time from dep name for now
                $0.trimmingCharacters(in: .whitespaces)
                    .replacingOccurrences(of: #"\s+[+\-]\d+[dwmy]$"#, with: "", options: .regularExpression)
            }.filter { !$0.isEmpty }
        }

        // Extract percent (10%)
        var percent = 0
        if let pMatch = firstMatch(for: #"(\d{1,3})%"#, in: text, group: 1), let p = Int(pMatch) {
            percent = min(100, max(0, p))
        }

        // Extract duration (10d, 2w, etc.) — avoid matching effort tokens (~8h)
        var durationDays = 1
        if let durMatch = firstMatch(for: #"(?<!~)(?<!/)\b(\d+)([dwmy])\b"#, in: text, group: 0),
           let parsed = SchedulingEngine.parseDurationToDays(durMatch) {
            durationDays = parsed
        }

        // Extract explicit start date (2025-03-01)
        var startDate: Date?
        if let dateMatch = firstMatch(for: #"(\d{4}-\d{2}-\d{2})"#, in: text, group: 1) {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            startDate = formatter.date(from: dateMatch)
        }

        // Duration of 0 = milestone
        let durationStr = firstMatch(for: #"(?<!~)(?<!/)\b(\d+)([dwmy])\b"#, in: text, group: 0) ?? ""
        if durationStr == "0d" || durationStr == "0days" {
            durationDays = 0
        }
        // Also check for "0days" pattern
        if let match = firstMatch(for: #"\b0days?\b"#, in: text, group: 0) {
            let _ = match
            durationDays = 0
        }

        // Extract priority (!!!, !!, !)
        var priority: Priority = .low
        if let pMatch = firstMatch(for: #"(?<!\w)(!!!|!!|!)(?!["'])"#, in: text, group: 1) {
            switch pMatch {
            case "!!!": priority = .urgent
            case "!!": priority = .important
            case "!": priority = .medium
            default: break
            }
        }

        // Extract comment (!"text" or "text")
        var comment = ""
        if let c = firstMatch(for: #"!"([^"]+)""#, in: text, group: 1) {
            comment = c
        } else if let c = firstMatch(for: #""([^"]+)""#, in: text, group: 1) {
            comment = c
        }

        // Extract effort (~8h, ~3d/5d)
        var effortCompleted: Double?
        var effortTotal: Double?
        var effortUnit: String?
        let effortPattern = #"~(\d+(?:\.\d+)?)(h|d)(?:/(\d+(?:\.\d+)?)(h|d))?"#
        if let regex = try? NSRegularExpression(pattern: effortPattern),
           let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) {
            if let r1 = Range(match.range(at: 1), in: text), let v1 = Double(text[r1]),
               let r2 = Range(match.range(at: 2), in: text) {
                let u1 = String(text[r2])
                if match.range(at: 3).location != NSNotFound,
                   let r3 = Range(match.range(at: 3), in: text), let v3 = Double(text[r3]),
                   let r4 = Range(match.range(at: 4), in: text) {
                    effortCompleted = v1
                    effortTotal = v3
                    effortUnit = String(text[r4])
                } else {
                    effortCompleted = 0
                    effortTotal = v1
                    effortUnit = u1
                }
            }
        }

        // Auto-calculate percent from effort
        if let completed = effortCompleted, let total = effortTotal, total > 0 {
            percent = min(100, max(0, Int((completed / total) * 100)))
        }

        // Extract task name: everything before the first metadata token
        let metadataPattern = #"(@|#|!|"|\{|\d{4}-\d{2}-\d{2}|\d+[dwmy]|\d+%|~\d|\[depends)"#
        let taskName: String
        if let range = text.range(of: metadataPattern, options: .regularExpression) {
            taskName = String(text[text.startIndex..<range.lowerBound]).trimmingCharacters(in: .whitespaces)
        } else {
            taskName = text.trimmingCharacters(in: .whitespaces)
        }

        // Determine parent from phase stack
        while let last = phaseStack.last, last.level >= level {
            phaseStack.removeLast()
        }
        let parent = phaseStack.last?.name ?? phase

        // Check if this is a summary task (has children — determined later, default false)
        let task = ScheduledTask(
            name: taskName,
            description: taskName,
            level: level,
            isSummary: false,
            parent: parent,
            phase: phase ?? "",
            resources: resources,
            labels: labels,
            percent: percent,
            comment: comment,
            priority: priority,
            durationDays: durationDays,
            depends: depends,
            isSequential: isSequential,
            start: startDate,
            finish: nil,
            effortCompleted: effortCompleted,
            effortTotal: effortTotal,
            effortUnit: effortUnit
        )

        phaseStack.append((name: taskName, level: level))
        return task
    }

    // MARK: - Regex Helpers

    private static func matches(for pattern: String, in text: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let results = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
        return results.compactMap {
            guard let range = Range($0.range, in: text) else { return nil }
            return String(text[range])
        }
    }

    private static func firstMatch(for pattern: String, in text: String, group: Int = 0) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range(at: group), in: text) else { return nil }
        return String(text[range])
    }
}
