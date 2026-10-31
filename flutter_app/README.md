# Assisted Writer — Flutter

The native application targets macOS, Windows, and iOS. It uses Dart services and Flutter widgets; Electron and Node.js are not required to run it. The original implementation remains in the parent repository as a compatibility reference.

Requires Flutter 3.47.9 / Dart 3.13.7 or compatible newer stable tooling. Platform targets are macOS 12+, Windows 10 x64, and iOS 15+.

```sh
flutter pub get
flutter run -d macos
# On Windows:
flutter run -d windows
# For an attached iPhone or installed simulator:
flutter devices
flutter run -d <device-id>
```

Apple builds require Xcode and CocoaPods. iPhone installation and App Store/TestFlight distribution additionally require your Apple signing configuration. Windows builds require Visual Studio's Desktop development with C++ workload, including ATL.

## Writing and book compatibility

Open an existing book folder or create a new one. `book.json` keeps the authoritative chapter order and stable IDs. Chapters, notes, context, named trackers, editorial reports, and exports retain the existing `assisted-writer-1` format. The Flutter tests include opening a newly created Flutter book through the existing Node reader.

The editor supports formatted Markdown, bold, italic, strikethrough, headings, quotes, lists, scene breaks, undo/redo, selection, copy/paste, and source mode. Unsupported structures and tracker markers default to source mode to preserve their text. macOS selection menus include system spelling suggestions. External writing-assistant integration depends on that assistant's support for Flutter accessibility and the operating system.

Changes autosave after a short pause. Saves check revisions before replacing files. If a file changes externally, the app preserves the draft and asks you to resolve the conflict. A local recovery copy is kept in app preferences while a document is unsaved. Reloading and discarding removes that recovery copy. Drafts are not part of the manuscript exports or Git repository.

Characters and Locations retain stable marked entries and freeform text outside those entries. Legacy books receive missing context/tracker files and current author-led guidance without replacing custom instructions or existing notes.

## AI and credentials

Enter your OpenAI API key in Settings. It is stored using the platform's secure storage and never written into the book. The initial model remains `gpt-6-astra`; Settings allows changing it to a model available to your account. Requests occur only after an explicit assistant action.

Discussion history, relevant chapters, notes, context, trackers, and `AGENTS.md` are assembled as in the original app. Reviews are saved under `editorial/`. An edit requires both the reviewed chapter hash and an exact unique quote. Notes require individual approval and append to their selected destination or stable tracker entry. API responses that are incomplete or refused never become edits.

Mac recent-book paths are imported from the old app when available. The Electron-encrypted API key is preserved in the old application's data directory but is not decrypted by Flutter; enter it once in the new Settings screen.

## Git

The panel provides initialization, status, diffs, selected-file commits, branch creation/switching, origin setup, fetch, push, fast-forward-only pull, and editable AI commit-message drafts. Pending writing is saved first. Branch changes and pulls require a clean working tree. Unrelated staged files are preserved by selected-file commits.

macOS and Windows prefer the installed Git client and its credential helpers. Windows falls back to bundled libgit2 when Git is unavailable. iOS uses libgit2. Native credentials in Settings support HTTPS tokens and SSH key pairs. Credentials are scoped to the configured server hostname. SSH connections use the server's published SHA256 host-key fingerprint when a native `known_hosts` trust decision is unavailable. Private keys, passphrases, and tokens stay in secure storage. Desktop Git continues to support configured SSH agents and credential helpers.

The macOS CocoaPods integration intentionally omits the unused mobile Git dylib, so that upstream binary does not raise the desktop app's minimum OS version.

## Exports

Export controls produce DOCX, EPUB 3, or a 6 × 9 inch PDF interior. Only ordered manuscript chapters are included. Inline formatting, headings, list text, scene breaks, and quotes are carried through; the PDF embeds the repository's licensed Libre Baskerville fonts. Notes, context, agent guidance, and editorial reports are excluded. Preview publication files in the target publishing tools before publication.

## Updates and release builds

Desktop update windows use Sparkle on macOS and WinSparkle on Windows, including their download progress and restart confirmation. Native quit handling saves writing first. iOS updates are distributed through the App Store or TestFlight.

Development builds have no update feed configured. Configure a signed feed for distribution:

1. Generate and securely retain platform-specific signing keys using `dart run auto_updater:generate_keys` on each desktop platform, following the package's signing procedure.
2. Set `SUPublicEDKey` in `macos/Runner/Info.plist` to the macOS public EdDSA key, replacing the build-setting reference or supplying that build setting. For Windows, place the public DSA key at `dsa_pub.pem` in this directory. The runner includes it only when present. Private signing material is ignored by Git.
3. Build with `--dart-define=UPDATE_FEED_URL=https://your-host/appcast.xml`. Use an increasing `--build-number` for macOS and increase the application version for every Windows release. Set `--dart-define=IOS_STORE_URL=https://apps.apple.com/...` for a published iOS application.
4. Sign and notarize the macOS bundle using your Developer ID. Sign the Windows installer with your distribution certificate. For an existing Electron-to-Flutter Mac update, keep bundle ID `com.assistedwriter.desktop`, product name `Assisted Writer`, the same signing identity, and publish a higher application version.
5. Create the Windows installer with Inno Setup: `ISCC /DAppVersion=<version> windows/installer.iss`. The setup installs per user and includes all Flutter runtime files.
6. Sign the macOS ZIP and Windows installer with their updater keys. Then run `tool/release_metadata.py --help` to produce the appcast, SHA-256 checksums, and transitional `latest-mac.yml` for existing Electron clients. Publish those files alongside the signed artifacts only after verification.

The Flutter CI workflow builds desktop artifacts and unsigned iOS targets; it does not publish a release or install production signing credentials. See [migration status](docs/flutter-migration.md) for the actual checks completed in this workspace.

## Verification

```sh
flutter analyze
flutter test
flutter build macos --release
flutter build windows --release
flutter build ios --simulator --debug
flutter build ios --release --no-codesign
```

Tests use temporary book repositories and mocked OpenAI responses. They do not send manuscripts to an external service or incur API charges. Tests include local-remote push/fetch/pull through both Git backends. Windows validation is provided by `.github/workflows/flutter.yml` and still needs an actual Windows CI or local run.

On macOS, building inside a synced/file-provider Documents folder can attach Finder metadata to generated bundles and make code signing fail. A source copy outside that folder (for example under `/private/tmp`) avoids that workspace-specific issue; this was used for native build verification here.
