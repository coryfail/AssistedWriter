import 'dart:convert';
import 'dart:io';

import 'package:image/image.dart' as img;

void main() {
  final source = img.decodePng(
    File('../assets/icon-1024.png').readAsBytesSync(),
  )!;
  for (final root in [
    'macos/Runner/Assets.xcassets/AppIcon.appiconset',
    'ios/Runner/Assets.xcassets/AppIcon.appiconset',
  ]) {
    final manifest =
        jsonDecode(File('$root/Contents.json').readAsStringSync()) as Map;
    for (final entry in manifest['images'] as List) {
      if (entry['filename'] == null) continue;
      final scale = double.parse(
        (entry['scale'] as String? ?? '1x').replaceAll('x', ''),
      );
      final width =
          (double.parse((entry['size'] as String).split('x').first) * scale)
              .round();
      final resized = img.copyResize(
        source,
        width: width,
        height: width,
        interpolation: img.Interpolation.average,
      );
      File('$root/${entry['filename']}')
          .writeAsBytesSync(img.encodePng(resized));
    }
  }
  File('windows/runner/resources/app_icon.ico').writeAsBytesSync(
    img.encodeIco(
      img.copyResize(
        source,
        width: 256,
        height: 256,
        interpolation: img.Interpolation.average,
      ),
    ),
  );
}
