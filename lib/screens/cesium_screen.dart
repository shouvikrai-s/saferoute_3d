import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

class CesiumScreen extends StatefulWidget {
  const CesiumScreen({super.key});

  @override
  State<CesiumScreen> createState() => _CesiumScreenState();
}

class _CesiumScreenState extends State<CesiumScreen> {
  late final WebViewController controller;

  @override
  void initState() {
    super.initState();

    controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..loadHtmlString(_htmlCode());
  }

  String _htmlCode() {
    return '''
    <!DOCTYPE html>
    <html>
    <head>
      <script src="https://cesium.com/downloads/cesiumjs/releases/1.111/Build/Cesium/Cesium.js"></script>
      <link href="https://cesium.com/downloads/cesiumjs/releases/1.111/Build/Cesium/Widgets/widgets.css" rel="stylesheet">
      <style>
        html, body, #cesiumContainer {
          width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden;
        }
      </style>
    </head>
    <body>
      <div id="cesiumContainer"></div>
      <script>
        Cesium.Ion.defaultAccessToken = "YOUR_CESIUM_TOKEN";

        const viewer = new Cesium.Viewer('cesiumContainer', {
          terrainProvider: Cesium.createWorldTerrain(),
        });

        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(88.5293, 27.1744, 15000)
        });
      </script>
    </body>
    </html>
    ''';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("🌍 3D Earth View")),
      body: WebViewWidget(controller: controller),
    );
  }
}
