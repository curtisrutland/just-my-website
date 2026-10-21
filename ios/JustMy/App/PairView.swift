import JMWClientSupport
import SwiftUI
import VisionKit

/// First launch, and after an unpair or a revocation (docs/ios-app.md §4.1): scan the QR from
/// /settings/devices, or paste the code / a bare token.
struct PairView: View {
    let notice: String?

    @Environment(AppModel.self) private var model
    @State private var text = Self.launchPrefill
    @State private var server = PairingPayload.defaultBase.absoluteString
    @State private var isScanning = false

    /// DEBUG only: a simulator can't scan, so `xcrun simctl launch` can hand the pairing code in via
    /// `SIMCTL_CHILD_JMW_PAIRING` (see ios/README.md). It only fills the field — pairing still goes
    /// through the server check. Compiled out of release builds.
    private static var launchPrefill: String {
        #if DEBUG
        ProcessInfo.processInfo.environment["JMW_PAIRING"] ?? ""
        #else
        ""
        #endif
    }

    private var canScan: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    var body: some View {
        NavigationStack {
            Form {
                if let notice {
                    Section {
                        Label(notice, systemImage: "exclamationmark.shield")
                            .foregroundStyle(.orange)
                    }
                }

                Section {
                    Button {
                        isScanning = true
                    } label: {
                        Label("Scan pairing code", systemImage: "qrcode.viewfinder")
                    }
                    .disabled(!canScan)
                } footer: {
                    Text(canScan
                        ? "On justmy.website, open Settings → Devices and pair a phone."
                        : "This device can't scan codes. Paste the code or token below.")
                }

                Section {
                    TextField("Pairing code or jmw_ token", text: $text, axis: .vertical)
                        .lineLimit(3...6)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.body.monospaced())
                    PasteButton(payloadType: String.self) { strings in
                        if let first = strings.first { text = first }
                    }
                } header: {
                    Text("Or paste")
                } footer: {
                    Text("A bare token comes from `npm run panel:token -- phone`.")
                }

                Section {
                    TextField("Server", text: $server)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.body.monospaced())
                } header: {
                    Text("Server")
                } footer: {
                    Text("Used only for a bare token; the pairing code carries its own server.")
                }

                if let error = model.errorMessage {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }

                Section {
                    Button {
                        Task { await submit(text) }
                    } label: {
                        HStack {
                            Text("Pair this iPhone")
                            Spacer()
                            if model.isBusy { ProgressView() }
                        }
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isBusy)
                }
            }
            .navigationTitle("Pair this iPhone")
            .sheet(isPresented: $isScanning) {
                QRScanner { payload in
                    isScanning = false
                    text = payload
                    Task { await submit(payload) }
                }
                .ignoresSafeArea()
            }
        }
    }

    private func submit(_ value: String) async {
        let fallback = URL(string: server.trimmingCharacters(in: .whitespaces)) ?? PairingPayload.defaultBase
        await model.pair(text: value, fallbackBase: fallback)
    }
}

/// VisionKit's live scanner, QR codes only; reports the first code it recognizes.
private struct QRScanner: UIViewControllerRepresentable {
    let onScan: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        private let onScan: (String) -> Void
        private var done = false

        init(onScan: @escaping (String) -> Void) { self.onScan = onScan }

        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !done else { return }
            for case let .barcode(code) in items {
                if let payload = code.payloadStringValue {
                    done = true
                    scanner.stopScanning()
                    onScan(payload)
                    return
                }
            }
        }
    }
}
