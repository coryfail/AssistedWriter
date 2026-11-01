import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
  private var bookFolders: BookFolderAccess?
  override func awakeFromNib() {
    let controller = FlutterViewController()
    let windowFrame = frame
    contentViewController = controller
    setFrame(windowFrame, display: true)
    RegisterGeneratedPlugins(registry: controller)
    bookFolders = BookFolderAccess(messenger: controller.engine.binaryMessenger)
    super.awakeFromNib()
  }
}

final class BookFolderAccess {
  private var scopes: [String: URL] = [:]
  private let channel: FlutterMethodChannel
  init(messenger: FlutterBinaryMessenger) {
    channel = FlutterMethodChannel(name: "com.assistedwriter/book-folders", binaryMessenger: messenger)
    channel.setMethodCallHandler { [weak self] call, result in self?.handle(call, result) }
  }
  deinit { for url in scopes.values { url.stopAccessingSecurityScopedResource() } }
  private func handle(_ call: FlutterMethodCall, _ result: @escaping FlutterResult) {
    do {
      let args = call.arguments as? [String: Any]
      switch call.method {
      case "spelling":
        let word = args?["word"] as? String ?? ""
        guard !word.isEmpty, word.utf16.count <= 80 else { result([String]()); return }
        let checker = NSSpellChecker.shared
        let range = checker.checkSpelling(of: word, startingAt: 0)
        if range.location == NSNotFound { result([String]()); return }
        result(Array((checker.guesses(forWordRange: NSRange(location: 0, length: word.utf16.count), in: word, language: checker.language(), inSpellDocumentWithTag: 0) ?? []).prefix(6)))
      case "pick":
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.begin { [weak self] response in
          guard response == .OK, let url = panel.url, let self = self else { result(nil); return }
          do { try self.retainURL(url); try self.remember(url.path); result(url.path) }
          catch { result(FlutterError(code: "folder_access", message: error.localizedDescription, details: nil)) }
        }
      case "remember":
        guard let path = args?["path"] as? String else { result(FlutterError(code: "path", message: "Missing book path", details: nil)); return }
        try remember(path); result(nil)
      case "restore":
        guard let path = args?["path"] as? String else { result(nil); return }
        guard let record = UserDefaults.standard.dictionary(forKey: "writer.folder." + path), let data = record["bookmark"] as? Data else { result(path); return }
        var stale = false
        let url = try URL(resolvingBookmarkData: data, options: [.withSecurityScope], relativeTo: nil, bookmarkDataIsStale: &stale)
        try retainURL(url)
        let suffix = record["suffix"] as? String ?? ""
        let restored = suffix.isEmpty ? url.path : url.appendingPathComponent(suffix).path
        try remember(restored)
        result(restored)
      default: result(FlutterMethodNotImplemented)
      }
    } catch { result(FlutterError(code: "folder_access", message: error.localizedDescription, details: nil)) }
  }
  private func retainURL(_ url: URL) throws {
    if scopes[url.path] != nil { return }
    guard url.startAccessingSecurityScopedResource() || FileManager.default.isReadableFile(atPath: url.path) else {
      throw NSError(domain: "AssistedWriter", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot access this folder. Choose it again using Open book."])
    }
    scopes[url.path] = url
  }
  private func remember(_ path: String) throws {
    guard let scope = scopes.values.sorted(by: { $0.path.count > $1.path.count }).first(where: { path == $0.path || path.hasPrefix($0.path + "/") }) else { return }
    let suffix = path == scope.path ? "" : String(path.dropFirst(scope.path.count + 1))
    let data = try scope.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
    UserDefaults.standard.set(["bookmark": data, "suffix": suffix], forKey: "writer.folder." + path)
  }
}
