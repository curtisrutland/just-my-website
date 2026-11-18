import Foundation
import JMWClientSupport
@testable import JustMy

/// A server that exists only inside a test: answers each request from a closure and records what
/// was asked. Every instance has its own made-up host, so suites running side by side can't see
/// each other's requests. Nothing here reaches a real server.
final class StubServer: @unchecked Sendable {
    struct Request {
        let method: String
        let path: String
        let auth: String?
        let body: [String: Any]
    }

    typealias Answer = (status: Int, body: String)
    typealias Handler = @Sendable (_ method: String, _ path: String) throws -> Answer

    let base: URL
    private let host: String

    init(_ handler: @escaping Handler) {
        host = "stub-\(UUID().uuidString.lowercased()).test"
        base = URL(string: "https://\(host)")!
        Registry.shared.set(host, handler)
    }

    deinit { Registry.shared.remove(host) }

    var requests: [Request] { Registry.shared.requests(host) }

    var session: URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [Loader.self]
        return URLSession(configuration: configuration)
    }

    func clients(token: String = "jmw_test-token") -> JMWClients {
        JMWClients(pairing: PairingPayload(base: base, token: token), session: session)
    }

    private final class Registry: @unchecked Sendable {
        static let shared = Registry()
        private let lock = NSLock()
        private var handlers: [String: Handler] = [:]
        private var seen: [String: [Request]] = [:]

        func set(_ host: String, _ handler: @escaping Handler) { lock.withLock { handlers[host] = handler } }
        func remove(_ host: String) { lock.withLock { handlers[host] = nil; seen[host] = nil } }
        func handler(_ host: String) -> Handler? { lock.withLock { handlers[host] } }
        func record(_ host: String, _ request: Request) { lock.withLock { seen[host, default: []].append(request) } }
        func requests(_ host: String) -> [Request] { lock.withLock { seen[host] ?? [] } }
    }

    private final class Loader: URLProtocol, @unchecked Sendable {
        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func stopLoading() {}

        override func startLoading() {
            let host = request.url?.host() ?? ""
            let sent = request.httpBody ?? request.httpBodyStream.map(Self.drain) ?? Data()
            let json = (try? JSONSerialization.jsonObject(with: sent)) as? [String: Any] ?? [:]
            let method = request.httpMethod ?? "", path = request.url?.path ?? ""
            Registry.shared.record(host, Request(method: method, path: path,
                                                 auth: request.value(forHTTPHeaderField: "Authorization"), body: json))
            do {
                guard let handler = Registry.shared.handler(host) else { throw URLError(.cannotFindHost) }
                let answer = try handler(method, path)
                let response = HTTPURLResponse(url: request.url!, statusCode: answer.status, httpVersion: "HTTP/1.1",
                                               headerFields: ["Content-Type": "application/json"])!
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: Data(answer.body.utf8))
                client?.urlProtocolDidFinishLoading(self)
            } catch {
                client?.urlProtocol(self, didFailWithError: error)
            }
        }

        private static func drain(_ stream: InputStream) -> Data {
            stream.open()
            defer { stream.close() }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let read = stream.read(&buffer, maxLength: buffer.count)
                guard read > 0 else { break }
                data.append(buffer, count: read)
            }
            return data
        }
    }
}

/// In-memory stand-in for the weigh-in token's Keychain item.
final class FakeWeighInStore: WeighInTokenStoring, @unchecked Sendable {
    var saved: PairingPayload?
    init(_ saved: PairingPayload? = nil) { self.saved = saved }
    func load() -> PairingPayload? { saved }
    func save(_ pairing: PairingPayload) { saved = pairing }
    func delete() { saved = nil }
}

/// A weigh-in as the server sends it.
func weighInJSON(on day: String, weight: Double) -> String {
    """
    {"id":"w1","createdAt":"2026-11-18T13:22:04.123Z","updatedAt":"2026-11-18T13:22:04.123Z","deletedAt":null,
     "measuredOn":"\(day)","weight":\(weight),"note":null}
    """
}
