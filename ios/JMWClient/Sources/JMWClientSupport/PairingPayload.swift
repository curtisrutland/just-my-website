import Foundation

/// What the pair screen accepts (docs/ios-app.md §4.1): the QR payload
/// `{"v":1,"base":"https://justmy.website","token":"jmw_…","name":"iPhone"}` (`name` optional: the
/// token's name on the web's devices page), or a bare `jmw_…` token pasted from
/// `npm run panel:token -- phone`, which pairs against `defaultBase`.
public struct PairingPayload: Equatable, Sendable {
    public static let defaultBase = URL(string: "https://justmy.website")!

    public let base: URL
    public let token: String
    /// The token's name on the devices page, so Settings can say which pairing this is.
    public let name: String?

    public enum ParseError: Error, Equatable {
        case empty
        case malformed
        case unsupportedVersion(Int)
        case badBase
        case badToken
    }

    public init(base: URL, token: String, name: String? = nil) {
        self.base = base
        self.token = token
        self.name = name
    }

    /// Parses scanned or pasted text. `fallbackBase` is used only for a bare token.
    public static func parse(_ text: String, fallbackBase: URL = defaultBase) throws(ParseError) -> PairingPayload {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw .empty }

        if trimmed.hasPrefix("{") {
            struct Wire: Decodable {
                let v: Int
                let base: String
                let token: String
                let name: String?
            }
            guard let data = trimmed.data(using: .utf8),
                  let wire = try? JSONDecoder().decode(Wire.self, from: data)
            else { throw .malformed }
            guard wire.v == 1 else { throw .unsupportedVersion(wire.v) }
            let name = wire.name?.trimmingCharacters(in: .whitespacesAndNewlines)
            return PairingPayload(
                base: try validBase(wire.base), token: try validToken(wire.token),
                name: name?.isEmpty == false ? name : nil
            )
        }

        return PairingPayload(base: try validBase(fallbackBase.absoluteString), token: try validToken(trimmed))
    }

    private static func validBase(_ raw: String) throws(ParseError) -> URL {
        guard let url = URL(string: raw.trimmingCharacters(in: .whitespaces)),
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              url.host() != nil,
              url.query() == nil, url.fragment() == nil
        else { throw .badBase }
        // http only for a dev server on this Mac or the LAN; the real site is always https.
        if scheme == "http", !isLocal(url) { throw .badBase }
        var string = url.absoluteString
        while string.hasSuffix("/") { string.removeLast() }
        return URL(string: string)!
    }

    private static func isLocal(_ url: URL) -> Bool {
        guard let host = url.host()?.lowercased() else { return false }
        return host == "localhost" || host == "127.0.0.1" || host.hasSuffix(".local")
    }

    private static func validToken(_ raw: String) throws(ParseError) -> String {
        let token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard token.hasPrefix("jmw_"), token.count > 4,
              token.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" })
        else { throw .badToken }
        return token
    }
}
