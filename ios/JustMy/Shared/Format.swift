import Foundation

/// Display formatting shared by every screen (docs/ios-design-handoff.md §2–3). The day boundary and
/// every displayed time are America/Chicago — the platform's `APP_TZ` — never the phone's zone, so a
/// trip doesn't move "today" (docs/ios-app.md §7.2). Storage is SI/kg; display is imperial.
nonisolated enum Format {
    static let zone = TimeZone(identifier: "America/Chicago")!

    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zone
        c.locale = Locale(identifier: "en_US")
        return c
    }()

    // MARK: Calendar dates ("YYYY-MM-DD")

    /// Today's calendar date in Chicago, as the API spells it.
    static func todayISO(now: Date = .now) -> String { iso(now) }

    static func iso(_ date: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// Noon in Chicago on that calendar date (noon keeps day arithmetic clear of DST edges).
    static func date(fromISO iso: String) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    static func addDays(_ n: Int, to iso: String) -> String {
        guard let d = date(fromISO: iso), let moved = calendar.date(byAdding: .day, value: n, to: d) else { return iso }
        return self.iso(moved)
    }

    /// The Monday that starts the week holding that date (the platform's weeks run Monday–Sunday).
    static func monday(of iso: String) -> String {
        guard let d = date(fromISO: iso) else { return iso }
        let weekday = calendar.component(.weekday, from: d) // 1 = Sunday
        return addDays(-((weekday + 5) % 7), to: iso)
    }

    /// `September 2026`
    static func monthYear(_ iso: String) -> String {
        guard let d = date(fromISO: iso) else { return iso }
        return d.formatted(Date.FormatStyle(timeZone: zone).month(.wide).year())
    }

    /// `Wed, Oct 21`
    static func day(_ iso: String) -> String {
        guard let d = date(fromISO: iso) else { return iso }
        return d.formatted(dayStyle)
    }

    /// `Today, Oct 22` for today, else `Wed, Oct 21`.
    static func relativeDay(_ iso: String, today: String = todayISO()) -> String {
        guard iso == today, let d = date(fromISO: iso) else { return day(iso) }
        return "Today, " + d.formatted(monthDayStyle)
    }

    /// `Oct 21`
    static func monthDay(_ iso: String) -> String {
        guard let d = date(fromISO: iso) else { return iso }
        return d.formatted(monthDayStyle)
    }

    private static var dayStyle: Date.FormatStyle {
        Date.FormatStyle(timeZone: zone).weekday(.abbreviated).month(.abbreviated).day()
    }

    private static var monthDayStyle: Date.FormatStyle {
        Date.FormatStyle(timeZone: zone).month(.abbreviated).day()
    }

    // MARK: Instants

    /// `7:28 PM`, Chicago.
    static func time(_ date: Date) -> String {
        date.formatted(Date.FormatStyle(timeZone: zone).hour().minute())
    }

    /// The Chicago calendar date an instant falls on.
    static func isoDay(of date: Date) -> String { iso(date) }

    // MARK: Numbers

    /// Whole number with grouping: `2,409`.
    static func whole(_ value: Double) -> String {
        Int(value.rounded()).formatted(.number.grouping(.automatic))
    }

    /// One decimal: `250.9`.
    static func oneDecimal(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(1)).grouping(.automatic))
    }

    /// Signed with a true minus: `+27`, `−3.2`, `0.0`.
    static func signed(_ value: Double, decimals: Int = 0) -> String {
        let body = abs(value).formatted(.number.precision(.fractionLength(decimals)).grouping(.automatic))
        let isZero = (value * pow(10, Double(decimals))).rounded() == 0
        return isZero ? body : (value > 0 ? "+" : "−") + body
    }

    // MARK: Durations

    /// `7:44` (hours:minutes) from seconds.
    static func hoursMinutes(_ seconds: Double) -> String {
        let total = Int((seconds / 60).rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    /// `1:37:40` or `19:52` from seconds.
    static func clock(_ seconds: Double) -> String {
        let s = Int(seconds.rounded())
        return s >= 3600
            ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
            : String(format: "%d:%02d", s / 60, s % 60)
    }

    /// Ride-row moving time: under an hour `16 min`, over `1:38`.
    static func movingShort(_ seconds: Double) -> String {
        seconds < 3600 ? "\(Int((seconds / 60).rounded())) min" : hoursMinutes(seconds)
    }

    // MARK: Units

    static func pounds(fromKg kg: Double) -> Double { (kg * 2.20462).rounded() }
    static func miles(fromMeters m: Double) -> Double { m / 1609.344 }
    static func feet(fromMeters m: Double) -> Double { m * 3.28084 }
    static func mph(fromMps v: Double) -> Double { v * 2.236936 }
}
