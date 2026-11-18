import AppIntents

/// "Log my weight" (#101): Siri asks for the number, reads it back, and saves today's weigh-in
/// without opening the app. It always asks before saving, and says so when it would replace a
/// weigh-in already logged today. The phone must be unlocked; on a locked phone Siri asks for that
/// first, so nothing about your weight is said or written from the lock screen.
struct LogWeightIntent: AppIntent {
    static let title: LocalizedStringResource = "Log Weight"
    static let description = IntentDescription("Logs today's weigh-in to justmy.website, after confirming the number.")
    static let authenticationPolicy = IntentAuthenticationPolicy.requiresAuthentication

    @Parameter(title: "Weight", description: "Your weight in pounds.", requestValueDialog: "What's your weight?")
    var weight: Double

    static var parameterSummary: some ParameterSummary {
        Summary("Log a weigh-in of \(\.$weight) pounds")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let weighIn = SiriWeighIn(store: KeychainWeighInTokenStore())
        do {
            let question = try await weighIn.question(for: weight)
            // Throws if the answer is no, which ends the intent with nothing saved.
            try await requestConfirmation(dialog: IntentDialog(stringLiteral: question))
            return .result(dialog: IntentDialog(stringLiteral: try await weighIn.log(weight)))
        } catch let failure as SiriWeighIn.Failure {
            throw SpokenError(message: failure.spoken)
        }
    }
}

/// An error Siri reads out as written.
struct SpokenError: Error, CustomLocalizedStringResourceConvertible {
    let message: String
    var localizedStringResource: LocalizedStringResource { LocalizedStringResource(stringLiteral: message) }
}

/// Makes the phrases work with no setup, and lists the action in Shortcuts and Spotlight.
struct JustMyShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: LogWeightIntent(),
            phrases: [
                "Log my weight in \(.applicationName)",
                "Log a weigh-in in \(.applicationName)",
                "Weigh in with \(.applicationName)",
            ],
            shortTitle: "Log Weight",
            systemImageName: "scalemass"
        )
    }
}
