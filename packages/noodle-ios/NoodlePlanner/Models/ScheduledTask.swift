import Foundation

/// A task after scheduling — includes computed start/finish dates.
struct ScheduledTask: Identifiable {
    let id = UUID()
    let name: String
    let description: String
    let level: Int
    let isSummary: Bool
    let parent: String?
    let phase: String

    var resources: [String]
    var labels: [String]
    var percent: Int
    var comment: String
    var priority: Priority
    var durationDays: Int
    var depends: [String]
    var isSequential: Bool

    var start: Date?
    var finish: Date?

    /// Effort tracking
    var effortCompleted: Double?
    var effortTotal: Double?
    var effortUnit: String?
}

enum Priority: String, CaseIterable {
    case urgent = "Urgent"
    case important = "Important"
    case medium = "Medium"
    case low = "Low"

    var color: String {
        switch self {
        case .urgent: return "red"
        case .important: return "orange"
        case .medium: return "yellow"
        case .low: return "gray"
        }
    }
}

/// RAG status for a plan
enum RAGStatus: String {
    case red = "Red"
    case amber = "Amber"
    case green = "Green"

    var emoji: String {
        switch self {
        case .red: return "🔴"
        case .amber: return "🟡"
        case .green: return "🟢"
        }
    }
}
