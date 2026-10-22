import SwiftUI

/// An inset grouped card: 26 pt radius on `secondarySystemGroupedBackground` (handoff §2.4).
struct Card<Content: View>: View {
    var padding = EdgeInsets(top: 18, leading: 16, bottom: 16, trailing: 16)
    var background = Color(.secondarySystemGroupedBackground)
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(background, in: .rect(cornerRadius: 26))
    }
}

/// A card of rows separated by inset hairlines (the stock inset-grouped look, without a List).
struct RowCard<Item: Identifiable, Row: View>: View {
    let items: [Item]
    var background = Color(.secondarySystemGroupedBackground)
    @ViewBuilder let row: (Item) -> Row

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                row(item)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .frame(minHeight: 44)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if index < items.count - 1 {
                    Divider().padding(.leading, 16)
                }
            }
        }
        .background(background, in: .rect(cornerRadius: 26))
    }
}

/// A 5 pt neutral track filled to `fraction` (clamped to 0…1).
struct Track: View {
    let fraction: Double
    var fill: Color = .secondary

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color(.systemFill))
                Capsule().fill(fill).frame(width: geo.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: 5)
        .accessibilityHidden(true)
    }
}
