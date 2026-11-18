import JMWClientSupport
import SwiftUI
import WeightAPI

/// Log weight (docs/ios-design-handoff.md §5.2, board `WeightLog-Dark`). `POST /api/weight/entries`
/// is an upsert per day, so the sheet says when the chosen day already has a weigh-in and that
/// saving replaces it.
struct WeightLogSheet: View {
    /// Prefills the field; the latest weigh-in is the usual starting point.
    let latest: WeightEntry?
    let onSaved: () -> Void

    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss
    @State private var weight = ""
    @State private var day = Format.todayISO()
    @State private var note = ""
    @State private var existing: WeightEntry?
    @State private var saving = false
    @State private var error: String?
    @FocusState private var weightFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Card(background: Color(.tertiarySystemGroupedBackground)) {
                        VStack(alignment: .leading, spacing: 6) {
                            SectionTitle("Weight")
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                TextField("0.0", text: $weight)
                                    .font(.hero).tracking(-0.6).monospacedDigit()
                                    .keyboardType(.decimalPad)
                                    .focused($weightFocused)
                                    .fixedSize()
                                Text("lb").foregroundStyle(.secondary)
                            }
                        }
                    }
                    VStack(spacing: 0) {
                        HStack {
                            Text("Date")
                            Spacer()
                            DatePicker("Date", selection: date, in: ...Date.now, displayedComponents: .date)
                                .labelsHidden()
                                .environment(\.timeZone, Format.zone)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 5).frame(minHeight: 44)
                        Divider().padding(.leading, 16)
                        HStack(spacing: 16) {
                            Text("Note")
                            TextField("Optional", text: $note).multilineTextAlignment(.trailing)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 11).frame(minHeight: 44)
                    }
                    .background(Color(.tertiarySystemGroupedBackground), in: .rect(cornerRadius: 26))
                    if let error {
                        Text(error).font(.footnote).foregroundStyle(.red).padding(.horizontal, 16)
                    } else if let existing {
                        Text(replaceNotice(existing)).font(.footnote).foregroundStyle(.secondary)
                            .monospacedDigit().padding(.horizontal, 16)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .pageContent()
            }
            .background(Color(.secondarySystemGroupedBackground))
            .navigationTitle("Log weight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .fontWeight(.semibold)
                        .disabled(parsedWeight == nil || saving)
                }
            }
            .task(id: day) { await loadExisting() }
            .onAppear {
                if let latest { weight = Format.oneDecimal(latest.weight) }
            }
            // Focus after the sheet settles; focusing during the presentation is dropped.
            .task {
                try? await Task.sleep(for: .milliseconds(450))
                weightFocused = true
            }
        }
        .presentationDetents([.large])
    }

    /// The chosen day as a Chicago calendar date; the picker works in `Date`s.
    private var date: Binding<Date> {
        Binding(get: { Format.date(fromISO: day) ?? .now }, set: { day = Format.iso($0) })
    }

    private var parsedWeight: Double? { WeightInput.parse(weight) }

    private func replaceNotice(_ entry: WeightEntry) -> AttributedString {
        let whose = day == Format.todayISO() ? "Today" : Format.day(day)
        var number = AttributedString("\(Format.oneDecimal(entry.weight)) lb")
        number.foregroundColor = .primary
        return AttributedString("\(whose) already has ") + number
            + AttributedString(", logged at \(Format.time(entry.updatedAt)). Saving replaces it — one weigh-in per day.")
    }

    private func loadExisting() async {
        guard let api else { return }
        existing = try? await api.weight.getApiWeightDaysDate(.init(path: .init(date: day))).ok.body.json
    }

    private func save() async {
        guard let api, let value = parsedWeight else { return }
        saving = true
        error = nil
        defer { saving = false }
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        error = await api.logWeight(value, on: day, note: trimmed.isEmpty ? nil : trimmed)
        if error == nil {
            onSaved()
            dismiss()
        }
    }
}
