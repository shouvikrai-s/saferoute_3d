"use strict";

const CORRIDORS = [
  { name: "Gangtok", district: "East", lat: 27.3389, lon: 88.6065, road: "NH-10 Gangtok–Deorali" },
  { name: "Namchi", district: "South", lat: 27.1665, lon: 88.3639, road: "Jorethang–Namchi Road" },
  { name: "Mangan", district: "North", lat: 27.5097, lon: 88.5322, road: "North Sikkim Highway NH-310A" },
  { name: "Gyalshing", district: "West", lat: 27.2896, lon: 88.2570, road: "Legship–Gyalshing Road" },
  { name: "Pakyong", district: "Pakyong", lat: 27.2345, lon: 88.5912, road: "Rorathang–Pakyong Road" },
  { name: "Soreng", district: "Soreng", lat: 27.1683, lon: 88.2036, road: "Sombaria–Soreng Corridor" },
  { name: "Rangpo", district: "East", lat: 27.1770, lon: 88.5328, road: "NH-10 Sikkim–Bengal Entry Gate" },
  { name: "Singtam", district: "East", lat: 27.2346, lon: 88.5015, road: "NH-10 Teesta–Singtam Junction" },
];

const FACILITIES = [
  { name: "Central Referral Hospital", facility_type: "hospital", district: "East", latitude: 27.3162391, longitude: 88.5972587 },
  { name: "STNM Hospital", facility_type: "hospital", district: "East", latitude: 27.3449449, longitude: 88.6038244 },
  { name: "District Hospital Singtam", facility_type: "hospital", district: "East", latitude: 27.2296952, longitude: 88.4946887 },
  { name: "Sadar Police Station", facility_type: "police", district: "East", latitude: 27.333706, longitude: 88.6150315 },
  { name: "Sikkim Police Headquarters", facility_type: "police", district: "East", latitude: 27.3301671, longitude: 88.6119303 },
  { name: "Tadong Police Station", facility_type: "police", district: "East", latitude: 27.3144007, longitude: 88.6010724 },
  { name: "Ranipool Police Station", facility_type: "police", district: "East", latitude: 27.2936311, longitude: 88.5908099 },
  { name: "District Hospital Namchi", facility_type: "hospital", district: "South", latitude: 27.1613101, longitude: 88.3581313 },
  { name: "Namchi Police Station", facility_type: "police", district: "South", latitude: 27.1647289, longitude: 88.3603093 },
  { name: "District Hospital Gyalshing", facility_type: "hospital", district: "West", latitude: 27.2911331, longitude: 88.2568793 },
  { name: "Police Station Geyzing", facility_type: "police", district: "West", latitude: 27.2881708, longitude: 88.2574613 },
  { name: "Mangan District Hospital", facility_type: "hospital", district: "North", latitude: 27.4908521, longitude: 88.5318815 },
  { name: "Mangan Police Station", facility_type: "police", district: "North", latitude: 27.5025105, longitude: 88.5359942 },
];

const TOURISM = [
  { circuit: "North Sikkim", destinations: ["Lachung", "Yumthang", "Gurudongmar Lake"], lat: 27.6893, lon: 88.7425 },
  { circuit: "East Sikkim Silk Route", destinations: ["Tsomgo Lake", "Baba Mandir", "Nathula Pass"], lat: 27.3389, lon: 88.6065 },
  { circuit: "West Sikkim", destinations: ["Pelling", "Skywalk", "Yuksom"], lat: 27.2896, lon: 88.2570 },
  { circuit: "South Sikkim", destinations: ["Ravangla Buddha Park", "Namchi Char Dham"], lat: 27.1665, lon: 88.3639 },
];

function distanceMeters(lat1, lon1, lat2, lon2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestCorridor(lat, lon) {
  return CORRIDORS.map((corridor) => ({
    ...corridor,
    distanceMeters: Math.round(distanceMeters(lat, lon, corridor.lat, corridor.lon)),
  })).sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
}

function assessment(lat, lon) {
  const corridor = nearestCorridor(lat, lon);
  const generatedAt = new Date().toISOString();
  const regionalAssessment = {
    status: "ACTIVE_SCREENING",
    risk: "UNASSESSED",
    riskScore: null,
    summary: "Regional corridor screening is ready; current provider measurements determine the risk score.",
    nearestCorridor: corridor,
  };
  return {
    status: "regional_reference_fallback",
    assessmentType: "REGIONAL_CORRIDOR_CONTEXT",
    generatedAt,
    requestedLocation: { latitude: lat, longitude: lon },
    assessment: regionalAssessment,
    regionalScreening: regionalAssessment,
    weather: null,
    discharge: null,
    source: "SafeRoute regional corridor and facility references",
    dataState: "REFERENCE_CONTEXT",
  };
}

function nearby(endpointName, params) {
  const { lat, lon, radius, limit, offset } = params;
  const withDistance = (records) => records
    .map((record) => ({
      ...record,
      distance_meters: Math.round(distanceMeters(lat, lon, record.latitude || record.lat, record.longitude || record.lon)),
    }))
    .filter((record) => record.distance_meters <= radius)
    .sort((a, b) => a.distance_meters - b.distance_meters);

  let responseKey;
  let records;
  if (endpointName === "nearby-emergency") {
    responseKey = "emergencyFacilities";
    records = withDistance(FACILITIES);
  } else if (endpointName === "nearby-tourism") {
    responseKey = "tourism";
    records = withDistance(TOURISM.map((place) => ({
      name: place.circuit,
      category: "regional_tourism_circuit",
      destinations: place.destinations,
      latitude: place.lat,
      longitude: place.lon,
      dataState: "REFERENCE",
    })));
  } else if (endpointName === "nearby-hazards") {
    responseKey = "hazards";
    records = [];
  } else if (endpointName === "nearby-roads") {
    responseKey = "roads";
    records = withDistance(CORRIDORS.map((corridor) => ({
      road_name: corridor.road,
      district: corridor.district,
      latitude: corridor.lat,
      longitude: corridor.lon,
      dataState: "REFERENCE",
    })));
  } else {
    responseKey = "locations";
    records = withDistance(FACILITIES.map((facility) => ({
      name: facility.name,
      category: facility.facility_type,
      district: facility.district,
      latitude: facility.latitude,
      longitude: facility.longitude,
      dataState: "REFERENCE",
    })));
  }

  const page = records.slice(offset, offset + limit);
  return {
    status: "regional_reference_fallback",
    dataState: "REFERENCE_CONTEXT",
    count: page.length,
    radiusMeters: radius,
    limit,
    offset,
    source: "SafeRoute bundled Sikkim regional references",
    regionalContext: {
      status: "ACTIVE_SCREENING",
      risk: "UNASSESSED",
      summary: "Reference locations are available; a database outage does not create live incident or facility-status observations.",
      nearestCorridor: nearestCorridor(lat, lon),
    },
    [responseKey]: page,
  };
}

module.exports = { assessment, nearby };
