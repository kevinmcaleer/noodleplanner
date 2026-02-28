import SwiftUI

/// Sheet for picking a plan template.
struct TemplatePickerView: View {
    @Environment(\.dismiss) private var dismiss
    let onSelect: (String, String) -> Void

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: 16)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(PlanTemplates.all) { template in
                        templateCard(template)
                    }
                }
                .padding()
            }
            .navigationTitle("Choose a Template")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func templateCard(_ template: PlanTemplate) -> some View {
        Button {
            onSelect(template.name, template.content)
            dismiss()
        } label: {
            VStack(spacing: 12) {
                Image(systemName: template.icon)
                    .font(.largeTitle)
                    .foregroundStyle(.tint)
                    .frame(height: 50)

                VStack(spacing: 4) {
                    Text(template.name)
                        .font(.subheadline.bold())
                        .multilineTextAlignment(.center)

                    Text(template.category)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                }

                Text(template.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
            .padding()
            .frame(maxWidth: .infinity, minHeight: 180)
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    TemplatePickerView { _, _ in }
}
