import Foundation

/// A run of the ride list under one header: a Monday-start week for recent rides, a calendar month
/// for older ones (#100).
nonisolated struct RideGroup<Item>: Identifiable {
    enum Span: Hashable {
        case week(monday: String)
        case month(String) // "YYYY-MM"
    }

    let span: Span
    var items: [Item]

    var id: Span { span }
}

nonisolated extension RideGroup {
    /// The number of weeks shown week by week, matching the six-week strip above the list.
    static var recentWeeks: Int { 6 }

    /// Groups a newest-first list by each item's own local date ("YYYY-MM-DD"). The six most recent
    /// weeks (this one included) group by week; anything earlier groups by month. Groups come out in
    /// the order their first item appears, so a newly loaded page extends the last group or opens
    /// a new one, never splits an existing one.
    static func grouping(_ items: [Item], localDate: (Item) -> String, today: String) -> [RideGroup] {
        let cutoff = Format.addDays(-7 * (recentWeeks - 1), to: Format.monday(of: today))
        var groups: [RideGroup] = []
        var index: [Span: Int] = [:]
        for item in items {
            let date = localDate(item)
            let span: Span = date >= cutoff ? .week(monday: Format.monday(of: date)) : .month(String(date.prefix(7)))
            if let i = index[span] {
                groups[i].items.append(item)
            } else {
                index[span] = groups.count
                groups.append(RideGroup(span: span, items: [item]))
            }
        }
        return groups
    }
}

nonisolated extension RideGroup.Span {
    /// `This week`, `Week of Oct 13`, `September 2026`.
    func title(today: String) -> String {
        switch self {
        case .week(let monday):
            monday == Format.monday(of: today) ? "This week" : "Week of \(Format.monthDay(monday))"
        case .month(let month):
            Format.monthYear(month + "-01")
        }
    }
}
