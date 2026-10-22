import Foundation
import Testing
@testable import JustMy

struct LockPolicyTests {
    let policy = LockPolicy()
    let t0 = Date(timeIntervalSinceReferenceDate: 0)

    @Test func neverLocksWithoutABackgroundTrip() {
        #expect(!policy.shouldLock(backgroundedAt: nil, now: t0))
    }

    @Test func staysUnlockedUnderFiveMinutes() {
        #expect(!policy.shouldLock(backgroundedAt: t0, now: t0.addingTimeInterval(299)))
    }

    @Test func locksAtFiveMinutes() {
        #expect(policy.shouldLock(backgroundedAt: t0, now: t0.addingTimeInterval(300)))
        #expect(policy.shouldLock(backgroundedAt: t0, now: t0.addingTimeInterval(3600)))
    }
}
