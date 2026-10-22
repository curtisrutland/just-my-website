import JMWClientSupport
import SwiftUI

extension EnvironmentValues {
    /// The unlocked session's clients. Screens only exist while unlocked, so this is set whenever
    /// a screen reads it.
    @Entry var api: JMWClients? = nil
}
