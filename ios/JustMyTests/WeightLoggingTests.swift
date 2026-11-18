import Foundation
import JMWClientSupport
import Testing
@testable import JustMy

/// The one weigh-in write, against a stubbed server: what it sends, and how each answer reads.
/// Nothing here reaches a real server, so no weigh-in is written anywhere.
@MainActor
struct WeightLoggingTests {
    let saved = weighInJSON(on: "2026-11-18", weight: 238.4)

    @Test func savesTodaysWeighInThroughTheUpsertRoute() async {
        let server = StubServer { [saved] _, _ in (200, saved) }
        #expect(await server.clients().logWeight(238.4, on: "2026-11-18") == nil)
        #expect(server.requests.count == 1)
        let request = server.requests[0]
        #expect(request.method == "POST")
        #expect(request.path == "/api/weight/entries")
        #expect(request.auth == "Bearer jmw_test-token")
        #expect(request.body["measuredOn"] as? String == "2026-11-18")
        #expect(request.body["weight"] as? Double == 238.4)
        #expect(request.body["note"] == nil) // no note: the key is left out, not sent as null or ""
    }

    @Test func aNoteRidesAlong() async {
        let server = StubServer { [saved] _, _ in (200, saved) }
        #expect(await server.clients().logWeight(238.4, on: "2026-11-17", note: "after a ride") == nil)
        #expect(server.requests[0].body["note"] as? String == "after a ride")
        #expect(server.requests[0].body["measuredOn"] as? String == "2026-11-17")
    }

    @Test func aRefusalShowsTheServersOwnMessage() async {
        let server = StubServer { _, _ in (400, #"{"error":{"code":"validation_error","message":"weight must be at most 1500"}}"#) }
        #expect(await server.clients().logWeight(9999, on: "2026-11-18") == "weight must be at most 1500")
        #expect(await server.clients().logWeightOutcome(9999, on: "2026-11-18") == .refused("weight must be at most 1500"))
    }

    @Test func anUnexpectedAnswerSaysItDidntSave() async {
        let server = StubServer { _, _ in (500, #"{"error":{"code":"internal","message":"boom"}}"#) }
        #expect(await server.clients().logWeight(238.4, on: "2026-11-18") == "Couldn't save. Try again.")
        #expect(await server.clients().logWeightOutcome(238.4, on: "2026-11-18") == .failed)
    }

    @Test func aRevokedTokenIsItsOwnOutcome() async {
        let server = StubServer { _, _ in (401, #"{"error":{"code":"unauthorized","message":"Invalid token"}}"#) }
        #expect(await server.clients().logWeightOutcome(238.4, on: "2026-11-18") == .unauthorized)
    }

    @Test func offlineSaysNothingWasSaved() async {
        let server = StubServer { _, _ in throw URLError(.notConnectedToInternet) }
        #expect(await server.clients().logWeight(238.4, on: "2026-11-18") == "Offline — nothing was saved.")
        #expect(await server.clients().logWeightOutcome(238.4, on: "2026-11-18") == .offline)
    }
}
