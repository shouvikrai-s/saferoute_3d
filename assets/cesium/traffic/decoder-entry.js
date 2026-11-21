import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";

window.SafeRouteTrafficDecoder = {
  inspect: function (buffer) {
    var tile = new VectorTile(new Pbf(new Uint8Array(buffer)));
    var layers = Object.keys(tile.layers);
    var featureCount = 0;
    var properties = [];
    var features = [];
    layers.forEach(function (name) {
      var layer = tile.layers[name];
      featureCount += layer.length;
      for (var index = 0; index < layer.length; index++) {
        var feature = layer.feature(index);
        var featureProperties = feature.properties || {};
        properties.push(Object.keys(featureProperties));
        if (feature.type === 2) {
          features.push({
            type: feature.type,
            geometry: feature.loadGeometry(),
            properties: featureProperties,
            extent: layer.extent,
            layer: name
          });
        }
      }
    });
    return {
      decoded: true,
      byteLength: buffer.byteLength,
      layers: layers,
      featureCount: featureCount,
      propertyKeys: properties,
      features: features
    };
  }
};
