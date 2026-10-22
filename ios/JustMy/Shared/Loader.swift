import Foundation
import Observation
import OpenAPIRuntime

/// One screen's fetch state (docs/ios-design-handoff.md §3). The last good value stays on screen
/// through a refresh and through a failure; a failure only adds the quiet banner. Held in memory —
/// nothing is cached to disk (docs/ios-app.md §4.3).
@Observable
final class Loader<Value> {
    private(set) var value: Value?
    private(set) var isLoading = false
    private(set) var loadedAt: Date?
    private(set) var failure: LoadFailure?

    func load(_ fetch: () async throws -> Value) async {
        isLoading = true
        defer { isLoading = false }
        do {
            value = try await fetch()
            loadedAt = .now
            failure = nil
        } catch where Task.isCancelled || isCancellation(error) {
            // A refresh superseded by another (or the view went away, e.g. a tab switch mid-load)
            // isn't a failure. The generated client wraps the cancellation in a ClientError.
        } catch {
            failure = LoadFailure(error)
        }
    }

    private func isCancellation(_ error: any Error) -> Bool {
        let underlying = (error as? ClientError)?.underlyingError ?? error
        return underlying is CancellationError || (underlying as? URLError)?.code == .cancelled
    }
}

/// Why the last load failed, worded for the banner.
struct LoadFailure: Equatable {
    let isOffline: Bool
    let message: String

    init(_ error: any Error) {
        let underlying = (error as? ClientError)?.underlyingError ?? error
        if let url = underlying as? URLError, url.code != .cancelled {
            isOffline = true
            message = "Offline"
        } else {
            isOffline = false
            message = "Couldn't load"
        }
    }
}
