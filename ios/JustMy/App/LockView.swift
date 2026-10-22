import SwiftUI

/// Shown on launch and after five minutes away (docs/ios-app.md §4.3). Unlocking reads the token from
/// the Keychain, which is what prompts Face ID — the lock is the Secure Enclave's, not this view's.
///
/// The app's mark in a dial of 60 ticks (handoff §5, Lock; boards `Lock-Scanning-Dark`,
/// `Lock-Checking-Dark`, `Lock-Dark`), in three beats: scanning, checking the token, and failed or
/// dismissed. It sits in the top third because iOS draws its own Face ID glyph at the center.
struct LockView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let beat = LockDial.Beat(model.unlockStage)
        VStack(spacing: 0) {
            LockMark(beat: beat, status: status)
            Spacer()
            if beat == .idle {
                VStack(spacing: 12) {
                    Button {
                        Task { await model.unlock() }
                    } label: {
                        Label("Unlock with Face ID", systemImage: "faceid")
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: 300, minHeight: 56)
                            .background(Color.accentColor, in: .capsule)
                            .foregroundStyle(Color(.systemBackground))
                    }
                    .buttonStyle(.plain)
                    Text("Face ID is asked on appear. This button is for when it was dismissed.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 72)
                .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 0.25), value: beat)
        .task { await model.unlock() }
    }

    private var status: LockMark.Status {
        switch model.unlockStage {
        case .scanning: .plain("Face ID")
        case .checking: .plain("Checking the token…")
        case .idle: model.errorMessage.map(LockMark.Status.error) ?? .plain("Locked")
        }
    }
}

/// Covers the app whenever it isn't frontmost, so the app switcher shows this, not health data. The
/// lock composition, static.
struct PrivacyCover: View {
    var body: some View {
        VStack(spacing: 0) {
            LockMark(beat: .idle, status: nil)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .ignoresSafeArea()
    }
}

/// The dial, the wordmark and the status line, positioned as the boards place them on an 874 pt screen.
private struct LockMark: View {
    enum Status: Equatable {
        case plain(String)
        case error(String)
    }

    let beat: LockDial.Beat
    let status: Status?

    var body: some View {
        VStack(spacing: 0) {
            LockDial(beat: beat)
                .padding(.top, 150)
            VStack(spacing: 6) {
                Text("JustMy").font(.title2.weight(.semibold))
                switch status {
                case let .plain(text):
                    Text(text).font(.subheadline).foregroundStyle(.secondary)
                case let .error(text):
                    Text(text).font(.subheadline).foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 300)
                        .accessibilityAddTraits(.updatesFrequently)
                case nil:
                    EmptyView()
                }
            }
            .padding(.top, 28)
        }
    }
}

/// 60 ticks (1.3° wide every 6°, radius 113–130) around the mark. Scanning sweeps a 110° arc of lit
/// ticks once per 1.8 s and the dot breathes; checking lights every tick with a slow fade; idle is
/// dim and still.
private struct LockDial: View {
    enum Beat: Equatable {
        case idle, scanning, checking

        init(_ stage: AppModel.UnlockStage) {
            switch stage {
            case .idle: self = .idle
            case .scanning: self = .scanning
            case .checking: self = .checking
            }
        }
    }

    let beat: Beat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: beat == .idle || reduceMotion)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            ZStack {
                Canvas { context, size in
                    draw(into: &context, size: size, t: t)
                }
                JMark(breathe: beat == .idle || reduceMotion ? 0 : (1 - cos(2 * .pi * t / 1.8)) / 2)
                    .frame(width: 128, height: 128)
            }
        }
        .frame(width: 260, height: 260)
        .accessibilityElement()
        .accessibilityLabel(beat == .idle ? "Locked" : "Unlocking")
    }

    private func draw(into context: inout GraphicsContext, size: CGSize, t: TimeInterval) {
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let dim = Color(.secondaryLabel).opacity(0.18)
        // Scanning: the lit arc's start, clockwise from 12 o'clock, one turn per 1.8 s.
        let sweepStart = (t / 1.8).truncatingRemainder(dividingBy: 1) * 360
        // Checking: 0.35 → 1, eased, alternating every 1.2 s.
        let phase = (t / 1.2).truncatingRemainder(dividingBy: 2)
        let settle = 0.35 + 0.65 * (1 - pow(1 - (phase < 1 ? phase : 2 - phase), 2))

        for i in 0..<60 {
            let start = Double(i) * 6
            context.fill(tick(at: start, center: center), with: .color(dim))
            if reduceMotion, beat != .idle {
                context.fill(tick(at: start, center: center), with: .color(.accentColor))
                continue
            }
            switch beat {
            case .idle:
                break
            case .scanning:
                let offset = (start - sweepStart + 360).truncatingRemainder(dividingBy: 360)
                if offset < 110 {
                    context.fill(tick(at: start, center: center), with: .color(.accentColor))
                }
            case .checking:
                context.fill(tick(at: start, center: center), with: .color(Color.accentColor.opacity(settle)))
            }
        }
    }

    /// One tick: an annular sector 1.3° wide, from radius 113 to 130, starting `degrees` clockwise
    /// from 12 o'clock.
    private func tick(at degrees: Double, center: CGPoint) -> Path {
        let a0 = Angle.degrees(degrees - 90), a1 = Angle.degrees(degrees + 1.3 - 90)
        var path = Path()
        path.addArc(center: center, radius: 130, startAngle: a0, endAngle: a1, clockwise: false)
        path.addArc(center: center, radius: 113, startAngle: a1, endAngle: a0, clockwise: true)
        path.closeSubpath()
        return path
    }
}

/// The app icon's mark (handoff §7): the "j" stroke in `label`, the dot in Accent. `breathe` 0…1
/// scales the dot to 1.18× and fades it to 75%.
private struct JMark: View {
    var breathe: Double = 0

    var body: some View {
        Canvas { context, size in
            let s = size.width / 1024
            context.scaleBy(x: s, y: s)
            var stroke = Path()
            stroke.move(to: CGPoint(x: 548, y: 292))
            stroke.addLine(to: CGPoint(x: 548, y: 652))
            stroke.addCurve(to: CGPoint(x: 398, y: 802), control1: CGPoint(x: 548, y: 742), control2: CGPoint(x: 486, y: 802))
            stroke.addCurve(to: CGPoint(x: 288, y: 764), control1: CGPoint(x: 354, y: 802), control2: CGPoint(x: 316, y: 788))
            context.stroke(stroke, with: .color(Color(.label).opacity(0.92)),
                           style: StrokeStyle(lineWidth: 104, lineCap: .round, lineJoin: .round))
            let r = 64 * (1 + 0.18 * breathe)
            context.fill(Path(ellipseIn: CGRect(x: 548 - r, y: 176 - r, width: 2 * r, height: 2 * r)),
                         with: .color(Color.accentColor.opacity(1 - 0.25 * breathe)))
        }
        .accessibilityHidden(true)
    }
}
