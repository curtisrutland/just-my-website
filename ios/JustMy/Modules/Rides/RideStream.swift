import CoreLocation
import Foundation
import RidesAPI

typealias RideDetail = RidesAPI.Components.Schemas.RideDetail
typealias RideSummary = RidesAPI.Components.Schemas.RideView

/// The downsampled stream as the screens use it: aligned channels over `t` (seconds from start),
/// `nil` for a gap. Values convert to display units here (ft, mph); storage stays SI.
struct RideTrack {
    let t: [Double]
    let altitudeFt: [Double?]
    let heartRate: [Double?]
    let speedMph: [Double?]
    let distanceMi: [Double?]
    let coordinates: [CLLocationCoordinate2D?]

    init?(_ detail: RideDetail) {
        guard let stream = detail.stream?.value1, !stream.data.t.isEmpty else { return nil }
        let data = stream.data
        let channel = { (name: String) in data.additionalProperties[name] ?? Array(repeating: nil, count: data.t.count) }
        t = data.t
        altitudeFt = channel("altitude").map { $0.map(Format.feet(fromMeters:)) }
        heartRate = channel("heartRate")
        speedMph = channel("speed").map { $0.map(Format.mph(fromMps:)) }
        distanceMi = channel("distance").map { $0.map(Format.miles(fromMeters:)) }
        let lat = channel("lat"), lon = channel("lon")
        coordinates = zip(lat, lon).map { la, lo in
            guard let la, let lo else { return nil }
            return CLLocationCoordinate2D(latitude: la, longitude: lo)
        }
    }

    var duration: Double { t.last ?? 0 }
    var hasRoute: Bool { coordinates.contains { $0 != nil } }
    var route: [CLLocationCoordinate2D] { coordinates.compactMap { $0 } }

    func hasData(_ channel: [Double?]) -> Bool { channel.contains { $0 != nil } }

    /// The sample pair around `time` and the fraction between them.
    private func bracket(_ time: Double) -> (Int, Int, Double) {
        guard time > t[0] else { return (0, 0, 0) }
        guard time < duration else { return (t.count - 1, t.count - 1, 0) }
        var lo = 0, hi = t.count - 1
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if t[mid] <= time { lo = mid } else { hi = mid }
        }
        let span = t[hi] - t[lo]
        return (lo, hi, span > 0 ? (time - t[lo]) / span : 0)
    }

    /// Linear interpolation between the two samples around `time`; a gap on either side is a gap.
    func value(_ channel: [Double?], at time: Double) -> Double? {
        let (a, b, f) = bracket(time)
        guard let va = channel[a], let vb = channel[b] else { return nil }
        return va + (vb - va) * f
    }

    func coordinate(at time: Double) -> CLLocationCoordinate2D? {
        let (a, b, f) = bracket(time)
        guard let ca = coordinates[a], let cb = coordinates[b] else { return coordinates[a] ?? coordinates[b] }
        return CLLocationCoordinate2D(
            latitude: ca.latitude + (cb.latitude - ca.latitude) * f,
            longitude: ca.longitude + (cb.longitude - ca.longitude) * f
        )
    }

    /// The route ridden up to `time`, ending exactly at the interpolated point.
    func riddenRoute(until time: Double) -> [CLLocationCoordinate2D] {
        let (a, _, _) = bracket(time)
        var prefix = coordinates[0...a].compactMap { $0 }
        if let now = coordinate(at: time) { prefix.append(now) }
        return prefix
    }
}

/// HR zones as the file recorded them: seconds per bucket plus the bpm boundaries they were computed
/// with. Seven buckets against six boundaries: below Z1, Z1–Z5, above max.
struct HRZones {
    struct Bucket: Identifiable {
        let index: Int
        let name: String
        let range: String
        let seconds: Double
        var id: Int { index }
    }

    let buckets: [Bucket]

    init?(seconds: [Double]?, boundaries: [Double]?) {
        guard let seconds, seconds.contains(where: { $0 > 0 }) else { return nil }
        let b = (boundaries ?? []).map { Int($0.rounded()) }
        buckets = seconds.enumerated().map { i, s in
            let name: String
            let range: String
            switch i {
            case 0:
                name = "Below Z1"; range = b.first.map { "< \($0)" } ?? ""
            case let i where i == seconds.count - 1 && i >= b.count:
                name = "Above max"; range = b.last.map { "> \($0)" } ?? ""
            default:
                name = "Z\(i)"
                range = (i < b.count && i - 1 < b.count) ? "\(b[i - 1])–\(b[i]) bpm" : ""
            }
            return Bucket(index: i, name: name, range: range, seconds: s)
        }
    }

    var total: Double { buckets.reduce(0) { $0 + $1.seconds } }
}

extension RideSummary {
    /// The ride's title: its own name, else the device profile and the local date.
    var title: String { name ?? "\(sportProfileName ?? sport.capitalized) — \(Format.monthDay(localDate))" }
}

extension RideDetail {
    var title: String { name ?? "\(sportProfileName ?? sport.capitalized) — \(Format.monthDay(localDate))" }
}

/// `0` distance and speed on an indoor activity mean "not measured" (#40), not zero.
func measured(_ value: Double?) -> Double? {
    guard let value, value > 0 else { return nil }
    return value
}

/// Garmin's product string made readable for the caption: `instinct3Amoled50mm` → `Instinct 3 Amoled`.
/// Display only (the web shows the raw string); the case-size suffix is dropped.
func deviceName(_ raw: String?) -> String? {
    guard let raw, !raw.isEmpty else { return nil }
    var out = ""
    var previous: Character?
    for c in raw {
        if let p = previous, (c.isUppercase && !p.isUppercase) || (c.isNumber && p.isLetter) || (c.isLetter && p.isNumber && c.isUppercase) {
            out.append(" ")
        }
        out.append(c)
        previous = c
    }
    let words = out.split(separator: " ").filter { !$0.hasSuffix("mm") || $0.dropLast(2).contains { !$0.isNumber } }
    guard let first = words.first else { return raw }
    return ([first.prefix(1).uppercased() + first.dropFirst()] + words.dropFirst().map(String.init)).joined(separator: " ")
}
