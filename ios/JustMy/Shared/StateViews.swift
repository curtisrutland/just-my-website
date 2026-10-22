import SwiftUI

/// `Offline · showing 10:42 AM` — the one quiet banner (docs/ios-design-handoff.md §3). Never modal,
/// never red; the last data stays underneath.
struct StatusBanner: View {
    let failure: LoadFailure
    let loadedAt: Date?

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: failure.isOffline ? "wifi.slash" : "exclamationmark.circle")
            Text(text).monospacedDigit()
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 12))
    }

    private var text: String {
        guard let loadedAt else { return failure.message }
        return "\(failure.message) · showing \(Format.time(loadedAt))"
    }
}

/// `—` for a value the device didn't measure. A null is a dash, never a zero.
struct NotMeasured: View {
    var body: some View {
        Text("—").foregroundStyle(.secondary).accessibilityLabel("not measured")
    }
}

/// A skeleton block that pulses while the first fetch is in flight.
struct SkeletonBlock: View {
    var height: CGFloat = 18
    var width: CGFloat? = nil
    @State private var dim = false

    var body: some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(Color(.systemFill))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
            .opacity(dim ? 0.45 : 1)
            .onAppear {
                withAnimation(.easeInOut(duration: 1.3).repeatForever(autoreverses: true)) { dim = true }
            }
            .accessibilityHidden(true)
    }
}

/// Uppercased footnote section header, letter-spaced (docs/ios-design-handoff.md §2.3).
struct SectionTitle: View {
    let text: String
    var trailing: String? = nil

    init(_ text: String, trailing: String? = nil) {
        self.text = text
        self.trailing = trailing
    }

    var body: some View {
        HStack {
            Text(text.uppercased()).tracking(0.4)
            Spacer()
            if let trailing { Text(trailing) }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .monospacedDigit()
    }
}

/// A value with a smaller secondary unit, baseline-aligned: `250.0 lb`.
struct ValueUnit: View {
    let value: String
    let unit: String
    var valueFont: Font = .body

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(value).font(valueFont).monospacedDigit()
            Text(unit).font(.footnote).foregroundStyle(.secondary)
        }
    }
}

extension Font {
    /// The one hero numeral per screen.
    static let hero = Font.system(size: 44, weight: .semibold)
    /// Trend values (vitals, the weekly strip).
    static let trend = Font.system(size: 28, weight: .semibold)
}
