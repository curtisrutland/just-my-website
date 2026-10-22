import SwiftUI
import VitalsAPI

/// One day of measurements (docs/ios-design-handoff.md §5.3): the night's sleep, the overnight
/// readings, and the day's movement — "so far" while the day is still in progress.
struct VitalsDayDetail: View {
    let day: VitalsDay
    private var inProgress: Bool { day.measuredOn == Format.todayISO() }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                SleepCard(day: day)
                section("Overnight") {
                    RowCard(items: overnight) { row in MeasureRow(row: row) }
                }
                section(throughTheDayTitle) {
                    RowCard(items: daytime) { row in MeasureRow(row: row) }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(Format.day(day.measuredOn))
        .navigationBarTitleDisplayMode(.inline)
    }

    private var throughTheDayTitle: String {
        inProgress ? "Through the day · in progress · synced \(Format.time(day.updatedAt))" : "Through the day"
    }

    private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(title).padding(.horizontal, 16)
            content()
        }
    }

    private var overnight: [Measure] {
        let spo2Aside: String? = {
            if day.sleepSpo2Avg == nil, let daytime = day.spo2Avg { return "daytime avg \(Format.whole(daytime))%" }
            return day.sleepSpo2Low.map { "low \(Format.whole($0))" }
        }()
        return [
            Measure(label: "Resting heart rate", value: day.restingHeartRate.map { "\($0)" }, unit: "bpm",
                    aside: join(day.minHeartRate.map { "min \($0)" }, day.maxHeartRate.map { "max \($0)" })),
            Measure(label: "HRV", value: day.hrvLastNightMs.map { "\($0)" }, unit: "ms",
                    aside: day.hrvLastNight5MinHighMs.map { "5-min high \($0)" }),
            Measure(label: "Blood oxygen", value: day.sleepSpo2Avg.map { Format.whole($0) }, unit: "%", aside: spo2Aside),
            Measure(label: "Respiration", value: day.sleepRespirationAvg.map { Format.whole($0) }, unit: "/min", aside: nil),
        ]
    }

    private var daytime: [Measure] {
        let soFar = inProgress ? "so far" : ""
        // Two measured counts, side by side. Garmin's own intensity total weights vigorous minutes
        // double — a model, so it isn't shown.
        return [
            Measure(label: "Steps", value: day.steps.map { Format.whole(Double($0)) }, unit: soFar, aside: nil),
            Measure(label: "Moderate intensity", value: day.intensityMinutesModerate.map { "\($0)" }, unit: inProgress ? "min so far" : "min", aside: nil),
            Measure(label: "Vigorous intensity", value: day.intensityMinutesVigorous.map { "\($0)" }, unit: inProgress ? "min so far" : "min", aside: nil),
        ]
    }

    private func join(_ parts: String?...) -> String? {
        let present = parts.compactMap { $0 }
        return present.isEmpty ? nil : present.joined(separator: " · ")
    }
}

struct Measure: Identifiable {
    let label: String
    let value: String?
    let unit: String
    let aside: String?
    var id: String { label }
}

private struct MeasureRow: View {
    let row: Measure

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(row.label).foregroundStyle(row.value == nil ? .secondary : .primary)
            Spacer(minLength: 8)
            if let aside = row.aside {
                Text(aside).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
            }
            if let value = row.value {
                ValueUnit(value: value, unit: row.unit)
            } else {
                NotMeasured()
            }
        }
    }
}

/// The sleep card: duration, the window, Garmin's stage classification as one bar, and a legend.
private struct SleepCard: View {
    let day: VitalsDay

    private struct Stage: Identifiable {
        let name: String
        let seconds: Int?
        let color: Color
        var id: String { name }
    }

    private var stages: [Stage] {
        [
            Stage(name: "Deep", seconds: day.sleepDeepSeconds, color: .indigo),
            Stage(name: "Light", seconds: day.sleepLightSeconds, color: .blue),
            Stage(name: "REM", seconds: day.sleepRemSeconds, color: .purple),
            Stage(name: "Awake", seconds: day.sleepAwakeSeconds, color: .orange),
        ]
    }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline) {
                    if let total = day.sleepTotalSeconds {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(Format.hoursMinutes(Double(total))).font(.hero).tracking(-0.6).monospacedDigit()
                            Text("asleep").foregroundStyle(.secondary)
                        }
                    } else {
                        Text("—").font(.hero).foregroundStyle(.secondary).accessibilityLabel("not measured")
                    }
                    Spacer()
                    if let start = day.sleepStartAt, let end = day.sleepEndAt {
                        Text("\(Format.time(start)) – \(Format.time(end))").font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
                stageBar
                HStack(alignment: .top) {
                    ForEach(stages) { stage in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Circle().fill(stage.color).frame(width: 8, height: 8)
                                Text(stage.name).font(.footnote).foregroundStyle(.secondary)
                            }
                            Text(stage.seconds.map { Format.hoursMinutes(Double($0)) } ?? "—").monospacedDigit()
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                Text(day.sleepTotalSeconds == nil
                    ? "The watch recorded no sleep this night — not worn, or not synced. A null is a dash, never a zero."
                    : "Stages are Garmin's classification. No sleep score exists here.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// Widths over the four stage sums (deliberately not rebalanced to the total — docs/vitals-model.md).
    private var stageBar: some View {
        let total = stages.compactMap(\.seconds).reduce(0, +)
        return GeometryReader { geo in
            if total > 0 {
                let gaps = CGFloat(stages.filter { ($0.seconds ?? 0) > 0 }.count - 1) * 2
                HStack(spacing: 2) {
                    ForEach(stages.filter { ($0.seconds ?? 0) > 0 }) { stage in
                        RoundedRectangle(cornerRadius: 4)
                            .fill(stage.color)
                            .frame(width: (geo.size.width - gaps) * CGFloat(stage.seconds!) / CGFloat(total))
                    }
                }
            } else {
                RoundedRectangle(cornerRadius: 4).fill(Color(.systemFill))
            }
        }
        .frame(height: 14)
        .accessibilityHidden(true)
    }
}
