import AppKit

let destination = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "assets/icon-1024.png"
let side = 1024
guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { fatalError("Unable to create icon bitmap") }
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: side, height: side).fill()
let tile = NSBezierPath(roundedRect: NSRect(x: 56, y: 56, width: 912, height: 912), xRadius: 215, yRadius: 215)
NSColor(calibratedRed: 0.35, green: 0.21, blue: 0.19, alpha: 1).setFill()
tile.fill()
let border = NSBezierPath(roundedRect: NSRect(x: 81, y: 81, width: 862, height: 862), xRadius: 198, yRadius: 198)
border.lineWidth = 2
NSColor(calibratedRed: 0.78, green: 0.62, blue: 0.49, alpha: 0.55).setStroke()
border.stroke()
let font = NSFont(name: "Palatino-Bold", size: 333) ?? NSFont.systemFont(ofSize: 333, weight: .semibold)
let text = NSAttributedString(string: "AW", attributes: [.font: font, .foregroundColor: NSColor(calibratedRed: 0.97, green: 0.93, blue: 0.85, alpha: 1), .kern: -24])
let bounds = text.size()
text.draw(at: NSPoint(x: (CGFloat(side) - bounds.width) / 2 - 12, y: (CGFloat(side) - bounds.height) / 2 - 32))
let star = NSBezierPath()
star.move(to: NSPoint(x: 772, y: 813))
star.curve(to: NSPoint(x: 798, y: 786), controlPoint1: NSPoint(x: 777, y: 795), controlPoint2: NSPoint(x: 786, y: 788))
star.curve(to: NSPoint(x: 772, y: 758), controlPoint1: NSPoint(x: 783, y: 784), controlPoint2: NSPoint(x: 776, y: 773))
star.curve(to: NSPoint(x: 746, y: 786), controlPoint1: NSPoint(x: 769, y: 774), controlPoint2: NSPoint(x: 759, y: 783))
star.curve(to: NSPoint(x: 772, y: 813), controlPoint1: NSPoint(x: 760, y: 790), controlPoint2: NSPoint(x: 770, y: 798))
star.close()
NSColor(calibratedRed: 0.91, green: 0.68, blue: 0.48, alpha: 1).setFill()
star.fill()
NSGraphicsContext.restoreGraphicsState()
guard let data = bitmap.representation(using: .png, properties: [:]) else { fatalError("Unable to encode icon PNG") }
try data.write(to: URL(fileURLWithPath: destination))
