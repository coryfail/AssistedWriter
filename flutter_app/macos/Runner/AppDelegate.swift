import Cocoa
import FlutterMacOS

@main
class AppDelegate: FlutterAppDelegate {
  private var preparingToQuit = false
  override func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
  override func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }
  override func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    if preparingToQuit { return .terminateLater }
    guard let controller = mainFlutterWindow?.contentViewController as? FlutterViewController else { return .terminateNow }
    preparingToQuit = true
    let channel = FlutterMethodChannel(name: "com.assistedwriter/lifecycle", binaryMessenger: controller.engine.binaryMessenger)
    channel.invokeMethod("prepareToQuit", arguments: nil) { [weak self] result in
      self?.preparingToQuit = false
      sender.reply(toApplicationShouldTerminate: (result as? Bool) == true)
    }
    return .terminateLater
  }
}
