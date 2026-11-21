"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");

process.env.ROUTING_MODE = "self_hosted";
process.env.GRAPHHOPPER_SELF_HOSTED_URL = "http://graphhopper.test/route";
process.env.REDIS_URL = "";

const app = express();
app.use("/api", require("../routes/route"));
const server = app.listen(0, "127.0.0.1");

function request(query) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: `/api/route?${query}` }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ statusCode: response.statusCode, body: JSON.parse(body) }));
    }).on("error", reject);
  });
}

function routeQuery(offset) {
  return `startLat=${27.3 + offset}&startLon=88.6&endLat=${27.2 + offset}&endLon=88.5`;
}

function upstreamResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => typeof payload === "string" ? payload : JSON.stringify(payload),
    json: async () => {
      if (payload instanceof Error) throw payload;
      if (typeof payload === "string") return JSON.parse(payload);
      return payload;
    },
  };
}

async function withFetch(fetchMock, callback) {
  const previousFetch = global.fetch;
  global.fetch = fetchMock;
  try {
    return await callback();
  } finally {
    global.fetch = previousFetch;
  }
}

test("valid upstream geometry is returned as a successful route", async () => {
  await withFetch(async () => upstreamResponse({
    paths: [{
      points: { coordinates: [[88.6, 27.3], [88.5, 27.2]] },
      distance: 1000,
      time: 60000,
      instructions: [{ text: "Continue" }],
    }],
  }), async () => {
    const result = await request(routeQuery(0.01));
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.paths.length, 1);
    assert.equal(result.body.paths[0].points.coordinates.length, 2);
  });
});

test("empty upstream paths are reported as no route, not a successful route", async () => {
  await withFetch(async () => upstreamResponse({ paths: [] }), async () => {
    const result = await request(routeQuery(0.02));
    assert.equal(result.statusCode, 404);
    assert.equal(result.body.error, "route_not_found");
  });
});

test("GraphHopper point-out-of-bounds responses are reported as no route", async () => {
  await withFetch(async () => upstreamResponse({
    message: "Point 0 is out of bounds",
  }, 400), async () => {
    const result = await request(routeQuery(0.021));
    assert.equal(result.statusCode, 404);
    assert.equal(result.body.error, "route_not_found");
  });
});

test("upstream HTTP 502 is exposed as a routing failure", async () => {
  await withFetch(async () => upstreamResponse("upstream unavailable", 502), async () => {
    const result = await request(routeQuery(0.03));
    assert.equal(result.statusCode, 502);
    assert.equal(result.body.error, "upstream_error");
  });
});

test("upstream timeout is exposed as HTTP 504", async () => {
  await withFetch(async () => {
    throw Object.assign(new Error("simulated upstream timeout"), { name: "AbortError" });
  }, async () => {
    const result = await request(routeQuery(0.04));
    assert.equal(result.statusCode, 504);
    assert.equal(result.body.error, "upstream_timeout");
  });
});

test("malformed upstream JSON is rejected as an invalid response", async () => {
  await withFetch(async () => upstreamResponse(new SyntaxError("Unexpected token")), async () => {
    const result = await request(routeQuery(0.05));
    assert.equal(result.statusCode, 502);
    assert.equal(result.body.error, "invalid_upstream_response");
  });
});

test("invalid route coordinates are rejected before contacting GraphHopper", async () => {
  let upstreamCalled = false;
  await withFetch(async () => {
    upstreamCalled = true;
    return upstreamResponse({ paths: [] });
  }, async () => {
    const result = await request("startLat=91&startLon=88.6&endLat=27.2&endLon=88.5");
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.error, "invalid_range");
    assert.equal(upstreamCalled, false);
  });
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
