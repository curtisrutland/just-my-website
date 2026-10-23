import Testing
@testable import JustMy

struct RideGroupsTests {
    // Thursday, Oct 22 2026: this week starts Monday Oct 19; the six-week window starts Sep 14.
    let today = "2026-10-22"

    func group(_ dates: [String]) -> [RideGroup<String>] {
        RideGroup.grouping(dates, localDate: { $0 }, today: today)
    }

    @Test func weeksStartOnMonday() {
        #expect(Format.monday(of: "2026-10-19") == "2026-10-19")
        #expect(Format.monday(of: "2026-10-25") == "2026-10-19") // Sunday closes the week
        #expect(Format.monday(of: "2026-10-26") == "2026-10-26")
        #expect(Format.monday(of: "2026-03-01") == "2026-02-23") // across a month edge
    }

    @Test func recentRidesGroupByWeekOlderByMonth() {
        let groups = group(["2026-10-22", "2026-10-19", "2026-10-18", "2026-09-14", "2026-09-13", "2026-09-01", "2026-08-30"])
        #expect(groups.map(\.span) == [
            .week(monday: "2026-10-19"),
            .week(monday: "2026-10-12"),
            .week(monday: "2026-09-14"), // the oldest week the strip shows
            .month("2026-09"),           // the rest of September, before the window
            .month("2026-08"),
        ])
        #expect(groups.map(\.items.count) == [2, 1, 1, 2, 1])
    }

    @Test func titles() {
        #expect(RideGroup<String>.Span.week(monday: "2026-10-19").title(today: today) == "This week")
        #expect(RideGroup<String>.Span.week(monday: "2026-10-12").title(today: today) == "Week of Oct 12")
        #expect(RideGroup<String>.Span.month("2026-09").title(today: today) == "September 2026")
    }

    @Test func aNewPageExtendsTheLastGroupOrOpensANewOne() {
        let first = ["2026-10-20", "2026-08-30", "2026-08-12"]
        let more = first + ["2026-08-02", "2026-07-30"]
        #expect(group(first).map(\.items.count) == [1, 2])
        #expect(group(more).map(\.span) == [.week(monday: "2026-10-19"), .month("2026-08"), .month("2026-07")])
        #expect(group(more).map(\.items.count) == [1, 3, 1])
    }

    @Test func emptyWeeksAndMonthsGetNoHeader() {
        #expect(group(["2026-10-21", "2026-06-02"]).map(\.span) == [.week(monday: "2026-10-19"), .month("2026-06")])
        #expect(group([]).isEmpty)
    }
}
