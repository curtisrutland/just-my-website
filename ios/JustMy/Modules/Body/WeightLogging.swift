import JMWClientSupport
import WeightAPI

/// A typed weight. Accepts the locale's decimal separator; nil until it's a positive number.
nonisolated enum WeightInput {
    static func parse(_ text: String) -> Double? {
        let cleaned = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard let value = Double(cleaned), value > 0, value.isFinite else { return nil }
        return value
    }
}

extension JMWClients {
    /// The app's one weigh-in write: `POST /api/weight/entries`, an upsert per day. The Log weight
    /// sheet and the Today field both save through here, so they can't drift apart. Returns nil
    /// once saved, else the sentence to show.
    func logWeight(_ weight: Double, on day: String, note: String? = nil) async -> String? {
        do {
            let body = Components.Schemas.WeightCreate(measuredOn: day, weight: weight, note: note)
            switch try await self.weight.postApiWeightEntries(.init(body: .json(body))) {
            case .ok:
                return nil
            case let .badRequest(response):
                return (try? response.body.json.error.message) ?? "The server refused that weight."
            default:
                return "Couldn't save. Try again."
            }
        } catch {
            return LoadFailure(write: error).isOffline ? "Offline — nothing was saved." : "Couldn't save. Try again."
        }
    }
}
