import Foundation
import JMWClientSupport

/// The weigh-in Siri runs (#101), apart from Siri itself so it can be tested: look at today, ask,
/// then save. It uses the weigh-in token — never the phone's full token, which stays behind Face ID —
/// and the same write as the Log weight sheet and the Today field (`JMWClients.logWeight`).
struct SiriWeighIn {
    /// Why a weigh-in couldn't be logged, worded for Siri to say. Nothing fails silently.
    enum Failure: Error, Equatable {
        /// No weigh-in token on this phone yet.
        case notSetUp
        /// The server no longer accepts the weigh-in token.
        case revoked
        case offline
        case notAWeight
        /// The server's own validation message.
        case refused(String)

        var spoken: String {
            switch self {
            case .notSetUp: "Open JustMy once so Siri can log weigh-ins."
            case .revoked: "Siri's access to your weigh-ins was revoked. Open JustMy to set it up again."
            case .offline: "I couldn't reach your server, so nothing was logged."
            case .notAWeight: "That doesn't look like a weight, so nothing was logged."
            case let .refused(message): "The server didn't take that: \(message)"
            }
        }
    }

    let store: any WeighInTokenStoring
    var session: URLSession = .shared
    var today: () -> String = { Format.todayISO() }

    /// The question to ask before saving. It says so when today already has a weigh-in, because
    /// saving replaces it: one weigh-in per day.
    func question(for weight: Double) async throws(Failure) -> String {
        guard weight > 0, weight.isFinite else { throw .notAWeight }
        let api = try clients()
        let existing: Double?
        do {
            switch try await api.weight.getApiWeightDaysDate(.init(path: .init(date: today()))) {
            case let .ok(response): existing = try response.body.json.weight
            case .notFound: existing = nil
            case .unauthorized: throw Failure.revoked
            default: existing = nil // an odd answer isn't a reason to refuse; the save will say more
            }
        } catch let failure as Failure {
            if failure == .revoked { store.delete() }
            throw failure
        } catch {
            throw .offline
        }
        let new = Self.pounds(weight)
        guard let existing else { return "Log \(new)?" }
        return "Today already has \(Self.pounds(existing)). Replace it with \(Format.oneDecimal(weight))?"
    }

    /// Saves today's weigh-in and returns what to say back.
    func log(_ weight: Double) async throws(Failure) -> String {
        guard weight > 0, weight.isFinite else { throw .notAWeight }
        let api = try clients()
        switch await api.logWeightOutcome(weight, on: today()) {
        case .saved: return "Logged \(Format.oneDecimal(weight)) lb."
        case .unauthorized:
            store.delete()
            throw .revoked
        case .offline: throw .offline
        case let .refused(message): throw .refused(message)
        case .failed: throw .refused("it couldn't save. Try again.")
        }
    }

    private func clients() throws(Failure) -> JMWClients {
        guard let pairing = store.load() else { throw .notSetUp }
        return JMWClients(pairing: pairing, session: session)
    }

    /// `246.2 pounds` — spelled out, so Siri says the unit rather than "l b".
    static func pounds(_ weight: Double) -> String { "\(Format.oneDecimal(weight)) pounds" }
}
