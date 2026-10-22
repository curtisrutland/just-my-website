import Charts
import JMWClientSupport
import SwiftUI
import WeightAPI

typealias WeightRollup = WeightAPI.Components.Schemas.WeightRollup
typealias WeightEntry = WeightAPI.Components.Schemas.WeightEntryView

/// Body › Weight (docs/ios-design-handoff.md §5.2). The trend is the truth: the 7-day average leads,
/// daily weigh-ins are subordinate scatter. Logging a weight is #74.
struct WeightView<Header: View>: View {
    let header: Header
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("weight.window") private var window = 30
    @State private var rollup = Loader<WeightRollup>()
    @State private var recent = Loader<[WeightEntry]>()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                if let failure = rollup.failure ?? recent.failure {
                    StatusBanner(failure: failure, loadedAt: rollup.loadedAt)
                }
                if let value = rollup.value {
                    TrendCard(rollup: value, latest: recent.value?.first, window: $window)
                } else if rollup.failure == nil {
                    Card { VStack(alignment: .leading, spacing: 14) { SkeletonBlock(height: 44, width: 160); SkeletonBlock(height: 168) } }
                }
                if let entries = recent.value {
                    RecentWeighIns(entries: entries)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
            .pageContent()
        }
        .background(Color(.systemGroupedBackground))
        .refreshable { await load() }
        .task(id: window) { await load() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await load() } } }
    }

    private func load() async {
        guard let api else { return }
        async let a: Void = rollup.load { try await api.weight.getApiWeightRollup(.init(query: .init(window: window))).ok.body.json }
        async let b: Void = recent.load { try await api.weight.getApiWeightEntries(.init(query: .init(limit: 8))).ok.body.json.items }
        _ = await (a, b)
    }
}

private struct TrendCard: View {
    let rollup: WeightRollup
    let latest: WeightEntry?
    @Binding var window: Int

    var body: some View {
        let s = rollup.summary
        Card {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline) {
                    if let avg = s.currentAvg {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(Format.oneDecimal(avg)).font(.hero).tracking(-0.6).monospacedDigit()
                            Text("lb").foregroundStyle(.secondary)
                        }
                    } else {
                        Text("—").font(.hero).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if let rate = s.trendPerWeek {
                        Label {
                            Text("\(Format.oneDecimal(abs(rate))) lb/wk").monospacedDigit()
                        } icon: {
                            Image(systemName: rate < 0 ? "arrow.down" : rate > 0 ? "arrow.up" : "arrow.right")
                        }
                        .foregroundStyle(.secondary)
                    }
                }
                Text(caption(s)).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                HStack {
                    Spacer()
                    Picker("Window", selection: $window) {
                        Text("30").tag(30); Text("90").tag(90); Text("365").tag(365); Text("All").tag(3650)
                    }
                    .pickerStyle(.segmented)
                    .fixedSize()
                }
                WeightChart(series: rollup.series)
                    .frame(height: 168)
            }
        }
    }

    private func caption(_ s: WeightRollup.SummaryPayload) -> String {
        var parts = ["7-day average"]
        if let latest { parts.append("\(latest.measuredOn == Format.todayISO() ? "today" : Format.monthDay(latest.measuredOn)) \(Format.oneDecimal(latest.weight)) lb") }
        if let r = s.range {
            let span = window >= 3650 ? "all time" : "last \(window) days"
            parts.append("\(span) \(Format.oneDecimal(r.min))–\(Format.oneDecimal(r.max))")
        }
        return parts.joined(separator: " · ")
    }
}

/// Daily weigh-ins as faint dots, the 7-day average as the Accent line. Gaps stay gaps: the line
/// breaks where the average is missing instead of bridging it.
private struct WeightChart: View {
    let series: WeightRollup.SeriesPayload

    private struct Point: Identifiable {
        let id: Int
        let date: Date
        let weight: Double?
        let avg: Double?
        let segment: Int
    }

    private var points: [Point] {
        var segment = 0, previousHadAvg = false
        return series.enumerated().compactMap { i, p in
            guard let date = Format.date(fromISO: p.date) else { return nil }
            if p.avg != nil && !previousHadAvg { segment += 1 }
            previousHadAvg = p.avg != nil
            return Point(id: i, date: date, weight: p.weight, avg: p.avg, segment: segment)
        }
    }

    /// Fit the data, padded by a pound, so a 10 lb trend fills the chart instead of a flat line.
    private func domain(_ points: [Point]) -> ClosedRange<Double> {
        let values = points.flatMap { [$0.weight, $0.avg] }.compactMap { $0 }
        guard let lo = values.min(), let hi = values.max() else { return 0...1 }
        return (lo - 1).rounded(.down)...(hi + 1).rounded(.up)
    }

    /// Gridlines at round 5 lb values inside the domain.
    private func gridlines(_ points: [Point]) -> [Double] {
        let d = domain(points)
        let step = d.upperBound - d.lowerBound > 40 ? 10.0 : 5.0
        return stride(from: (d.lowerBound / step).rounded(.up) * step, through: d.upperBound, by: step).map { $0 }
    }

    var body: some View {
        let points = self.points
        Chart {
            ForEach(points) { p in
                if let w = p.weight {
                    PointMark(x: .value("Day", p.date), y: .value("Weight", w))
                        .symbolSize(10)
                        .foregroundStyle(Color.secondary.opacity(0.45))
                }
            }
            ForEach(points.filter { $0.avg != nil }) { p in
                LineMark(x: .value("Day", p.date), y: .value("Average", p.avg!), series: .value("Run", p.segment))
                    .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                    .foregroundStyle(Color.accentColor)
            }
        }
        .chartYScale(domain: domain(points))
        .chartYAxis {
            AxisMarks(position: .trailing, values: gridlines(points)) { value in
                AxisGridLine()
                AxisValueLabel { if let v = value.as(Double.self) { Text(Format.whole(v)).monospacedDigit() } }
            }
        }
        .chartXAxis {
            if let first = points.first?.date {
                AxisMarks(values: [first]) { _ in
                    AxisValueLabel(anchor: .topLeading) { Text(Format.monthDay(Format.iso(first))) }
                }
            }
            if let last = points.last?.date {
                AxisMarks(values: [last]) { _ in
                    AxisValueLabel(anchor: .topTrailing) { Text(Format.monthDay(Format.iso(last))) }
                }
            }
        }
        .accessibilityLabel("Weight trend")
    }
}

private struct RecentWeighIns: View {
    let entries: [WeightEntry]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle("Recent weigh-ins").padding(.horizontal, 16)
            RowCard(items: Array(entries.enumerated()).map(Indexed.init)) { row in
                HStack(alignment: .firstTextBaseline) {
                    Text(Format.relativeDay(row.entry.measuredOn))
                    Spacer()
                    ValueUnit(value: Format.oneDecimal(row.entry.weight), unit: "lb")
                    Text(delta(row.index))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                        .frame(width: 44, alignment: .trailing)
                }
            }
        }
    }

    /// Change from the next-older weigh-in on the list (blank for the oldest shown).
    private func delta(_ index: Int) -> String {
        guard index + 1 < entries.count else { return "" }
        return Format.signed(entries[index].weight - entries[index + 1].weight, decimals: 1)
    }

    private struct Indexed: Identifiable {
        let index: Int
        let entry: WeightEntry
        init(_ pair: (Int, WeightEntry)) { (index, entry) = pair }
        var id: String { entry.id }
    }
}
