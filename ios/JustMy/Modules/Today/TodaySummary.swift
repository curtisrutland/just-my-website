import Foundation

/// Today's arrangement of facts other modules own (#116). Nothing here is a new number: it picks
/// which weigh-in is today's and words the latest ride in one line.
nonisolated enum TodaySummary {
    /// Where today's weigh-in stands, from the newest few entries (newest first).
    enum WeighIn<Entry> {
        case logged(Entry)
        /// Nothing for today yet; `last` is the most recent earlier weigh-in, for context.
        case notYet(last: Entry?)
    }

    static func weighIn<Entry>(_ entries: [Entry], measuredOn: (Entry) -> String, today: String) -> WeighIn<Entry> {
        if let entry = entries.first(where: { measuredOn($0) == today }) { return .logged(entry) }
        return .notYet(last: entries.first { measuredOn($0) < today })
    }

    /// `Tue · 10.5 mi · 1:38`. A ride with no measured distance (indoor) drops that part.
    static func rideLine(localDate: String, distanceMeters: Double?, movingSeconds: Double, today: String) -> String {
        var parts = [Format.recentDay(localDate, today: today)]
        // 0 on an indoor ride means "not measured" (#40), not zero.
        if let d = distanceMeters, d > 0 { parts.append("\(Format.oneDecimal(Format.miles(fromMeters: d))) mi") }
        parts.append(Format.movingShort(movingSeconds))
        return parts.joined(separator: " · ")
    }
}
