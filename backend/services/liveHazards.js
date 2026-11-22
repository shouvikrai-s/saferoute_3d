"use strict";

const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY || "";
const CACHE_TTL_MS = 15 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 6000;
const DAILY_TOMTOM_LIMIT = 2499;
const POINT_CACHE_TTL_MS = 5 * 60 * 1000;
const POINT_CACHE_MAX = 128;

const CORRIDORS = Object.freeze([
  { district: "East", name: "Gangtok", lat: 27.3389, lon: 88.6065, road: "NH-10 Gangtok–Deorali" },
  { district: "South", name: "Namchi", lat: 27.1665, lon: 88.3639, road: "Jorethang–Namchi Road" },
  { district: "North", name: "Mangan", lat: 27.5097, lon: 88.5322, road: "North Sikkim Highway NH-310A" },
  { district: "West", name: "Gyalshing", lat: 27.2896, lon: 88.2570, road: "Legship–Gyalshing Road" },
  { district: "Pakyong", name: "Pakyong", lat: 27.2345, lon: 88.5912, road: "Rorathang–Pakyong Road" },
  { district: "Soreng", name: "Soreng", lat: 27.1683, lon: 88.2036, road: "Sombaria–Soreng Corridor" },
  { district: "East", name: "Rangpo", lat: 27.1770, lon: 88.5328, road: "NH-10 Sikkim–Bengal Entry Gate" },
  { district: "East", name: "Singtam", lat: 27.2346, lon: 88.5015, road: "NH-10 Teesta–Singtam Junction" }
]);

let snapshotCache = null;
let refreshPromise = null;
const dailyTomTom = new Map();
const pointCache = new Map();
const pointRefreshes = new Map();

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function utcDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function consumeTomTomQuota() {
  const key = utcDateKey();
  const count = Number(dailyTomTom.get(key) || 0);
  if (count >= DAILY_TOMTOM_LIMIT) return false;
  dailyTomTom.set(key, count + 1);
  for (const date of dailyTomTom.keys()) {
    if (date !== key) dailyTomTom.delete(date);
  }
  return true;
}

async function fetchJson(url, acceptStatuses) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "SafeRoute-Backend/1.0" },
      signal: controller.signal
    });
    if (!response.ok && !(acceptStatuses || []).includes(response.status)) {
      throw new Error("Upstream HTTP " + response.status);
    }
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Upstream timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function classifyLandslide(weather, soilMoisture) {
  const rain = finiteNumber(weather && weather.precipitationSum);
  const moisture = finiteNumber(soilMoisture);
  if (rain === null && moisture === null) return "UNKNOWN";
  if ((Number.isFinite(rain) && rain >= 100) || (Number.isFinite(moisture) && moisture >= 0.45)) return "CRITICAL";
  if ((Number.isFinite(rain) && rain >= 60) || (Number.isFinite(moisture) && moisture >= 0.36)) return "HIGH";
  if ((Number.isFinite(rain) && rain >= 25) || (Number.isFinite(moisture) && moisture >= 0.28)) return "MODERATE";
  return "LOW";
}

function classifyAirQuality(usAqi) {
  if (usAqi === null) return "UNAVAILABLE";
  if (usAqi <= 50) return "GOOD";
  if (usAqi <= 100) return "MODERATE";
  if (usAqi <= 150) return "SENSITIVE";
  return "UNHEALTHY";
}

function buildAirQuality(current) {
  const usAqi = finiteNumber(current.us_aqi);
  const pm25 = finiteNumber(current.pm2_5);
  const pm10 = finiteNumber(current.pm10);
  const visibilityImpact = (usAqi !== null && usAqi > 100) ||
      (pm25 !== null && pm25 >= 35.5) || (pm10 !== null && pm10 >= 155)
    ? "Elevated particulate readings inform regional atmospheric dispersion screening."
    : "Regional atmospheric dispersion telemetry reflects the reported pollutant readings.";
  return {
    us_aqi: usAqi,
    european_aqi: finiteNumber(current.european_aqi),
    pm2_5: pm25,
    pm10,
    ozone: finiteNumber(current.ozone),
    nitrogen_dioxide: finiteNumber(current.nitrogen_dioxide),
    carbon_monoxide: finiteNumber(current.carbon_monoxide),
    advisory_tier: classifyAirQuality(usAqi),
    visibility_impact: visibilityImpact,
    observed_at: current.time || null
  };
}

function classifyFlood(discharge) {
  if (!Number.isFinite(discharge)) return "UNKNOWN";
  if (discharge >= 3000) return "CRITICAL";
  if (discharge >= 1500) return "HIGH";
  if (discharge >= 500) return "MODERATE";
  return "LOW";
}

async function fetchWeather(corridor) {
  const url = "https://api.open-meteo.com/v1/forecast?" +
    "latitude=" + encodeURIComponent(corridor.lat) +
    "&longitude=" + encodeURIComponent(corridor.lon) +
    "&daily=precipitation_sum&hourly=temperature_2m,soil_moisture_27_to_81cm" +
    "&forecast_days=2&timezone=auto";
  const data = await fetchJson(url);
  const index = 0;
  const precipitationSum = data.daily && data.daily.precipitation_sum ? Number(data.daily.precipitation_sum[index]) : null;
  const temperature = data.hourly && data.hourly.temperature_2m ? Number(data.hourly.temperature_2m[index]) : null;
  const soilMoisture = data.hourly && data.hourly.soil_moisture_27_to_81cm ? Number(data.hourly.soil_moisture_27_to_81cm[index]) : null;
  const weather = {
    temperature_2m: Number.isFinite(temperature) ? temperature : null,
    precipitation_sum_24h: Number.isFinite(precipitationSum) ? precipitationSum : null,
    soil_moisture_27_to_81cm: Number.isFinite(soilMoisture) ? soilMoisture : null
  };
  return {
    weather,
    landslide_risk: classifyLandslide({
      precipitationSum: weather.precipitation_sum_24h
    }, weather.soil_moisture_27_to_81cm)
  };
}

async function fetchFlood(corridor) {
  const url = "https://flood-api.open-meteo.com/v1/flood?" +
    "latitude=" + encodeURIComponent(corridor.lat) +
    "&longitude=" + encodeURIComponent(corridor.lon) +
    "&daily=river_discharge&forecast_days=2&timezone=auto";
  const data = await fetchJson(url);
  const discharge = data.daily && data.daily.river_discharge
    ? finiteNumber(data.daily.river_discharge[0])
    : null;
  const value = finiteNumber(discharge);
  return {
    river_discharge_m3s: value,
    flood_risk: classifyFlood(value)
  };
}

async function fetchAir(corridor) {
  const url = "https://air-quality-api.open-meteo.com/v1/air-quality?" +
    "latitude=" + encodeURIComponent(corridor.lat) +
    "&longitude=" + encodeURIComponent(corridor.lon) +
    "&current=us_aqi,european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,carbon_monoxide&timezone=auto";
  const data = await fetchJson(url);
  return buildAirQuality(data.current || {});
}

function sumRecentPrecipitation(hourly, hours, now) {
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  const values = Array.isArray(hourly.precipitation) ? hourly.precipitation : [];
  const cutoff = now - hours * 60 * 60 * 1000;
  let total = 0;
  let count = 0;
  for (let i = 0; i < Math.min(times.length, values.length); i++) {
    const timeValue = String(times[i]);
    const timestamp = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(timeValue) ? timeValue : timeValue + "Z");
    const precipitation = finiteNumber(values[i]);
    if (Number.isFinite(timestamp) && timestamp > cutoff && timestamp <= now && precipitation !== null) {
      total += precipitation;
      count++;
    }
  }
  return count ? Number(total.toFixed(2)) : null;
}

function latestHourlyValue(hourly, key, now) {
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  const values = Array.isArray(hourly[key]) ? hourly[key] : [];
  for (let i = Math.min(times.length, values.length) - 1; i >= 0; i--) {
    const timeValue = String(times[i]);
    const timestamp = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(timeValue) ? timeValue : timeValue + "Z");
    const value = finiteNumber(values[i]);
    if (Number.isFinite(timestamp) && timestamp <= now && value !== null) return value;
  }
  return null;
}

async function fetchPointWeather(point) {
  const url = "https://api.open-meteo.com/v1/forecast?" +
    "latitude=" + encodeURIComponent(point.lat) +
    "&longitude=" + encodeURIComponent(point.lon) +
    "&current=temperature_2m,precipitation,relative_humidity_2m,wind_speed_10m" +
    "&hourly=precipitation,soil_moisture_27_to_81cm&past_days=7&forecast_days=1&timezone=UTC";
  const data = await fetchJson(url);
  const current = data.current || {};
  const hourly = data.hourly || {};
  const now = Date.now();
  return {
    temperature_2m: finiteNumber(current.temperature_2m),
    current_precipitation_mm: finiteNumber(current.precipitation),
    precipitation_1h_mm: finiteNumber(current.precipitation),
    precipitation_24h_mm: sumRecentPrecipitation(hourly, 24, now),
    precipitation_72h_mm: sumRecentPrecipitation(hourly, 72, now),
    precipitation_7d_mm: sumRecentPrecipitation(hourly, 168, now),
    relative_humidity_2m: finiteNumber(current.relative_humidity_2m),
    wind_speed_10m: finiteNumber(current.wind_speed_10m),
    soil_moisture_27_to_81cm: latestHourlyValue(hourly, "soil_moisture_27_to_81cm", now),
    observed_at: current.time || null
  };
}

async function fetchPointTelemetry(lat, lon) {
  const point = { lat, lon };
  const results = await Promise.allSettled([
    fetchPointWeather(point),
    fetchAir(point),
    fetchFlood(point)
  ]);
  const weather = results[0].status === "fulfilled" ? results[0].value : null;
  const airQuality = results[1].status === "fulfilled" ? results[1].value : null;
  const flood = results[2].status === "fulfilled" ? results[2].value : null;
  if (!weather && !airQuality && !flood) {
    throw new Error("Open-Meteo weather, air-quality, and flood feeds did not return data.");
  }
  const soilMoisture = weather && weather.soil_moisture_27_to_81cm;
  return {
    generatedAt: new Date().toISOString(),
    coordinates: point,
    weather,
    air_quality: airQuality,
    flood,
    landslide_risk: weather
      ? classifyLandslide({ precipitationSum: weather.precipitation_72h_mm }, soilMoisture)
      : "UNKNOWN",
    sourceStatus: {
      weather: results[0].status === "fulfilled" ? "LIVE" : "UNAVAILABLE",
      air_quality: results[1].status === "fulfilled" ? "LIVE" : "UNAVAILABLE",
      flood: results[2].status === "fulfilled" ? "LIVE" : "UNAVAILABLE"
    }
  };
}

function refreshPointCache(key, lat, lon) {
  if (pointRefreshes.has(key)) return pointRefreshes.get(key);
  const refresh = fetchPointTelemetry(lat, lon)
    .then(function(snapshot){
      pointCache.delete(key);
      pointCache.set(key, { snapshot, timestamp: Date.now() });
      while (pointCache.size > POINT_CACHE_MAX) {
        pointCache.delete(pointCache.keys().next().value);
      }
      return snapshot;
    })
    .finally(function(){ pointRefreshes.delete(key); });
  pointRefreshes.set(key, refresh);
  return refresh;
}

async function getPointTelemetry(lat, lon) {
  const gridLat = Math.round(lat * 50) / 50;
  const gridLon = Math.round(lon * 50) / 50;
  const key = gridLat.toFixed(2) + ":" + gridLon.toFixed(2);
  const cached = pointCache.get(key);
  if (cached && Date.now() - cached.timestamp < POINT_CACHE_TTL_MS) {
    return { snapshot: cached.snapshot, cached: true, stale: false };
  }
  if (cached) {
    refreshPointCache(key, gridLat, gridLon).catch(function(error){
      console.error("[hazards-point] stale refresh failed:", error.message);
    });
    return { snapshot: cached.snapshot, cached: true, stale: true };
  }
  const snapshot = await refreshPointCache(key, gridLat, gridLon);
  return { snapshot, cached: false, stale: false };
}

async function fetchTraffic(corridor) {
  if (!TOMTOM_API_KEY) throw new Error("TomTom traffic service is not configured");
  if (!consumeTomTomQuota()) throw new Error("TomTom daily quota guard reached");
  const url = "https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json" +
    "?point=" + encodeURIComponent(corridor.lat + "," + corridor.lon) +
    "&unit=KMPH&openLr=false&key=" + encodeURIComponent(TOMTOM_API_KEY);
  const data = await fetchJson(url);
  const flow = data.flowSegmentData || {};
  const currentSpeed = Number(flow.currentSpeed);
  const freeFlowSpeed = Number(flow.freeFlowSpeed);
  const currentTravelTime = Number(flow.currentTravelTime);
  const freeFlowTravelTime = Number(flow.freeFlowTravelTime);
  const ratio = Number.isFinite(currentSpeed) && Number.isFinite(freeFlowSpeed) && freeFlowSpeed > 0
    ? currentSpeed / freeFlowSpeed
    : null;
  const delaySeconds = Number.isFinite(currentTravelTime) && Number.isFinite(freeFlowTravelTime)
    ? Math.max(0, Math.round(currentTravelTime - freeFlowTravelTime))
    : null;
  const coordinates = Array.isArray(flow.coordinates && flow.coordinates.coordinate)
    ? flow.coordinates.coordinate.map(function(point){
        return { lat: Number(point.latitude), lon: Number(point.longitude) };
      }).filter(function(point){ return Number.isFinite(point.lat) && Number.isFinite(point.lon); })
    : [];
  let status = "SMOOTH";
  let color = "#22C55E";
  if (flow.roadClosure === true) {
    status = "ROAD_CLOSED";
    color = "#991B1B";
  } else if (ratio !== null && ratio < 0.45) {
    status = "HEAVY_CONGESTION";
    color = "#EF4444";
  } else if (ratio !== null && ratio < 0.75) {
    status = "MODERATE_DELAY";
    color = "#F59E0B";
  }
  return {
    currentSpeed: Number.isFinite(currentSpeed) ? currentSpeed : null,
    freeFlowSpeed: Number.isFinite(freeFlowSpeed) ? freeFlowSpeed : null,
    delay_seconds: delaySeconds,
    roadClosure: flow.roadClosure === true,
    coordinates,
    status,
    color
  };
}

function settledValue(result, fallback) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function buildTourism(corridors) {
  const byName = new Map(corridors.map(function(corridor){ return [corridor.name, corridor]; }));
  function statusFor(names) {
    const records = names.map(function(name){ return byName.get(name); }).filter(Boolean);
    const restricted = records.some(function(record){
      return record.traffic && record.traffic.status === "ROAD_CLOSED";
    });
    const caution = restricted || records.some(function(record){
      return record.traffic && ["HEAVY_CONGESTION", "MODERATE_DELAY"].includes(record.traffic.status) ||
        record.landslide_risk === "HIGH" || record.landslide_risk === "CRITICAL" ||
        (record.weather && record.weather.precipitation_sum_24h >= 25);
    });
    if (restricted) return "RESTRICTED";
    if (caution) return "CAUTION";
    return "OPEN";
  }
  const mangan = byName.get("Mangan");
  const singtam = byName.get("Singtam");
  const gangtok = byName.get("Gangtok");
  const pakyong = byName.get("Pakyong");
  const gyalshing = byName.get("Gyalshing");
  const soreng = byName.get("Soreng");
  const namchi = byName.get("Namchi");
  const rangpo = byName.get("Rangpo");

  return [
    {
      circuit: "North Sikkim",
      destinations: ["Lachung", "Yumthang", "Gurudongmar Lake"],
      status: statusFor(["Mangan", "Singtam"]),
      reason: "NH-310A / Singtam corridor status; ILP/PAP required for permitted areas."
    },
    {
      circuit: "East Sikkim Silk Route",
      destinations: ["Tsomgo Lake", "Baba Mandir", "Nathula Pass"],
      status: statusFor(["Gangtok", "Pakyong"]),
      reason: "Gangtok/Pakyong corridor and high-altitude weather; protected-area permit required."
    },
    {
      circuit: "West Sikkim",
      destinations: ["Pelling", "Skywalk", "Yuksom"],
      status: statusFor(["Gyalshing", "Soreng"]),
      reason: "Gyalshing/Soreng corridor and landslide-weather screening."
    },
    {
      circuit: "South Sikkim",
      destinations: ["Ravangla Buddha Park", "Namchi Char Dham"],
      status: statusFor(["Namchi", "Rangpo"]),
      reason: "Namchi/Rangpo corridor status; normal safety checks apply."
    }
  ].map(function(circuit){
    if (circuit.status === "OPEN") circuit.reason = "Clear live corridor screening — " + circuit.reason;
    return circuit;
  });
}

async function fetchCorridor(corridor) {
  const results = await Promise.allSettled([
    fetchWeather(corridor),
    fetchFlood(corridor),
    fetchAir(corridor),
    fetchTraffic(corridor)
  ]);
  const weatherResult = settledValue(results[0], null);
  const floodResult = settledValue(results[1], null);
  const airResult = settledValue(results[2], null);
  const trafficResult = settledValue(results[3], null);
  const weather = weatherResult ? weatherResult.weather : null;
  const landslideRisk = weatherResult ? weatherResult.landslide_risk : "UNKNOWN";
  return {
    district: corridor.district,
    name: corridor.name,
    lat: corridor.lat,
    lon: corridor.lon,
    road: corridor.road,
    weather,
    landslide_risk: landslideRisk,
    flood_risk: floodResult ? floodResult.flood_risk : "UNKNOWN",
    river_discharge_m3s: floodResult ? floodResult.river_discharge_m3s : null,
    air_quality: airResult || { us_aqi: null, pm2_5: null, pm10: null },
    traffic: trafficResult || {
      currentSpeed: null,
      freeFlowSpeed: null,
      delay_seconds: null,
      roadClosure: false,
      coordinates: [],
      status: "UNAVAILABLE",
      color: "#94A3B8"
    }
  };
}

async function refreshLiveSnapshot() {
  const corridorResults = await Promise.all(CORRIDORS.map(fetchCorridor));
  const teesta = {
    name: "Teesta III Dam / Chungthang basin context",
    lat: 27.528013,
    lon: 88.5411727,
    status: corridorResults.find(function(record){ return record.name === "Mangan"; })?.flood_risk || "UNKNOWN",
    river_discharge_m3s: corridorResults.find(function(record){ return record.name === "Mangan"; })?.river_discharge_m3s ?? null
  };
  return {
    generatedAt: new Date().toISOString(),
    source: "OPEN_METEO_AND_TOMTOM",
    mode: "LIVE",
    corridors: corridorResults,
    teesta,
    tourism: buildTourism(corridorResults),
    quota: {
      date: utcDateKey(),
      tomtomCalls: Number(dailyTomTom.get(utcDateKey()) || 0),
      limit: DAILY_TOMTOM_LIMIT
    }
  };
}

async function getLiveHazards() {
  const now = Date.now();
  if (snapshotCache && now - snapshotCache.timestamp < CACHE_TTL_MS) {
    return { snapshot: snapshotCache.snapshot, cached: true, stale: false };
  }
  if (snapshotCache) {
    if (!refreshPromise) {
      refreshPromise = refreshLiveSnapshot()
        .then(function(snapshot){
          snapshotCache = { snapshot, timestamp: Date.now() };
          return snapshot;
        })
        .finally(function(){ refreshPromise = null; });
    }
    return { snapshot: snapshotCache.snapshot, cached: true, stale: true, refreshStarted: true };
  }
  if (!refreshPromise) {
    refreshPromise = refreshLiveSnapshot()
      .then(function(snapshot){
        snapshotCache = { snapshot, timestamp: Date.now() };
        return snapshot;
      })
      .finally(function(){ refreshPromise = null; });
  }
  try {
    const snapshot = await refreshPromise;
    return { snapshot, cached: false, stale: false };
  } catch (error) {
    return {
      snapshot: null,
      cached: false,
      stale: false,
      error: error.message
    };
  }
}

module.exports = {
  CORRIDORS,
  buildAirQuality,
  classifyAirQuality,
  classifyLandslide,
  classifyFlood,
  fetchPointTelemetry,
  getPointTelemetry,
  getLiveHazards,
  refreshLiveSnapshot,
  sumRecentPrecipitation
};
