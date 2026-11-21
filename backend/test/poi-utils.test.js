"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { definitions, buildQuery, normalizeElements, shouldRetry, classifyError } = require("../../assets/cesium/Apps/poi-utils");

test("all Explore POI categories have a label and valid OpenStreetMap tags", () => {
  const expected = [
    "hospitals", "police", "dams", "hotels", "food", "cafes", "fuel", "parking", "tourist_places",
    "viewpoints", "attractions", "pharmacies", "atms", "ev_charging",
  ];
  assert.deepEqual(Object.keys(definitions), expected);
  for (const category of expected) {
    assert.ok(definitions[category].label);
    assert.ok(definitions[category].selectors.length > 0);
    const query = buildQuery(category, [27.2, 88.4, 27.4, 88.7]);
    for (const selector of definitions[category].selectors) {
      assert.ok(query.includes(`node${selector}(27.20,88.40,27.40,88.70);`), `${category} node query`);
      assert.ok(query.includes(`way${selector}(27.20,88.40,27.40,88.70);`), `${category} way query`);
      assert.ok(query.includes(`relation${selector}(27.20,88.40,27.40,88.70);`), `${category} relation query`);
    }
  }
  assert.equal(definitions.hospitals.valid({ amenity: "hospital" }), true);
  assert.equal(definitions.hospitals.valid({ amenity: "clinic" }), false);
  assert.equal(definitions.police.valid({ amenity: "police" }), true);
  assert.equal(definitions.dams.valid({ waterway: "dam" }), true);
  assert.equal(definitions.dams.valid({ man_made: "dam" }), true);
  assert.equal(definitions.hotels.valid({ tourism: "guest_house" }), true);
  assert.equal(definitions.food.valid({ amenity: "restaurant" }), true);
  assert.equal(definitions.attractions.valid({ historic: "monument" }), true);
  assert.equal(definitions.ev_charging.valid({ amenity: "charging_station" }), true);
  assert.throws(() => buildQuery("unknown", [27, 88, 28, 89]), RangeError);
});

test("query generation uses current bounds and valid node/way selectors", () => {
  const query = buildQuery("tourist_places", [27.1234, 88.4567, 27.9876, 88.9999]);
  assert.equal(
    query,
    '[out:json][timeout:8];(node["tourism"~"attraction|museum|gallery|zoo|theme_park"](27.12,88.46,27.99,89.00);way["tourism"~"attraction|museum|gallery|zoo|theme_park"](27.12,88.46,27.99,89.00);relation["tourism"~"attraction|museum|gallery|zoo|theme_park"](27.12,88.46,27.99,89.00););out center 60;'
  );
  assert.throws(() => buildQuery("cafes", [27, 89, 28, 88]), RangeError);
  assert.throws(() => buildQuery("cafes", [27, 88, 91, 89]), RangeError);
});

test("each of the 14 Explore categories accepts only its mapped OpenStreetMap tags", () => {
  const categoryTags = {
    hospitals: { amenity: "hospital" },
    police: { amenity: "police" },
    dams: { waterway: "dam" },
    hotels: { tourism: "hotel" },
    food: { amenity: "restaurant" },
    cafes: { amenity: "cafe" },
    fuel: { amenity: "fuel" },
    parking: { amenity: "parking" },
    tourist_places: { tourism: "attraction" },
    viewpoints: { tourism: "viewpoint" },
    attractions: { historic: "monument" },
    pharmacies: { amenity: "pharmacy" },
    atms: { amenity: "atm" },
    ev_charging: { amenity: "charging_station" },
  };
  assert.deepEqual(Object.keys(categoryTags), Object.keys(definitions));
  for (const [category, tags] of Object.entries(categoryTags)) {
    const normalized = normalizeElements([
      { type: "node", id: 10, lat: 27.3, lon: 88.6, tags },
    ], category);
    assert.equal(normalized.items.length, 1, `${category} accepts its OSM tags`);
    assert.equal(normalized.items[0].category, category);
    assert.equal(normalized.items[0].source, "OpenStreetMap");
  }
});

test("response normalization keeps valid category records and rejects bad coordinates", () => {
  const result = normalizeElements([
    { type: "node", id: 1, lat: 27.4, lon: 88.6, tags: { amenity: "pharmacy", name: "Clinic" } },
    { type: "way", id: 2, center: { lat: 27.3, lon: 88.5 }, tags: { amenity: "pharmacy" } },
    { type: "node", id: 3, lat: 91, lon: 88, tags: { amenity: "pharmacy" } },
    { type: "node", id: 4, lat: 27, lon: 88, tags: { amenity: "atm" } },
  ], "pharmacies", { lat: 27.3, lon: 88.5 }, (aLat, aLon, bLat, bLon) => Math.hypot(aLat - bLat, aLon - bLon));
  assert.equal(result.invalidCount, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].name, null);
  assert.equal(result.items[0].osm, "way/2");
  assert.equal(result.items[0].source, "OpenStreetMap");
  assert.deepEqual([result.items[0].latitude, result.items[0].longitude], [27.3, 88.5]);
});

test("Overpass errors distinguish retryable failures, timeouts, and cancellation", () => {
  assert.equal(shouldRetry({ status: 429 }), true);
  assert.equal(shouldRetry({ status: 503 }), true);
  assert.equal(shouldRetry(new TypeError("network")), true);
  assert.equal(shouldRetry({ status: 406 }), false);
  assert.equal(shouldRetry({ status: 400 }), false);
  assert.equal(shouldRetry(new Error("timeout"), true), true);
  assert.equal(classifyError({ status: 504 }, false), "timeout");
  assert.equal(classifyError({ name: "AbortError" }, false), "aborted");
  assert.equal(classifyError(new SyntaxError("invalid JSON"), false), "error");
});
