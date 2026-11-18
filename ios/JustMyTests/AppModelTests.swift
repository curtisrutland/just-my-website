import Foundation
import JMWClientSupport
import SwiftUI
import Testing
@testable import JustMy

/// In-memory stand-in for the Keychain: no Face ID, no device passcode.
final class FakeStore: TokenStoring, @unchecked Sendable {
    var saved: PairingPayload?
    var loadError: TokenStoreError?

    var hasPairing: Bool { saved != nil }
    func save(_ pairing: PairingPayload) throws(TokenStoreError) { saved = pairing }
    func load(reason: String) async throws(TokenStoreError) -> PairingPayload {
        if let loadError { throw loadError }
        guard let saved else { throw .notFound }
        return saved
    }
    func delete() { saved = nil }
}

@MainActor
struct AppModelTests {
    let token = "jmw_test-token"
    let base = URL(string: "http://localhost:3000")!
    var qr: String { #"{"v":1,"base":"\#(base.absoluteString)","token":"\#(token)"}"# }

    func model(store: FakeStore = FakeStore(), result: JMWClients.CheckResult = .ok, clock: Clock = Clock()) -> AppModel {
        AppModel(store: store, check: { _ in result }, now: { clock.now })
    }

    final class Clock: @unchecked Sendable { var now = Date(timeIntervalSinceReferenceDate: 0) }

    @Test func startsUnpairedWithNothingSaved() {
        #expect(model().phaseKind == .unpaired)
    }

    @Test func startsLockedWhenPaired() {
        let store = FakeStore()
        store.saved = PairingPayload(base: base, token: token)
        #expect(model(store: store).phaseKind == .locked)
    }

    @Test func pairingSavesOnlyAfterTheServerAccepts() async {
        let store = FakeStore()
        let m = model(store: store)
        await m.pair(text: qr, fallbackBase: PairingPayload.defaultBase)
        #expect(m.phaseKind == .unlocked)
        #expect(store.saved == PairingPayload(base: base, token: token))
        #expect(m.session?.pairing.base == base)
    }

    @Test func aRejectedTokenIsNeverSaved() async {
        let store = FakeStore()
        let m = model(store: store, result: .rejected)
        await m.pair(text: qr, fallbackBase: PairingPayload.defaultBase)
        #expect(m.phaseKind == .unpaired)
        #expect(store.saved == nil)
        #expect(m.errorMessage != nil)
    }

    @Test func aMalformedCodeNeverReachesTheServer() async {
        let m = AppModel(store: FakeStore(), check: { _ in Issue.record("check called"); return .ok })
        await m.pair(text: "nonsense", fallbackBase: PairingPayload.defaultBase)
        #expect(m.errorMessage != nil)
    }

    @Test func unlockingReadsTheTokenAndARevocationUnpairs() async {
        let store = FakeStore()
        store.saved = PairingPayload(base: base, token: token)
        let ok = model(store: store)
        await ok.unlock()
        #expect(ok.phaseKind == .unlocked)

        let revoked = model(store: store, result: .rejected)
        await revoked.unlock()
        #expect(revoked.phaseKind == .unlocked) // opens first (#115)…
        await revoked.revalidation?.value
        #expect(revoked.phaseKind == .unpaired) // …then the background check unpairs
        #expect(store.saved == nil)
    }

    @Test func cancellingFaceIDStaysLocked() async {
        let store = FakeStore()
        store.saved = PairingPayload(base: base, token: token)
        store.loadError = .cancelled
        let m = model(store: store)
        await m.unlock()
        #expect(m.phaseKind == .locked)
        #expect(store.saved != nil)
    }

    @Test func aFaceIDMismatchStaysLockedAndSaysSo() async {
        let store = FakeStore()
        store.saved = PairingPayload(base: base, token: token)
        store.loadError = .authFailed
        let m = model(store: store)
        await m.unlock()
        #expect(m.phaseKind == .locked)
        #expect(m.errorMessage?.contains("didn’t match") == true)
        #expect(m.unlockStage == .idle)
    }

    @Test func anUnreachableServerStillOpensTheApp() async {
        let store = FakeStore()
        store.saved = PairingPayload(base: base, token: token)
        let m = AppModel(store: store, check: { _ in throw URLError(.notConnectedToInternet) })
        await m.unlock()
        #expect(m.phaseKind == .unlocked)
    }

    @Test func unlockingDoesntWaitOnTheCheck() async {
        let store = FakeStore()
        store.saved = PairingPayload(base: base, token: token)
        let m = AppModel(store: store, check: { _ in
            try await Task.sleep(for: .seconds(30))
            return .ok
        })
        let started = Date()
        await m.unlock()
        #expect(m.phaseKind == .unlocked)
        #expect(Date().timeIntervalSince(started) < 1)
        m.revalidation?.cancel()
    }

    @Test func aLateRejectionDoesntUnpairANewerPairing() async {
        let store = FakeStore()
        store.saved = PairingPayload(base: base, token: "jmw_old-token")
        let gate = AsyncStream<Void>.makeStream()
        let m = AppModel(store: store, check: { pairing in
            guard pairing.token == "jmw_old-token" else { return .ok }
            for await _ in gate.stream {} // held until the test re-pairs
            return .rejected
        })
        await m.unlock()
        m.unpair()
        await m.pair(text: qr, fallbackBase: PairingPayload.defaultBase)
        gate.continuation.finish()
        await m.revalidation?.value
        #expect(m.phaseKind == .unlocked)
        #expect(store.saved?.token == token)
    }

    @Test func relocksAfterFiveMinutesInTheBackgroundButNotBefore() async {
        let store = FakeStore()
        let clock = Clock()
        let m = model(store: store, clock: clock)
        await m.pair(text: qr, fallbackBase: PairingPayload.defaultBase)

        m.scenePhaseChanged(to: .inactive)
        #expect(m.isCovered)
        m.scenePhaseChanged(to: .background)
        clock.now.addTimeInterval(120)
        m.scenePhaseChanged(to: .active)
        #expect(!m.isCovered)
        #expect(m.phaseKind == .unlocked)

        m.scenePhaseChanged(to: .background)
        clock.now.addTimeInterval(300)
        m.scenePhaseChanged(to: .active)
        #expect(m.phaseKind == .locked)
        #expect(m.session == nil)
    }

    @Test func unpairForgetsTheToken() async {
        let store = FakeStore()
        let m = model(store: store)
        await m.pair(text: qr, fallbackBase: PairingPayload.defaultBase)
        m.unpair()
        #expect(m.phaseKind == .unpaired)
        #expect(store.saved == nil)
    }

    // MARK: Siri weigh-in token (#101)

    func provisioned(store: FakeStore = FakeStore(), weighInStore: FakeWeighInStore = FakeWeighInStore(),
                     result: JMWClients.CheckResult = .ok, minted: String? = "jmw_weigh-in",
                     mints: Counter = Counter()) -> AppModel {
        AppModel(store: store, check: { _ in result }, weighIn: WeighInSetup(store: weighInStore) { _ in
            mints.count += 1
            return minted
        })
    }

    final class Counter: @unchecked Sendable { var count = 0 }

    @Test func pairingFetchesAWeighInTokenForSiri() async {
        let weighInStore = FakeWeighInStore()
        let m = provisioned(weighInStore: weighInStore)
        await m.pair(text: qr, fallbackBase: PairingPayload.defaultBase)
        await m.provisioning?.value
        #expect(weighInStore.saved == PairingPayload(base: base, token: "jmw_weigh-in"))
        #expect(weighInStore.saved?.token != token) // never the phone's own token
        #expect(m.siriWeighInReady)
    }

    @Test func unlockingFetchesOneOnlyWhenItIsMissing() async {
        let store = FakeStore()
        store.saved = PairingPayload(base: base, token: token)
        let weighInStore = FakeWeighInStore()
        let mints = Counter()
        let first = provisioned(store: store, weighInStore: weighInStore, mints: mints)
        await first.unlock()
        await first.provisioning?.value
        #expect(mints.count == 1)
        #expect(weighInStore.saved?.token == "jmw_weigh-in")

        let second = provisioned(store: store, weighInStore: weighInStore, mints: mints)
        await second.unlock()
        await second.provisioning?.value
        #expect(mints.count == 1) // already there: the server isn't asked again
        #expect(second.siriWeighInReady)
    }

    @Test func aRefusedOrFailedFetchLeavesSiriNotSetUpAndTheAppOpen() async {
        let weighInStore = FakeWeighInStore()
        let refused = provisioned(weighInStore: weighInStore, minted: nil)
        await refused.pair(text: qr, fallbackBase: PairingPayload.defaultBase)
        await refused.provisioning?.value
        #expect(refused.phaseKind == .unlocked)
        #expect(weighInStore.saved == nil)
        #expect(!refused.siriWeighInReady)

        let offline = AppModel(store: FakeStore(), check: { _ in .ok },
                               weighIn: WeighInSetup(store: weighInStore) { _ in throw URLError(.notConnectedToInternet) })
        await offline.pair(text: qr, fallbackBase: PairingPayload.defaultBase)
        await offline.provisioning?.value
        #expect(offline.phaseKind == .unlocked)
        #expect(weighInStore.saved == nil)
    }

    @Test func unpairingAndRevocationForgetTheWeighInToken() async {
        let weighInStore = FakeWeighInStore()
        let m = provisioned(weighInStore: weighInStore)
        await m.pair(text: qr, fallbackBase: PairingPayload.defaultBase)
        await m.provisioning?.value
        m.unpair()
        #expect(weighInStore.saved == nil)
        #expect(!m.siriWeighInReady)

        await m.pair(text: qr, fallbackBase: PairingPayload.defaultBase)
        await m.provisioning?.value
        #expect(weighInStore.saved != nil)
        m.handleUnauthorized() // the phone's token was revoked
        #expect(weighInStore.saved == nil)
    }

    @Test func pairingAgainReplacesAnEarlierPairingsWeighInToken() async {
        let weighInStore = FakeWeighInStore(PairingPayload(base: base, token: "jmw_old-weigh-in"))
        let m = provisioned(weighInStore: weighInStore)
        await m.pair(text: qr, fallbackBase: PairingPayload.defaultBase)
        await m.provisioning?.value
        #expect(weighInStore.saved?.token == "jmw_weigh-in")
    }
}
