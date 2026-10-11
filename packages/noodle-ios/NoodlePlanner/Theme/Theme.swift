import SwiftUI
import UIKit

/// Warm Paper + Marigold, the web app's design system, for SwiftUI.
///
/// Values mirror the `--np-*` tokens in
/// `packages/noodle-web/src/noodle_web/static/visual-system.css` (generated from
/// the Penpot export in `docs/design/tokens/`). Change a token in Penpot first,
/// then update it here. Each colour flips with the system light/dark setting.
enum NP {

    // MARK: Colours

    static let paper = dynamic(light: 0xFAF8F4, dark: 0x201E1A)
    static let surface = dynamic(light: 0xFFFDF9, dark: 0x292620)
    static let surfaceAlt = dynamic(light: 0xF3EEE5, dark: 0x312D26)
    static let sunken = dynamic(light: 0xEFE9DE, dark: 0x39342C)
    static let selected = dynamic(light: 0xE5DCCD, dark: 0x484033)
    static let border = dynamic(light: 0xE3DDD3, dark: 0x51493D)
    static let hairline = dynamic(light: 0xEFE9DE, dark: 0x3E382F)

    static let ink = dynamic(light: 0x23201C, dark: 0xFAF8F4)
    static let body = dynamic(light: 0x5C5850, dark: 0xD4CCBF)
    static let muted = dynamic(light: 0x635E55, dark: 0xC0B6A6)

    /// Marigold. The fill is the same in both themes; the ink is for text on paper.
    static let accent = dynamic(light: 0xEDB52A, dark: 0xEDB52A)
    static let accentTint = dynamic(light: 0xFBEFCE, dark: 0x453A20)
    static let accentInk = dynamic(light: 0x8A6205, dark: 0xF3C754)
    /// Text drawn on an `accent` fill.
    static let onAccent = dynamic(light: 0x23201C, dark: 0x23201C)

    static let success = dynamic(light: 0x6B7A5E, dark: 0xA9BC98)
    static let successTint = dynamic(light: 0xE7EDE2, dark: 0x303B2A)
    static let successInk = dynamic(light: 0x4E5C43, dark: 0xC5D8B5)

    static let danger = dynamic(light: 0xC21D1D, dark: 0xC21D1D)
    static let dangerTint = dynamic(light: 0xF6E3E0, dark: 0x4B2D27)
    static let dangerInk = dynamic(light: 0x8C3A2C, dark: 0xF4B7AA)

    static let info = dynamic(light: 0x108BB9, dark: 0x3FB6E0)
    static let infoTint = dynamic(light: 0xDCEBF2, dark: 0x1C3A47)
    static let infoInk = dynamic(light: 0x0A5A78, dark: 0x8FD3EC)

    static let purple = dynamic(light: 0x9B59B6, dark: 0x9B59B6)

    // MARK: Radii, spacing

    enum Radius {
        static let sm: CGFloat = 4
        static let md: CGFloat = 6
        static let lg: CGFloat = 8
        static let xl: CGFloat = 12
        static let control = lg
        static let card = xl
    }

    enum Space {
        static let s4: CGFloat = 4
        static let s8: CGFloat = 8
        static let s12: CGFloat = 12
        static let s16: CGFloat = 16
        static let s24: CGFloat = 24
    }

    // MARK: Type
    //
    // The web app uses Newsreader (headings), Instrument Sans (UI) and IBM Plex
    // Mono (data). None are bundled in the app yet, so these use the closest
    // system designs and keep Dynamic Type working.

    static func heading(_ style: Font.TextStyle = .title2) -> Font {
        .system(style, design: .serif).weight(.semibold)
    }

    static func data(_ style: Font.TextStyle = .caption) -> Font {
        .system(style, design: .monospaced)
    }

    // MARK: Helpers

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

private extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

// MARK: - Shared components

/// A white-ish card on the paper background, like `.np-card` on the web.
struct NPCardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(NP.surface)
            .clipShape(RoundedRectangle(cornerRadius: NP.Radius.card))
            .overlay(
                RoundedRectangle(cornerRadius: NP.Radius.card)
                    .stroke(NP.border, lineWidth: 1)
            )
    }
}

extension View {
    func npCard() -> some View { modifier(NPCardModifier()) }

    /// Paper background behind a screen.
    func npScreen() -> some View {
        background(NP.paper.ignoresSafeArea())
    }
}

/// Small rounded label, used for resources, priority and counts.
struct NPChip: View {
    let text: String
    var foreground: Color = NP.body
    var background: Color = NP.sunken

    var body: some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .foregroundStyle(foreground)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(background))
    }
}

extension RAGStatus {
    /// Matches the web's rag-red / rag-amber / rag-green mapping.
    var color: Color {
        switch self {
        case .red: return NP.danger
        case .amber: return NP.accent
        case .green: return NP.success
        }
    }

    var tint: Color {
        switch self {
        case .red: return NP.dangerTint
        case .amber: return NP.accentTint
        case .green: return NP.successTint
        }
    }
}

/// Coloured dot plus label, replacing the emoji RAG badge.
struct RAGBadge: View {
    let status: RAGStatus

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(status.color).frame(width: 8, height: 8)
            Text(status.rawValue)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(NP.ink)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Capsule().fill(status.tint))
        .accessibilityLabel("Status \(status.rawValue)")
    }
}
