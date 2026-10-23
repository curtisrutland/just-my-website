import Foundation
import JMWClientSupport
import LocalAuthentication
import Security

/// Where the pairing lives (docs/ios-app.md §4.2). The protocol exists so AppModel can be tested
/// without a Keychain or Face ID.
protocol TokenStoring: Sendable {
    /// True when a pairing was saved. Cheap and prompt-free: it doesn't touch the token.
    var hasPairing: Bool { get }
    func save(_ pairing: PairingPayload) throws(TokenStoreError)
    /// Reading the token is what prompts Face ID (or the passcode).
    func load(reason: String) async throws(TokenStoreError) -> PairingPayload
    func delete()
}

enum TokenStoreError: Error, Equatable {
    case notFound
    /// The user dismissed the Face ID prompt.
    case cancelled
    /// Face ID ran and didn't match.
    case authFailed
    case unavailable(OSStatus)
}

/// One Keychain item behind `.userPresence`, readable only when the device has a passcode, on this
/// device only — never synced, never in UserDefaults, never logged. The server URL isn't a secret, so
/// it sits in UserDefaults beside it.
struct KeychainTokenStore: TokenStoring {
    private let service = "website.justmy.app.device-token"
    private let account = "device-token"
    private let baseKey = "pairing.base"
    /// The pairing's name (from the devices page) and when it was paired: shown in Settings, not secret.
    static let nameKey = "pairing.name"
    static let pairedAtKey = "pairing.pairedAt"

    var hasPairing: Bool {
        UserDefaults.standard.string(forKey: baseKey) != nil
    }

    func save(_ pairing: PairingPayload) throws(TokenStoreError) {
        delete()
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, &error
        ) else { throw .unavailable(errSecParam) }
        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessControl as String: access,
            kSecUseDataProtectionKeychain as String: true,
            kSecValueData as String: Data(pairing.token.utf8),
        ]
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw .unavailable(status) }
        UserDefaults.standard.set(pairing.base.absoluteString, forKey: baseKey)
        UserDefaults.standard.set(pairing.name, forKey: Self.nameKey)
        UserDefaults.standard.set(Date.now.timeIntervalSince1970, forKey: Self.pairedAtKey)
    }

    func load(reason: String) async throws(TokenStoreError) -> PairingPayload {
        guard let base = UserDefaults.standard.string(forKey: baseKey).flatMap(URL.init(string:)) else {
            throw .notFound
        }
        let (service, account) = (service, account)
        // SecItemCopyMatching blocks while Face ID runs, so keep it off the main actor.
        let result: Result<String, TokenStoreError> = await Task.detached {
            let context = LAContext()
            context.localizedReason = reason
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
                kSecUseDataProtectionKeychain as String: true,
                kSecUseAuthenticationContext as String: context,
                kSecReturnData as String: true,
            ]
            var out: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &out)
            switch status {
            case errSecSuccess:
                guard let data = out as? Data, let token = String(data: data, encoding: .utf8) else {
                    return .failure(.unavailable(errSecDecode))
                }
                return .success(token)
            case errSecItemNotFound: return .failure(.notFound)
            case errSecUserCanceled: return .failure(.cancelled)
            case errSecAuthFailed: return .failure(.authFailed)
            default: return .failure(.unavailable(status))
            }
        }.value
        switch result {
        case let .success(token):
            return PairingPayload(base: base, token: token, name: UserDefaults.standard.string(forKey: Self.nameKey))
        case let .failure(error): throw error
        }
    }

    func delete() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecUseDataProtectionKeychain as String: true,
        ]
        SecItemDelete(query as CFDictionary)
        UserDefaults.standard.removeObject(forKey: baseKey)
        UserDefaults.standard.removeObject(forKey: Self.nameKey)
        UserDefaults.standard.removeObject(forKey: Self.pairedAtKey)
    }
}
