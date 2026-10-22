import Charts
import JMWClientSupport
import LiftingAPI
import SwiftUI

/// One session (docs/ios-design-handoff.md §5.5): the cold set table beside Claude's warm read.
struct SessionDetailView: View {
    let summary: SessionSummary
    @Environment(\.api) private var api
    @State private var loader = Loader<SessionDetail>()
    /// Each lift's progression, for its sparkline, keyed by template id.
    @State private var progressions: [String: LiftProgression] = [:]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if let failure = loader.failure {
                    StatusBanner(failure: failure, loadedAt: loader.loadedAt)
                }
                if let s = loader.value {
                    HeaderCard(session: s)
                    readSection(s)
                    VStack(alignment: .leading, spacing: 8) {
                        SectionTitle("Sets · Hevy's numbers, in lb").padding(.horizontal, 16)
                        Card {
                            VStack(alignment: .leading, spacing: 18) {
                                ForEach(s.exercises, id: \.index) { ExerciseBlock(exercise: $0, progression: $0.exerciseTemplateId.flatMap { progressions[$0] }) }
                            }
                        }
                    }
                    if s.annotation.sessionNotes != nil || s.annotation.quality != nil {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionTitle("Your notes").padding(.horizontal, 16)
                            Card {
                                VStack(alignment: .leading, spacing: 6) {
                                    if let q = s.annotation.quality { Text("Quality \(q) of 5").monospacedDigit() }
                                    if let n = s.annotation.sessionNotes { Text(n) }
                                }
                            }
                        }
                    }
                } else if loader.failure == nil {
                    Card { VStack(spacing: 14) { SkeletonBlock(height: 28); SkeletonBlock(height: 44) } }
                    Card { VStack(spacing: 10) { ForEach(0..<4, id: \.self) { _ in SkeletonBlock(height: 18) } } }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
            .pageContent()
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(shortTitle)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
    }

    /// `Session A` from `Session A — Hinge + Horizontal`.
    private var shortTitle: String {
        let t = summary.title ?? "Session"
        return t.components(separatedBy: " — ").first ?? t
    }

    @ViewBuilder
    private func readSection(_ s: SessionDetail) -> some View {
        let goalDate = s.goal?.value1.effectiveFrom
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(goalDate.map { "The read · Claude, against the goal of \(Format.monthDay($0))" } ?? "The read · Claude")
                .padding(.horizontal, 16)
            Card {
                if let read = s.annotation.interpretation {
                    Text(read).lineSpacing(3)
                } else {
                    Text("Not read yet. Ask Claude to read this session.").foregroundStyle(.secondary)
                }
            }
        }
    }

    private func load() async {
        guard let api else { return }
        await loader.load { try await api.lifting.getApiLiftingSessionsId(.init(path: .init(id: summary.id))).ok.body.json }
        guard let s = loader.value else { return }
        // One progression read per lift with an e1RM — the web page makes the same N reads.
        let ids = Set(s.exercises.filter { $0.e1rmKg != nil }.compactMap(\.exerciseTemplateId))
        await withTaskGroup(of: (String, LiftProgression?).self) { group in
            for id in ids {
                group.addTask {
                    (id, try? await api.lifting.getApiLiftingLiftsTemplateId(.init(path: .init(templateId: id))).ok.body.json)
                }
            }
            for await (id, p) in group { if let p { progressions[id] = p } }
        }
    }
}

private struct HeaderCard: View {
    let session: SessionDetail

    var body: some View {
        let d = session.derived
        Card {
            VStack(alignment: .leading, spacing: 14) {
                Text(session.title ?? "Session").font(.title2.bold())
                Text(caption).font(.footnote).foregroundStyle(.secondary)
                // Natural widths spread edge to edge: equal columns run a five-digit tonnage into Sets.
                HStack(alignment: .top, spacing: 0) {
                    tile("Tonnage", lb(d.tonnageKg), "lb", sub: nil)
                    Spacer(minLength: 10)
                    tile("Sets", "\(d.workingSets)", "", sub: "\(d.totalReps) reps")
                    Spacer(minLength: 10)
                    tile("Top e1RM", d.topE1rmKg.map(lb) ?? "—", d.topE1rmKg == nil ? "" : "lb", sub: nil)
                    Spacer(minLength: 10)
                    tile("PRs", d.prs.isEmpty ? "—" : "\(d.prs.count)", "", sub: d.prs.isEmpty ? "repeat day" : nil)
                }
            }
        }
    }

    private var caption: String {
        var parts = [Format.day(Format.isoDay(of: session.startedAt))]
        if let end = session.endedAt {
            parts.append("\(Format.time(session.startedAt))–\(Format.time(end))")
        } else {
            parts.append(Format.time(session.startedAt))
        }
        if let m = session.derived.durationMin { parts.append("\(Int(m.rounded())) min") }
        if let f = session.annotation.focus { parts.append(focusLabel(f)) }
        parts.append("from Hevy")
        return parts.joined(separator: " · ")
    }

    private func tile(_ label: String, _ value: String, _ unit: String, sub: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.footnote).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).font(.title3.weight(.semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                if !unit.isEmpty { Text(unit).font(.footnote).foregroundStyle(.secondary) }
            }
            if let sub { Text(sub).font(.caption).foregroundStyle(.secondary).monospacedDigit() }
        }
    }
}

private struct ExerciseBlock: View {
    let exercise: LiftingAPI.Components.Schemas.ExerciseView
    let progression: LiftProgression?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(exercise.title).fontWeight(.semibold)
                    if let e = exercise.e1rmKg {
                        Text(e1rmCaption(e)).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
                Spacer()
                if let progression, let id = exercise.exerciseTemplateId, progression.points.contains(where: { $0.e1rmKg != nil }) {
                    NavigationLink(value: LiftLink(templateId: id, title: exercise.title)) {
                        HStack(spacing: 4) {
                            Sparkline(values: progression.points.map { $0.e1rmKg.map(Format.pounds(fromKg:)) })
                                .frame(width: 84, height: 28)
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(exercise.title) progression")
                }
            }
            ForEach(exercise.sets, id: \.index) { set in
                HStack(spacing: 12) {
                    Text("\(set.index + 1)").foregroundStyle(.secondary).frame(width: 18, alignment: .leading)
                    Text(load(set))
                    Text(reps(set)).foregroundStyle(.secondary)
                    if set.pr {
                        Text("PR").font(.caption2.weight(.bold)).foregroundStyle(Color.accentColor)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Color.accentColor.opacity(0.12), in: .capsule)
                    }
                    Spacer()
                }
                .monospacedDigit()
            }
            if let notes = exercise.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty { // Hevy sends "" for none
                Text("Hevy note: \(notes)").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private func e1rmCaption(_ kg: Double) -> String {
        var s = "e1RM \(lb(kg)) lb"
        if let n = progression?.points.count { s += " · \(n) session\(n == 1 ? "" : "s")" }
        if exercise.e1rmUnreliable { s += " · high reps, rough" }
        return s
    }

    private func load(_ set: LiftingAPI.Components.Schemas.SetView) -> String {
        if let kg = set.weightKg { return "\(lb(kg)) lb" }
        if set.reps == nil, let d = set.durationSeconds { return Format.clock(d) }
        if let m = set.distanceMeters { return "\(Format.oneDecimal(Format.miles(fromMeters: m))) mi" }
        return "bodyweight"
    }

    private func reps(_ set: LiftingAPI.Components.Schemas.SetView) -> String {
        if let r = set.reps { return "× \(r)" }
        return set.durationSeconds != nil ? "hold" : ""
    }
}

/// A lift's whole history: e1RM and top set over time, in lb.
struct LiftProgressionView: View {
    let link: LiftLink
    @Environment(\.api) private var api
    @State private var loader = Loader<LiftProgression>()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if let failure = loader.failure {
                    StatusBanner(failure: failure, loadedAt: loader.loadedAt)
                }
                if let p = loader.value {
                    let points = p.points.filter { $0.e1rmKg != nil }
                    Card {
                        VStack(alignment: .leading, spacing: 12) {
                            if let last = points.last?.e1rmKg {
                                HStack(alignment: .firstTextBaseline, spacing: 6) {
                                    Text(lb(last)).font(.hero).tracking(-0.6).monospacedDigit()
                                    Text("lb e1RM").foregroundStyle(.secondary)
                                }
                            }
                            Chart(points, id: \.sessionId) { pt in
                                LineMark(x: .value("Date", pt.startedAt), y: .value("e1RM", Format.pounds(fromKg: pt.e1rmKg!)))
                                    .foregroundStyle(Color.accentColor)
                                PointMark(x: .value("Date", pt.startedAt), y: .value("e1RM", Format.pounds(fromKg: pt.e1rmKg!)))
                                    .foregroundStyle(Color.accentColor).symbolSize(20)
                            }
                            .chartYScale(domain: .automatic(includesZero: false))
                            .frame(height: 180)
                            Text("\(p.points.count) sessions. e1RM is Epley over working sets — an estimate, not a lift.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    RowCard(items: p.points.reversed().map(Row.init)) { row in
                        HStack {
                            Text(Format.day(Format.isoDay(of: row.point.startedAt)))
                            Spacer()
                            if let top = row.point.topSetKg { Text("top \(lb(top)) lb").foregroundStyle(.secondary).monospacedDigit() }
                            Text(row.point.e1rmKg.map { "\(lb($0)) lb" } ?? "—").monospacedDigit()
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
            .pageContent()
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(link.title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard let api else { return }
            await loader.load { try await api.lifting.getApiLiftingLiftsTemplateId(.init(path: .init(templateId: link.templateId))).ok.body.json }
        }
    }

    private struct Row: Identifiable {
        let point: LiftProgression.PointsPayloadPayload
        var id: String { point.sessionId }
    }
}
