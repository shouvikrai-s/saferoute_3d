import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:local_assets_server/local_assets_server.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:flutter_tts/flutter_tts.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final server = LocalAssetsServer(
    address: InternetAddress.loopbackIPv4,
    assetsBasePath: 'assets/cesium',
    logger: const DebugLogger(),
  );

  await server.serve();

  final int port = server.boundPort!;

  runApp(MyApp(port: port));
}

class MyApp extends StatelessWidget {
  final int port;

  const MyApp({
    super.key,
    required this.port,
  });

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: CesiumPage(port: port),
    );
  }
}

class CesiumPage extends StatefulWidget {
  final int port;

  const CesiumPage({
    super.key,
    required this.port,
  });

  @override
  State<CesiumPage> createState() => _CesiumPageState();
}

class _CesiumPageState extends State<CesiumPage> {
  late final WebViewController controller;
  StreamSubscription<Position>? _positionStreamSubscription;
  Timer? _locationUpdateTimer;
  Position? _pendingLocationUpdate;
  bool _locationUpdateInProgress = false;
  bool _locationSetupInProgress = false;
  bool _hasInitialLocation = false;

  // ===================================================================
  // NATIVE ANDROID TTS BRIDGE
  // Android WebView does NOT implement window.speechSynthesis — a
  // known, long-standing Chromium/WebView limitation (confirmed via
  // the Chromium bug tracker, issue "Support for Web Speech API in
  // Android WebView", open for years with no fix shipped). So instead
  // of a browser Web Speech API, HelloWorld.html's speak() function
  // sends text through a JavaScriptChannel named "SafeRouteTTS", and
  // Flutter speaks it using flutter_tts, which wraps Android's real
  // native TextToSpeech engine — the same one the rest of the OS uses.
  // ===================================================================
  final FlutterTts _flutterTts = FlutterTts();
  bool _ttsReady = false;
  Future<void>? _ttsInitialization;

  @override
  void initState() {
    super.initState();

    _ttsInitialization = _initTts();

    controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..enableZoom(false)
      ..setBackgroundColor(Colors.black)
      ..setOnConsoleMessage((JavaScriptConsoleMessage message) {
        debugPrint("JS CONSOLE: ${message.message}");
      })
      ..addJavaScriptChannel(
        'SafeRouteTTS',
        onMessageReceived: (JavaScriptMessage message) {
          _speakNative(message.message);
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (NavigationRequest request) async {
            // Any link that ISN'T our own local Cesium app (which is
            // always served from 127.0.0.1) should open externally —
            // in the phone's real browser or dialer — rather than
            // trying to load inside this small map WebView.
            final isLocalApp = request.url.startsWith('http://127.0.0.1');

            if (!isLocalApp) {
              final uri = Uri.parse(request.url);
              if (await canLaunchUrl(uri)) {
                await launchUrl(
                  uri,
                  mode: LaunchMode.externalApplication,
                );
              } else {
                debugPrint("Could not launch: ${request.url}");
              }
              return NavigationDecision.prevent;
            }

            return NavigationDecision.navigate;
          },
          onPageStarted: (url) {
            debugPrint("PAGE STARTED : $url");
          },
          onPageFinished: (url) {
            debugPrint("PAGE FINISHED : $url");
            _sendUserLocationToCesium();
          },
          onWebResourceError: (error) {
            debugPrint("WEB ERROR");
            debugPrint("Description : ${error.description}");
            debugPrint("Error Code : ${error.errorCode}");
            debugPrint("URL : ${error.url}");
          },
        ),
      );

    controller.loadRequest(
      Uri.parse(
        'http://127.0.0.1:${widget.port}/Apps/HelloWorld.html',
      ),
    );
  }

  Future<void> _initTts() async {
    for (final language in ["en-IN", "en-US"]) {
      try {
        final result = await _flutterTts.setLanguage(language);
        if (result == false || result == -1 || result == -2) {
          debugPrint("NATIVE TTS: $language voice is unavailable");
          continue;
        }
        debugPrint("NATIVE TTS: using $language");
        break;
      } catch (languageError) {
        debugPrint("NATIVE TTS: $language voice unavailable -> $languageError");
      }
    }

    try {
      await _flutterTts.setSpeechRate(0.48);
      await _flutterTts.setPitch(1.0);
      await _flutterTts.setVolume(1.0);

      _ttsReady = true;
      debugPrint("NATIVE TTS: initialized; using the device default if no language was available");
    } catch (ttsInitError) {
      debugPrint("NATIVE TTS: initialization failed -> $ttsInitError");
    }
  }

  Future<void> _speakNative(String text) async {
    if (text == '__STOP__') {
      try {
        await _flutterTts.stop();
        debugPrint("NATIVE TTS: stopped");
      } catch (stopError) {
        debugPrint("NATIVE TTS: stop() failed -> $stopError");
      }
      return;
    }

    debugPrint("NATIVE TTS: speaking guidance");

    if (!_ttsReady) {
      debugPrint(
        "NATIVE TTS: engine was not confirmed ready yet, attempting to speak anyway",
      );
    }

    try {
      await _ttsInitialization;
      // Stop whatever is currently being spoken first, so a new
      // instruction never overlaps with a previous one.
      await _flutterTts.stop();
      await _flutterTts.speak(text);
    } catch (speakError) {
      debugPrint("NATIVE TTS: speak() failed -> $speakError");
    }
  }

  Future<void> _sendUserLocationToCesium() async {
    if (_locationSetupInProgress || _hasInitialLocation) return;
    _locationSetupInProgress = true;

    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        debugPrint("LOCATION SERVICE DISABLED");
        return;
      }

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        debugPrint("LOCATION PERMISSION UNAVAILABLE");
        return;
      }

      final position = await Geolocator.getCurrentPosition();
      await controller.runJavaScript(
        'window.flyToUserLocation(${position.latitude}, ${position.longitude});',
      );
      _hasInitialLocation = true;
      await _startLiveLocationUpdates();
    } catch (locationError) {
      debugPrint("LOCATION SETUP FAILED: ${locationError.runtimeType}");
    } finally {
      _locationSetupInProgress = false;
    }
  }

  Future<void> _startLiveLocationUpdates() async {
    if (_positionStreamSubscription != null) return;

    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        debugPrint("LIVE LOCATION UPDATES UNAVAILABLE: service disabled");
        return;
      }

      final permission = await Geolocator.checkPermission();
      if (permission != LocationPermission.whileInUse &&
          permission != LocationPermission.always) {
        debugPrint("LIVE LOCATION UPDATES UNAVAILABLE: permission missing");
        return;
      }

      const locationSettings = LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 5,
      );
      _positionStreamSubscription = Geolocator.getPositionStream(
        locationSettings: locationSettings,
      ).listen(
        (position) {
          _pendingLocationUpdate = position;
          _scheduleLocationUpdate();
        },
        onError: (Object error) {
          debugPrint("LIVE LOCATION STREAM FAILED: ${error.runtimeType}");
          final subscription = _positionStreamSubscription;
          _positionStreamSubscription = null;
          subscription?.cancel();
        },
      );
    } catch (locationError) {
      debugPrint("LIVE LOCATION SETUP FAILED: ${locationError.runtimeType}");
    }
  }

  void _scheduleLocationUpdate() {
    if (_locationUpdateInProgress || _locationUpdateTimer?.isActive == true) {
      return;
    }

    _locationUpdateTimer = Timer(const Duration(milliseconds: 100), () {
      _locationUpdateTimer = null;
      unawaited(_flushLocationUpdate());
    });
  }

  Future<void> _flushLocationUpdate() async {
    final position = _pendingLocationUpdate;
    _pendingLocationUpdate = null;
    if (position == null) return;

    _locationUpdateInProgress = true;
    try {
      final speedMps = position.speed.isFinite && position.speed >= 0
          ? position.speed.toStringAsFixed(2)
          : 'null';
      await controller.runJavaScript(
        'window.updateUserMarker(${position.latitude}, ${position.longitude}, $speedMps);',
      );
    } catch (locationBridgeError) {
      debugPrint(
        "LIVE LOCATION BRIDGE FAILED: ${locationBridgeError.runtimeType}",
      );
    } finally {
      _locationUpdateInProgress = false;
      if (_pendingLocationUpdate != null) {
        _scheduleLocationUpdate();
      }
    }
  }

  @override
  void dispose() {
    _locationUpdateTimer?.cancel();
    _pendingLocationUpdate = null;
    _positionStreamSubscription?.cancel();
    _flutterTts.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: WebViewWidget(
          controller: controller,
        ),
      ),
    );
  }
}
