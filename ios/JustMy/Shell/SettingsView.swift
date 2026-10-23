import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var confirmUnpair = false
    @AppStorage(KeychainTokenStore.pairedAtKey) private var pairedAt: Double = 0

    var body: some View {
        NavigationStack {
            Form {
                Section("This iPhone") {
                    LabeledContent("Server") {
                        Text(model.session?.pairing.base.absoluteString ?? "—").monospaced()
                    }
                    LabeledContent("Paired", value: paired)
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

    /// `Curtis's iPhone · Oct 21`: the name from the devices page and the day it was paired here.
    /// A pairing from a bare token (or from before names) is `This iPhone`.
    private var paired: String {
        let name = model.session?.pairing.name ?? "This iPhone"
        guard pairedAt > 0 else { return name }
        return "\(name) · \(Format.monthDay(Format.iso(Date(timeIntervalSince1970: pairedAt))))"
    }

    private static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }
}
