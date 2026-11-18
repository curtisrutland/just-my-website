import Foundation
import JMWClientSupport
import Security

/// Where the weigh-in token lives (docs/ios-app.md §4.2): the narrow credential Siri logs a weight
/// with. The protocol exists so the model and the Siri flow can be tested without a Keychain.
protocol WeighInTokenStoring: Sendable {
    /// Prompt-free: readable whenever the phone is unlocked.
    func load() -> PairingPayload?
    /// Best-effort; a failed save just means Siri says to open the app.
    func save(_ pairing: PairingPayload)
    func delete()
}

/// A second Keychain item, deliberately weaker than the pairing's: readable while the phone is
/// unlocked, with no Face ID, because an intent running behind Siri can't raise a Face ID prompt.
/// What it guards is correspondingly small: a token that can log and read weigh-ins and nothing
/// else. This device only, never synced. The server address rides inside the item, so the intent
/// needs nothing else to run.
struct KeychainWeighInTokenStore: WeighInTokenStoring {
    private let service = "website.justmy.app.weigh-in-token"
    private let account = "weigh-in-token"

    private struct Stored: Codable {
        let base: URL
        let token: String
    }

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    func load() -> PairingPayload? {
        var read = query
        read[kSecReturnData as String] = true
        var out: CFTypeRef?
        guard SecItemCopyMatching(read as CFDictionary, &out) == errSecSuccess, let data = out as? Data,
              let stored = try? JSONDecoder().decode(Stored.self, from: data) else { return nil }
        return PairingPayload(base: stored.base, token: stored.token)
    }

    func save(_ pairing: PairingPayload) {
        delete()
        guard let data = try? JSONEncoder().encode(Stored(base: pairing.base, token: pairing.token)) else { return }
        var item = query
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        item[kSecValueData as String] = data
        SecItemAdd(item as CFDictionary, nil)
    }

    func delete() {
        SecItemDelete(query as CFDictionary)
    }
}

/// How the app gets and keeps its weigh-in token: the store, and the one server call that mints one.
struct WeighInSetup: Sendable {
    let store: any WeighInTokenStoring
    /// Asks the server, as the phone, for a weigh-in token. nil when the server refuses.
    let mint: @Sendable (PairingPayload) async throws -> String?

    static let live = WeighInSetup(store: KeychainWeighInTokenStore()) { pairing in
        try await JMWClients(pairing: pairing).mintWeighInToken()
    }
}
