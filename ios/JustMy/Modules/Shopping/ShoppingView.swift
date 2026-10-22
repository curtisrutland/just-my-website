import JMWClientSupport
import ShoppingAPI
import SwiftUI

typealias ShoppingList = ShoppingAPI.Components.Schemas.ShoppingList
typealias ShoppingItem = ShoppingAPI.Components.Schemas.ShoppingItemView
private typealias ItemStatus = ShoppingAPI.Components.Schemas.ShoppingPatch.StatusPayload

/// A row on the list, waiting out its check-off (the undo window), or bought.
private enum RowState: Equatable {
    case needed, draining
    case bought(subtitle: String)

    var isDraining: Bool { self == .draining }
    var isChecked: Bool { self != .needed }
    var subtitle: String? { if case let .bought(subtitle) = self { subtitle } else { nil } }
}

/// Shopping (docs/ios-design-handoff.md §5.6): a calm, grouped working list you edit in the store.
/// Tap a row to check it off (it drains in place for 2.5 s — tap again to cancel — then moves to
/// Recently bought); tap a bought row to put it back; swipe to delete; add from the bar at the bottom.
/// Every write is optimistic, puts the row back on error, then refetches `/list`.
struct ShoppingView: View {
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase
    @State private var loader = Loader<ShoppingList>()
    @State private var edits = Edits()
    @State private var writeFailure: LoadFailure?
    /// Collapsed on every launch (#102); kept while the app is in use.
    @State private var showBought = false
    @State private var checkedOff = 0
    @FocusState private var adding: Bool

    var body: some View {
        let view = edits.apply(to: loader.value)
        List {
            Section {
                if let view {
                    Text(view.activeCount == 0 ? "nothing on the list" : "\(view.activeCount) on the list")
                        .font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                }
                if let failure = writeFailure ?? loader.failure {
                    StatusBanner(failure: failure, loadedAt: writeFailure == nil ? loader.loadedAt : nil)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
            }
            if let view {
                if view.groups.isEmpty && view.bought.isEmpty {
                    Section {
                        Text("Nothing on the list. Add something below, or tell Claude.")
                            .foregroundStyle(.secondary)
                            .listRowBackground(Color.clear)
                    }
                }
                ForEach(view.groups, id: \.category) { group in
                    Section {
                        ForEach(group.items) { item in
                            row(item, state: edits.isDraining(item.id) ? .draining : .needed)
                        }
                    } header: {
                        SectionTitle("\(group.category) · \(group.items.count)")
                    }
                }
                if !view.bought.isEmpty {
                    Section {
                        if showBought {
                            ForEach(view.bought) { item in
                                row(item, state: .bought(subtitle: boughtSubtitle(item)))
                            }
                        }
                    } header: {
                        boughtHeader(count: view.bought.count)
                    }
                }
            } else if loader.failure == nil {
                Section { ForEach(0..<6, id: \.self) { _ in SkeletonBlock(height: 22) } }
            }
        }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.immediately)
        .contentMargins(.bottom, 80, for: .scrollContent) // room above the add bar
        .navigationTitle("Shopping")
        .safeAreaInset(edge: .bottom) {
            // The list fades out behind the bar (board `ShoppingAdd-Dark`), so rows never read through it.
            ZStack(alignment: .bottom) {
                LinearGradient(
                    stops: [.init(color: Color(.systemGroupedBackground).opacity(0), location: 0),
                            .init(color: Color(.systemGroupedBackground), location: 0.45)],
                    startPoint: .top, endPoint: .bottom
                )
                .allowsHitTesting(false)
                AddBar(categories: view?.categories ?? [], focus: $adding) { category, text in
                    await add(category: category, text: text)
                }
                .padding(.top, 36)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .toolbar(adding ? .hidden : .visible, for: .tabBar)
        .sensoryFeedback(.impact(weight: .light), trigger: checkedOff)
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await load() } } }
    }

    private func row(_ item: ShoppingItem, state: RowState) -> some View {
        Button {
            switch state {
            case .needed: checkOff(item)
            case .draining: cancelCheckOff(item)
            case .bought: uncheck(item)
            }
        } label: {
            ItemRow(item: item, state: state)
        }
        .buttonStyle(.plain)
        .listRowInsets(EdgeInsets(top: 9, leading: 14, bottom: 9, trailing: 16))
        // The undo window drains along the row's bottom edge (inside the row, so the list doesn't clip it).
        .listRowBackground(
            Color(.secondarySystemGroupedBackground)
                .overlay(alignment: .bottomLeading) { if state == .draining { DrainBar() } }
        )
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button("Delete", systemImage: "trash", role: .destructive) { delete(item) }
        }
        .accessibilityAction(named: "Delete") { delete(item) }
    }

    /// `RECENTLY BOUGHT · 6` and a chevron: a disclosure button, collapsed by default (#102).
    private func boughtHeader(count: Int) -> some View {
        Button {
            withAnimation(.snappy) { showBought.toggle() }
        } label: {
            HStack(spacing: 6) {
                Text("Recently bought · \(count)".uppercased()).tracking(0.4)
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .rotationEffect(.degrees(showBought ? 90 : 0))
                Spacer()
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .monospacedDigit()
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityValue(showBought ? "expanded" : "collapsed")
        .accessibilityHint("Shows the items bought in the last 7 days")
    }

    // MARK: Writes

    private func checkOff(_ item: ShoppingItem) {
        adding = false
        withAnimation(.snappy) { edits.beginCheckOff(item.id) }
        checkedOff += 1
        write(item.id, status: .bought)
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            // Cancelled meanwhile (or the write failed): nothing to move.
            guard edits.isDraining(item.id) else { return }
            withAnimation(.snappy) { edits.endDrain(item.id) }
            await load()
        }
    }

    private func cancelCheckOff(_ item: ShoppingItem) {
        withAnimation(.snappy) { edits.cancelCheckOff(item.id) }
        write(item.id, status: .needed)
    }

    private func uncheck(_ item: ShoppingItem) {
        withAnimation(.snappy) { edits.set(item.id, to: .needed) }
        write(item.id, status: .needed, refetch: true)
    }

    private func write(_ id: String, status: ItemStatus, refetch: Bool = false) {
        guard let api else { return }
        edits.enqueue(id) {
            do {
                let output = try await api.shopping.patchApiShoppingItemsId(
                    .init(path: .init(id: id), body: .json(.init(status: status)))
                )
                if case let .badRequest(response) = output {
                    throw WriteError(message: (try? response.body.json.error.message) ?? "The server refused that change.")
                }
                _ = try output.ok
                writeFailure = nil
                if refetch { await load() }
            } catch {
                withAnimation(.snappy) { edits.revert(id) }
                writeFailure = LoadFailure(write: error)
            }
        }
    }

    private func delete(_ item: ShoppingItem) {
        guard let api else { return }
        withAnimation(.snappy) { edits.delete(item.id) }
        edits.enqueue(item.id) {
            do {
                // Soft delete only: the phone's token can't hard-delete, and never asks to.
                _ = try await api.shopping.deleteApiShoppingItemsId(.init(path: .init(id: item.id), query: .init())).noContent
                writeFailure = nil
                await load()
            } catch {
                withAnimation(.snappy) { edits.undelete(item.id) }
                writeFailure = LoadFailure(write: error)
            }
        }
    }

    private func add(category: String, text: String) async -> Bool {
        guard let api else { return false }
        do {
            let output = try await api.shopping.postApiShoppingItems(.init(body: .json(.init(category: category, text: text))))
            if case let .badRequest(response) = output {
                throw WriteError(message: (try? response.body.json.error.message) ?? "The server refused that item.")
            }
            _ = try output.created
            writeFailure = nil
            await load()
            return true
        } catch {
            writeFailure = LoadFailure(write: error)
            return false
        }
    }

    private func load() async {
        guard let api else { return }
        await loader.load { try await api.shopping.getApiShoppingList(.init()).ok.body.json }
        if loader.failure == nil { edits.settle() }
    }

    private func boughtSubtitle(_ item: ShoppingItem) -> String {
        guard item.status == .bought, let at = item.checkedAt else { return "\(item.category) · just now" }
        let day = Format.isoDay(of: at)
        let when = day == Format.todayISO() ? Format.time(at) : Format.day(day)
        return "\(item.category) · \(when)"
    }
}

/// The optimistic layer over the last fetched list: status overrides, rows still draining after a
/// check-off, and deletions — each kept until a refetch reflects it and its write has finished.
@Observable
private final class Edits {
    private var overrides: [String: ItemStatus] = [:]
    private var draining: Set<String> = []
    private var deleted: Set<String> = []
    /// Writes to one item run in order, so a cancel can't overtake the check-off it cancels.
    @ObservationIgnored private var queues: [String: Task<Void, Never>] = [:]

    struct View {
        struct Group { let category: String; let items: [ShoppingItem] }
        let groups: [Group]
        let bought: [ShoppingItem]
        let categories: [String]
        let activeCount: Int
    }

    func isDraining(_ id: String) -> Bool { draining.contains(id) }

    func beginCheckOff(_ id: String) {
        overrides[id] = .bought
        draining.insert(id)
    }

    func endDrain(_ id: String) { draining.remove(id) }

    func cancelCheckOff(_ id: String) {
        draining.remove(id)
        overrides[id] = .needed
    }

    func set(_ id: String, to status: ItemStatus) { overrides[id] = status }

    func revert(_ id: String) {
        overrides[id] = nil
        draining.remove(id)
    }

    func delete(_ id: String) {
        deleted.insert(id)
        draining.remove(id)
    }

    func undelete(_ id: String) { deleted.remove(id) }

    @MainActor
    func enqueue(_ id: String, _ work: @escaping @MainActor () async -> Void) {
        let previous = queues[id]
        let task = Task { @MainActor in
            await previous?.value
            await work()
        }
        queues[id] = task
        Task { @MainActor in
            await task.value
            if queues[id] == task { queues[id] = nil }
        }
    }

    /// After a successful refetch, drop the edits the server now reflects. Rows still draining or
    /// with a write in flight keep theirs.
    func settle() {
        overrides = overrides.filter { draining.contains($0.key) || queues[$0.key] != nil }
        deleted = deleted.filter { queues[$0] != nil }
    }

    func apply(to list: ShoppingList?) -> View? {
        guard let list else { return nil }
        let all = list.active.flatMap(\.items) + list.recentlyBought
        let live = all.filter { !deleted.contains($0.id) }
        func status(_ item: ShoppingItem) -> ItemStatus { overrides[item.id] ?? (item.status == .bought ? .bought : .needed) }

        let onList = live.filter { status($0) == .needed || draining.contains($0.id) }
        let grouped = Dictionary(grouping: onList, by: \.category)
            .map { View.Group(category: $0.key, items: $0.value) }
            .sorted { $0.category.localizedCaseInsensitiveCompare($1.category) == .orderedAscending }
        // Checked off here first ("just now"), then the server's own recent order.
        let bought = live.filter { status($0) == .bought && !draining.contains($0.id) }
        let justNow = bought.filter { $0.status != .bought }
        let categories = Set(all.map(\.category)).sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
        return View(
            groups: grouped,
            bought: justNow + bought.filter { $0.status == .bought },
            categories: categories,
            activeCount: live.filter { status($0) == .needed }.count
        )
    }
}

private struct ItemRow: View {
    let item: ShoppingItem
    let state: RowState

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            mark
            VStack(alignment: .leading, spacing: 2) {
                Text(item.text)
                    .strikethrough(state.isChecked)
                    .foregroundStyle(state.isChecked ? .secondary : .primary)
                if let subtitle = state.subtitle {
                    Text(subtitle).font(.footnote).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 26)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityValue(state.isChecked ? "bought" : "needed")
        .accessibilityHint(state.isDraining ? "Tap to undo" : state.isChecked ? "Tap to put it back on the list" : "Tap to check off")
    }

    @ViewBuilder
    private var mark: some View {
        if state.isDraining {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 26)).foregroundStyle(Color.accentColor)
        } else if state.isChecked {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 26)).foregroundStyle(.secondary)
        } else {
            Circle().strokeBorder(Color(.secondaryLabel).opacity(0.4), lineWidth: 1.8)
                .frame(width: 26, height: 26)
        }
    }
}

/// The 2 pt Accent bar that drains along a checked row's bottom edge for 2.5 s — the undo window.
private struct DrainBar: View {
    @State private var remaining = 1.0

    var body: some View {
        GeometryReader { geo in
            Capsule().fill(Color.accentColor)
                .frame(width: geo.size.width * remaining, height: 2)
        }
        .frame(height: 2)
        .onAppear { withAnimation(.linear(duration: 2.5)) { remaining = 0 } }
        .accessibilityHidden(true)
    }
}

/// The add bar (§5.6, board `ShoppingAdd-Dark`): a glass capsule above the tab bar with the
/// category chip and the field. Focused, the tab bar hides and a strip of every category (plus
/// `+ New`) appears above it. Return or Add posts, clears, keeps focus.
private struct AddBar: View {
    let categories: [String]
    var focus: FocusState<Bool>.Binding
    let add: (String, String) async -> Bool

    @AppStorage("shopping.category") private var category = ""
    @State private var text = ""
    @State private var newCategory: String?
    @State private var posting = false
    @FocusState private var naming: Bool

    var body: some View {
        VStack(spacing: 10) {
            if focus.wrappedValue || naming {
                chips.transition(.move(edge: .bottom).combined(with: .opacity))
            }
            HStack(spacing: 8) {
                if !focus.wrappedValue && !naming {
                    Menu {
                        ForEach(categories, id: \.self) { c in Button(c) { category = c } }
                    } label: {
                        HStack(spacing: 4) {
                            Text(current).fontWeight(.semibold)
                            Image(systemName: "chevron.down").font(.caption.weight(.semibold))
                        }
                        .font(.subheadline)
                        .padding(.horizontal, 12).frame(height: 34)
                        .background(Color(.tertiarySystemFill), in: .capsule)
                    }
                    .foregroundStyle(.primary)
                }
                TextField("Add to the list", text: $text)
                    .focused(focus)
                    .textInputAutocapitalization(.never)
                    .submitLabel(.done)
                    .onSubmit { Task { await submit() } }
                if !text.trimmingCharacters(in: .whitespaces).isEmpty {
                    Button("Add") { Task { await submit() } }
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 16).frame(height: 38)
                        .background(Color.accentColor, in: .capsule)
                        .foregroundStyle(Color(.systemBackground))
                        .disabled(posting)
                }
            }
            .padding(.leading, focus.wrappedValue ? 16 : 6)
            .padding(.trailing, 6)
            .frame(height: 50)
            .glassEffect(.regular, in: .capsule)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, focus.wrappedValue ? 10 : 20)
        .animation(.snappy, value: focus.wrappedValue)
    }

    /// The remembered category, else Pantry if the list has one, else the first, else Other.
    private var current: String {
        if !category.isEmpty { return category }
        return categories.first { $0.caseInsensitiveCompare("Pantry") == .orderedSame } ?? categories.first ?? "Other"
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(chipCategories, id: \.self) { c in
                    let selected = c == current
                    Button(c) { category = c }
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14).frame(height: 36)
                        .background(selected ? Color(.label) : Color(.tertiarySystemFill), in: .capsule)
                        .foregroundStyle(selected ? Color(.systemBackground) : Color(.label))
                        .accessibilityAddTraits(selected ? .isSelected : [])
                }
                if let binding = newCategoryBinding {
                    TextField("Category", text: binding)
                        .focused($naming)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .onSubmit(commitNewCategory)
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14).frame(width: 140, height: 36)
                        .background(Color(.tertiarySystemFill), in: .capsule)
                } else {
                    Button("+ New") {
                        newCategory = ""
                        naming = true
                    }
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 14).frame(height: 36)
                    .background(Color(.tertiarySystemFill), in: .capsule)
                    .foregroundStyle(Color.accentColor)
                }
            }
            .padding(.vertical, 2)
        }
        .scrollClipDisabled()
    }

    /// The list's categories, plus a remembered one that isn't on the list right now.
    private var chipCategories: [String] {
        categories.contains(current) ? categories : [current] + categories
    }

    private var newCategoryBinding: Binding<String>? {
        guard newCategory != nil else { return nil }
        return Binding(get: { newCategory ?? "" }, set: { newCategory = $0 })
    }

    private func commitNewCategory() {
        let name = (newCategory ?? "").trimmingCharacters(in: .whitespaces)
        if !name.isEmpty { category = name }
        newCategory = nil
        focus.wrappedValue = true
    }

    private func submit() async {
        let item = text.trimmingCharacters(in: .whitespaces)
        guard !item.isEmpty, !posting else { return }
        posting = true
        defer { posting = false }
        let chosen = current
        if await add(chosen, item) {
            text = ""
            category = chosen
        }
        focus.wrappedValue = true
    }
}

extension ShoppingItem: @retroactive Identifiable {}
