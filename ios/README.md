# JustMy for iPhone

The native iOS app: a SwiftUI client of the token API. The spec is [`docs/ios-app.md`](../docs/ios-app.md), and the tracking epic is #66.

```
ios/
  JustMy.xcodeproj      the app project (iOS 27, iPhone only); folders are synced, so new files need no project edits
  JustMy/               the app: App/ (pairing, lock, Keychain), Shell/ (tabs, settings)
  JustMyTests/          unit tests for the app model and lock policy (Swift Testing)
  JMWClient/            local Swift package: one generated client per module, plus JMWClientSupport (auth, pairing)
  Tools/                pins swift-openapi-generator; build-time only
  scripts/              generate-client.sh
```

## Build and run

Open `ios/JustMy.xcodeproj` in Xcode 27 and run the **JustMy** scheme on an iOS 27 simulator.

From the command line:

```bash
xcodebuild -project ios/JustMy.xcodeproj -scheme JustMy -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=27.0' test
```

The JMWClient package tests run on the Mac:

```bash
swift test --package-path ios/JMWClient
```

## The API client

The generated client in `JMWClient/Sources/*API/Generated/` is committed. It's produced from the Zod-derived OpenAPI specs, so it's always downstream of `src/lib/{module}/schema.ts`. Regenerate it after any API schema change or any edit to `scripts/build-openapi.ts`:

```bash
ios/scripts/generate-client.sh
```

That runs `npm run openapi:build`, then the pinned generator. If `git diff` is clean afterwards, the client is in sync.

## Pairing

The app talks to the server only with a **device token** that holds the phone scopes (spec §3–4). The token lives in the Keychain, behind Face ID or the passcode, on this device only.

- **Production:** on justmy.website, go to Settings → Devices, choose "Pair a phone" (#69), and scan the QR code.
- **Until that page exists:**
  1. Mint a token with `npm run panel:token -- phone`.
  2. Paste it into the app, and set **Server** to the address you want.
- **Simulator + local dev server:**
  1. `npm run dev`.
  2. Mint a phone token.
  3. Launch with the pairing code in the environment. A simulator can't scan, and on iOS 27 simulators `simctl pbcopy` doesn't reach the pasteboard. DEBUG builds read `JMW_PAIRING` to prefill the field.

     ```bash
     SIMCTL_CHILD_JMW_PAIRING='{"v":1,"base":"http://localhost:3000","token":"jmw_…"}' xcrun simctl launch booted website.justmy.app
     ```

  `http://` is accepted only for `localhost`, `127.0.0.1` and `*.local` hosts. Production is always https.

Revoke a test token when you're done. Until #69 adds a revoke button, set `revoked_at` on its `device_tokens` row, or delete the row.

## Signing

The project ships with no `DEVELOPMENT_TEAM`. To run on your iPhone, pick your personal team under **Signing & Capabilities** in Xcode. With a free Apple ID the build expires after 7 days; rebuild from Xcode to renew it (spec §8).

The Face ID gate is only meaningful on a real device. The simulator doesn't enforce the Keychain item's `.userPresence` check, so it unlocks without a prompt.
