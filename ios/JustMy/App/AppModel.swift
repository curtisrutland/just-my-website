import Foundation
import JMWClientSupport
import Observation
import SwiftUI

/// The app's one piece of global state: whether it's paired, locked, or unlocked, plus the privacy
/// cover (docs/ios-app.md §4). Fetched data never lives here — it's held by the screens, in memory.
@Observable
final class AppModel {
    enum Phase {
        case unpaired(notice: String?)
        case locked
        case unlocked(Session)
    }

    enum PhaseKind: Equatable { case unpaired, locked, unlocked }

    struct Session {
        let pairing: PairingPayload
        let clients: JMWClients
    }

    /// One allowlisted read, so a token is proven before it's saved and re-proven on unlock.
    typealias Check = @Sendable (PairingPayload) async throws -> JMWClients.CheckResult

    private(set) var phase: Phase
    /// True whenever the scene isn't active, so the app-switcher snapshot shows the cover, not data.
    private(set) var isCovered = false
    private(set) var isBusy = false
    private(set) var errorMessage: String?

    private let store: any TokenStoring
    private let check: Check
    private let policy: LockPolicy
    private let now: () -> Date
    private var backgroundedAt: Date?

    init(store: any TokenStoring, check: @escaping Check, policy: LockPolicy = .init(), now: @escaping () -> Date = Date.init) {
        self.store = store
        self.check = check
        self.policy = policy
        self.now = now
        phase = store.hasPairing ? .locked : .unpaired(notice: nil)
    }

    static func live() -> AppModel {
        AppModel(store: KeychainTokenStore(), check: { try await JMWClients(pairing: $0).check() })
    }

    var phaseKind: PhaseKind {
        switch phase {
        case .unpaired: .unpaired
        case .locked: .locked
        case .unlocked: .unlocked
        }
    }

    var session: Session? {
        if case let .unlocked(session) = phase { session } else { nil }
    }

    /// Clients for an unlocked session. Any `401` from any module means the token was revoked, so
    /// it routes back here and the app returns to pairing.
    private func makeClients(_ pairing: PairingPayload) -> JMWClients {
        JMWClients(pairing: pairing, onUnauthorized: { [weak self] in
            Task { @MainActor in self?.handleUnauthorized() }
        })
    }

    // MARK: Pairing

    /// `fallbackBase` is only used when `text` is a bare token rather than the QR payload.
    func pair(text: String, fallbackBase: URL) async {
        errorMessage = nil
        let pairing: PairingPayload
        do {
            pairing = try PairingPayload.parse(text, fallbackBase: fallbackBase)
        } catch {
            errorMessage = Self.message(for: error)
            return
        }
        isBusy = true
        defer { isBusy = false }
        do {
            switch try await check(pairing) {
            case .ok:
                try store.save(pairing)
                phase = .unlocked(Session(pairing: pairing, clients: makeClients(pairing)))
            case .rejected:
                errorMessage = "The server rejected that token. It may be revoked, or not a phone token."
            case let .unexpected(code):
                errorMessage = "The server answered \(code). Check the server address."
            }
        } catch let error as TokenStoreError {
            errorMessage = "Couldn't save the token to the Keychain (\(error)). Is a device passcode set?"
        } catch {
            errorMessage = "Couldn't reach \(pairing.base.host() ?? "the server"): \(error.localizedDescription)"
        }
    }

    func unpair() {
        store.delete()
        errorMessage = nil
        phase = .unpaired(notice: nil)
    }

    /// Any 401 from the API: the token was revoked or lost its scope. Forget it and re-pair.
    func handleUnauthorized() {
        guard phaseKind != .unpaired else { return } // several in-flight reads may 401 together
        store.delete()
        phase = .unpaired(notice: "This iPhone's token was revoked. Pair it again to continue.")
    }

    // MARK: Locking

    func unlock() async {
        guard case .locked = phase, !isBusy else { return }
        errorMessage = nil
        isBusy = true
        defer { isBusy = false }
        let pairing: PairingPayload
        do {
            pairing = try await store.load(reason: "Unlock your data")
        } catch .notFound {
            store.delete()
            phase = .unpaired(notice: nil)
            return
        } catch .cancelled {
            return
        } catch {
            errorMessage = "Couldn't read the token (\(error))."
            return
        }
        phase = .unlocked(Session(pairing: pairing, clients: makeClients(pairing)))
        // Re-prove the token so a revocation shows up now, not on the first screen's fetch.
        // Offline is fine: stay unlocked and let the screens report the network.
        if case .rejected = try? await check(pairing) {
            handleUnauthorized()
        }
    }

    func scenePhaseChanged(to scenePhase: ScenePhase) {
        switch scenePhase {
        case .active:
            isCovered = false
            if case .unlocked = phase, policy.shouldLock(backgroundedAt: backgroundedAt, now: now()) {
                phase = .locked // drops the session: token and clients leave memory
            }
            backgroundedAt = nil
        case .inactive:
            isCovered = true
        case .background:
            isCovered = true
            if backgroundedAt == nil { backgroundedAt = now() }
        @unknown default:
            isCovered = true
        }
    }

    private static func message(for error: PairingPayload.ParseError) -> String {
        switch error {
        case .empty: "Paste the pairing code or a token first."
        case .malformed: "That doesn't look like a pairing code."
        case let .unsupportedVersion(v): "This pairing code is version \(v); update the app."
        case .badBase: "The server address must be https (http is allowed only for localhost or a .local host)."
        case .badToken: "That token isn't valid. Device tokens start with jmw_."
        }
    }
}
