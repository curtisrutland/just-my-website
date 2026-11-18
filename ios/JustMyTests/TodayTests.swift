import Testing
@testable import JustMy

struct TodayTests {
    // Wednesday, Nov 18 2026.
    let today = "2026-11-18"

    struct Entry: Equatable {
        let measuredOn: String
        let weight: Double
    }

    func weighIn(_ entries: [Entry]) -> TodaySummary.WeighIn<Entry> {
        TodaySummary.weighIn(entries, measuredOn: \.measuredOn, today: today)
    }

    @Test func todaysWeighInIsTheLoggedOne() {
        let entries = [Entry(measuredOn: "2026-11-18", weight: 238.4), Entry(measuredOn: "2026-11-17", weight: 239.1)]
        guard case let .logged(entry) = weighIn(entries) else { Issue.record("expected logged"); return }
        #expect(entry.weight == 238.4)
    }

    @Test func withoutOneTheLastEarlierWeighInIsContext() {
        let entries = [Entry(measuredOn: "2026-11-17", weight: 239.1), Entry(measuredOn: "2026-11-16", weight: 239.6)]
        guard case let .notYet(last) = weighIn(entries) else { Issue.record("expected notYet"); return }
        #expect(last == Entry(measuredOn: "2026-11-17", weight: 239.1))
    }

    @Test func noWeighInsAtAll() {
        guard case let .notYet(last) = weighIn([]) else { Issue.record("expected notYet"); return }
        #expect(last == nil)
    }

    /// A weigh-in dated ahead of today is neither today's nor the "last" one.
    @Test func aLaterDatedEntryIsSkipped() {
        let ahead = Entry(measuredOn: "2026-11-19", weight: 1)
        guard case let .logged(entry) = weighIn([ahead, Entry(measuredOn: "2026-11-18", weight: 238.4)]) else {
            Issue.record("expected logged"); return
        }
        #expect(entry.weight == 238.4)
        guard case let .notYet(last) = weighIn([ahead, Entry(measuredOn: "2026-11-17", weight: 239.1)]) else {
            Issue.record("expected notYet"); return
        }
        #expect(last?.measuredOn == "2026-11-17")
    }

    @Test func recentDaysAreSaidBriefly() {
        #expect(Format.recentDay("2026-11-18", today: today) == "Today")
        #expect(Format.recentDay("2026-11-17", today: today) == "Yesterday")
        #expect(Format.recentDay("2026-11-16", today: today) == "Mon")
        #expect(Format.recentDay("2026-11-12", today: today) == "Thu") // six days back: still unambiguous
        #expect(Format.recentDay("2026-11-11", today: today) == "Nov 11") // last Wednesday isn't "Wed"
        #expect(Format.recentDay("2026-11-19", today: today) == "Nov 19") // ahead of today: just the date
    }

    @Test func daysBetweenCrossTheDSTChange() {
        #expect(Format.days(from: "2026-10-31", to: "2026-11-02") == 2) // clocks fall back Nov 1
        #expect(Format.days(from: "2026-03-07", to: "2026-03-09") == 2) // spring forward Mar 8
        #expect(Format.days(from: "not-a-date", to: today) == nil)
    }

    @Test func rideLine() {
        #expect(TodaySummary.rideLine(localDate: "2026-11-17", distanceMeters: 16_898, movingSeconds: 5_880, today: today)
            == "Yesterday · 10.5 mi · 1:38")
        #expect(TodaySummary.rideLine(localDate: "2026-11-14", distanceMeters: 4_828, movingSeconds: 960, today: today)
            == "Sat · 3.0 mi · 16 min")
        // Indoor: a 0 or missing distance means "not measured", so the line drops it.
        #expect(TodaySummary.rideLine(localDate: "2026-11-18", distanceMeters: 0, movingSeconds: 1_800, today: today)
            == "Today · 30 min")
        #expect(TodaySummary.rideLine(localDate: "2026-11-01", distanceMeters: nil, movingSeconds: 1_800, today: today)
            == "Nov 1 · 30 min")
    }

    @Test func weightInput() {
        #expect(WeightInput.parse("238.4") == 238.4)
        #expect(WeightInput.parse(" 238,4 ") == 238.4) // a comma decimal separator
        #expect(WeightInput.parse("238") == 238)
        #expect(WeightInput.parse("") == nil)
        #expect(WeightInput.parse("0") == nil)
        #expect(WeightInput.parse("-5") == nil)
        #expect(WeightInput.parse("abc") == nil)
        #expect(WeightInput.parse("1.2.3") == nil)
    }
}
