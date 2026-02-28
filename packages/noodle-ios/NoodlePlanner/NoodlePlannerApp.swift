import SwiftUI
import SwiftData

@main
struct NoodlePlannerApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: [Plan.self])
    }
}
