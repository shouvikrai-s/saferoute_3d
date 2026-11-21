import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.LOADTEST_BASE_URL || "http://127.0.0.1:3000";
const CLIENT_KEY =
  __ENV.LOADTEST_CLIENT_KEY || "sr3d-a91f4c2e-client";

export const options = {
  vus: Number(__ENV.LOADTEST_VUS || 1),
  iterations: Number(__ENV.LOADTEST_ITERATIONS || 10),

  thresholds: {
    http_req_failed: ["rate<0.10"],
    http_req_duration: ["p(95)<5000"],
  },
};

function pickRoutePair() {
  const i = __ITER + __VU * 10000;

  return {
    startLat: 27.05 + ((i * 17) % 300) / 10000,
    startLon: 88.25 + ((i * 23) % 400) / 10000,
    endLat: 27.10 + ((i * 29) % 300) / 10000,
    endLon: 88.30 + ((i * 31) % 400) / 10000,
  };
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