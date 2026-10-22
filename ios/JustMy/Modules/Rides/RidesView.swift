import Charts
import JMWClientSupport
import RidesAPI
import SwiftUI

typealias WeeklyStats = RidesAPI.Components.Schemas.WeeklyStats

/// Training › Rides (docs/ios-design-handoff.md §5.4). The log is the value: this week's numbers,
/// a six-week strip with no goal line, and every activity, newest first.
struct RidesView<Header: View>: View {
    let header: Header
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase
    @State private var weekly = Loader<WeeklyStats>()
    @State private var rides = PagedRides()

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22) {
                header
                if let failure = weekly.failure ?? rides.failure {
                    StatusBanner(failure: failure, loadedAt: weekly.loadedAt)
                }
                if let w = weekly.value {
                    WeekCard(weeks: w.weeks)
                } else if weekly.failure == nil {
                    Card { VStack(alignment: .leading, spacing: 14) { SkeletonBlock(height: 34); SkeletonBlock(height: 60) } }
                }
                if !rides.items.isEmpty {
                    RideList(rides: rides)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(Color(.systemGroupedBackground))
        .navigationDestination(for: RideSummary.self) { RideDetailView(summary: $0) }
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await load() } } }
    }

    private func load() async {
        guard let api else { return }
        async let a: Void = weekly.load { try await api.rides.getApiRidesWeekly(.init(query: .init(weeks: 6))).ok.body.json }
        async let b: Void = rides.reload(api)
        _ = await (a, b)
    }
}

/// The ride list, paged by 20 as it scrolls (the web page reads 200 at once; the API caps a page at 100).
@Observable
final class PagedRides {
    private(set) var items: [RideSummary] = []
    private(set) var total = 0
    private(set) var failure: LoadFailure?
    private var loading = false

    func reload(_ api: JMWClients) async { await fetch(api, offset: 0) }

    func loadMore(_ api: JMWClients) async {
        guard items.count < total, !loading else { return }
        await fetch(api, offset: items.count)
    }

    private func fetch(_ api: JMWClients, offset: Int) async {
        loading = true
        defer { loading = false }
        do {
            let page = try await api.rides.getApiRides(.init(query: .init(limit: 20, offset: offset))).ok.body.json
            items = offset == 0 ? page.items : items + page.items
            total = page.count
            failure = nil
        } catch is CancellationError {
        } catch {
            failure = LoadFailure(error)
        }
    }
}

/// This week (Monday start, Chicago) in four numbers, then the last six weeks' distance.
private struct WeekCard: View {
    let weeks: WeeklyStats.WeeksPayload

    private var thisMonday: String {
        let today = Format.date(fromISO: Format.todayISO())!
        let weekday = Format.calendar.component(.weekday, from: today) // 1 = Sunday
        return Format.addDays(-((weekday + 5) % 7), to: Format.todayISO())
    }

    var body: some View {
        let monday = thisMonday
        let current = weeks.first { $0.weekStart == monday }
        Card {
            VStack(alignment: .leading, spacing: 14) {
                SectionTitle("This week · from \(Format.day(monday))")
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    stat(Format.whole(Double(current?.rides ?? 0)), (current?.rides ?? 0) == 1 ? "ride" : "rides")
                    stat(Format.oneDecimal(Format.miles(fromMeters: current?.distanceMeters ?? 0)), "mi")
                    stat(Format.hoursMinutes(current?.movingSeconds ?? 0), "moving")
                    stat(Format.whole(Format.feet(fromMeters: current?.totalAscentMeters ?? 0)), "ft")
                }
                strip(monday: monday)
            }
        }
    }

    private func stat(_ value: String, _ unit: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.trend).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
            Text(unit).font(.footnote).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Six Monday-start weeks, oldest first, empty weeks as empty bars. No goal line.
    private func strip(monday: String) -> some View {
        let starts = (0..<6).reversed().map { Format.addDays(-7 * $0, to: monday) }
        let byStart = Dictionary(weeks.map { ($0.weekStart, $0.distanceMeters) }, uniquingKeysWith: { a, _ in a })
        let peak = max(byStart.values.max() ?? 1, 1)
        return HStack(alignment: .bottom, spacing: 6) {
            ForEach(starts, id: \.self) { start in
                VStack(spacing: 4) {
                    let d = byStart[start] ?? 0
                    RoundedRectangle(cornerRadius: 3)
                        .fill(start == monday ? Color.primary : Color.secondary.opacity(0.3))
                        .frame(height: max(3, 44 * d / peak))
                        .frame(height: 44, alignment: .bottom)
                    Text(Format.monthDay(start)).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .accessibilityLabel("Distance by week, last six weeks")
    }
}

private struct RideList: View {
    let rides: PagedRides
    @Environment(\.api) private var api

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle("Rides · \(rides.total)").padding(.horizontal, 16)
            VStack(spacing: 0) {
                ForEach(Array(rides.items.enumerated()), id: \.element.id) { index, ride in
                    NavigationLink(value: ride) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(ride.title)
                                Text(line2(ride)).font(.footnote).foregroundStyle(.secondary)
                                Text(line3(ride)).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
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
                        if index == rides.items.count - 1, let api { Task { await rides.loadMore(api) } }
                    }
                    if index < rides.items.count - 1 { Divider().padding(.leading, 16) }
                }
            }
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 26))
        }
    }

    private func line2(_ r: RideSummary) -> String {
        [Format.day(r.localDate), Format.time(r.startedAt), r.sportProfileName].compactMap { $0 }.joined(separator: " · ")
    }

    private func line3(_ r: RideSummary) -> String {
        var parts = [Format.movingShort(r.movingSeconds)]
        if let d = measured(r.distanceMeters) { parts.append("\(Format.oneDecimal(Format.miles(fromMeters: d))) mi") }
        if let a = r.totalAscentMeters, measured(r.distanceMeters) != nil { parts.append("\(Format.whole(Format.feet(fromMeters: a))) ft") }
        if let hr = r.avgHeartRate { parts.append("avg \(Format.whole(hr)) bpm") }
        return parts.joined(separator: " · ")
    }
}

extension RideSummary: @retroactive Identifiable {}
