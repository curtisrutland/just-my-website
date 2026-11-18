import JMWClientSupport
import SwiftUI

/// Today (#116): the three things checked every day, on the screen the app opens to. Macros at a
/// glance, today's weigh-in — or the field to log it, already focused — and the latest ride in one
/// line. A surface over three modules' own reads: it arranges their facts side by side and computes
/// nothing new. Each card loads and fails on its own.
struct TodayView: View {
    @Binding var tab: AppTab
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("body.segment") private var bodySegment = BodySegment.weight
    @State private var day = Format.todayISO()
    @State private var macros = Loader<DayRollup>()
    @State private var weighIns = Loader<[WeightEntry]>()
    @State private var rides = Loader<[RideSummary]>()
    /// The keyboard comes up by itself once per unlock; after that it's the user's to raise.
    @State private var offeredKeyboard = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if let failure = macros.failure ?? weighIns.failure ?? rides.failure {
                    StatusBanner(failure: failure, loadedAt: macros.loadedAt ?? weighIns.loadedAt ?? rides.loadedAt)
                }
                macrosCard
                weightCard
                rideRow
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
            .pageContent()
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Today")
        .navigationSubtitle(Format.day(day))
        .navigationDestination(for: RideSummary.self) { RideDetailView(summary: $0) }
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await load() } } }
    }

    /// Three independent reads. `day` is re-read each time, so a refetch after midnight moves on.
    private func load() async {
        guard let api else { return }
        let today = Format.todayISO()
        day = today
        async let a: Void = macros.load { try await api.macros.getApiMacrosDaysDate(.init(path: .init(date: today))).ok.body.json }
        async let b: Void = weighIns.load { try await api.weight.getApiWeightEntries(.init(query: .init(limit: 3))).ok.body.json.items }
        async let c: Void = rides.load { try await api.rides.getApiRides(.init(query: .init(limit: 1, offset: 0))).ok.body.json.items }
        _ = await (a, b, c)
    }

    // MARK: Macros

    /// The top of the Macros rollup: calories against the ceiling, protein to the floor.
    @ViewBuilder
    private var macrosCard: some View {
        // A day that rolled over shows the old rollup until the new one lands; don't call it today's.
        if let rollup = macros.value, rollup.day.date == day {
            let budget = Budget(day: rollup)
            Button { tab = .macros } label: {
                Card {
                    VStack(alignment: .leading, spacing: 14) {
                        CardTitle("Macros", opens: true)
                        BudgetHero(budget: budget)
                        BudgetBar(budget: budget)
                        ProteinRow(budget: budget, isToday: true)
                    }
                }
                .contentShape(.rect(cornerRadius: 26))
            }
            .buttonStyle(.plain)
        } else if macros.failure == nil {
            Card { VStack(alignment: .leading, spacing: 14) { SkeletonBlock(height: 44, width: 200); SkeletonBlock(height: 20); SkeletonBlock(height: 20) } }
        }
    }

    // MARK: Weight

    @ViewBuilder
    private var weightCard: some View {
        if let entries = weighIns.value {
            switch TodaySummary.weighIn(entries, measuredOn: \.measuredOn, today: day) {
            case let .logged(entry):
                Button {
                    bodySegment = .weight
                    tab = .body
                } label: {
                    Card {
                        VStack(alignment: .leading, spacing: 8) {
                            CardTitle("Weight", opens: true)
                            HStack(alignment: .firstTextBaseline) {
                                ValueUnit(value: Format.oneDecimal(entry.weight), unit: "lb", valueFont: .trend)
                                Spacer(minLength: 12)
                                Text("logged \(Format.time(entry.updatedAt))")
                                    .font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                            }
                        }
                    }
                    .contentShape(.rect(cornerRadius: 26))
                }
                .buttonStyle(.plain)
            case let .notYet(last):
                WeighInField(day: day, last: last, raisesKeyboard: !offeredKeyboard) {
                    offeredKeyboard = true
                } onSaved: {
                    await reloadWeighIns()
                }
            }
        } else if weighIns.failure == nil {
            Card { VStack(alignment: .leading, spacing: 10) { SkeletonBlock(height: 14, width: 70); SkeletonBlock(height: 30, width: 130) } }
        }
    }

    private func reloadWeighIns() async {
        guard let api else { return }
        await weighIns.load { try await api.weight.getApiWeightEntries(.init(query: .init(limit: 3))).ok.body.json.items }
    }

    // MARK: Latest ride

    @ViewBuilder
    private var rideRow: some View {
        if let ride = rides.value?.first {
            NavigationLink(value: ride) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Latest ride").foregroundStyle(.secondary)
                    Spacer(minLength: 12)
                    Text(TodaySummary.rideLine(localDate: ride.localDate, distanceMeters: ride.distanceMeters,
                                               movingSeconds: ride.movingSeconds, today: day))
                        .monospacedDigit().lineLimit(1)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .frame(minHeight: 44)
                .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 26))
                .contentShape(.rect(cornerRadius: 26))
            }
            .buttonStyle(.plain)
        }
    }
}

/// A card's label, with a chevron when the card opens its tab.
private struct CardTitle: View {
    let text: String
    let opens: Bool

    init(_ text: String, opens: Bool = false) {
        self.text = text
        self.opens = opens
    }

    var body: some View {
        HStack {
            SectionTitle(text)
            if opens {
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
    }
}

/// Today's weigh-in, not logged yet: a field that takes the number where it stands. It saves
/// through the same write as the Log weight sheet (`JMWClients.logWeight`), for today only; another
/// day, or a note, is the sheet's job in Body.
private struct WeighInField: View {
    let day: String
    let last: WeightEntry?
    /// Whether to put the cursor in the field as it appears.
    let raisesKeyboard: Bool
    let onKeyboardOffered: () -> Void
    let onSaved: () async -> Void

    @Environment(\.api) private var api
    @State private var text = ""
    @State private var saving = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                CardTitle("Weight")
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    TextField("0.0", text: $text)
                        .font(.trend).monospacedDigit()
                        .keyboardType(.decimalPad)
                        .focused($focused)
                        .fixedSize()
                    Text("lb").foregroundStyle(.secondary)
                    Spacer(minLength: 12)
                    Button("Save") { Task { await save() } }
                        .fontWeight(.semibold)
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.capsule)
                        .disabled(WeightInput.parse(text) == nil || saving)
                }
                // The field hugs its digits; a tap anywhere on the row still puts the cursor in it.
                .contentShape(.rect)
                .onTapGesture { focused = true }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                } else {
                    Text(context).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                }
            }
        }
        // Focus after the screen settles (the unlock cross-dissolve); focusing sooner is dropped.
        .task {
            guard raisesKeyboard else { return }
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            focused = true
            onKeyboardOffered()
        }
    }

    private var context: String {
        guard let last else { return "No weigh-in yet today." }
        let when = Format.recentDay(last.measuredOn, today: day)
        return "Not weighed in yet today · \(when == "Yesterday" ? "yesterday" : when) \(Format.oneDecimal(last.weight)) lb"
    }

    private func save() async {
        guard let api, let value = WeightInput.parse(text) else { return }
        saving = true
        defer { saving = false }
        error = await api.logWeight(value, on: day)
        if error == nil {
            focused = false
            await onSaved()
        }
    }
}
