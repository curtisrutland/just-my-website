import Charts
import JMWClientSupport
import LiftingAPI
import SwiftUI

typealias SessionSummary = LiftingAPI.Components.Schemas.SessionSummary
typealias SessionDetail = LiftingAPI.Components.Schemas.SessionDetail
typealias LiftProgression = LiftingAPI.Components.Schemas.LiftProgression
typealias SessionFocus = LiftingAPI.Components.Schemas.SessionAnnotation.FocusPayload

/// Training › Lifting (docs/ios-design-handoff.md §5.5). The numbers are Hevy's; the meaning is
/// ours. Lifting is deliberately paused right now, so the list never nags: no days-since, no streak.
struct LiftingView<Header: View>: View {
    let header: Header
    @Environment(\.api) private var api
    @Environment(\.scenePhase) private var scenePhase
    @State private var sessions = PagedSessions()
    @State private var unread = Loader<Int>()
    @State private var goalExpanded = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22) {
                header
                if let failure = sessions.failure {
                    StatusBanner(failure: failure, loadedAt: sessions.loadedAt)
                }
                if let goal = sessions.goal {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionTitle("The goal · since \(Format.monthDay(goal.effectiveFrom))").padding(.horizontal, 16)
                        Card {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(goal.statement).lineLimit(goalExpanded ? nil : 4)
                                Button(goalExpanded ? "less" : "more") { withAnimation { goalExpanded.toggle() } }
                                    .font(.body)
                            }
                        }
                    }
                }
                if sessions.loadedAt != nil {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionTitle("Sessions · \(sessions.total)", trailing: unreadText).padding(.horizontal, 16)
                        SessionList(sessions: sessions)
                    }
                } else if sessions.failure == nil {
                    Card { VStack(spacing: 16) { ForEach(0..<4, id: \.self) { _ in SkeletonBlock(height: 44) } } }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
            .pageContent()
        }
        .background(Color(.systemGroupedBackground))
        .navigationDestination(for: SessionSummary.self) { SessionDetailView(summary: $0) }
        .navigationDestination(for: LiftLink.self) { LiftProgressionView(link: $0) }
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await load() } } }
    }

    private var unreadText: String? {
        guard let n = unread.value else { return nil }
        return n == 0 ? "all read" : "\(n) need\(n == 1 ? "s" : "") a read"
    }

    private func load() async {
        guard let api else { return }
        async let a: Void = sessions.reload(api)
        // The exact count of uninterpreted sessions (docs/ios-app.md §7.2), not a count over one page.
        async let b: Void = unread.load {
            try await api.lifting.getApiLiftingSessions(.init(query: .init(limit: 1, interpreted: false))).ok.body.json.count
        }
        _ = await (a, b)
    }
}

@Observable
final class PagedSessions {
    private(set) var items: [SessionSummary] = []
    private(set) var goal: LiftingAPI.Components.Schemas.GoalView?
    private(set) var total = 0
    private(set) var loadedAt: Date?
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
            let page = try await api.lifting.getApiLiftingSessions(.init(query: .init(limit: 20, offset: offset))).ok.body.json
            items = offset == 0 ? page.items : items + page.items
            total = page.count
            if offset == 0 { goal = page.goal?.value1 }
            loadedAt = .now
            failure = nil
        } catch is CancellationError {
        } catch {
            failure = LoadFailure(error)
        }
    }
}

/// Display label for the focus vocabulary (the `liftingFocus` enum).
func focusLabel(_ focus: SessionFocus) -> String {
    switch focus {
    case .push: "push"
    case .pull: "pull"
    case .upper: "upper body"
    case .lower: "lower body"
    case .full: "full body"
    case .accessory: "accessory"
    case .other: "other"
    }
}

/// Whole pounds from Hevy's kg (`round(kg × 2.20462)`).
func lb(_ kg: Double) -> String { Format.whole(Format.pounds(fromKg: kg)) }

private struct SessionList: View {
    let sessions: PagedSessions
    @Environment(\.api) private var api

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(sessions.items.enumerated()), id: \.element.id) { index, s in
                NavigationLink(value: s) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(s.title ?? "Untitled session")
                                if !s.annotation.interpreted {
                                    Circle().fill(Color.accentColor).frame(width: 8, height: 8)
                                        .accessibilityLabel("needs a read")
                                }
                            }
                            Text(line2(s)).font(.footnote).foregroundStyle(.secondary)
                            Text(line3(s)).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
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
                    if index == sessions.items.count - 1, let api { Task { await sessions.loadMore(api) } }
                }
                if index < sessions.items.count - 1 { Divider().padding(.leading, 16) }
            }
        }
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 26))
    }

    private func line2(_ s: SessionSummary) -> String {
        var parts = [Format.day(Format.isoDay(of: s.startedAt)), Format.time(s.startedAt)]
        if let d = s.derived.durationMin { parts.append("\(Int(d.rounded())) min") }
        if let f = s.annotation.focus { parts.append(focusLabel(f)) }
        return parts.joined(separator: " · ")
    }

    private func line3(_ s: SessionSummary) -> String {
        var parts = ["\(lb(s.derived.tonnageKg)) lb"]
        if let e = s.derived.topE1rmKg { parts.append("top e1RM \(lb(e)) lb") }
        let prs = s.derived.prs.count
        parts.append(prs == 0 ? "no PRs" : prs == 1 ? "1 PR" : "\(prs) PRs")
        return parts.joined(separator: " · ")
    }
}

/// Navigation value for a lift's progression screen.
struct LiftLink: Hashable {
    let templateId: String
    let title: String
}

extension SessionSummary: @retroactive Identifiable {}
