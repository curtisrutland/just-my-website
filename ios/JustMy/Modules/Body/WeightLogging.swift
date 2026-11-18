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

/// How a weigh-in write ended.
enum WeightLogOutcome: Equatable {
    case saved
    /// A validation refusal, with the server's own message.
    case refused(String)
    /// The token isn't accepted (revoked, or missing the scope).
    case unauthorized
    case offline
    case failed
}

extension JMWClients {
    /// The app's one weigh-in write: `POST /api/weight/entries`, an upsert per day. The Log weight
    /// sheet, the Today field and Siri all save through here, so they can't drift apart.
    func logWeightOutcome(_ weight: Double, on day: String, note: String? = nil) async -> WeightLogOutcome {
        do {
            let body = Components.Schemas.WeightCreate(measuredOn: day, weight: weight, note: note)
            switch try await self.weight.postApiWeightEntries(.init(body: .json(body))) {
            case .ok:
                return .saved
            case let .badRequest(response):
                return .refused((try? response.body.json.error.message) ?? "The server refused that weight.")
            case .unauthorized:
                return .unauthorized
            default:
                return .failed
            }
        } catch {
            return LoadFailure(write: error).isOffline ? .offline : .failed
        }
    }

    /// The same write, worded for a screen: nil once saved, else the sentence to show.
    func logWeight(_ weight: Double, on day: String, note: String? = nil) async -> String? {
        switch await logWeightOutcome(weight, on: day, note: note) {
        case .saved: nil
        case let .refused(message): message
        case .offline: "Offline — nothing was saved."
        case .unauthorized, .failed: "Couldn't save. Try again."
        }
    }
}
