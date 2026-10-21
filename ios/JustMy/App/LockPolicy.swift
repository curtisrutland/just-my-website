import Foundation

/// When the app relocks (docs/ios-app.md §4.3): on launch, and on return to the foreground after
/// `gracePeriod` or more in the background. Shorter trips (a glance at Messages) don't prompt.
nonisolated struct LockPolicy {
    var gracePeriod: TimeInterval = 5 * 60

    func shouldLock(backgroundedAt: Date?, now: Date) -> Bool {
        guard let backgroundedAt else { return false }
        return now.timeIntervalSince(backgroundedAt) >= gracePeriod
    }
}
