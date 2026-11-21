import 'package:flutter/material.dart';
import 'cesium_screen.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("SafeRoute AI"),
        centerTitle: true,
      ),
      body: Center(
        child: ElevatedButton(
          child: const Text("Open 3D Map"),
          onPressed: () {
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (context) => const CesiumScreen(),
              ),
            );
          },
        ),
      ),
    );
  }
}
