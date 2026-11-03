import Charts
import MapKit
import SwiftUI

/// Replay (docs/ios-design-handoff.md §6): the four streams correlated by time. Drag the chart strip
/// to scrub, or play it back compressed. Everything shown is interpolated between recorded samples.
/// To read how the streams correlate (#104), each chart marks its peak with a rule through the whole
/// strip, climbs are shaded behind all three, and the route can be colored by HR zone, speed or grade.
struct ReplayView: View {
    let title: String
    let track: RideTrack
    /// Derived once: the body re-renders about 30 times a second while playing.
    private let figures: ReplayFigures

    @Environment(\.dismiss) private var dismiss
    @AppStorage("replay.speed") private var speed = 60
    @AppStorage("replay.coloring") private var coloring = RouteColoring.plain
    @State private var time: Double = 0
    @State private var playing = false
    @State private var stripWidth: CGFloat = 1
    @State private var snappedPeak: Double?
    @State private var camera: MapCameraPosition

    init(title: String, track: RideTrack) {
        self.title = title
        self.track = track
        figures = ReplayFigures(track)
        _camera = State(initialValue: .rect(boundingRect(track.route)))
    }

    /// The stored choice, unless this ride can't draw it (no HR, no zones, no speed).
    private var activeColoring: RouteColoring {
        figures.coloringOptions.contains(coloring) ? coloring : .plain
    }

    var body: some View {
        // A plain header instead of a navigation bar: MapKit extends into any safe area it touches,
        // so the map sits below this row rather than under a bar.
        VStack(spacing: 12) {
            HStack {
                Text(title).font(.headline).lineLimit(1)
                Spacer()
                Button("Done") { dismiss() }
                    .fontWeight(.semibold)
                    .buttonStyle(.glass)
            }
            map.frame(height: 250).clipShape(.rect(cornerRadius: 26))
                .overlay(alignment: .topTrailing) { coloringMenu.padding(10) }
                .overlay(alignment: .bottomLeading) { legend.padding(10) }
            readout
            strip
            transport
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .background(Color(.systemGroupedBackground))
        // While playing, advance `time` by speed × wall-clock elapsed, about 30 times a second.
        // Restarts whenever play toggles; cancelled when the cover closes.
        .task(id: playing) {
            guard playing else { return }
            var last = Date.now
            while playing, !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(33))
                let now = Date.now
                time = min(track.duration, time + now.timeIntervalSince(last) * Double(speed))
                last = now
                if time >= track.duration { playing = false }
            }
        }
    }

    private var map: some View {
        Map(position: $camera) {
            ForEach(strokes) { stroke in
                MapPolyline(coordinates: stroke.points).stroke(stroke.color, lineWidth: stroke.width)
            }
            if let start = track.route.first {
                Annotation("Start", coordinate: start) { Circle().fill(.white).frame(width: 8, height: 8) }
                    .annotationTitles(.hidden)
            }
            if let now = track.coordinate(at: time) {
                Annotation("Now", coordinate: now) {
                    Circle().fill(.white).frame(width: 11, height: 11)
                        .overlay(Circle().stroke(Color.accentColor, lineWidth: 2.5))
                        .background(Circle().fill(Color.accentColor.opacity(0.25)).frame(width: 26, height: 26))
                }
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
        .mapControlVisibility(.hidden)
        // MapKit doesn't redraw its overlays when only the route coloring changes (they catch up on
        // the next cursor move), so a new coloring gets a fresh map; the camera binding keeps the
        // viewer's pan and zoom.
        .id(activeColoring)
    }

    private var readout: some View {
        Card(padding: EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16)) {
            HStack(alignment: .bottom, spacing: 0) {
                // Sized to the full duration so the column never truncates or shifts as the clock grows.
                VStack(alignment: .leading, spacing: 0) {
                    Text(Format.clock(track.duration)).font(.trend).monospacedDigit().hidden()
                        .overlay(alignment: .leading) { Text(Format.clock(time)).font(.trend).monospacedDigit() }
                    Text("of \(Format.clock(track.duration))").font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                }
                .fixedSize()
                .padding(.trailing, 8)
                column(track.value(track.distanceMi, at: time).map { Format.oneDecimal($0) }, "mi")
                column(track.value(track.altitudeFt, at: time).map { Format.whole($0) }, "ft")
                column(track.value(track.heartRate, at: time).map { Format.whole($0) }, "bpm")
                column(track.value(track.speedMph, at: time).map { Format.oneDecimal($0) }, "mph")
            }
        }
    }

    private func column(_ value: String?, _ unit: String) -> some View {
        VStack(spacing: 0) {
            Text(value ?? "—").font(.title3.weight(.semibold)).monospacedDigit().foregroundStyle(value == nil ? .secondary : .primary)
            Text(unit).font(.footnote).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    /// The strip is the scrubber: a horizontal drag anywhere sets the time and pauses playback. A
    /// touch that lands within a finger's width of a peak rule snaps to that peak.
    private var strip: some View {
        Card(padding: EdgeInsets(top: 14, leading: 16, bottom: 12, trailing: 16)) {
            VStack(spacing: 10) {
                VStack(spacing: 10) {
                    if track.hasData(track.altitudeFt) { StreamChart(label: "Elevation", unit: "ft", track: track, values: track.altitudeFt, height: 54, cursor: time, peak: figures.peak(.elevation), showsCaption: false) }
                    if track.hasData(track.heartRate) { StreamChart(label: "Heart rate", unit: "bpm", track: track, values: track.heartRate, height: 54, cursor: time, peak: figures.peak(.heartRate), showsCaption: false) }
                    if track.hasData(track.speedMph) { StreamChart(label: "Speed", unit: "mph", track: track, values: track.speedMph, height: 54, cursor: time, peak: figures.peak(.speed), showsCaption: false) }
                }
                .background { StripMarks(duration: track.duration, climbs: figures.climbs, peaks: figures.peaks.map(\.t)) }
                TimeTicks(duration: track.duration)
            }
            .contentShape(.rect)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { stripWidth = max($0, 1) }
            .gesture(
                DragGesture(minimumDistance: 0).onChanged { drag in
                    playing = false
                    var t = min(max(0, (drag.location.x / stripWidth) * track.duration), track.duration)
                    if abs(drag.translation.width) < 4, let peak = nearestPeak(to: t) {
                        t = peak
                        snappedPeak = peak
                    }
                    time = t
                }
                .onEnded { _ in snappedPeak = nil }
            )
            .sensoryFeedback(.selection, trigger: snappedPeak)
            .accessibilityElement(children: .combine)
            .accessibilityActions {
                ForEach(figures.peaks) { peak in
                    Button(peak.channel.jumpLabel) {
                        playing = false
                        time = peak.t
                    }
                }
            }
        }
    }

    /// The peak whose rule is within 14 pt of `t` on the strip, if any.
    private func nearestPeak(to t: Double) -> Double? {
        let perPoint = track.duration / Double(stripWidth)
        return figures.peaks.map(\.t)
            .filter { abs($0 - t) <= 14 * perPoint }
            .min { abs($0 - t) < abs($1 - t) }
    }

    private struct Stroke: Identifiable {
        let id: String
        let points: [CLLocationCoordinate2D]
        let color: Color
        let width: CGFloat
    }

    /// Colored, the whole route shows at once and the dot alone says where the cursor is; plain, the
    /// ridden part is drawn over the rest.
    private var strokes: [Stroke] {
        let coloring = activeColoring
        guard let runs = figures.runs[coloring] else {
            return [
                Stroke(id: "route", points: track.route, color: Color.secondary.opacity(0.28), width: 3),
                Stroke(id: "ridden", points: track.riddenRoute(until: time), color: .accentColor, width: 3),
            ]
        }
        return runs.enumerated().map { i, run in
            Stroke(id: "\(coloring.rawValue)-\(i)", points: run.points, color: figures.color(run.step, coloring), width: 4)
        }
    }

    private var coloringMenu: some View {
        Menu {
            Picker("Color the route by", selection: $coloring) {
                ForEach(figures.coloringOptions, id: \.self) { Text($0.label).tag($0) }
            }
        } label: {
            Label(activeColoring.label, systemImage: "paintpalette").font(.footnote.weight(.semibold))
        }
        .buttonStyle(.glass)
        .opacity(figures.coloringOptions.count > 1 ? 1 : 0)
    }

    /// What the colors mean, for a colored route: the steps low to high between their end labels.
    @ViewBuilder private var legend: some View {
        if let scale = figures.legend(activeColoring) {
            HStack(spacing: 6) {
                Text(scale.low)
                HStack(spacing: 2) {
                    ForEach(scale.steps, id: \.self) { step in
                        Capsule().fill(figures.color(step, activeColoring)).frame(width: 12, height: 6)
                    }
                }
                Text(scale.high)
            }
            .font(.caption2.weight(.medium)).monospacedDigit()
            .padding(.horizontal, 10).padding(.vertical, 6)
            .glassEffect(.regular, in: .capsule)
        }
    }

    private var transport: some View {
        HStack(spacing: 14) {
            Button {
                if time >= track.duration { time = 0 }
                playing.toggle()
            } label: {
                Image(systemName: playing ? "pause.fill" : "play.fill")
                    .font(.title2)
                    .frame(width: 56, height: 56)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .tint(.accentColor)
            .accessibilityLabel(playing ? "Pause" : "Play")
            Picker("Speed", selection: $speed) {
                ForEach([30, 60, 120, 300], id: \.self) { Text("\($0)×").tag($0) }
            }
            .pickerStyle(.segmented)
            Text("\(Format.clock(track.duration / Double(speed))) at \(speed)×")
                .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                .fixedSize()
        }
    }
}

/// What the replay route can be colored by. `plain` is the ridden/unridden route.
enum RouteColoring: String, CaseIterable {
    case plain, zone, speed, grade

    var label: String {
        switch self {
        case .plain: "Route"
        case .zone: "HR zones"
        case .speed: "Speed"
        case .grade: "Grade"
        }
    }
}

/// Replay's derived figures (RideAnalysis), computed once per ride.
struct ReplayFigures {
    enum Channel: Hashable {
        case elevation, heartRate, speed

        var jumpLabel: String {
            switch self {
            case .elevation: "Jump to highest point"
            case .heartRate: "Jump to peak heart rate"
            case .speed: "Jump to top speed"
            }
        }
    }

    struct Peak: Identifiable {
        let channel: Channel
        let index: Int
        let t: Double
        var id: Channel { channel }
    }

    struct Scale {
        let low: String
        let high: String
        let steps: [Int]
    }

    let peaks: [Peak]
    let climbs: [ClosedRange<Double>]
    /// The colored route for each coloring this ride can draw.
    let runs: [RouteColoring: [(step: Int?, points: [CLLocationCoordinate2D])]]
    private let speedRange: ClosedRange<Double>?

    init(_ track: RideTrack) {
        let channels: [(Channel, [Double?])] = [(.elevation, track.altitudeFt), (.heartRate, track.heartRate), (.speed, track.speedMph)]
        peaks = channels.compactMap { channel, values in
            RideAnalysis.peak(values).map { Peak(channel: channel, index: $0, t: track.t[$0]) }
        }
        climbs = RideAnalysis.climbs(t: track.t, grade: track.grade)

        var runs: [RouteColoring: [(step: Int?, points: [CLLocationCoordinate2D])]] = [:]
        let speed = RideAnalysis.scaledSteps(track.speedMph, floor: 1) // scale over moving, not stopped
        if track.hasRoute {
            if let b = track.zoneBoundaries, !b.isEmpty, track.hasData(track.heartRate) {
                runs[.zone] = RideAnalysis.runs(track.coordinates, steps: RideAnalysis.zoneSteps(track.heartRate, boundaries: b))
            }
            if let speed { runs[.speed] = RideAnalysis.runs(track.coordinates, steps: speed.steps) }
            if track.hasData(track.grade) { runs[.grade] = RideAnalysis.runs(track.coordinates, steps: RideAnalysis.gradeSteps(track.grade)) }
        }
        self.runs = runs
        speedRange = speed?.range
    }

    var coloringOptions: [RouteColoring] { RouteColoring.allCases.filter { $0 == .plain || runs[$0] != nil } }

    func peak(_ channel: Channel) -> Int? { peaks.first { $0.channel == channel }?.index }

    private static let speedPalette: [Color] = [.blue, .cyan, .green, .yellow, .orange, .red]

    func color(_ step: Int?, _ coloring: RouteColoring) -> Color {
        guard let step else { return Color(.systemGray) }
        switch coloring {
        case .plain:
            return .accentColor
        case .zone:
            return zoneColor(step, count: 7)
        case .speed:
            return Self.speedPalette[min(max(step, 0), Self.speedPalette.count - 1)]
        case .grade:
            // Diverging from a quiet neutral at flat (most of a ride), so climbs and descents carry
            // the color: blue down, red up, full strength at 8 %.
            let neutral = Color(white: 0.6)
            guard step != 0 else { return neutral.opacity(0.7) }
            let strength = 0.4 + 0.6 * Double(min(abs(step), 4)) / 4
            return (step > 0 ? Color.red : Color.blue).mix(with: neutral, by: 1 - strength)
        }
    }

    func legend(_ coloring: RouteColoring) -> Scale? {
        switch coloring {
        case .plain: nil
        case .zone: Scale(low: "Z1", high: "Z5", steps: Array(1...5))
        case .speed: speedRange.map { Scale(low: Format.whole($0.lowerBound), high: "\(Format.whole($0.upperBound)) mph", steps: Array(0...5)) }
        case .grade: Scale(low: "−8%", high: "+8%", steps: Array(-4...4))
        }
    }
}

/// Behind the charts: climbs as faint bands and each peak as a dashed rule, both across the whole
/// strip so one channel's moment can be read against the others. Time maps to x as in the charts.
private struct StripMarks: View {
    let duration: Double
    let climbs: [ClosedRange<Double>]
    let peaks: [Double]

    var body: some View {
        Canvas { context, size in
            let x = { (t: Double) in CGFloat(t / max(duration, 1)) * size.width }
            for climb in climbs {
                let rect = CGRect(x: x(climb.lowerBound), y: 0, width: max(2, x(climb.upperBound) - x(climb.lowerBound)), height: size.height)
                context.fill(Path(rect), with: .color(.red.opacity(0.12)))
            }
            for peak in peaks {
                var rule = Path()
                rule.move(to: CGPoint(x: x(peak), y: 0))
                rule.addLine(to: CGPoint(x: x(peak), y: size.height))
                context.stroke(rule, with: .color(.secondary.opacity(0.7)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            }
        }
        .accessibilityHidden(true)
    }
}
