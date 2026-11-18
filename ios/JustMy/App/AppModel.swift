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

    /// Where an unlock is (handoff §5, Lock): Face ID scanning, then the one token check before
    /// the app opens. `idle` while locked means the prompt failed or was dismissed.
    enum UnlockStage: Equatable { case idle, scanning }

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
    private(set) var unlockStage = UnlockStage.idle

    private let store: any TokenStoring
    private let check: Check
    private let weighIn: WeighInSetup?
    private let policy: LockPolicy
    private let now: () -> Date
    private var backgroundedAt: Date?
    /// The background token check started by the last unlock (exposed for tests).
    private(set) var revalidation: Task<Void, Never>?
    /// The weigh-in token being fetched, if one was missing (exposed for tests).
    private(set) var provisioning: Task<Void, Never>?
    /// Whether Siri has what it needs to log a weigh-in; Settings shows it.
    private(set) var siriWeighInReady = false

    init(store: any TokenStoring, check: @escaping Check, weighIn: WeighInSetup? = nil,
         policy: LockPolicy = .init(), now: @escaping () -> Date = Date.init) {
        self.store = store
        self.check = check
        self.weighIn = weighIn
        self.policy = policy
        self.now = now
        phase = store.hasPairing ? .locked : .unpaired(notice: nil)
    }

    static func live() -> AppModel {
        AppModel(store: KeychainTokenStore(), check: { try await JMWClients(pairing: $0).check() }, weighIn: .live)
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
                weighIn?.store.delete() // a weigh-in token from an earlier pairing belongs to that phone token
                phase = .unlocked(Session(pairing: pairing, clients: makeClients(pairing)))
                provisionWeighIn(for: pairing)
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
        forgetWeighIn()
        errorMessage = nil
        phase = .unpaired(notice: nil)
    }

    /// Any 401 from the API: the token was revoked or lost its scope. Forget it and re-pair.
    func handleUnauthorized() {
        guard phaseKind != .unpaired else { return } // several in-flight reads may 401 together
        store.delete()
        forgetWeighIn()
        phase = .unpaired(notice: "This iPhone's token was revoked. Pair it again to continue.")
    }

    // MARK: Locking

    func unlock() async {
        guard case .locked = phase, !isBusy else { return }
        errorMessage = nil
        isBusy = true
        unlockStage = .scanning
        defer {
            isBusy = false
            unlockStage = .idle
        }
        let pairing: PairingPayload
        do {
            pairing = try await store.load(reason: "Unlock your data")
        } catch .notFound {
            store.delete()
            phase = .unpaired(notice: nil)
            return
        } catch .cancelled {
            return
        } catch .authFailed {
            errorMessage = "Face ID didn’t match. Try again, or use your passcode."
            return
        } catch {
            errorMessage = "Couldn't read the token (\(error))."
            return
        }
        // Open now and prove the token in the background (#115): waiting on the server here was
        // the pause after every Face ID. A revoked token still unpairs, from this check or from the
        // first screen's 401, a beat later instead of before the app shows. Offline just opens.
        phase = .unlocked(Session(pairing: pairing, clients: makeClients(pairing)))
        let check = self.check
        revalidation = Task {
            guard case .rejected = try? await check(pairing), session?.pairing == pairing else { return }
            handleUnauthorized()
        }
        provisionWeighIn(for: pairing)
    }

    // MARK: Siri weigh-in

    /// Makes sure Siri has a weigh-in token (docs/ios-app.md §3.3.7, §4.2). The phone's own token is
    /// only in hand while the app is unlocked, so this is the moment to ask for the narrow one: once,
    /// then it sits in its own Keychain item until this phone is unpaired or the token is revoked.
    /// Quiet on failure — offline or refused just means Siri says to open the app, and the next
    /// unlock tries again.
    private func provisionWeighIn(for pairing: PairingPayload) {
        guard let weighIn else { return }
        if weighIn.store.load()?.base == pairing.base {
            siriWeighInReady = true
            return
        }
        provisioning = Task {
            guard let token = try? await weighIn.mint(pairing), session?.pairing == pairing else { return }
            weighIn.store.save(PairingPayload(base: pairing.base, token: token))
            siriWeighInReady = weighIn.store.load() != nil
        }
    }

    private func forgetWeighIn() {
        provisioning?.cancel()
        weighIn?.store.delete()
        siriWeighInReady = false
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
