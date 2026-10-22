import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Reports any `401` the server sends, from any module's client: the token was revoked or lost its
/// scope (docs/ios-app.md §4.3). The app forgets the token and returns to pairing; the response
/// still flows on to the caller unchanged.
public struct UnauthorizedMiddleware: ClientMiddleware {
    private let onUnauthorized: @Sendable () -> Void

    public init(onUnauthorized: @escaping @Sendable () -> Void) {
        self.onUnauthorized = onUnauthorized
    }

    public func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let (response, responseBody) = try await next(request, body, baseURL)
        if response.status == .unauthorized { onUnauthorized() }
        return (response, responseBody)
    }
}
