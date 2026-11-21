import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.LOADTEST_BASE_URL || "http://127.0.0.1:3000";
const CLIENT_KEY =
  __ENV.LOADTEST_CLIENT_KEY || "sr3d-a91f4c2e-client";

const ROUTE_PAIRS = [
  { startLat: 27.3389, startLon: 88.6065, endLat: 27.3314, endLon: 88.6138 },
  { startLat: 27.0410, startLon: 88.2540, endLat: 27.0667, endLon: 88.2333 },
  { startLat: 27.2833, startLon: 88.5833, endLat: 27.3389, endLon: 88.6065 },
  { startLat: 27.1667, startLon: 88.5333, endLat: 27.2833, endLon: 88.5833 },
];

export const options = {
  vus: Number(__ENV.LOADTEST_VUS || 1),
  iterations: Number(__ENV.LOADTEST_ITERATIONS || 10),

  thresholds: {
    http_req_failed: ["rate<0.10"],
    http_req_duration: ["p(95)<5000"],
  },
};

function pickRoutePair() {
  return ROUTE_PAIRS[Math.floor(Math.random() * ROUTE_PAIRS.length)];
}

export default function () {
  const p = pickRoutePair();

  const url =
    `${BASE_URL}/api/route` +
    `?startLat=${p.startLat}` +
    `&startLon=${p.startLon}` +
    `&endLat=${p.endLat}` +
    `&endLon=${p.endLon}`;

  const response = http.get(url, {
    headers: {
      "X-SafeRoute-Client-Key": CLIENT_KEY,
    },
    tags: {
      name: "GET /api/route",
    },
  });

  check(response, {
    "route request returned 2xx": (r) =>
      r.status >= 200 && r.status < 300,
  });
}