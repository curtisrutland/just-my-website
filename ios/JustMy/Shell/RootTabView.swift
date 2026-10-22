import SwiftUI

/// The four tabs (docs/ios-app.md §5; docs/ios-design-handoff.md §4). Body and Training put two
/// modules behind a segmented control; Training opens on Rides and remembers the last choice.
struct RootTabView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        TabView {
            Tab("Macros", systemImage: "fork.knife") {
                ModuleStack { MacrosView() }
            }
            Tab("Body", systemImage: "figure") {
                ModuleStack { BodyView() }
            }
            Tab("Training", systemImage: "figure.outdoor.cycle") {
                ModuleStack { TrainingView() }
            }
            Tab("Shopping", systemImage: "cart") {
                ModuleStack { ShoppingView() }
            }
        }
        .environment(\.api, model.session?.clients)
    }
}

/// A tab's NavigationStack with the shared Settings gear (leading, on each tab's top screen).
private struct ModuleStack<Content: View>: View {
    @ViewBuilder let content: Content
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            content
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Settings", systemImage: "gearshape") { showSettings = true }
                    }
                }
                .sheet(isPresented: $showSettings) { SettingsView() }
        }
    }
}

/// Body: Weight | Vitals.
struct BodyView: View {
    @AppStorage("body.segment") private var segment = BodySegment.weight

    var body: some View {
        // The segmented control scrolls with each screen's content (under the large title) rather
        // than sitting in a safe-area inset, which displaces the large title.
        let header = SegmentBar(selection: $segment)
        Group {
            switch segment {
            case .weight: WeightView(header: header)
            case .vitals: VitalsView(header: header)
            }
        }
        .navigationTitle("Body")
    }
}

enum BodySegment: String, CaseIterable, Identifiable {
    case weight = "Weight", vitals = "Vitals"
    var id: Self { self }
}

/// Training: Lifting | Rides — Rides by default (lifting is deliberately dormant).
struct TrainingView: View {
    @AppStorage("training.segment") private var segment = TrainingSegment.rides

    var body: some View {
        let header = SegmentBar(selection: $segment)
        Group {
            switch segment {
            case .lifting: LiftingView(header: header)
            case .rides: RidesView(header: header)
            }
        }
        .navigationTitle("Training")
    }
}

enum TrainingSegment: String, CaseIterable, Identifiable {
    case lifting = "Lifting", rides = "Rides"
    var id: Self { self }
}

struct SegmentBar<Segment: Hashable & Identifiable & RawRepresentable & CaseIterable>: View
where Segment.RawValue == String, Segment.AllCases: RandomAccessCollection {
    @Binding var selection: Segment

    var body: some View {
        Picker("Section", selection: $selection) {
            ForEach(Segment.allCases) { Text($0.rawValue).tag($0) }
        }
        .pickerStyle(.segmented)
    }
}

