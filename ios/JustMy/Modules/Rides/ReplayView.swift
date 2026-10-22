import Charts
import MapKit
import SwiftUI

/// Replay (docs/ios-design-handoff.md §6): the four streams correlated by time. Drag the chart strip
/// to scrub, or play it back compressed. Everything shown is interpolated between recorded samples.
struct ReplayView: View {
    let title: String
    let track: RideTrack

    @Environment(\.dismiss) private var dismiss
    @AppStorage("replay.speed") private var speed = 60
    @State private var time: Double = 0
    @State private var playing = false
    @State private var stripWidth: CGFloat = 1

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
        Map(initialPosition: .rect(boundingRect(track.route))) {
            MapPolyline(coordinates: track.route).stroke(Color.secondary.opacity(0.28), lineWidth: 3)
            MapPolyline(coordinates: track.riddenRoute(until: time)).stroke(Color.accentColor, lineWidth: 3)
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

    /// The strip is the scrubber: a horizontal drag anywhere sets the time and pauses playback.
    private var strip: some View {
        Card(padding: EdgeInsets(top: 14, leading: 16, bottom: 12, trailing: 16)) {
            VStack(spacing: 10) {
                if track.hasData(track.altitudeFt) { StreamChart(label: "Elevation", unit: "ft", track: track, values: track.altitudeFt, height: 54, cursor: time, showsCaption: false) }
                if track.hasData(track.heartRate) { StreamChart(label: "Heart rate", unit: "bpm", track: track, values: track.heartRate, height: 54, cursor: time, showsCaption: false) }
                if track.hasData(track.speedMph) { StreamChart(label: "Speed", unit: "mph", track: track, values: track.speedMph, height: 54, cursor: time, showsCaption: false) }
                TimeTicks(duration: track.duration)
            }
            .contentShape(.rect)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { stripWidth = max($0, 1) }
            .gesture(
                DragGesture(minimumDistance: 0).onChanged { drag in
                    playing = false
                    time = min(max(0, (drag.location.x / stripWidth) * track.duration), track.duration)
                }
            )
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
