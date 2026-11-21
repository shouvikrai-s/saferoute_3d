import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: 10000,
  duration: "30s",

  thresholds: {
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const res = http.get("http://127.0.0.1:8080/live");

  check(res, {
    "HTTP 200": (r) => r.status === 200,
  });
}