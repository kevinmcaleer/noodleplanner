import Foundation
import SwiftData

@Model
final class Plan {
    var id: UUID
    var title: String
    var rawText: String
    var createdAt: Date
    var updatedAt: Date

    init(title: String, rawText: String = "") {
        self.id = UUID()
        self.title = title
        self.rawText = rawText
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}
