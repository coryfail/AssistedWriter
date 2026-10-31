//
//  Generated file. Do not edit.
//

import FlutterMacOS
import Foundation

import auto_updater_macos
import file_picker_darwin
import flutter_secure_storage_darwin
import git2dart_binaries
import package_info_plus
import quill_native_bridge_macos
import screen_retriever_macos
import shared_preferences_foundation
import url_launcher_macos
import window_manager

func RegisterGeneratedPlugins(registry: FlutterPluginRegistry) {
  AutoUpdaterMacosPlugin.register(with: registry.registrar(forPlugin: "AutoUpdaterMacosPlugin"))
  FilePickerPlugin.register(with: registry.registrar(forPlugin: "FilePickerPlugin"))
  FlutterSecureStorageDarwinPlugin.register(with: registry.registrar(forPlugin: "FlutterSecureStorageDarwinPlugin"))
  Git2dartBinariesPlugin.register(with: registry.registrar(forPlugin: "Git2dartBinariesPlugin"))
  FPPPackageInfoPlusPlugin.register(with: registry.registrar(forPlugin: "FPPPackageInfoPlusPlugin"))
  QuillNativeBridgePlugin.register(with: registry.registrar(forPlugin: "QuillNativeBridgePlugin"))
  ScreenRetrieverMacosPlugin.register(with: registry.registrar(forPlugin: "ScreenRetrieverMacosPlugin"))
  SharedPreferencesPlugin.register(with: registry.registrar(forPlugin: "SharedPreferencesPlugin"))
  UrlLauncherPlugin.register(with: registry.registrar(forPlugin: "UrlLauncherPlugin"))
  WindowManagerPlugin.register(with: registry.registrar(forPlugin: "WindowManagerPlugin"))
}
