import SwiftUI

@main
struct JustMyApp: App {
    @State private var model = AppModel.live()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .onChange(of: scenePhase, initial: true) { _, phase in
                    model.scenePhaseChanged(to: phase)
                }
        }
    }
}

/// Pair → lock → tabs (docs/ios-app.md §4). The privacy cover sits over all of it whenever the app
/// isn't frontmost, so the app-switcher snapshot never shows data.
struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            switch model.phase {
            case let .unpaired(notice):
                PairView(notice: notice)
            case .locked:
                LockView().transition(.opacity)
            case .unlocked:
                RootTabView().transition(.opacity)
            }
            if model.isCovered {
                PrivacyCover()
            }
        }
        // Unlocking cross-dissolves into the app (handoff §5, Lock).
        .animation(.easeInOut(duration: 0.25), value: model.phaseKind)
    }
}
