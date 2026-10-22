import JMWClientSupport
import ShoppingAPI
import SwiftUI

typealias ShoppingList = ShoppingAPI.Components.Schemas.ShoppingList
typealias ShoppingItem = ShoppingAPI.Components.Schemas.ShoppingItemView

/// Shopping (docs/ios-design-handoff.md §5.6): a calm, grouped working list. This change shows the
/// list; checking off, adding and swipe-to-delete are the writes in #74.
struct ShoppingView: View {
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase
    @State private var loader = Loader<ShoppingList>()

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22) {
                if let list = loader.value {
                    Text(list.activeCount == 0 ? "nothing on the list" : "\(list.activeCount) on the list")
                        .font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                        .padding(.horizontal, 16)
                }
                if let failure = loader.failure {
                    StatusBanner(failure: failure, loadedAt: loader.loadedAt)
                }
                if let list = loader.value {
                    if list.active.isEmpty && list.recentlyBought.isEmpty {
                        Text("Nothing on the list. Tell Claude what to add.")
                            .foregroundStyle(.secondary).padding(.horizontal, 16)
                    }
                    ForEach(list.active, id: \.category) { group in
                        VStack(alignment: .leading, spacing: 8) {
                            SectionTitle("\(group.category) · \(group.items.count)").padding(.horizontal, 16)
                            RowCard(items: group.items) { ItemRow(item: $0, subtitle: nil) }
                                .clipShape(.rect(cornerRadius: 22))
                        }
                    }
                    if !list.recentlyBought.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionTitle("Recently bought · last 7 days").padding(.horizontal, 16)
                            RowCard(items: list.recentlyBought) { ItemRow(item: $0, subtitle: boughtSubtitle($0)) }
                        }
                    }
                } else if loader.failure == nil {
                    Card { VStack(spacing: 16) { ForEach(0..<6, id: \.self) { _ in SkeletonBlock(height: 22) } } }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Shopping")
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await load() } } }
    }

    private func load() async {
        guard let api else { return }
        await loader.load { try await api.shopping.getApiShoppingList(.init()).ok.body.json }
    }

    private func boughtSubtitle(_ item: ShoppingItem) -> String {
        guard let at = item.checkedAt else { return item.category }
        let day = Format.isoDay(of: at)
        let when = day == Format.todayISO() ? Format.time(at) : Format.day(day)
        return "\(item.category) · \(when)"
    }
}

private struct ItemRow: View {
    let item: ShoppingItem
    let subtitle: String?

    var body: some View {
        let bought = item.status == .bought
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: bought ? "checkmark.circle.fill" : "circle")
                .font(.title3)
                .foregroundStyle(bought ? Color.secondary : Color.secondary.opacity(0.4))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.text)
                    .strikethrough(bought)
                    .foregroundStyle(bought ? .secondary : .primary)
                if let subtitle { Text(subtitle).font(.footnote).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(bought ? "bought" : "needed")
    }
}

extension ShoppingItem: @retroactive Identifiable {}
