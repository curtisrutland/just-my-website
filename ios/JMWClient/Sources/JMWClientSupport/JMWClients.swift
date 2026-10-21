import Foundation
import LiftingAPI
import MacrosAPI
import OpenAPIRuntime
import OpenAPIURLSession
import RidesAPI
import ShoppingAPI
import VitalsAPI
import WeightAPI

/// Every module's generated client, built once per pairing against one server with one token.
/// The only place clients are constructed, so the base URL and auth can't differ between modules.
public struct JMWClients: Sendable {
    public let macros: MacrosAPI.Client
    public let weight: WeightAPI.Client
    public let lifting: LiftingAPI.Client
    public let rides: RidesAPI.Client
    public let vitals: VitalsAPI.Client
    public let shopping: ShoppingAPI.Client

    public init(pairing: PairingPayload, session: URLSession = .shared) {
        let transport = URLSessionTransport(configuration: .init(session: session))
        let middlewares: [any ClientMiddleware] = [BearerTokenMiddleware(token: pairing.token)]
        // The specs' paths are absolute (`/api/weight/rollup`), so the server URL is just the origin.
        let server = pairing.base
        macros = .init(serverURL: server, transport: transport, middlewares: middlewares)
        weight = .init(serverURL: server, transport: transport, middlewares: middlewares)
        lifting = .init(serverURL: server, transport: transport, middlewares: middlewares)
        rides = .init(serverURL: server, transport: transport, middlewares: middlewares)
        vitals = .init(serverURL: server, transport: transport, middlewares: middlewares)
        shopping = .init(serverURL: server, transport: transport, middlewares: middlewares)
    }

    public enum CheckResult: Equatable, Sendable {
        case ok
        /// 401: unknown, revoked, or missing the scope.
        case rejected
        case unexpected(statusCode: Int)
    }

    /// Confirms a token before it's saved (docs/ios-app.md §4.1): one cheap allowlisted read.
    /// Network failures throw; an HTTP answer is always a `CheckResult`.
    public func check() async throws -> CheckResult {
        switch try await weight.getApiWeightRollup(.init(query: .init(window: 7))) {
        case .ok: .ok
        case .unauthorized: .rejected
        case .badRequest: .unexpected(statusCode: 400)
        case let .undocumented(statusCode, _): statusCode == 401 ? .rejected : .unexpected(statusCode: statusCode)
        default: .unexpected(statusCode: -1)
        }
    }
}
