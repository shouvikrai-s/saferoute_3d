import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.LOADTEST_BASE_URL || "http://127.0.0.1:3000";

export const options = {
  vus: Number(__ENV.LOADTEST_VUS || 1),
  iterations: Number(__ENV.LOADTEST_ITERATIONS || 10),
  thresholds: {
    http_req_failed: ["rate<0.10"],
    http_req_duration: ["p(95)<1000"],
  },
};

export default function () {
  const response = http.get(`${BASE_URL}/health`);

  check(response, {
    "health request returned 2xx": (r) =>
      r.status >= 200 && r.status < 300,
  });
}