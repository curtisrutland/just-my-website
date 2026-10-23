import Foundation
import Testing
@testable import JMWClientSupport

struct PairingPayloadTests {
    let token = "jmw_AbC-123_xyz"

    @Test func parsesTheQRPayload() throws {
        let p = try PairingPayload.parse(#"{"v":1,"base":"https://justmy.website","token":"\#(token)"}"#)
        #expect(p == PairingPayload(base: URL(string: "https://justmy.website")!, token: token))
    }

    @Test func readsTheOptionalNameFromTheDevicesPage() throws {
        let named = try PairingPayload.parse(#"{"v":1,"base":"https://justmy.website","token":"\#(token)","name":" Curtis's iPhone "}"#)
        #expect(named.name == "Curtis's iPhone")
        let blank = try PairingPayload.parse(#"{"v":1,"base":"https://justmy.website","token":"\#(token)","name":"  "}"#)
        #expect(blank.name == nil)
        #expect(try PairingPayload.parse(token).name == nil)
    }

    @Test func trimsTrailingSlashesAndWhitespace() throws {
        let p = try PairingPayload.parse("  {\"v\":1,\"base\":\"https://justmy.website//\",\"token\":\"\(token)\"}\n")
        #expect(p.base.absoluteString == "https://justmy.website")
    }

    @Test func bareTokenUsesTheFallbackBase() throws {
        #expect(try PairingPayload.parse("\(token)\n").base == PairingPayload.defaultBase)
        let dev = URL(string: "http://localhost:3000")!
        #expect(try PairingPayload.parse(token, fallbackBase: dev).base == dev)
    }

    @Test func allowsHttpOnlyForLocalHosts() throws {
        for base in ["http://localhost:3000", "http://127.0.0.1:3000", "http://curtis-mac.local:3000"] {
            #expect(try PairingPayload.parse(#"{"v":1,"base":"\#(base)","token":"\#(token)"}"#).base.absoluteString == base)
        }
        #expect(throws: PairingPayload.ParseError.badBase) {
            try PairingPayload.parse(#"{"v":1,"base":"http://justmy.website","token":"\#(token)"}"#)
        }
    }

    @Test func rejectsBadInput() {
        #expect(throws: PairingPayload.ParseError.empty) { try PairingPayload.parse("   ") }
        #expect(throws: PairingPayload.ParseError.malformed) { try PairingPayload.parse("{not json") }
        #expect(throws: PairingPayload.ParseError.unsupportedVersion(2)) {
            try PairingPayload.parse(#"{"v":2,"base":"https://justmy.website","token":"\#(token)"}"#)
        }
        #expect(throws: PairingPayload.ParseError.badBase) {
            try PairingPayload.parse(#"{"v":1,"base":"ftp://justmy.website","token":"\#(token)"}"#)
        }
        #expect(throws: PairingPayload.ParseError.badBase) {
            try PairingPayload.parse(#"{"v":1,"base":"https://justmy.website?x=1","token":"\#(token)"}"#)
        }
        #expect(throws: PairingPayload.ParseError.badToken) { try PairingPayload.parse("not-a-token") }
        #expect(throws: PairingPayload.ParseError.badToken) { try PairingPayload.parse("jmw_") }
        #expect(throws: PairingPayload.ParseError.badToken) { try PairingPayload.parse("jmw_has space") }
    }
}
