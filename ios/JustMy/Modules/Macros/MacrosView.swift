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
                    RollupCard(day: day, isToday: isToday)
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

/// The rollup as a budget (docs/ios-design-handoff.md §5.1): calories are the ceiling and the goal,
/// protein a floor, fat and carbs levers judged only for balance. Thresholds are the app's: a 5%
/// landing zone under the ceiling, and overshoot turns from Warning to Over past 3%.
private struct RollupCard: View {
    let day: DayRollup
    let isToday: Bool

    var body: some View {
        let budget = Budget(day: day)
        Card(padding: EdgeInsets(top: 18, leading: 16, bottom: 6, trailing: 16)) {
            VStack(alignment: .leading, spacing: 14) {
                hero(budget)
                BudgetBar(budget: budget)
                VStack(spacing: 12) {
                    proteinRow(budget)
                    LeversRow(budget: budget)
                }
                if budget.ceiling == nil {
                    Text("No target applies to this day — the first target profile starts later. Numbers only; nothing to compare against.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Divider().padding(.top, 4)
                EstimationRow(day: day).padding(.bottom, 10)
            }
        }
    }

    private func hero(_ b: Budget) -> some View {
        HStack(alignment: .firstTextBaseline) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(Format.whole(b.kcal)).font(.hero).tracking(-0.6).monospacedDigit()
                if let ceiling = b.ceiling {
                    Text("/ \(Format.whole(ceiling)) kcal").foregroundStyle(.secondary).monospacedDigit()
                } else {
                    Text("kcal").foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 12)
            if let ceiling = b.ceiling {
                calorieState(b, ceiling: ceiling)
            } else {
                Text("no target yet").font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func calorieState(_ b: Budget, ceiling: Double) -> some View {
        Group {
            switch b.calorieState {
            case .under:
                Text("\(Format.whole(ceiling - b.kcal)) left").foregroundStyle(.secondary)
            case .landed:
                Text("landed · \(Format.whole(ceiling - b.kcal)) left").fontWeight(.semibold).foregroundStyle(Color("Success"))
            case let .over(color):
                Text("+\(Format.whole(b.kcal - ceiling)) over").fontWeight(.semibold).foregroundStyle(color)
            }
        }
        .font(.subheadline)
        .monospacedDigit()
        .lineLimit(1)
    }

    private func proteinRow(_ b: Budget) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Legend(color: .accentColor, label: "Protein")
            Spacer(minLength: 12)
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                if let floor = b.proteinFloor {
                    Text("\(Format.whole(b.protein)) \(Text("/ \(Format.whole(floor)) g").foregroundStyle(.secondary))")
                    proteinState(b.protein, floor: floor)
                        .frame(minWidth: 110, alignment: .trailing)
                } else {
                    Text("\(Format.whole(b.protein)) \(Text("g").foregroundStyle(.secondary))")
                }
            }
            .monospacedDigit()
        }
    }

    /// Cleared is a finding in Success. Short on a past day is a hard finding; short today is just
    /// where the day stands.
    private func proteinState(_ protein: Double, floor: Double) -> some View {
        if protein >= floor {
            Text("cleared · +\(Format.whole(protein - floor)) g").foregroundStyle(Color("Success"))
        } else if isToday {
            Text("\(Format.whole(floor - protein)) g to floor").foregroundStyle(.secondary)
        } else {
            Text("\(Format.whole(floor - protein)) g short").foregroundStyle(Color("Warning"))
        }
    }
}

/// The day's arithmetic over `totals` and `target` — presentation only, nothing server-side.
private struct Budget {
    /// The bar runs to 115% of the ceiling so an overshoot has room to show.
    static let span = 1.15

    enum CalorieState { case under, landed, over(Color) }

    let kcal: Double
    let protein: Double
    let fat: Double
    let carbs: Double
    let ceiling: Double?
    let proteinFloor: Double?
    let fatGuide: Double?
    let carbGuide: Double?

    init(day: DayRollup) {
        let t = day.totals, target = day.target?.value1
        kcal = t.calories ?? 0
        protein = t.proteinContent ?? 0
        fat = t.fatContent ?? 0
        carbs = t.carbohydrateContent ?? 0
        ceiling = target?.calories.flatMap { $0 > 0 ? $0 : nil }
        proteinFloor = target?.proteinContent
        fatGuide = target?.fatContent
        carbGuide = target?.carbohydrateContent
    }

    /// 4/9/4 kcal per gram, scaled so the three sources sum to the logged calories.
    var scale: Double {
        let raw = protein * 4 + fat * 9 + carbs * 4
        return raw > 0 ? kcal / raw : 1
    }

    /// Each source's share of the day's energy, 0…1.
    var shares: (protein: Double, fat: Double, carbs: Double) {
        guard kcal > 0 else { return (0, 0, 0) }
        let k = scale
        return (protein * 4 * k / kcal, fat * 9 * k / kcal, carbs * 4 * k / kcal)
    }

    var calorieState: CalorieState {
        guard let ceiling else { return .under }
        if kcal > ceiling {
            return .over((kcal - ceiling) / ceiling > 0.03 ? Color("Over") : Color("Warning"))
        }
        return kcal / ceiling >= 0.95 ? .landed : .under
    }

    /// Positions along the bar, 0…1. Without a ceiling the bar is pure proportions at full width.
    var fillEnd: Double { ceiling.map { min(kcal, $0) / ($0 * Self.span) } ?? (kcal > 0 ? 1 : 0) }
    var ceilingAt: Double? { ceiling.map { _ in 1 / Self.span } }
    var overEnd: Double? {
        guard let ceiling, kcal > ceiling else { return nil }
        return min(kcal, ceiling * Self.span) / (ceiling * Self.span)
    }
    var floorAt: Double? {
        guard let ceiling, let proteinFloor else { return nil }
        return min(proteinFloor * 4 * scale / (ceiling * Self.span), 1)
    }

    /// Fat's share of the lever calories, and the guideline's share over the targets.
    var fatShare: Double? {
        let levers = fat * 9 + carbs * 4
        return levers > 0 ? fat * 9 / levers : nil
    }
    var guideShare: Double? {
        guard let fatGuide, let carbGuide else { return nil }
        let levers = fatGuide * 9 + carbGuide * 4
        return levers > 0 ? fatGuide * 9 / levers : nil
    }
}

/// Energy by source filling toward the ceiling, the floor and ceiling ticks, the landing band, and
/// any overshoot past the ceiling as a stub in the state color.
private struct BudgetBar: View {
    let budget: Budget

    var body: some View {
        VStack(spacing: 14) {
            GeometryReader { geo in
                let w = geo.size.width
                let shares = budget.shares
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(.tertiarySystemFill)).frame(height: 10)
                    if let ceilingAt = budget.ceilingAt {
                        Rectangle().fill(Color.accentColor.opacity(0.12))
                            .frame(width: w * (ceilingAt - 0.95 / Budget.span), height: 10)
                            .offset(x: w * 0.95 / Budget.span)
                    }
                    HStack(spacing: 0) {
                        Rectangle().fill(Color.accentColor).frame(width: w * budget.fillEnd * shares.protein)
                        Rectangle().fill(Color.macroFat).frame(width: w * budget.fillEnd * shares.fat)
                        Rectangle().fill(Color.macroCarbs).frame(width: w * budget.fillEnd * shares.carbs)
                    }
                    .frame(height: 10)
                    .clipShape(Capsule())
                    if let ceilingAt = budget.ceilingAt, let overEnd = budget.overEnd, case let .over(color) = budget.calorieState {
                        UnevenRoundedRectangle(bottomTrailingRadius: 5, topTrailingRadius: 5)
                            .fill(color)
                            .frame(width: w * (overEnd - ceilingAt), height: 10)
                            .offset(x: w * ceilingAt)
                    }
                    if let floorAt = budget.floorAt { Tick(height: 20).offset(x: w * floorAt - 1) }
                    if let ceilingAt = budget.ceilingAt { Tick(height: 20).offset(x: w * ceilingAt - 1) }
                }
                .frame(height: 20)
            }
            .frame(height: 20)
            .accessibilityElement()
            .accessibilityLabel(accessibilityLabel)
            if budget.ceilingAt != nil {
                GeometryReader { geo in
                    ZStack(alignment: .topLeading) {
                        if let floorAt = budget.floorAt { tickLabel("floor").position(x: geo.size.width * floorAt, y: 6) }
                        if let ceilingAt = budget.ceilingAt { tickLabel("ceiling").position(x: geo.size.width * ceilingAt, y: 6) }
                    }
                }
                .frame(height: 12)
                .padding(.top, -10) // the labels sit 14 pt under the bar itself, not under the ticks
                .accessibilityHidden(true)
            }
        }
    }

    private func tickLabel(_ text: String) -> some View {
        Text(text).font(.system(size: 11)).foregroundStyle(.secondary).fixedSize()
    }

    private var accessibilityLabel: String {
        let s = budget.shares, k = budget.kcal
        let sources = "protein \(Format.whole(s.protein * k)), fat \(Format.whole(s.fat * k)), carbs \(Format.whole(s.carbs * k))"
        if let ceiling = budget.ceiling {
            return "Energy by source toward the \(Format.whole(ceiling)) kcal ceiling: \(sources)"
        }
        return "Energy by source: \(sources)"
    }
}

/// Fat and carbs aren't goals: no "left", no "over", no color judgment. Only their balance, against
/// the guideline's split.
private struct LeversRow: View {
    let budget: Budget

    var body: some View {
        VStack(spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text("Levers").font(.subheadline).foregroundStyle(.secondary)
                Spacer(minLength: 12)
                HStack(alignment: .firstTextBaseline, spacing: 14) {
                    lever(budget.fat, "g fat", color: .macroFat)
                    lever(budget.carbs, "g carbs", color: .macroCarbs)
                }
                .monospacedDigit()
            }
            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(.tertiarySystemFill)).frame(height: 6)
                    if let fatShare = budget.fatShare {
                        HStack(spacing: 0) {
                            Rectangle().fill(Color.macroFat).frame(width: w * fatShare)
                            Rectangle().fill(Color.macroCarbs)
                        }
                        .frame(height: 6)
                        .clipShape(Capsule())
                    }
                    if let guide = budget.guideShare { Tick(height: 14).offset(x: w * guide - 1) }
                }
                .frame(height: 14)
            }
            .frame(height: 14)
            .padding(.vertical, -4) // the guide tick overhangs the 6 pt bar; the bar keeps its spacing
            .accessibilityElement()
            .accessibilityLabel(balanceLabel)
            HStack {
                Text(shareCaption)
                Spacer(minLength: 8)
                if let f = budget.fatGuide, let c = budget.carbGuide, budget.guideShare != nil {
                    Text("guide \(Format.whole(f)) / \(Format.whole(c)) g")
                } else {
                    Text("no guide")
                }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .monospacedDigit()
        }
    }

    private func lever(_ grams: Double, _ unit: String, color: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Circle().fill(color).frame(width: 8, height: 8).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
            Text("\(Format.whole(grams)) \(Text(unit).foregroundStyle(.secondary))")
        }
    }

    private var shareCaption: String {
        guard let fatShare = budget.fatShare else { return "no fat or carbs yet" }
        let fat = "fat \(Int((fatShare * 100).rounded()))% of the levers"
        guard let guide = budget.guideShare else { return fat }
        return "\(fat) · guide \(Int((guide * 100).rounded()))%"
    }

    private var balanceLabel: String {
        guard let fatShare = budget.fatShare else { return "Lever balance: nothing logged" }
        let fat = "Lever balance: fat \(Int((fatShare * 100).rounded()))% of lever calories"
        guard let guide = budget.guideShare else { return fat }
        return "\(fat), guideline \(Int((guide * 100).rounded()))%"
    }
}

/// A legend dot and its label, as the protein row and the levers caption use.
private struct Legend: View {
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).font(.subheadline).foregroundStyle(.secondary)
        }
    }
}

/// A 2 pt marker over a bar: white in dark, black in light (boards `MacroBudget`, `MacrosDay-Light`).
private struct Tick: View {
    let height: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: 1)
            .fill(Color(UIColor { $0.userInterfaceStyle == .dark ? .white.withAlphaComponent(0.85) : .black.withAlphaComponent(0.75) }))
            .frame(width: 2, height: height)
    }
}

private extension Color {
    /// Energy-by-source hues (handoff §2 tokens). Source only — state lives in ticks and delta text.
    static let macroFat = Color.pink
    static let macroCarbs = Color(UIColor {
        $0.userInterfaceStyle == .dark
            ? UIColor(red: 0xFF / 255, green: 0xD6 / 255, blue: 0x0A / 255, alpha: 1)
            : UIColor(red: 0xE5 / 255, green: 0xB8 / 255, blue: 0x00 / 255, alpha: 1)
    })
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
