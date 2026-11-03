import Testing
@testable import JustMy

struct RideAnalysisTests {
    /// A steady 6 % climb: 20 m of distance and 1.2 m of rise per sample.
    @Test func gradeOfASteadyClimb() {
        let distance: [Double?] = (0..<10).map { Double($0) * 20 }
        let altitude: [Double?] = (0..<10).map { 100 + Double($0) * 1.2 }
        for g in RideAnalysis.grade(distance: distance, altitude: altitude) {
            #expect(abs(g! - 6) < 0.001)
        }
    }

    @Test func aStopAddsNoGrade() {
        // Stopped at 100 m for five samples while the altimeter drifts.
        let distance: [Double?] = [0, 50, 100, 100, 100, 100, 100, 150, 200]
        let altitude: [Double?] = [0, 0, 0, 0.6, -0.4, 0.8, 0, 0, 0]
        let g = RideAnalysis.grade(distance: distance, altitude: altitude)
        // The samples in the stop see only the stop plus the moving neighbours either side: the fit
        // stays near flat rather than reading the drift as a steep grade.
        for v in g.compactMap({ $0 }) { #expect(abs(v) < 1) }
    }

    @Test func tooLittleRunHasNoGrade() {
        let g = RideAnalysis.grade(distance: [0, 5, 10], altitude: [0, 1, 2])
        #expect(g.allSatisfy { $0 == nil })
    }

    @Test func farApartSamplesStillUseTheirNeighbours() {
        // A fast descent: 120 m per sample, beyond the ±50 m window.
        let distance: [Double?] = [0, 120, 240, 360]
        let altitude: [Double?] = [60, 54, 48, 42]
        for g in RideAnalysis.grade(distance: distance, altitude: altitude) { #expect(abs(g! + 5) < 0.001) }
    }

    @Test func gapsAreSkipped() {
        let g = RideAnalysis.grade(distance: [0, 20, nil, 60, 80], altitude: [0, 1, 2, 3, 4])
        #expect(g[2] == nil)
        #expect(abs(g[1]! - 5) < 0.001)
    }

    @Test func peakIsTheFirstHighestSample() {
        #expect(RideAnalysis.peak([nil, 3, 7, 7, 2]) == 2)
        #expect(RideAnalysis.peak([nil, nil]) == nil)
    }

    @Test func climbsAreSustainedAndBridgeShortDips() {
        let t = (0..<14).map { Double($0) * 10 }
        let grade: [Double?] = [0, 6, 7, 3, 8, 6, 0, 0, 0, 9, 0, 0, 5, 6]
        // 10–50 s climbs with one dip at 30 s (bridged); 90 s is a single sample (too short);
        // 120–130 s is only 10 s long.
        #expect(RideAnalysis.climbs(t: t, grade: grade) == [10...50])
    }

    @Test func zoneStepsMatchTheZonesCardBuckets() {
        let b: [Double] = [90, 106, 123, 143, 161, 179]
        #expect(RideAnalysis.zoneSteps([80, 90, 120, 150, 185, nil], boundaries: b) == [0, 1, 2, 4, 6, nil])
    }

    @Test func scaledStepsIgnoreASpike() {
        let values: [Double?] = (0..<100).map { Double($0 % 10) } + [500]
        let (steps, range) = RideAnalysis.scaledSteps(values)!
        #expect(range == 0...9)
        #expect(steps.last == 5)
        #expect(steps[0] == 0)
    }

    @Test func stopsDontSetTheSpeedScale() {
        let values: [Double?] = [0, 0, 0, 0, 0] + (0..<20).map { 4 + Double($0) / 2 }
        let (steps, range) = RideAnalysis.scaledSteps(values, floor: 1)!
        #expect(range.lowerBound == 4)
        #expect(steps[0] == 0) // a stop still draws, in the bottom step
    }

    @Test func gradeStepsBandByTwoPercent() {
        #expect(RideAnalysis.gradeSteps([-12, -5, -1.9, 0, 1.9, 3, 9, nil]) == [-4, -2, 0, 0, 0, 1, 4, nil])
    }

    @Test func runsJoinAtTheirEdgesAndSkipMissingPoints() {
        let runs = RideAnalysis.runs([1, 2, nil, 3, 4, 5], steps: [0, 0, 1, 1, nil, 2])
        #expect(runs.map(\.step) == [0, 1, 2])
        #expect(runs.map(\.points) == [[1, 2], [2, 3, 4], [4, 5]])
    }
}
