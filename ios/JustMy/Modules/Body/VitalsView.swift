import Charts
import JMWClientSupport
import SwiftUI
import VitalsAPI

typealias VitalsRollup = VitalsAPI.Components.Schemas.VitalsRollup
typealias VitalsDay = VitalsAPI.Components.Schemas.VitalsDayView

/// Body › Vitals (docs/ios-design-handoff.md §5.3). Measurements, not verdicts: three trends, the
/// factual gaps, and the days, newest first. There is no score anywhere.
struct VitalsView<Header: View>: View {
    let header: Header
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("vitals.window") private var window = 14
    @State private var rollup = Loader<VitalsRollup>()
    @State private var days = PagedDays()

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22) {
                header
                if let failure = rollup.failure ?? days.failure {
                    StatusBanner(failure: failure, loadedAt: rollup.loadedAt)
                }
                if let value = rollup.value {
                    VStack(alignment: .leading, spacing: 8) {
                        TrendsCard(rollup: value)
                        Text(gapsText(value)).font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 16)
                    }
                } else if rollup.failure == nil {
                    Card { VStack(spacing: 18) { ForEach(0..<3, id: \.self) { _ in SkeletonBlock(height: 40) } } }
                }
                if !days.items.isEmpty {
                    DaysList(days: days)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(Color(.systemGroupedBackground))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Picker("Window", selection: $window) {
                    Text("14").tag(14); Text("30").tag(30); Text("90").tag(90); Text("All").tag(365)
                }
                .pickerStyle(.segmented)
                .fixedSize()
            }
        }
        .navigationDestination(for: VitalsDay.self) { VitalsDayDetail(day: $0) }
        .refreshable { await load(reset: true) }
        .task(id: window) { await load(reset: days.items.isEmpty) }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await load(reset: true) } } }
    }

    private func load(reset: Bool) async {
        guard let api else { return }
        async let a: Void = rollup.load { try await api.vitals.getApiVitalsSummary(.init(query: .init(window: window))).ok.body.json }
        async let b: Void = reset ? days.reload(api) : ()
        _ = await (a, b)
    }

    private func gapsText(_ r: VitalsRollup) -> String {
        if r.gaps.isEmpty {
            return "Every day since \(Format.monthDay(r.from)) has data. Week-over-week change is a plain number — there is no score."
        }
        return "No data " + r.gaps.map { Format.monthDay($0.date) }.joined(separator: " · ")
    }
}

/// The days list, paged by 30 as it scrolls (the API caps a page at 100).
@Observable
final class PagedDays {
    private(set) var items: [VitalsDay] = []
    private(set) var total = 0
    private(set) var failure: LoadFailure?
    private var loading = false

    var hasMore: Bool { items.count < total }

    func reload(_ api: JMWClients) async { await fetch(api, offset: 0) }

    func loadMore(_ api: JMWClients) async {
        guard hasMore, !loading else { return }
        await fetch(api, offset: items.count)
    }

    private func fetch(_ api: JMWClients, offset: Int) async {
        loading = true
        defer { loading = false }
        do {
            let page = try await api.vitals.getApiVitals(.init(query: .init(limit: 30, offset: offset))).ok.body.json
            items = offset == 0 ? page.items : items + page.items
            total = page.count
            failure = nil
        } catch is CancellationError {
        } catch {
            failure = LoadFailure(error)
        }
    }
}

private struct TrendsCard: View {
    let rollup: VitalsRollup

    var body: some View {
        Card(padding: EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16)) {
            VStack(spacing: 0) {
                TrendRow(label: "Resting heart rate", trend: Trend(rollup.restingHeartRate), unit: "bpm", format: { Format.whole($0) }, delta: { Format.signed($0) + " bpm/wk" })
                Divider()
                TrendRow(label: "HRV, last night", trend: Trend(rollup.hrvLastNightMs), unit: "ms", format: { Format.whole($0) }, delta: { Format.signed($0.rounded()) + " ms/wk" })
                Divider()
                TrendRow(label: "Sleep", trend: Trend(rollup.sleepTotalSeconds), unit: "", format: { Format.hoursMinutes($0) }, delta: { signedHM($0) + "/wk" })
            }
        }
    }

    private func signedHM(_ seconds: Double) -> String {
        let minutes = Int((seconds / 60).rounded())
        guard minutes != 0 else { return "0:00" }
        return (minutes > 0 ? "+" : "−") + String(format: "%d:%02d", abs(minutes) / 60, abs(minutes) % 60)
    }
}

/// The three rollup metrics share a shape; this flattens the three generated payload types.
private struct Trend {
    let current: Double?
    let currentAvg: Double?
    let deltaPerWeek: Double?
    let series: [Double?]

    init(_ t: VitalsRollup.RestingHeartRatePayload) {
        current = t.current; currentAvg = t.currentAvg; deltaPerWeek = t.deltaPerWeek; series = t.series.map(\.value)
    }
    init(_ t: VitalsRollup.HrvLastNightMsPayload) {
        current = t.current; currentAvg = t.currentAvg; deltaPerWeek = t.deltaPerWeek; series = t.series.map(\.value)
    }
    init(_ t: VitalsRollup.SleepTotalSecondsPayload) {
        current = t.current; currentAvg = t.currentAvg; deltaPerWeek = t.deltaPerWeek; series = t.series.map(\.value)
    }
}

private struct TrendRow: View {
    let label: String
    let trend: Trend
    let unit: String
    let format: (Double) -> String
    let delta: (Double) -> String

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.footnote).foregroundStyle(.secondary)
                if let current = trend.current {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(format(current)).font(.trend).monospacedDigit()
                        if !unit.isEmpty { Text(unit).font(.footnote).foregroundStyle(.secondary) }
                    }
                } else {
                    Text("—").font(.trend).foregroundStyle(.secondary).accessibilityLabel("not measured")
                }
                Text(caption).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
            }
            Spacer()
            Sparkline(values: trend.series).frame(width: 104, height: 40)
        }
        .padding(.vertical, 12)
    }

    private var caption: String {
        var parts: [String] = []
        if let avg = trend.currentAvg { parts.append("7-day \(unit.isEmpty ? format(avg) : Format.oneDecimal(avg))") }
        if let d = trend.deltaPerWeek { parts.append(delta(d)) }
        return parts.joined(separator: " · ")
    }
}

private struct DaysList: View {
    let days: PagedDays
    @Environment(\.api) private var api

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle("Days").padding(.horizontal, 16)
            VStack(spacing: 0) {
                ForEach(Array(days.items.enumerated()), id: \.element.id) { index, day in
                    NavigationLink(value: day) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(Format.relativeDay(day.measuredOn))
                                Text(summary(day)).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 11)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .onAppear {
                        if index == days.items.count - 1, let api { Task { await days.loadMore(api) } }
                    }
                    if index < days.items.count - 1 { Divider().padding(.leading, 16) }
                }
            }
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 26))
        }
    }

    private func summary(_ d: VitalsDay) -> String {
        var parts: [String] = []
        parts.append(d.sleepTotalSeconds.map { "\(Format.hoursMinutes(Double($0))) sleep" } ?? "— sleep")
        parts.append(d.hrvLastNightMs.map { "\($0) ms" } ?? "— ms")
        parts.append(d.restingHeartRate.map { "\($0) bpm" } ?? "— bpm")
        if let steps = d.steps {
            let inProgress = d.measuredOn == Format.todayISO()
            parts.append("\(Format.whole(Double(steps))) steps\(inProgress ? " so far" : "")")
        }
        return parts.joined(separator: " · ")
    }
}

extension VitalsDay: @retroactive Identifiable {}
