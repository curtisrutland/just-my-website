import Foundation

/// What Replay derives from the stream to show how the channels correlate (#104): grade, each
/// channel's peak, the climbs, and the steps the route is colored in. Pure functions over the
/// stored 10 s stream, so the cursor always lands on something the charts draw.
nonisolated enum RideAnalysis {
    /// Grade (%) at each sample: the slope of a line fitted to elevation against distance over about
    /// ±`halfWindow` meters of route, always reaching at least one sample either side (at speed, 10 s
    /// buckets sit farther apart than the window). Distance, not time, so a stop adds nothing; a
    /// window with less than `minRun` meters of run has no grade. Both inputs in meters.
    static func grade(distance: [Double?], altitude: [Double?], halfWindow: Double = 50, minRun: Double = 20) -> [Double?] {
        let valid = distance.indices.filter { distance[$0] != nil && altitude[$0] != nil }
        var out = [Double?](repeating: nil, count: distance.count)
        for (k, i) in valid.enumerated() {
            let d0 = distance[i]!
            var lo = k, hi = k
            while lo > 0, lo == k || abs(distance[valid[lo - 1]]! - d0) <= halfWindow { lo -= 1 }
            while hi < valid.count - 1, hi == k || abs(distance[valid[hi + 1]]! - d0) <= halfWindow { hi += 1 }
            let window = valid[lo...hi]
            let xs = window.map { distance[$0]! }, ys = window.map { altitude[$0]! }
            guard let minX = xs.min(), let maxX = xs.max(), maxX - minX >= minRun else { continue }
            let mx = xs.reduce(0, +) / Double(xs.count), my = ys.reduce(0, +) / Double(ys.count)
            let sxx = xs.reduce(0) { $0 + ($1 - mx) * ($1 - mx) }
            let sxy = zip(xs, ys).reduce(0) { $0 + ($1.0 - mx) * ($1.1 - my) }
            out[i] = sxx > 0 ? 100 * sxy / sxx : nil
        }
        return out
    }

    /// The index of a channel's highest sample, the first on a tie; nil for a channel with no data.
    static func peak(_ values: [Double?]) -> Int? {
        var best: Int?
        for (i, v) in values.enumerated() {
            guard let v else { continue }
            if best == nil || v > values[best!]! { best = i }
        }
        return best
    }

    /// Climbs as time spans: runs of samples at `minGrade`% or steeper, joined across a dip of one
    /// 10 s sample (`bridge` seconds between climbing samples), kept when they last `minDuration`+ seconds.
    static func climbs(t: [Double], grade: [Double?], minGrade: Double = 5, minDuration: Double = 20, bridge: Double = 20) -> [ClosedRange<Double>] {
        var runs: [ClosedRange<Double>] = []
        var start: Double?
        var end = 0.0
        for (i, g) in grade.enumerated() {
            if let g, g >= minGrade {
                if let s = start, t[i] - end > bridge {
                    runs.append(s...end)
                    start = t[i]
                } else if start == nil {
                    start = t[i]
                }
                end = t[i]
            }
        }
        if let s = start { runs.append(s...end) }
        return runs.filter { $0.upperBound - $0.lowerBound >= minDuration }
    }

    // MARK: Route color steps

    /// HR zone per sample against the ride's zone boundaries: 0 below Z1, 1–5 for Z1–Z5, 6 above
    /// max (the zones card's buckets).
    static func zoneSteps(_ heartRate: [Double?], boundaries: [Double]) -> [Int?] {
        heartRate.map { hr in hr.map { hr in boundaries.filter { hr >= $0 }.count } }
    }

    /// A continuous channel in `count` steps between its 5th and 95th percentiles, so one spike
    /// doesn't squeeze everything else into the bottom step. Values below `floor` (stops, for speed)
    /// still get the bottom step but don't set the scale. Returns the steps and the range used.
    static func scaledSteps(_ values: [Double?], count: Int = 6, floor: Double = -.infinity) -> (steps: [Int?], range: ClosedRange<Double>)? {
        let sorted = values.compactMap { $0 }.filter { $0 >= floor }.sorted()
        guard sorted.count > 1 else { return nil }
        let lo = sorted[Int(Double(sorted.count - 1) * 0.05)], hi = sorted[Int(Double(sorted.count - 1) * 0.95)]
        guard hi > lo else { return nil }
        let steps = values.map { v in v.map { min(count - 1, max(0, Int((($0 - lo) / (hi - lo)) * Double(count)))) } }
        return (steps, lo...hi)
    }

    /// Grade in 2 % bands either side of flat: −4 (8 % down or steeper) … 0 (within 2 % of flat) … 4.
    static func gradeSteps(_ grade: [Double?]) -> [Int?] {
        grade.map { g in g.map { min(4, max(-4, Int($0 / 2))) } }
    }

    /// Splits the route into runs of one step, each starting at the previous run's last point so the
    /// colored line stays continuous. A sample with no step (a gap in the channel) takes the step
    /// before it; samples with no position are skipped.
    static func runs<Point>(_ points: [Point?], steps: [Int?]) -> [(step: Int?, points: [Point])] {
        var out: [(step: Int?, points: [Point])] = []
        var current: Int?
        for (p, s) in zip(points, steps) {
            guard let p else { continue }
            let step = s ?? current
            if let last = out.last, last.step == step {
                out[out.count - 1].points.append(p)
            } else {
                let joint = out.last?.points.last.map { [$0] } ?? []
                out.append((step, joint + [p]))
            }
            current = step
        }
        return out
    }
}
