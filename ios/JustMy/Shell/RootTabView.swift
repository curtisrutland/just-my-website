import SwiftUI

/// The four tabs (docs/ios-app.md §5, decided 2026-10-21). Screens are placeholders until the read
/// views land (#73); the shape — tabs, segmented pairs, a NavigationStack each — is final.
struct RootTabView: View {
    var body: some View {
        TabView {
            Tab("Macros", systemImage: "fork.knife") {
                ModuleStack(title: "Macros") {
                    Placeholder(title: "Macros", systemImage: "fork.knife")
                }
            }
            Tab("Body", systemImage: "figure") {
                SegmentedTab(title: "Body", first: ("Weight", "scalemass"), second: ("Vitals", "heart.text.square"))
            }
            Tab("Training", systemImage: "dumbbell") {
                SegmentedTab(title: "Training", first: ("Lifting", "dumbbell"), second: ("Rides", "bicycle"))
            }
            Tab("Shopping", systemImage: "cart") {
                ModuleStack(title: "Shopping") {
                    Placeholder(title: "Shopping", systemImage: "cart")
                }
            }
        }
    }
}

/// A tab's NavigationStack with the shared Settings button.
private struct ModuleStack<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(title)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Settings", systemImage: "gearshape") { showSettings = true }
                    }
                }
                .sheet(isPresented: $showSettings) { SettingsView() }
        }
    }
}

/// Body and Training: two modules behind a segmented control.
private struct SegmentedTab: View {
    let title: String
    let first: (String, String)
    let second: (String, String)
    @State private var selection = 0

    var body: some View {
        ModuleStack(title: title) {
            Group {
                if selection == 0 {
                    Placeholder(title: first.0, systemImage: first.1)
                } else {
                    Placeholder(title: second.0, systemImage: second.1)
                }
            }
            .safeAreaInset(edge: .top) {
                Picker(title, selection: $selection) {
                    Text(first.0).tag(0)
                    Text(second.0).tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
            }
        }
    }
}

private struct Placeholder: View {
    let title: String
    let systemImage: String

    var body: some View {
        ContentUnavailableView(title, systemImage: systemImage, description: Text("Arrives with the read views (#73)."))
    }
}
