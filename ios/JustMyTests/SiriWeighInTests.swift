import Foundation
import JMWClientSupport
import Testing
@testable import JustMy

/// Siri's weigh-in (#101) against a stubbed server: what it asks, what it sends, and what it says
/// when it can't. Nothing here reaches a real server.
@MainActor
struct SiriWeighInTests {
    let today = "2026-11-18"
    let unauthorized = #"{"error":{"code":"unauthorized","message":"Invalid token"}}"#
    let notFound = #"{"error":{"code":"not_found","message":"Not found"}}"#

    func weighIn(_ server: StubServer, store: FakeWeighInStore? = nil) -> (SiriWeighIn, FakeWeighInStore) {
        let store = store ?? FakeWeighInStore(PairingPayload(base: server.base, token: "jmw_weigh-in-only"))
        return (SiriWeighIn(store: store, session: server.session, today: { [today] in today }), store)
    }

    func failure(_ body: () async throws(SiriWeighIn.Failure) -> String) async -> SiriWeighIn.Failure? {
        do { _ = try await body(); return nil } catch { return error }
    }

    @Test func asksBeforeLoggingAFreshDay() async throws {
        let server = StubServer { [notFound] _, _ in (404, notFound) }
        let (siri, _) = weighIn(server)
        #expect(try await siri.question(for: 246.2) == "Log 246.2 pounds?")
        #expect(server.requests.map(\.path) == ["/api/weight/days/2026-11-18"])
        #expect(server.requests[0].method == "GET") // asking writes nothing
    }

    @Test func saysSoWhenTodayAlreadyHasAWeighIn() async throws {
        let server = StubServer { [today] _, _ in (200, weighInJSON(on: today, weight: 247.0)) }
        let (siri, _) = weighIn(server)
        #expect(try await siri.question(for: 246.2) == "Today already has 247.0 pounds. Replace it with 246.2?")
    }

    @Test func logsTodayWithTheWeighInTokenOnly() async throws {
        let server = StubServer { [today] _, _ in (200, weighInJSON(on: today, weight: 246.2)) }
        let (siri, _) = weighIn(server)
        #expect(try await siri.log(246.2) == "Logged 246.2 lb.")
        let request = try #require(server.requests.first)
        #expect(server.requests.count == 1)
        #expect(request.method == "POST")
        #expect(request.path == "/api/weight/entries")
        #expect(request.auth == "Bearer jmw_weigh-in-only")
        #expect(request.body["measuredOn"] as? String == today)
        #expect(request.body["weight"] as? Double == 246.2)
    }

    @Test func withoutATokenItSaysToOpenTheAppAndAsksTheServerNothing() async {
        let server = StubServer { _, _ in (200, "{}") }
        let (siri, _) = weighIn(server, store: FakeWeighInStore())
        #expect(await failure { () async throws(SiriWeighIn.Failure) in try await siri.question(for: 246.2) } == .notSetUp)
        #expect(await failure { () async throws(SiriWeighIn.Failure) in try await siri.log(246.2) } == .notSetUp)
        #expect(server.requests.isEmpty)
    }

    @Test func aRevokedTokenIsForgottenWhetherFoundOnTheQuestionOrTheSave() async {
        let server = StubServer { [unauthorized] _, _ in (401, unauthorized) }
        let (asking, askStore) = weighIn(server)
        #expect(await failure { () async throws(SiriWeighIn.Failure) in try await asking.question(for: 246.2) } == .revoked)
        #expect(askStore.saved == nil) // the next unlock fetches a new one

        let (saving, saveStore) = weighIn(server)
        #expect(await failure { () async throws(SiriWeighIn.Failure) in try await saving.log(246.2) } == .revoked)
        #expect(saveStore.saved == nil)
    }

    @Test func offlineKeepsTheTokenAndSaysNothingWasLogged() async {
        let server = StubServer { _, _ in throw URLError(.notConnectedToInternet) }
        let (siri, store) = weighIn(server)
        #expect(await failure { () async throws(SiriWeighIn.Failure) in try await siri.question(for: 246.2) } == .offline)
        #expect(await failure { () async throws(SiriWeighIn.Failure) in try await siri.log(246.2) } == .offline)
        #expect(store.saved != nil)
        #expect(SiriWeighIn.Failure.offline.spoken.contains("nothing was logged"))
    }

    @Test func aRefusalIsSpokenInTheServersWords() async {
        let server = StubServer { _, _ in (400, #"{"error":{"code":"validation_error","message":"weight must be at most 1500"}}"#) }
        let (siri, _) = weighIn(server)
        let refused = await failure { () async throws(SiriWeighIn.Failure) in try await siri.log(9999) }
        #expect(refused == .refused("weight must be at most 1500"))
        #expect(refused?.spoken == "The server didn't take that: weight must be at most 1500")
    }

    @Test func aNonsenseNumberNeverReachesTheServer() async {
        let server = StubServer { _, _ in (200, "{}") }
        let (siri, _) = weighIn(server)
        for bad in [0, -5, Double.nan, .infinity] {
            #expect(await failure { () async throws(SiriWeighIn.Failure) in try await siri.question(for: bad) } == .notAWeight)
            #expect(await failure { () async throws(SiriWeighIn.Failure) in try await siri.log(bad) } == .notAWeight)
        }
        #expect(server.requests.isEmpty)
    }
}
