import Foundation
import OpenAPIRuntime

/// Dates on the wire are what JavaScript's `Date.toISOString()` emits: `2026-10-21T20:03:27.225Z`,
/// with milliseconds. The runtime's default transcoder rejects the fraction and its fractional one
/// requires it, so this one accepts both and always sends the fractional form.
public struct ISO8601Transcoder: DateTranscoder {
    public init() {}

    public func encode(_ date: Date) throws -> String {
        date.formatted(Self.fractional)
    }

    public func decode(_ string: String) throws -> Date {
        if let date = try? Self.fractional.parse(string) { return date }
        if let date = try? Self.whole.parse(string) { return date }
        throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Not an ISO 8601 date-time: \(string)"))
    }

    private static let fractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let whole = Date.ISO8601FormatStyle()
}
