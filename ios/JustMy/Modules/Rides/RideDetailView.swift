import Charts
import JMWClientSupport
import MapKit
import RidesAPI
import SwiftUI

/// One ride (docs/ios-design-handoff.md §5.4): the route, the facts, where the heart rate was, and
/// the ride over time. Sections for channels the device didn't record are absent, not empty.
struct RideDetailView: View {
    let summary: RideSummary
    @Environment(\.api) private var api
    @State private var loader = Loader<RideDetail>()
    @State private var replaying = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if let failure = loader.failure {
                    StatusBanner(failure: failure, loadedAt: loader.loadedAt)
                }
                if let ride = loader.value {
                    let track = RideTrack(ride)
                    if let track, track.hasRoute {
                        RouteMap(route: track.route)
                            .frame(height: 240)
                            .clipShape(.rect(cornerRadius: 26))
                            .overlay(alignment: .bottomTrailing) {
                                Button { replaying = true } label: { Label("Replay", systemImage: "play.fill") }
                                    .buttonStyle(.glass)
                                    .padding(12)
                            }
                    }
                    SummaryCard(ride: ride, indoor: !(track?.hasRoute ?? false))
                    if let zones = HRZones(seconds: ride.timeInHrZone?.value1.timeInHrZone, boundaries: ride.timeInHrZone?.value1.hrZoneHighBoundary) {
                        ZonesSection(zones: zones)
                    }
                    if let track {
                        OverTheRide(track: track, canReplay: track.hasRoute) { replaying = true }
                    }
                    if let note = ride.note {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionTitle("Note").padding(.horizontal, 16)
                            Card { Text(note) }
                        }
                    }
                } else if loader.failure == nil {
                    SkeletonBlock(height: 240)
                    Card { VStack(spacing: 14) { ForEach(0..<3, id: \.self) { _ in SkeletonBlock(height: 34) } } }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(loader.value?.title ?? summary.title)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .fullScreenCover(isPresented: $replaying) {
            if let ride = loader.value, let track = RideTrack(ride) {
                ReplayView(title: ride.title, track: track)
            }
        }
    }

    private func load() async {
        guard let api else { return }
        await loader.load { try await api.rides.getApiRidesId(.init(path: .init(id: summary.id), query: .init(streams: ._1))).ok.body.json }
    }
}

/// The whole route, muted map, Accent line, white start dot and Accent end dot.
struct RouteMap: View {
    let route: [CLLocationCoordinate2D]

    var body: some View {
        Map(initialPosition: .rect(boundingRect(route))) {
            MapPolyline(coordinates: route).stroke(Color.accentColor, lineWidth: 3)
            if let start = route.first {
                Annotation("Start", coordinate: start) { Circle().fill(.white).frame(width: 9, height: 9).overlay(Circle().stroke(.black.opacity(0.3))) }
                    .annotationTitles(.hidden)
            }
            if let end = route.last {
                Annotation("End", coordinate: end) { Circle().fill(Color.accentColor).frame(width: 9, height: 9) }
                    .annotationTitles(.hidden)
            }
        }
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
        .mapControlVisibility(.hidden)
    }
}

/// The route's bounds, padded so the line doesn't touch the edges.
func boundingRect(_ route: [CLLocationCoordinate2D]) -> MKMapRect {
    var rect = MKMapRect.null
    for c in route {
        let p = MKMapPoint(c)
        rect = rect.union(MKMapRect(x: p.x, y: p.y, width: 0, height: 0))
    }
    let pad = max(rect.width, rect.height) * 0.15 + 200
    return rect.insetBy(dx: -pad, dy: -pad)
}

private struct SummaryCard: View {
    let ride: RideDetail
    let indoor: Bool

    private struct Tile: Identifiable {
        let label: String
        let value: String
        let unit: String
        var sub: String? = nil
        var id: String { label }
    }

    private var tiles: [Tile] {
        var t: [Tile] = []
        let elapsedDiffers = ride.elapsedSeconds - ride.movingSeconds > 30
        t.append(Tile(label: "Moving time", value: Format.clock(ride.movingSeconds), unit: "",
                      sub: elapsedDiffers ? "elapsed \(Format.clock(ride.elapsedSeconds))" : nil))
        if let d = measured(ride.distanceMeters) {
            t.append(Tile(label: "Distance", value: Format.oneDecimal(Format.miles(fromMeters: d)), unit: "mi"))
        }
        if !indoor, let a = ride.totalAscentMeters {
            t.append(Tile(label: "Ascent", value: Format.whole(Format.feet(fromMeters: a)), unit: "ft",
                          sub: ride.totalDescentMeters.map { "\(Format.whole(Format.feet(fromMeters: $0))) ft descent" }))
        }
        if let hr = ride.avgHeartRate {
            t.append(Tile(label: "Heart rate", value: Format.whole(hr), unit: "bpm", sub: ride.maxHeartRate.map { "max \(Format.whole($0))" }))
        }
        if let v = measured(ride.avgSpeedMps) {
            t.append(Tile(label: "Speed", value: Format.oneDecimal(Format.mph(fromMps: v)), unit: "mph",
                          sub: measured(ride.maxSpeedMps).map { "max \(Format.oneDecimal(Format.mph(fromMps: $0)))" }))
        }
        if let w = ride.avgPowerWatts {
            t.append(Tile(label: "Power", value: Format.whole(w), unit: "W", sub: ride.maxPowerWatts.map { "max \(Format.whole($0))" }))
        }
        if let kcal = ride.calories {
            t.append(Tile(label: "Calories", value: Format.whole(kcal), unit: "kcal"))
        }
        return t
    }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                Text([Format.day(ride.localDate), Format.time(ride.startedAt), ride.sportProfileName, deviceName(ride.deviceProduct)]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(.secondary)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .topLeading), count: 3), alignment: .leading, spacing: 16) {
                    ForEach(tiles) { tile in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(tile.label).font(.footnote).foregroundStyle(.secondary)
                            HStack(alignment: .firstTextBaseline, spacing: 3) {
                                Text(tile.value).font(.title3.weight(.semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                                if !tile.unit.isEmpty { Text(tile.unit).font(.footnote).foregroundStyle(.secondary) }
                            }
                            if let sub = tile.sub { Text(sub).font(.caption).foregroundStyle(.secondary).monospacedDigit() }
                        }
                    }
                }
                if indoor {
                    Text("No GPS on this activity, so no map, distance, speed or ascent — the device reports those as 0, which here means not measured.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// The zone scale (handoff §2.2): ordinal system colors, Success/Warning/Over never used here.
func zoneColor(_ index: Int, count: Int) -> Color {
    switch index {
    case 0: Color(.systemGray).opacity(0.45)
    case 1: Color(.systemGray)
    case 2: .blue
    case 3: .green
    case 4: .orange
    default: .red
    }
}

private struct ZonesSection: View {
    let zones: HRZones

    var body: some View {
        let shown = zones.buckets.filter { $0.seconds > 0 }
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle("Heart-rate zones · this ride's boundaries").padding(.horizontal, 16)
            Card {
                VStack(alignment: .leading, spacing: 12) {
                    GeometryReader { geo in
                        HStack(spacing: 2) {
                            ForEach(shown) { b in
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(zoneColor(b.index, count: zones.buckets.count))
                                    .frame(width: max(2, (geo.size.width - CGFloat(shown.count - 1) * 2) * b.seconds / zones.total))
                            }
                        }
                    }
                    .frame(height: 16)
                    .accessibilityHidden(true)
                    ForEach(shown) { b in
                        HStack {
                            Circle().fill(zoneColor(b.index, count: zones.buckets.count)).frame(width: 8, height: 8)
                            Text(b.name)
                            Text(b.range).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                            Spacer()
                            Text(Format.clock(b.seconds)).monospacedDigit()
                        }
                    }
                }
            }
        }
    }
}

/// Elevation, heart rate and speed over the ride; null buckets are gaps. Tapping opens Replay.
private struct OverTheRide: View {
    let track: RideTrack
    let canReplay: Bool
    let replay: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                SectionTitle("Over the ride")
                Spacer()
                if canReplay {
                    Button("Scrub and replay ›", action: replay).font(.footnote)
                }
            }
            .padding(.horizontal, 16)
            Card {
                VStack(alignment: .leading, spacing: 16) {
                    if track.hasData(track.altitudeFt) { StreamChart(label: "Elevation", unit: "ft", track: track, values: track.altitudeFt) }
                    if track.hasData(track.heartRate) { StreamChart(label: "Heart rate", unit: "bpm", track: track, values: track.heartRate) }
                    if track.hasData(track.speedMph) { StreamChart(label: "Speed", unit: "mph", track: track, values: track.speedMph) }
                    TimeTicks(duration: track.duration)
                }
            }
            .contentShape(.rect)
            .onTapGesture { if canReplay { replay() } }
        }
    }
}

/// One stream channel: an Accent line over a 12% area, gaps broken. `cursor` draws the replay sweeper (`label`: the board's white in dark, black in light).
struct StreamChart: View {
    let label: String
    let unit: String
    let track: RideTrack
    let values: [Double?]
    var height: CGFloat = 64
    var cursor: Double? = nil
    var showsCaption = true

    private struct Sample: Identifiable { let id: Int; let t: Double; let v: Double; let run: Int }

    private var samples: [Sample] {
        var run = 0, previous = false
        return values.enumerated().compactMap { i, v in
            if v != nil && !previous { run += 1 }
            previous = v != nil
            return v.map { Sample(id: i, t: track.t[i], v: $0, run: run) }
        }
    }

    var body: some View {
        let samples = self.samples
        let lo = samples.map(\.v).min() ?? 0, hi = samples.map(\.v).max() ?? 1
        VStack(alignment: .leading, spacing: 4) {
            if showsCaption {
                HStack {
                    Text(label).font(.footnote)
                    Spacer()
                    Text("\(Format.whole(lo))–\(Format.whole(hi)) \(unit)").font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                }
            } else {
                Text(label.uppercased()).font(.system(size: 11)).foregroundStyle(.secondary)
            }
            Chart {
                ForEach(samples) { s in
                    AreaMark(x: .value("t", s.t), yStart: .value("lo", lo), yEnd: .value("v", s.v), series: .value("run", s.run))
                        .foregroundStyle(Color.accentColor.opacity(0.12))
                    LineMark(x: .value("t", s.t), y: .value("v", s.v), series: .value("run", s.run))
                        .lineStyle(StrokeStyle(lineWidth: 1.8))
                        .foregroundStyle(Color.accentColor)
                }
                if let cursor {
                    RuleMark(x: .value("now", cursor)).foregroundStyle(Color(.label)).lineStyle(StrokeStyle(lineWidth: 1.5))
                    if let v = track.value(values, at: cursor) {
                        PointMark(x: .value("now", cursor), y: .value("v", v)).foregroundStyle(Color(.label)).symbolSize(28)
                    }
                }
            }
            .chartXScale(domain: 0...max(track.duration, 1))
            .chartYScale(domain: lo...(hi > lo ? hi : lo + 1))
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .frame(height: height)
        }
    }
}

/// `0:00 · 0:30 · 1:00 · 1:30` under the charts.
struct TimeTicks: View {
    let duration: Double

    var body: some View {
        let step = duration > 7200 ? 3600.0 : duration > 1800 ? 1800.0 : 600.0
        let ticks = stride(from: 0.0, through: duration, by: step).map { $0 }
        GeometryReader { geo in
            ForEach(ticks, id: \.self) { tick in
                Text(Format.hoursMinutes(tick))
                    .font(.caption2).foregroundStyle(.secondary).monospacedDigit()
                    .fixedSize()
                    .position(x: min(max(geo.size.width * tick / max(duration, 1), 14), geo.size.width - 14), y: 6)
            }
        }
        .frame(height: 12)
    }
}
