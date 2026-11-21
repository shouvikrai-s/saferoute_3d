(function (global) {
  "use strict";

  var DEFAULTS = {
    minZoom: 10,
    maxZoom: 16,
    maxVisibleTiles: 24,
    cacheMaxEntries: 48,
    tileTtlMs: 120000,
    movementDebounceMs: 450,
    maxConcurrentRequests: 3,
    diagnostics: true
  };

  function TrafficManager() {
    this.viewer = null;
    this.options = {};
    this.enabled = false;
    this.cache = new Map();
    this.inFlight = new Map();
    this.queue = [];
    this.activeRequests = 0;
    this.moveTimer = null;
    this.viewUpdateTimer = null;
    this.pending2DView = null;
    this.moveEndRemove = null;
    this.destroyed = false;
    this.renderer = null;
    this.secondaryRenderer = null;
    this.refreshTimer = null;
    this.stats = { cacheHits: 0, cacheMisses: 0, loaded: 0, failed: 0 };
  }

  TrafficManager.prototype.init = function (viewer, options) {
    this.viewer = viewer;
    this.options = Object.assign({}, DEFAULTS, options || {});
    this.enabled = this.options.enabled !== false;
    this.destroyed = false;
    this.renderer = new SafeRouteTrafficRenderer(viewer);
    this.refreshTimer = setInterval(function () {
      if (this.enabled) this.update();
    }.bind(this), this.options.tileTtlMs);
    this.moveEndRemove = viewer.camera.moveEnd.addEventListener(
      this.scheduleUpdate.bind(this)
    );
    this.scheduleUpdate();
    return this;
  };

  TrafficManager.prototype.setEnabled = function (enabled) {
    this.enabled = Boolean(enabled);
    if (this.enabled) {
      this.scheduleUpdate();
    } else {
      clearTimeout(this.viewUpdateTimer);
      this.pending2DView = null;
      var cancelled = this.queue.splice(0);
      cancelled.forEach(function (work) {
        var error = new Error("Traffic tile request was superseded.");
        error.name = "AbortError";
        work.reject(error);
      });
      if (this.renderer) this.renderer.removeAll();
      if (this.secondaryRenderer && this.secondaryRenderer.removeAll) {
        this.secondaryRenderer.removeAll();
      }
    }
    if (global.__srUpdateTrafficLegend) global.__srUpdateTrafficLegend();
  };

  TrafficManager.prototype.setSecondaryRenderer = function (renderer) {
    this.secondaryRenderer = renderer || null;
    if (!this.secondaryRenderer) return;
    var manager = this;
    this.cache.forEach(function (entry) {
      if (entry.data && entry.data.decoded && manager.secondaryRenderer.updateTile) {
        manager.secondaryRenderer.updateTile(
          entry.data.tile,
          entry.data,
          Date.now() - entry.timestamp >= manager.options.tileTtlMs
        );
      }
    });
  };

  TrafficManager.prototype.updateFor2DView = function (view) {
    if (!this.enabled || this.destroyed || !view) return;
    this.pending2DView = view;
    clearTimeout(this.viewUpdateTimer);
    var manager = this;
    this.viewUpdateTimer = setTimeout(function () {
      var latestView = manager.pending2DView;
      manager.pending2DView = null;
      manager.updateFor2DViewNow(latestView);
    }, this.options.movementDebounceMs);
  };

  TrafficManager.prototype.updateFor2DViewNow = function (view) {
    if (!this.enabled || this.destroyed || !view) return;
    var zoom = Math.max(this.options.minZoom, Math.min(this.options.maxZoom, Math.round(view.zoom)));
    var center = SafeRouteTrafficTileMath.tileForCoordinate(view.lon, view.lat, zoom);
    var n = Math.pow(2, zoom);
    var tilePixels = 256 * Math.pow(2, (Number(view.zoom) || zoom) - zoom);
    var radiusX = Math.ceil((Number(view.width) || 768) / (2 * tilePixels)) + 1;
    var radiusY = Math.ceil((Number(view.height) || 768) / (2 * tilePixels)) + 1;
    var tiles = [];
    for (var dx = -radiusX; dx <= radiusX; dx++) {
      for (var dy = -radiusY; dy <= radiusY; dy++) {
        var x = (center.x + dx + n) % n;
        var y = Math.max(0, Math.min(n - 1, center.y + dy));
        var tile = { z: zoom, x: x, y: y, key: zoom + "/" + x + "/" + y };
        if (!tiles.some(function (candidate) { return candidate.key === tile.key; })) {
          tile.distance = dx * dx + dy * dy;
          tiles.push(tile);
        }
      }
    }
    tiles.sort(function (a, b) { return a.distance - b.distance; });
    tiles = tiles.slice(0, this.options.maxVisibleTiles);
    var manager = this;
    if (this.secondaryRenderer && this.secondaryRenderer.setVisibleTiles) {
      this.secondaryRenderer.setVisibleTiles(tiles.map(function (tile) { return tile.key; }));
    }
    tiles.forEach(function (tile) {
      manager.loadTile(tile).catch(function (error) {
        if (error.name === "AbortError") return;
        manager.report("2D traffic tile failed: " + tile.key + " (" + error.message + ")");
      });
    });
  };

  TrafficManager.prototype.getZoom = function () {
    var height = this.viewer.camera.positionCartographic.height;
    var normalized = Math.max(0, Math.min(1, (Math.log(height) - Math.log(300)) / Math.log(100000)));
    return Math.round(
      this.options.maxZoom - normalized * (this.options.maxZoom - this.options.minZoom)
    );
  };

  TrafficManager.prototype.scheduleUpdate = function () {
    var manager = this;
    if (!this.enabled || this.destroyed) return;
    clearTimeout(this.moveTimer);
    this.moveTimer = setTimeout(function () {
      manager.update();
    }, this.options.movementDebounceMs);
  };

  TrafficManager.prototype.update = function () {
    if (!this.enabled || this.destroyed) return;
    var rectangle;
    try {
      rectangle = this.viewer.camera.computeViewRectangle(Cesium.Ellipsoid.WGS84);
    } catch (error) {
      this.report("Traffic update skipped: camera bounds unavailable.");
      return;
    }
    if (!rectangle) return;

    var zoom = this.getZoom();
    var tiles = SafeRouteTrafficTileMath.tilesForRectangle(
      rectangle,
      zoom,
      this.options.maxVisibleTiles
    );
    var manager = this;
    this.renderer.setVisibleTiles(tiles.map(function (tile) { return tile.key; }));
    tiles.forEach(function (tile) {
      manager.loadTile(tile).catch(function (error) {
        if (error.name === "AbortError") return;
        manager.report("Traffic tile failed: " + tile.key + " (" + error.message + ")");
      });
    });
    this.report(
      "Traffic enabled=" + this.enabled +
      " zoom=" + zoom +
      " visibleTiles=" + tiles.length +
      " cacheHits=" + this.stats.cacheHits +
      " cacheMisses=" + this.stats.cacheMisses +
      " inFlight=" + this.inFlight.size +
      " queued=" + this.queue.length +
      " loaded=" + this.stats.loaded +
      " failed=" + this.stats.failed
    );
  };

  TrafficManager.prototype.loadTile = function (tile) {
    var now = Date.now();
    var cached = this.cache.get(tile.key);
    if (cached && now - cached.timestamp < this.options.tileTtlMs) {
      cached.lastUsed = now;
      this.stats.cacheHits++;
      if (this.renderer && cached.data.decoded) {
        this.renderer.updateTile(tile, cached.data);
      }
      if (this.secondaryRenderer && cached.data.decoded && this.secondaryRenderer.updateTile) {
        this.secondaryRenderer.updateTile(tile, cached.data);
      }
      return Promise.resolve(cached.data);
    }
    if (cached && cached.data && cached.data.decoded) {
      if (this.renderer) this.renderer.updateTile(tile, cached.data, true);
      if (this.secondaryRenderer && this.secondaryRenderer.updateTile) {
        this.secondaryRenderer.updateTile(tile, cached.data, true);
      }
    }
    if (this.inFlight.has(tile.key)) return this.inFlight.get(tile.key);

    this.stats.cacheMisses++;
    var manager = this;
    var promise = new Promise(function (resolve, reject) {
      manager.queue.push({ tile: tile, resolve: resolve, reject: reject });
      manager.pumpQueue();
    }).finally(function () {
      manager.inFlight.delete(tile.key);
    });
    this.inFlight.set(tile.key, promise);
    return promise;
  };

  TrafficManager.prototype.pumpQueue = function () {
    var manager = this;
    while (
      this.activeRequests < this.options.maxConcurrentRequests &&
      this.queue.length
    ) {
      let work = this.queue.shift();
      this.activeRequests++;
      this.fetchTile(work.tile)
        .then(function (result) {
          work.resolve(result);
        })
        .catch(function (error) {
          manager.stats.failed++;
          if (global.__srUpdateTrafficLegend) global.__srUpdateTrafficLegend();
          work.reject(error);
        })
        .finally(function () {
          manager.activeRequests--;
          manager.pumpQueue();
        });
    }
  };

  TrafficManager.prototype.fetchTile = function (tile) {
    var manager = this;
    var url = this.options.backendTileUrl + "/" + tile.z + "/" + tile.x + "/" + tile.y;
    return fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error("Traffic tile HTTP " + response.status);
        return response.arrayBuffer().then(function (buffer) {
          var decoded = global.SafeRouteTrafficDecoder
            ? global.SafeRouteTrafficDecoder.inspect(buffer)
            : { byteLength: buffer.byteLength, decoded: false };
          if (!decoded.decoded || !Array.isArray(decoded.features)) {
            throw new Error("Traffic vector tile could not be decoded.");
          }
          decoded.tile = tile;
          if (decoded.decoded && manager.renderer && manager.enabled && !manager.destroyed) {
            manager.renderer.updateTile(tile, decoded, false);
          }
          if (decoded.decoded && manager.secondaryRenderer && manager.enabled && !manager.destroyed) {
            manager.secondaryRenderer.updateTile(tile, decoded, false);
          }
          var timestamp = Date.now();
          manager.cache.set(tile.key, {
            data: decoded,
            timestamp: timestamp,
            lastUsed: timestamp
          });
          manager.trimCache();
          manager.stats.loaded++;
          if (global.__srUpdateTrafficLegend) global.__srUpdateTrafficLegend();
          return decoded;
        });
      });
  };

  TrafficManager.prototype.trimCache = function () {
    while (this.cache.size > this.options.cacheMaxEntries) {
      var oldestKey = null;
      var oldestTime = Infinity;
      this.cache.forEach(function (entry, key) {
        if (entry.lastUsed < oldestTime) {
          oldestKey = key;
          oldestTime = entry.lastUsed;
        }
      });
      if (oldestKey === null) break;
      this.cache.delete(oldestKey);
    }
  };

  TrafficManager.prototype.report = function (message) {
    if (this.options.diagnostics) console.log("[traffic]", message);
  };

  TrafficManager.prototype.destroy = function () {
    this.destroyed = true;
    this.enabled = false;
    clearTimeout(this.moveTimer);
    clearTimeout(this.viewUpdateTimer);
    this.pending2DView = null;
    clearInterval(this.refreshTimer);
    if (this.moveEndRemove) this.moveEndRemove();
    var cancelled = this.queue.splice(0);
    cancelled.forEach(function (work) {
      var error = new Error("Traffic manager was destroyed.");
      error.name = "AbortError";
      work.reject(error);
    });
    this.cache.clear();
    this.inFlight.clear();
    if (this.renderer) this.renderer.destroy();
  };

  global.SafeRouteTrafficManager = TrafficManager;
  if (typeof globalThis !== "undefined") {
    globalThis.SafeRouteTrafficManager = TrafficManager;
  }
})(window);
