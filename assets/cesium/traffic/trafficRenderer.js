(function (global) {
  "use strict";

  function colorForRelativeSpeed(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      return Cesium.Color.GRAY;
    }
    if (value >= 0.8) return Cesium.Color.LIME;
    if (value >= 0.25) return Cesium.Color.YELLOW;
    return Cesium.Color.RED;
  }

  function coordinateToDegrees(tile, point, extent) {
    var scale = Math.pow(2, tile.z);
    var normalizedX = (tile.x + point.x / extent) / scale;
    var normalizedY = (tile.y + point.y / extent) / scale;
    var longitude = normalizedX * 360 - 180;
    var latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * normalizedY))) * 180 / Math.PI;
    return [longitude, latitude];
  }

  function TrafficRenderer(viewer) {
    this.viewer = viewer;
    this.primitivesByTile = new Map();
  }

  TrafficRenderer.prototype.updateTile = function (tile, decoded, stale) {
    this.removeTile(tile.key);
    var instances = [];
    var renderer = this;
    decoded.features.forEach(function (feature) {
      var relativeSpeed = feature.properties.relative_speed;
      var color = stale ? Cesium.Color.GRAY : colorForRelativeSpeed(relativeSpeed);
      feature.geometry.forEach(function (part) {
        if (part.length < 2) return;
        var positions = part.map(function (point) {
          var coordinates = coordinateToDegrees(tile, point, feature.extent);
          return Cesium.Cartesian3.fromDegrees(coordinates[0], coordinates[1], 2);
        });
        instances.push(new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: positions,
            width: 3,
            vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color)
          }
        }));
      });
    });
    if (!instances.length) return;
    var primitive = this.viewer.scene.primitives.add(new Cesium.Primitive({
      geometryInstances: instances,
      appearance: new Cesium.PolylineColorAppearance({
        translucent: false
      }),
      asynchronous: true,
      releaseGeometryInstances: true
    }));
    this.primitivesByTile.set(tile.key, primitive);
  };

  TrafficRenderer.prototype.removeTile = function (key) {
    var primitive = this.primitivesByTile.get(key);
    if (primitive) {
      this.viewer.scene.primitives.remove(primitive);
      this.primitivesByTile.delete(key);
    }
  };

  TrafficRenderer.prototype.setVisibleTiles = function (keys) {
    var visible = new Set(keys);
    var renderer = this;
    this.primitivesByTile.forEach(function (primitive, key) {
      if (!visible.has(key)) renderer.removeTile(key);
    });
  };

  TrafficRenderer.prototype.removeAll = function () {
    var renderer = this;
    this.primitivesByTile.forEach(function (primitive, key) {
      renderer.removeTile(key);
    });
  };

  TrafficRenderer.prototype.destroy = function () {
    this.removeAll();
  };

  global.SafeRouteTrafficRenderer = TrafficRenderer;
  if (typeof globalThis !== "undefined") {
    globalThis.SafeRouteTrafficRenderer = TrafficRenderer;
  }
})(window);
