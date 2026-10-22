// swift-tools-version: 6.0
// Build-time tooling only: pins swift-openapi-generator so `ios/scripts/generate-client.sh` runs the
// same generator version on every machine. Nothing here ships in the app.
import PackageDescription

let package = Package(
    name: "Tools",
    platforms: [.macOS(.v15)],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.0.0"),
    ]
)
