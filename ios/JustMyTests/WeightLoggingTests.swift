import Foundation
import JMWClientSupport
import Testing
@testable import JustMy

/// The one weigh-in write, against a stubbed server: what it sends, and how each answer reads.
/// Nothing here reaches a real server, so no weigh-in is written anywhere.
@MainActor
@Suite(.serialized)
struct WeightLoggingTests {
    /// Answers every request from `respond` and records what was asked.
    final class Stub: URLProtocol, @unchecked Sendable {
        nonisolated(unsafe) static var respond: (@Sendable () throws -> (status: Int, body: String))?
        nonisolated(unsafe) static var requests: [(method: String, path: String, auth: String?, body: [String: Any])] = []

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func stopLoading() {}

        override func startLoading() {
            let sent = request.httpBody ?? request.httpBodyStream.map(Self.drain) ?? Data()
            let json = (try? JSONSerialization.jsonObject(with: sent)) as? [String: Any] ?? [:]
            Self.requests.append((request.httpMethod ?? "", request.url?.path ?? "",
                                  request.value(forHTTPHeaderField: "Authorization"), json))
            do {
                let answer = try Self.respond!()
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

    func clients(_ respond: @escaping @Sendable () throws -> (status: Int, body: String)) -> JMWClients {
        Stub.respond = respond
        Stub.requests = []
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [Stub.self]
        return JMWClients(pairing: PairingPayload(base: URL(string: "http://localhost:3000")!, token: "jmw_test-token"),
                          session: URLSession(configuration: configuration))
    }

    let saved = """
    {"id":"w1","createdAt":"2026-11-18T13:22:04.123Z","updatedAt":"2026-11-18T13:22:04.123Z","deletedAt":null,
     "measuredOn":"2026-11-18","weight":238.4,"note":null}
    """

    @Test func savesTodaysWeighInThroughTheUpsertRoute() async {
        let api = clients { [saved] in (200, saved) }
        #expect(await api.logWeight(238.4, on: "2026-11-18") == nil)
        #expect(Stub.requests.count == 1)
        let request = Stub.requests[0]
        #expect(request.method == "POST")
        #expect(request.path == "/api/weight/entries")
        #expect(request.auth == "Bearer jmw_test-token")
        #expect(request.body["measuredOn"] as? String == "2026-11-18")
        #expect(request.body["weight"] as? Double == 238.4)
        #expect(request.body["note"] == nil) // no note: the key is left out, not sent as null or ""
    }

    @Test func aNoteRidesAlong() async {
        let api = clients { [saved] in (200, saved) }
        #expect(await api.logWeight(238.4, on: "2026-11-17", note: "after a ride") == nil)
        #expect(Stub.requests[0].body["note"] as? String == "after a ride")
        #expect(Stub.requests[0].body["measuredOn"] as? String == "2026-11-17")
    }

    @Test func aRefusalShowsTheServersOwnMessage() async {
        let api = clients { (400, #"{"error":{"code":"validation_error","message":"weight must be at most 1500"}}"#) }
        #expect(await api.logWeight(9999, on: "2026-11-18") == "weight must be at most 1500")
    }

    @Test func anUnexpectedAnswerSaysItDidntSave() async {
        let api = clients { (500, #"{"error":{"code":"internal","message":"boom"}}"#) }
        #expect(await api.logWeight(238.4, on: "2026-11-18") == "Couldn't save. Try again.")
    }

    @Test func offlineSaysNothingWasSaved() async {
        let api = clients { throw URLError(.notConnectedToInternet) }
        #expect(await api.logWeight(238.4, on: "2026-11-18") == "Offline — nothing was saved.")
    }
}
