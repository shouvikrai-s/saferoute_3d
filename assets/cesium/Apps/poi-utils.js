(function (root, factory) {
  const utilities = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = utilities;
  }
  if (root) {
    root.SafeRoutePoiUtils = utilities;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const definitions = {
    hospitals: { label: "Hospitals", selectors: ['["amenity"="hospital"]'], valid: (tags) => tags.amenity === "hospital" },
    police: { label: "Police", selectors: ['["amenity"="police"]'], valid: (tags) => tags.amenity === "police" },
    dams: { label: "Dams", selectors: ['["waterway"="dam"]', '["man_made"="dam"]'], valid: (tags) => tags.waterway === "dam" || tags.man_made === "dam" },
    hotels: { label: "Hotels", selectors: ['["tourism"~"hotel|guest_house|hostel|motel"]'], valid: (tags) => /^(hotel|guest_house|hostel|motel)$/.test(tags.tourism || "") },
    food: { label: "Food", selectors: ['["amenity"~"restaurant|fast_food|food_court"]'], valid: (tags) => /^(restaurant|fast_food|food_court)$/.test(tags.amenity || "") },
    cafes: { label: "Cafes", selectors: ['["amenity"="cafe"]'], valid: (tags) => tags.amenity === "cafe" },
    fuel: { label: "Fuel", selectors: ['["amenity"="fuel"]'], valid: (tags) => tags.amenity === "fuel" },
    parking: { label: "Parking", selectors: ['["amenity"="parking"]'], valid: (tags) => tags.amenity === "parking" },
    tourist_places: { label: "Tourist places", selectors: ['["tourism"~"attraction|museum|gallery|zoo|theme_park"]'], valid: (tags) => /^(attraction|museum|gallery|zoo|theme_park)$/.test(tags.tourism || "") },
    viewpoints: { label: "Viewpoints", selectors: ['["tourism"="viewpoint"]'], valid: (tags) => tags.tourism === "viewpoint" },
    attractions: { label: "Attractions", selectors: ['["historic"]', '["amenity"="place_of_worship"]'], valid: (tags) => Boolean(tags.historic) || tags.amenity === "place_of_worship" },
    pharmacies: { label: "Pharmacies", selectors: ['["amenity"="pharmacy"]'], valid: (tags) => tags.amenity === "pharmacy" },
    atms: { label: "ATMs", selectors: ['["amenity"="atm"]'], valid: (tags) => tags.amenity === "atm" },
    ev_charging: { label: "EV charging", selectors: ['["amenity"="charging_station"]'], valid: (tags) => tags.amenity === "charging_station" },
  };

  function buildQuery(category, bounds) {
    const definition = definitions[category];
    if (!definition) {
      throw new RangeError(`Unsupported POI category: ${category}`);
    }
    const values = Array.isArray(bounds)
      ? bounds.map(Number)
      : [bounds.south, bounds.west, bounds.north, bounds.east].map(Number);
    if (
      values.length !== 4 ||
      !values.every(Number.isFinite) ||
      values[0] < -90 ||
      values[2] > 90 ||
      values[1] < -180 ||
      values[3] > 180 ||
      values[0] >= values[2] ||
      values[1] >= values[3]
    ) {
      throw new RangeError("POI search bounds are invalid.");
    }

    const bbox = values.map((value) => value.toFixed(2)).join(",");
    const selectors = definition.selectors
      .map((selector) => `node${selector}(${bbox});way${selector}(${bbox});relation${selector}(${bbox});`)
      .join("");
    return `[out:json][timeout:8];(${selectors});out center 60;`;
  }

  function normalizeElements(elements, category, origin, distanceCalculator) {
    const definition = definitions[category];
    if (!definition) {
      throw new RangeError(`Unsupported POI category: ${category}`);
    }

    let invalidCount = 0;
    const items = (Array.isArray(elements) ? elements : [])
      .map((element) => {
        const tags = element.tags || {};
        if (!definition.valid(tags)) {
          return null;
        }

        const lat = Number(element.lat != null ? element.lat : element.center && element.center.lat);
        const lon = Number(element.lon != null ? element.lon : element.center && element.center.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
          invalidCount += 1;
          return null;
        }

        const km = origin && typeof distanceCalculator === "function"
          ? distanceCalculator(origin.lat, origin.lon, lat, lon)
          : null;
        return {
          name: tags.name || tags.brand || tags.operator || null,
          lat,
          lon,
          latitude: lat,
          longitude: lon,
          category,
          source: "OpenStreetMap",
          tags,
          osm: `${element.type}/${element.id}`,
          km,
        };
      })
      .filter(Boolean);

    items.sort((a, b) => (a.km == null ? Infinity : a.km) - (b.km == null ? Infinity : b.km));
    return { items, invalidCount };
  }

  function shouldRetry(error, timedOut) {
    return Boolean(
      timedOut ||
      error && (error.status === 429 || error.status >= 500 || error instanceof TypeError)
    );
  }

  function classifyError(error, timedOut) {
    if (timedOut || error && (error.status === 408 || error.status === 504)) {
      return "timeout";
    }
    if (error && error.name === "AbortError") {
      return "aborted";
    }
    return "error";
  }

  return { definitions, buildQuery, normalizeElements, shouldRetry, classifyError };
});
