import SwiftUI

/// Shown on launch and after five minutes away (docs/ios-app.md §4.3). Unlocking reads the token from
/// the Keychain, which is what prompts Face ID — the lock is the Secure Enclave's, not this view's.
struct LockView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "lock.fill")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("JustMy is locked")
                .font(.title2.weight(.semibold))
            if let error = model.errorMessage {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
            Spacer()
            Button {
                Task { await model.unlock() }
            } label: {
                Label("Unlock", systemImage: "faceid")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.isBusy)
        }
        .padding(24)
        .task { await model.unlock() }
    }
}

/// Covers the app whenever it isn't frontmost, so the app switcher shows this, not health data.
struct PrivacyCover: View {
    var body: some View {
        ZStack {
            Rectangle().fill(.background)
            Image(systemName: "lock.fill")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
        }
        .ignoresSafeArea()
    }
}
