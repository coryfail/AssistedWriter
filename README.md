# Assisted Writer

An author-led fiction writing studio built with Flutter for **macOS, Windows, and iOS** on branch `flutter-cross-platform`.

The Flutter app lives in [`flutter_app/`](flutter_app/README.md). It includes the rich Markdown editor, book and chapter management, notes/context and named story trackers, autosave and recovery, AI discussion and editorial approval workflows, Git, DOCX/EPUB/PDF exports, secure settings, and native platform integration.

```sh
cd flutter_app
flutter pub get
flutter run -d macos
```

Use `flutter run -d windows` on Windows or select an iOS simulator/device with `flutter devices`. Read the [Flutter setup and distribution instructions](flutter_app/README.md) and [verification status](flutter_app/docs/flutter-migration.md) before treating this branch as a release.

Books retain the existing readable Markdown files and `assisted-writer-1` manifest. Existing books can be opened without conversion to a private database.

The original Electron implementation and its Node tests remain as a behavior and file-format reference during migration. Its previous documentation is preserved in [the Electron reference](flutter_app/docs/electron-reference.md).
