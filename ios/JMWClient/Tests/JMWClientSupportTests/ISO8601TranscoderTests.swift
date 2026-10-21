import Foundation
import Testing
@testable import JMWClientSupport

struct ISO8601TranscoderTests {
    let transcoder = ISO8601Transcoder()

    @Test func decodesJavaScriptMilliseconds() throws {
        let date = try transcoder.decode("2026-10-21T20:03:27.225Z")
        #expect(abs(date.timeIntervalSince1970 - 1_792_613_007.225) < 0.0005)
    }

    @Test func decodesWholeSeconds() throws {
        #expect(try transcoder.decode("2026-10-21T20:03:27Z").timeIntervalSince1970 == 1_792_613_007)
    }

    @Test func roundTripsWithTheFraction() throws {
        // Start from the wire form: a binary Double can't hold .225 exactly, so a Date built from
        // the literal would format as .224 (the style truncates).
        let wire = "2026-10-21T20:03:27.225Z"
        let decoded = try transcoder.decode(wire)
        let encoded = try transcoder.encode(decoded)
        #expect(encoded.hasPrefix("2026-10-21T20:03:27."))
        #expect(encoded.hasSuffix("Z"))
        let again = try transcoder.decode(encoded)
        #expect(abs(again.timeIntervalSince(decoded)) < 0.002)
    }

    @Test func rejectsNonDates() {
        #expect(throws: (any Error).self) { try transcoder.decode("2026-10-21") }
        #expect(throws: (any Error).self) { try transcoder.decode("yesterday") }
    }
}
