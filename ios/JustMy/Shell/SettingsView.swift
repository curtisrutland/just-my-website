import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var confirmUnpair = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    LabeledContent("Address", value: model.session?.pairing.base.absoluteString ?? "—")
                        .font(.body.monospaced())
                }
                Section {
                    LabeledContent("Lock", value: "After 5 min in the background")
                } header: {
                    Text("Security")
                } footer: {
                    Text("Revoke this iPhone from justmy.website (Settings → Devices) if it's lost.")
                }
                Section {
                    Button("Unpair this iPhone", role: .destructive) { confirmUnpair = true }
                }
                Section("About") {
                    LabeledContent("Version", value: Self.version)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .confirmationDialog("Unpair this iPhone?", isPresented: $confirmUnpair, titleVisibility: .visible) {
                Button("Unpair", role: .destructive) {
                    dismiss()
                    model.unpair()
                }
            } message: {
                Text("The token is deleted from this iPhone. Revoke it on the web too if you won't re-pair.")
            }
        }
    }

    private static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }
}
