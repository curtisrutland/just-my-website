import JMWClientSupport
import MacrosAPI
import SwiftUI

typealias DayRollup = Components.Schemas.DayRollup
typealias MacroEntry = Components.Schemas.EntryView

/// Macros › Day (docs/ios-design-handoff.md §5.1). Horizontal paging between days, a date picker,
/// and a Today button. Read-only: food logging is Claude's.
struct MacrosView: View {
    @State private var selected = Format.todayISO()
    @State private var direction: Edge = .leading
    @State private var pickingDate = false
    /// Each visited day's loader, so paging back shows the last data at once while it refreshes.
    @State private var loaders = DayLoaders()
    private let today = Format.todayISO()
    private let earliest = Format.addDays(-540, to: Format.todayISO())

    var body: some View {
        MacrosDayPage(date: selected, isToday: selected == today, loader: loaders.loader(for: selected))
            .id(selected)
            .transition(.push(from: direction))
            // Horizontal swipe pages days. A gesture rather than a paging scroll view, so the large
            // title stays attached to the day's vertical scroll.
            .simultaneousGesture(
                DragGesture(minimumDistance: 24).onEnded { drag in
                    let dx = drag.translation.width, dy = drag.translation.height
                    guard abs(dx) > max(60, abs(dy) * 1.5) else { return }
                    if dx > 0 { go(by: -1) } else if selected < today { go(by: 1) }
                }
            )
            .background(Color(.systemGroupedBackground))
            .navigationTitle(Format.day(selected))
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("Pick a date", systemImage: "calendar") { pickingDate = true }
                    if selected != today {
                        Button("Today") { jump(to: today) }.fontWeight(.semibold)
                    }
                }
            }
            .sheet(isPresented: $pickingDate) {
                DayPickerSheet(selected: Binding(get: { selected }, set: { jump(to: $0) }), earliest: earliest, latest: today)
            }
    }

    private func go(by days: Int) {
        let target = Format.addDays(days, to: selected)
        guard target >= earliest, target <= today else { return }
        jump(to: target)
    }

    private func jump(to day: String) {
        direction = day < selected ? .leading : .trailing
        withAnimation(.snappy) { selected = day }
    }
}

/// Day loaders by date. Plain reference type: views observe each `Loader`, not this map.
final class DayLoaders {
    private var byDate: [String: Loader<DayRollup>] = [:]

    func loader(for date: String) -> Loader<DayRollup> {
        if let existing = byDate[date] { return existing }
        let made = Loader<DayRollup>()
        byDate[date] = made
        return made
    }
}

private struct DayPickerSheet: View {
    @Binding var selected: String
    let earliest: String
    let latest: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            DatePicker(
                "Day",
                selection: Binding(
                    get: { Format.date(fromISO: selected) ?? .now },
                    set: { selected = Format.iso($0); dismiss() }
                ),
                in: Format.date(fromISO: earliest)!...Format.date(fromISO: latest)!,
                displayedComponents: .date
            )
            .datePickerStyle(.graphical)
            .environment(\.timeZone, Format.zone)
            .padding(.horizontal)
            .navigationTitle("Go to day")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}

/// One day: the rollup card and its entries.
private struct MacrosDayPage: View {
    let date: String
    let isToday: Bool
    let loader: Loader<DayRollup>

    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase
    @State private var openEntry: MacroEntry?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if let failure = loader.failure {
                    StatusBanner(failure: failure, loadedAt: loader.loadedAt)
                }
                if let day = loader.value {
                    RollupCard(day: day)
                    entries(day)
                } else if loader.failure == nil {
                    skeleton
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
            .pageContent()
        }
        .refreshable { await load() }
        .task(id: date) { await load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await load() } }
        }
        .sheet(item: $openEntry) { EntrySheet(entry: $0) }
    }

    private func load() async {
        guard let api else { return }
        await loader.load { try await api.macros.getApiMacrosDaysDate(.init(path: .init(date: date))).ok.body.json }
    }

    @ViewBuilder
    private func entries(_ day: DayRollup) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle("Entries · \(day.entries.count)").padding(.horizontal, 16)
            if day.entries.isEmpty {
                Text(isToday ? "Nothing logged yet today." : "Nothing logged this day.")
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
            } else {
                RowCard(items: day.entries) { entry in
                    Button { openEntry = entry } label: { EntryRow(entry: entry) }
                        .buttonStyle(.plain)
                }
            }
        }
    }

    private var skeleton: some View {
        VStack(alignment: .leading, spacing: 22) {
            Card {
                VStack(alignment: .leading, spacing: 14) {
                    SkeletonBlock(height: 44, width: 200)
                    ForEach(0..<3, id: \.self) { _ in SkeletonBlock(height: 20) }
                    SkeletonBlock(height: 6)
                }
            }
            Card { VStack(spacing: 16) { ForEach(0..<5, id: \.self) { _ in SkeletonBlock(height: 22) } } }
        }
    }
}

/// The rollup: calories against target, the three macros, and the estimation strip. Neutral in v1:
/// over target is a number, never a color (#49 lands state into the track fills later).
private struct RollupCard: View {
    let day: DayRollup

    var body: some View {
        let target = day.target?.value1
        Card(padding: EdgeInsets(top: 18, leading: 16, bottom: 6, trailing: 16)) {
            VStack(alignment: .leading, spacing: 14) {
                hero(target)
                VStack(spacing: 12) {
                    MacroRow(label: "Protein", value: day.totals.proteinContent, target: target?.proteinContent)
                    MacroRow(label: "Fat", value: day.totals.fatContent, target: target?.fatContent)
                    MacroRow(label: "Carbs", value: day.totals.carbohydrateContent, target: target?.carbohydrateContent)
                }
                .padding(.top, 4)
                if target == nil {
                    Text("No target applies to this day — the first target profile starts later. Numbers only; nothing to compare against.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Divider().padding(.top, 4)
                EstimationRow(day: day).padding(.bottom, 10)
            }
        }
    }

    @ViewBuilder
    private func hero(_ target: Components.Schemas.MacroTotals?) -> some View {
        let eaten = day.totals.calories ?? 0
        HStack(alignment: .firstTextBaseline) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(Format.whole(eaten)).font(.hero).tracking(-0.6).monospacedDigit()
                if let goal = target?.calories {
                    Text("/ \(Format.whole(goal)) kcal").foregroundStyle(.secondary).monospacedDigit()
                } else {
                    Text("kcal").foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 12)
            if let goal = target?.calories {
                Text(eaten <= goal ? "\(Format.whole(goal - eaten)) left" : "\(Format.whole(eaten - goal)) over")
                    .foregroundStyle(.secondary).monospacedDigit()
            } else {
                Text("no target yet").font(.subheadline).foregroundStyle(.secondary)
            }
        }
        if let goal = target?.calories, goal > 0 {
            Track(fraction: eaten / goal)
        }
    }
}

private struct MacroRow: View {
    let label: String
    let value: Double?
    let target: Double?

    var body: some View {
        VStack(spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(label).font(.subheadline).foregroundStyle(.secondary)
                Spacer(minLength: 12)
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    if let value {
                        if let target {
                            Text("\(Format.whole(value)) \(Text("/ \(Format.whole(target)) g").foregroundStyle(.secondary))")
                        } else {
                            Text("\(Format.whole(value)) \(Text("g").foregroundStyle(.secondary))")
                        }
                    } else {
                        NotMeasured()
                    }
                    if let value, let target {
                        let diff = (value - target).rounded()
                        Text(diff > 0 ? "+\(Format.whole(diff)) g" : "\(Format.whole(-diff)) left")
                            .foregroundStyle(.secondary)
                            .frame(minWidth: 60, alignment: .trailing)
                    }
                }
                .monospacedDigit()
            }
            if let value, let target, target > 0 {
                Track(fraction: value / target)
            }
        }
    }
}

/// `≈ 11% estimated · 3 of 15 entries` and one segment per entry — the module's signature.
private struct EstimationRow: View {
    let day: DayRollup

    var body: some View {
        let e = day.estimation
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("≈").fontWeight(.semibold).foregroundStyle(Color.accentColor)
                Text("\(Text("\(Int((e.estimatedFraction * 100).rounded()))% estimated").fontWeight(.semibold).foregroundStyle(Color.accentColor))\(Text(" · \(e.estimatedCount) of \(e.entryCount) entries").foregroundStyle(.secondary))")
                    .font(.subheadline)
                    .monospacedDigit()
            }
            if !day.entries.isEmpty {
                HStack(spacing: 3) {
                    ForEach(day.entries, id: \.id) { entry in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(entry.confidence == .estimated ? Color.accentColor : Color(.systemFill))
                            .frame(height: 6)
                    }
                }
                .accessibilityElement()
                .accessibilityLabel("\(e.entryCount) entries, \(e.estimatedCount) estimated")
            }
        }
    }
}

/// The entry's label: its own name, else the web's fallback.
func entryName(_ entry: MacroEntry) -> String { entry.name ?? "ad-hoc" }

private struct EntryRow: View {
    let entry: MacroEntry

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(entryName(entry)).multilineTextAlignment(.leading)
                Text("\(Text("\(Format.whole(entry.quantityGrams)) g").foregroundStyle(.secondary))\(confidenceSuffix)")
                    .font(.footnote)
                    .monospacedDigit()
            }
            Spacer(minLength: 0)
            if let kcal = entry.calories {
                ValueUnit(value: Format.whole(kcal), unit: "kcal")
            } else {
                NotMeasured()
            }
        }
        .contentShape(.rect)
    }

    private var confidenceSuffix: Text {
        switch entry.confidence {
        case .estimated: Text(" · ≈ estimated").foregroundStyle(Color.accentColor)
        case .loggedServing: Text(" · serving").foregroundStyle(.secondary)
        case .measured: Text("")
        }
    }
}

/// The entry sheet: all eight macros to one decimal, and Claude's note when there is one.
private struct EntrySheet: View {
    let entry: MacroEntry
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(entryName(entry)).font(.title2.bold())
                        Text("\(Text("\(Format.whole(entry.quantityGrams)) g").foregroundStyle(.secondary))\(suffix)")
                            .font(.subheadline)
                            .monospacedDigit()
                    }
                    Spacer()
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.circle)
                }
                RowCard(items: rows, background: Color(.tertiarySystemGroupedBackground)) { row in
                    HStack(alignment: .firstTextBaseline) {
                        Text(row.label).foregroundStyle(row.value == nil ? .secondary : .primary)
                        Spacer()
                        if let v = row.value {
                            ValueUnit(value: Format.oneDecimal(v), unit: row.unit)
                        } else {
                            NotMeasured()
                        }
                    }
                }
                if let note = entry.note {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionTitle("How it was estimated").padding(.horizontal, 16)
                        Card(padding: EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16), background: Color(.tertiarySystemGroupedBackground)) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("“\(note)”")
                                Text("Claude’s note on the entry. Correct it by telling Claude; the app doesn’t edit food.")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .pageContent()
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var suffix: Text {
        switch entry.confidence {
        case .estimated: Text(" · ≈ estimated").fontWeight(.semibold).foregroundStyle(Color.accentColor)
        case .loggedServing: Text(" · serving").foregroundStyle(.secondary)
        case .measured: Text("")
        }
    }

    private struct Row: Identifiable {
        let label: String
        let value: Double?
        let unit: String
        var id: String { label }
    }

    private var rows: [Row] {
        [
            Row(label: "Calories", value: entry.calories, unit: "kcal"),
            Row(label: "Protein", value: entry.proteinContent, unit: "g"),
            Row(label: "Fat", value: entry.fatContent, unit: "g"),
            Row(label: "Carbs", value: entry.carbohydrateContent, unit: "g"),
            Row(label: "Fiber", value: entry.fiberContent, unit: "g"),
            Row(label: "Sugar", value: entry.sugarContent, unit: "g"),
            // Stored in grams like every mass macro (CONVENTIONS §6); shown in mg.
            Row(label: "Sodium", value: entry.sodiumContent.map { $0 * 1000 }, unit: "mg"),
            Row(label: "Saturated fat", value: entry.saturatedFatContent, unit: "g"),
        ]
    }
}

extension MacroEntry: @retroactive Identifiable {}
