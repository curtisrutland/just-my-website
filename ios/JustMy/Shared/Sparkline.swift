import Charts
import SwiftUI

/// A small Accent line with a dot on the last point; no axes, no score.
struct Sparkline: View {
    let values: [Double?]

    var body: some View {
        let points = values.enumerated().compactMap { i, v in v.map { (i, $0) } }
        Chart {
            ForEach(points, id: \.0) { i, v in
                LineMark(x: .value("i", i), y: .value("v", v))
                    .interpolationMethod(.monotone)
                    .lineStyle(StrokeStyle(lineWidth: 1.8, lineCap: .round))
            }
            if let last = points.last {
                PointMark(x: .value("i", last.0), y: .value("v", last.1)).symbolSize(22)
            }
        }
        .foregroundStyle(Color.accentColor)
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartYScale(domain: .automatic(includesZero: false))
        .accessibilityHidden(true)
    }
}
