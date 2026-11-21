(function (global) {
  "use strict";

  var MAX_MERCATOR_LATITUDE = 85.0511287798;

  function clampLatitude(latitude) {
    return Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
  }

  function normalizeLongitude(longitude) {
    return ((longitude + 180) % 360 + 360) % 360 - 180;
  }

  function tileForCoordinate(longitude, latitude, zoom) {
    var n = Math.pow(2, zoom);
    var safeLatitude = clampLatitude(latitude);
    var latitudeRadians = safeLatitude * Math.PI / 180;
    var x = Math.floor((normalizeLongitude(longitude) + 180) / 360 * n);
    var y = Math.floor(
      (1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * n
    );
    return {
      x: Math.max(0, Math.min(n - 1, x)),
      y: Math.max(0, Math.min(n - 1, y))
    };
  }

  function longitudeTileRanges(west, east, zoom) {
    var n = Math.pow(2, zoom);
    var normalizedWest = normalizeLongitude(west);
    var normalizedEast = normalizeLongitude(east);
    if (east - west >= 360 || (normalizedEast < normalizedWest && west < east)) {
      return [[0, n - 1]];
    }
    var westTile = tileForCoordinate(normalizedWest, 0, zoom).x;
    var eastTile = tileForCoordinate(normalizedEast, 0, zoom).x;
    if (westTile <= eastTile) return [[westTile, eastTile]];
    return [[westTile, n - 1], [0, eastTile]];
  }

  function tilesForRectangle(rectangle, zoom, maxTiles) {
    var west = rectangle.west * 180 / Math.PI;
    var east = rectangle.east * 180 / Math.PI;
    var north = rectangle.north * 180 / Math.PI;
    var south = rectangle.south * 180 / Math.PI;
    var northTile = tileForCoordinate(west, north, zoom).y;
    var southTile = tileForCoordinate(west, south, zoom).y;
    var ranges = longitudeTileRanges(west, east, zoom);
    var tiles = [];

    ranges.forEach(function (range) {
      for (var x = range[0]; x <= range[1]; x++) {
        for (var y = Math.min(northTile, southTile); y <= Math.max(northTile, southTile); y++) {
          tiles.push({ z: zoom, x: x, y: y, key: zoom + "/" + x + "/" + y });
        }
      }
    });

    if (tiles.length <= maxTiles) return tiles;
    return tiles.slice(0, maxTiles);
  }

  global.SafeRouteTrafficTileMath = {
    clampLatitude: clampLatitude,
    tileForCoordinate: tileForCoordinate,
    tilesForRectangle: tilesForRectangle
  };
})(window);
