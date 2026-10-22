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

extension View {
    /// A page's vertical-scroll content, pinned to exactly the scroll view's width. A wrapped `Text`
    /// can round ⅓ pt wider than it was offered, and content even that much wider than its scroll
    /// view makes the page drag sideways under a horizontal swipe.
    func pageContent() -> some View {
        containerRelativeFrame(.horizontal)
    }
}
