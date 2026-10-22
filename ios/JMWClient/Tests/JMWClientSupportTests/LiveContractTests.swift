import Foundation
import LiftingAPI
import MacrosAPI
import RidesAPI
import ShoppingAPI
import Testing
import VitalsAPI
import WeightAPI
@testable import JMWClientSupport

/// End to end through the generated client: every operation the app may call (docs/ios-app.md §3.4),
/// against a real server with a real phone token, decoded into the generated types. The server-side
/// half is `src/lib/http/contract.test.ts`; this half proves the Swift decode (dates, nullability,
/// the stream's open channels) agrees.
///
/// Skipped unless both are set — it needs a running server and a token with PHONE_SCOPES:
///
///     JMW_E2E_BASE=http://localhost:3000 JMW_E2E_TOKEN=jmw_… swift test --package-path ios/JMWClient
///
/// It writes a 1990-01-03 weigh-in and a `zzz-e2e` shopping item (which it soft-deletes; the phone
/// token can't hard-delete), so remove both rows afterwards (ios/README.md).
private let livePairing: PairingPayload? = {
    let env = ProcessInfo.processInfo.environment
    guard let base = env["JMW_E2E_BASE"].flatMap(URL.init(string:)), let token = env["JMW_E2E_TOKEN"] else { return nil }
    return PairingPayload(base: base, token: token)
}()

@Suite(.enabled(if: livePairing != nil, "set JMW_E2E_BASE and JMW_E2E_TOKEN"))
struct LiveContractTests {
    let api = JMWClients(pairing: livePairing!)

    @Test func macrosDay() async throws {
        let today = Date.now.formatted(.iso8601.year().month().day())
        let day = try await api.macros.getApiMacrosDaysDate(.init(path: .init(date: today))).ok.body.json
        #expect(day.day.date == today)
    }

    @Test func weight() async throws {
        let rollup = try await api.weight.getApiWeightRollup(.init(query: .init(window: 30))).ok.body.json
        #expect(!rollup.series.isEmpty)
        let list = try await api.weight.getApiWeightEntries(.init(query: .init(limit: 5))).ok.body.json
        let first = try #require(list.items.first)
        let day = try await api.weight.getApiWeightDaysDate(.init(path: .init(date: first.measuredOn))).ok.body.json
        #expect(day.id == first.id)
        let logged = try await api.weight.postApiWeightEntries(
            .init(body: .json(.init(measuredOn: "1990-01-03", weight: 150.5, note: "e2e")))
        ).ok.body.json
        #expect(logged.weight == 150.5)
        // A real, recent instant decoded from the server's ISO string (clocks may differ by a little).
        #expect(abs(logged.updatedAt.timeIntervalSinceNow) < 300)
    }

    @Test func lifting() async throws {
        let list = try await api.lifting.getApiLiftingSessions(.init(query: .init(limit: 5))).ok.body.json
        let summary = try #require(list.items.first)
        let detail = try await api.lifting.getApiLiftingSessionsId(.init(path: .init(id: summary.id))).ok.body.json
        #expect(detail.id == summary.id)
        let templateId = try #require(detail.exercises.compactMap(\.exerciseTemplateId).first)
        let progression = try await api.lifting.getApiLiftingLiftsTemplateId(.init(path: .init(templateId: templateId))).ok.body.json
        #expect(!progression.points.isEmpty)
    }

    @Test func rides() async throws {
        let list = try await api.rides.getApiRides(.init(query: .init(limit: 5))).ok.body.json
        let first = try #require(list.items.first)
        let detail = try await api.rides.getApiRidesId(.init(path: .init(id: first.id), query: .init(streams: ._1))).ok.body.json
        // A nullable `$ref` is emitted as `allOf` + `nullable` (the OpenAPI 3.0 idiom), which the
        // generator wraps: the referenced `RideStream` is `value1`.
        let stream = try #require(detail.stream).value1
        #expect(!stream.data.t.isEmpty)
        // Every other channel aligns to `t`; lat/lon are what the MapKit route is drawn from.
        for (_, channel) in stream.data.additionalProperties { #expect(channel.count == stream.data.t.count) }
        let weekly = try await api.rides.getApiRidesWeekly(.init()).ok.body.json
        #expect(!weekly.weeks.isEmpty)
    }

    @Test func vitals() async throws {
        let list = try await api.vitals.getApiVitals(.init(query: .init(limit: 5))).ok.body.json
        let first = try #require(list.items.first)
        let day = try await api.vitals.getApiVitalsDate(.init(path: .init(date: first.measuredOn))).ok.body.json
        #expect(day.id == first.id)
        let summary = try await api.vitals.getApiVitalsSummary(.init(query: .init(window: 30))).ok.body.json
        #expect(!summary.restingHeartRate.series.isEmpty)
    }

    @Test func shopping() async throws {
        let item = try await api.shopping.postApiShoppingItems(.init(body: .json(.init(category: "zzz-e2e", text: "e2e-me")))).created.body.json
        let bought = try await api.shopping.patchApiShoppingItemsId(.init(path: .init(id: item.id), body: .json(.init(status: .bought)))).ok.body.json
        #expect(bought.status == .bought)
        #expect(bought.checkedAt != nil)
        let list = try await api.shopping.getApiShoppingList(.init()).ok.body.json
        #expect(list.recentlyBought.contains { $0.id == item.id })
        // Swipe to delete (soft) — and the same token can never hard-delete.
        _ = try await api.shopping.deleteApiShoppingItemsId(.init(path: .init(id: item.id))).noContent
        let after = try await api.shopping.getApiShoppingList(.init()).ok.body.json
        #expect(!after.recentlyBought.contains { $0.id == item.id })
        let hard = try await api.shopping.deleteApiShoppingItemsId(.init(path: .init(id: item.id), query: .init(hard: true)))
        #expect(throws: (any Error).self) { try hard.noContent }
    }
}
