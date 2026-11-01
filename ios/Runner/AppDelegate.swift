import Flutter
import UIKit
import UniformTypeIdentifiers

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var bookFolders: BookFolderAccess?
  override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "BookFolderAccess") {
      bookFolders = BookFolderAccess(messenger: registrar.messenger())
    }
  }
}

final class BookFolderAccess: NSObject, UIDocumentPickerDelegate {
  private var scopes: [String: URL] = [:]
  private var pending: FlutterResult?
  private let channel: FlutterMethodChannel
  init(messenger: FlutterBinaryMessenger) {
    channel = FlutterMethodChannel(name: "com.assistedwriter/book-folders", binaryMessenger: messenger)
    super.init()
    channel.setMethodCallHandler { [weak self] call, result in self?.handle(call, result) }
  }
  deinit { for url in scopes.values { url.stopAccessingSecurityScopedResource() } }
  private func handle(_ call: FlutterMethodCall, _ result: @escaping FlutterResult) {
    do {
      let args = call.arguments as? [String: Any]
      switch call.method {
      case "pick":
        guard pending == nil else { result(FlutterError(code: "busy", message: "A folder picker is already open.", details: nil)); return }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard var presenter = scenes.flatMap({ $0.windows }).first(where: { $0.isKeyWindow })?.rootViewController else { result(FlutterError(code: "window", message: "No active window", details: nil)); return }
        while let next = presenter.presentedViewController { presenter = next }
        pending = result
        presenter.present(picker, animated: true)
      case "remember":
        if let path = args?["path"] as? String { try remember(path) }
        result(nil)
      case "restore":
        guard let path = args?["path"] as? String else { result(nil); return }
        guard let record = UserDefaults.standard.dictionary(forKey: "writer.folder." + path), let data = record["bookmark"] as? Data else { result(path); return }
        var stale = false
        let url = try URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
        try retainURL(url)
        let suffix = record["suffix"] as? String ?? ""
        let restored = suffix.isEmpty ? url.path : url.appendingPathComponent(suffix).path
        try remember(restored)
        result(restored)
      default: result(FlutterMethodNotImplemented)
      }
    } catch { result(FlutterError(code: "folder_access", message: error.localizedDescription, details: nil)) }
  }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    let result = pending; pending = nil; result?(nil)
  }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    let result = pending; pending = nil
    guard let url = urls.first else { result?(nil); return }
    do { try retainURL(url); try remember(url.path); result?(url.path) }
    catch { result?(FlutterError(code: "folder_access", message: error.localizedDescription, details: nil)) }
  }
  private func retainURL(_ url: URL) throws {
    if scopes[url.path] != nil { return }
    guard url.startAccessingSecurityScopedResource() || (url.path.hasPrefix(NSHomeDirectory() + "/") && FileManager.default.isReadableFile(atPath: url.path)) else {
      throw NSError(domain: "AssistedWriter", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot access this folder. Choose it again using Open book."])
    }
    scopes[url.path] = url
  }
  private func remember(_ path: String) throws {
    guard let scope = scopes.values.sorted(by: { $0.path.count > $1.path.count }).first(where: { path == $0.path || path.hasPrefix($0.path + "/") }) else { return }
    let suffix = path == scope.path ? "" : String(path.dropFirst(scope.path.count + 1))
    let data = try scope.bookmarkData(options: [.minimalBookmark], includingResourceValuesForKeys: nil, relativeTo: nil)
    UserDefaults.standard.set(["bookmark": data, "suffix": suffix], forKey: "writer.folder." + path)
  }
}
