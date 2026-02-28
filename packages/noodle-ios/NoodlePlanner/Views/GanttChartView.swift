import SwiftUI

/// Scrollable Gantt chart that renders task bars proportionally across a calendar timeline.
struct GanttChartView: View {
    @Bindable var viewModel: PlanViewModel

    private let rowHeight: CGFloat = 32
    private let labelWidth: CGFloat = 160
    private let dayWidth: CGFloat = 20

    var body: some View {
        if viewModel.scheduledTasks.isEmpty {
            ContentUnavailableView("No Tasks", systemImage: "chart.bar.xaxis",
                                   description: Text("Add tasks in the editor to see the Gantt chart."))
        } else if let range = viewModel.dateRange {
            ganttContent(range: range)
        }
    }

    // MARK: - Gantt Content

    private func ganttContent(range: (start: Date, finish: Date)) -> some View {
        let calendar = Calendar.current
        let totalDays = max(1, calendar.dateComponents([.day], from: range.start, to: range.finish).day ?? 1)
        let chartWidth = CGFloat(totalDays) * dayWidth

        return ScrollView([.horizontal, .vertical]) {
            VStack(spacing: 0) {
                // Header with month/day labels
                headerRow(start: range.start, totalDays: totalDays, chartWidth: chartWidth)

                // Task rows
                ForEach(viewModel.scheduledTasks) { task in
                    taskRow(task: task, planStart: range.start, totalDays: totalDays, chartWidth: chartWidth)
                }
            }
        }
        .background(Color(.systemBackground))
    }

    // MARK: - Header

    private func headerRow(start: Date, totalDays: Int, chartWidth: CGFloat) -> some View {
        let calendar = Calendar.current
        return HStack(spacing: 0) {
            // Label column
            Text("Task")
                .font(.caption.bold())
                .frame(width: labelWidth, alignment: .leading)
                .padding(.horizontal, 8)

            // Day columns — show month labels
            ZStack(alignment: .leading) {
                // Month markers
                ForEach(monthMarkers(start: start, totalDays: totalDays), id: \.offset) { marker in
                    Text(marker.label)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .offset(x: CGFloat(marker.offset) * dayWidth)
                }
            }
            .frame(width: chartWidth, height: 24, alignment: .leading)
        }
        .background(Color(.secondarySystemBackground))
    }

    private struct MonthMarker {
        let label: String
        let offset: Int
    }

    private func monthMarkers(start: Date, totalDays: Int) -> [MonthMarker] {
        let calendar = Calendar.current
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM yyyy"

        var markers: [MonthMarker] = []
        var current = start
        for day in 0..<totalDays {
            let dayComponent = calendar.component(.day, from: current)
            if dayComponent == 1 || day == 0 {
                markers.append(MonthMarker(label: formatter.string(from: current), offset: day))
            }
            current = calendar.date(byAdding: .day, value: 1, to: current)!
        }
        return markers
    }

    // MARK: - Task Row

    private func taskRow(task: ScheduledTask, planStart: Date, totalDays: Int, chartWidth: CGFloat) -> some View {
        let calendar = Calendar.current
        let startOffset = task.start.map { calendar.dateComponents([.day], from: planStart, to: $0).day ?? 0 } ?? 0
        let taskDays = {
            if let s = task.start, let f = task.finish {
                return max(1, calendar.dateComponents([.day], from: s, to: f).day ?? 1)
            }
            return 1
        }()
        let isMilestone = task.durationDays == 0

        return HStack(spacing: 0) {
            // Label
            HStack(spacing: 4) {
                if task.isSummary {
                    Image(systemName: "folder")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Text(task.name)
                    .font(.caption)
                    .fontWeight(task.isSummary ? .semibold : .regular)
                    .lineLimit(1)
            }
            .padding(.leading, CGFloat(task.level) * 12 + 8)
            .frame(width: labelWidth, alignment: .leading)

            // Bar area
            ZStack(alignment: .leading) {
                // Today line
                let todayOffset = calendar.dateComponents([.day], from: planStart, to: Date()).day ?? 0
                if todayOffset >= 0 && todayOffset <= totalDays {
                    Rectangle()
                        .fill(Color.red.opacity(0.3))
                        .frame(width: 1)
                        .offset(x: CGFloat(todayOffset) * dayWidth)
                }

                if isMilestone {
                    // Diamond for milestones
                    Image(systemName: "diamond.fill")
                        .font(.caption)
                        .foregroundStyle(.purple)
                        .offset(x: CGFloat(startOffset) * dayWidth - 4)
                } else {
                    // Task bar
                    let barWidth = max(4, CGFloat(taskDays) * dayWidth - 2)
                    let barColor = barColor(for: task)

                    RoundedRectangle(cornerRadius: 3)
                        .fill(barColor.opacity(task.isSummary ? 0.4 : 0.7))
                        .frame(width: barWidth, height: task.isSummary ? 8 : 18)
                        .overlay(alignment: .leading) {
                            if task.percent > 0 && !task.isSummary {
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(barColor)
                                    .frame(width: barWidth * CGFloat(task.percent) / 100)
                            }
                        }
                        .offset(x: CGFloat(startOffset) * dayWidth)
                }
            }
            .frame(width: chartWidth, height: rowHeight, alignment: .leading)
        }
        .frame(height: rowHeight)
        .background(task.isSummary ? Color(.tertiarySystemBackground) : Color.clear)
    }

    private func barColor(for task: ScheduledTask) -> Color {
        if task.percent >= 100 { return .green }
        if let finish = task.finish, finish < Date() && task.percent < 100 { return .red }
        if !task.resources.isEmpty { return .blue }
        return .accentColor
    }
}
