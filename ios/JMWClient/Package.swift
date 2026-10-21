// swift-tools-version: 6.4
// The generated API client (docs/ios-app.md §8): one target per module, each generated from that
// module's Zod-derived OpenAPI spec by ios/scripts/generate-client.sh. `JMWClientSupport` holds the
// hand-written glue — the bearer-token middleware and the one place clients are constructed.
import PackageDescription

let modules = ["MacrosAPI", "WeightAPI", "LiftingAPI", "RidesAPI", "VitalsAPI", "ShoppingAPI"]

let runtime: [Target.Dependency] = [
    .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
    .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
]

let package = Package(
    name: "JMWClient",
    platforms: [.iOS(.v27), .macOS(.v26)],
    products: [
        .library(name: "JMWClient", targets: ["JMWClientSupport"] + modules),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.0.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.0.0"),
    ],
    targets: modules.map {
        // Generated code (Generated/ is overwritten by generate-client.sh): its warnings aren't ours to fix.
        .target(name: $0, dependencies: runtime, swiftSettings: [.unsafeFlags(["-suppress-warnings"])])
    } + [
        .target(name: "JMWClientSupport", dependencies: runtime.map { $0 } + modules.map { .target(name: $0) }),
        .testTarget(name: "JMWClientSupportTests", dependencies: ["JMWClientSupport"]),
    ]
)
