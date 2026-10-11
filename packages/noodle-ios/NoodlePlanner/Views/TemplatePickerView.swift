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
            .npScreen()
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
                    .foregroundStyle(NP.accentInk)
                    .frame(height: 50)

                VStack(spacing: 4) {
                    Text(template.name)
                        .font(NP.heading(.subheadline))
                        .foregroundStyle(NP.ink)
                        .multilineTextAlignment(.center)

                    Text(template.category)
                        .font(.caption2)
                        .foregroundStyle(NP.muted)
                        .textCase(.uppercase)
                }

                Text(template.description)
                    .font(.caption)
                    .foregroundStyle(NP.body)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
            .padding()
            .frame(maxWidth: .infinity, minHeight: 180)
            .npCard()
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    TemplatePickerView { _, _ in }
}
