"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

function request(server, requestPath, method = "GET", body) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: requestPath,
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
    }, (res) => {
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { responseBody += chunk; });
      res.on("end", () => resolve({ statusCode: res.statusCode, body: responseBody }));
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test("browser-facing API routes are rate-limited and do not require a client secret", async () => {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", require("../routes/route"));
  app.use("/api", require("../routes/nearby"));
  app.use("/api", require("../routes/traffic"));
  app.use("/api", require("../routes/ai"));
  app.use("/api", require("../routes/monitoring"));
  app.use("/api", require("../routes/data"));
  app.use("/api", require("../routes/liveHazards"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const cases = [
      ["/api/monitoring/status", "GET", undefined, 200],
      ["/api/route", "GET", undefined, 400],
      ["/api/nearby/locations", "GET", undefined, 400],
      ["/api/traffic/tile/23/0/0", "GET", undefined, 400],
      ["/api/ai/analyze", "POST", {}, 400],
      ["/api/data/history?dataset=unknown", "GET", undefined, 400],
      ["/api/data/assessment", "GET", undefined, 400],
      ["/api/data/events?type=current", "GET", undefined, 400],
      ["/api/hazards/point", "GET", undefined, 400],
    ];
    for (const [requestPath, method, body, expectedStatus] of cases) {
      const response = await request(server, requestPath, method, body);
      assert.equal(response.statusCode, expectedStatus, `${method} ${requestPath}`);
      assert.doesNotMatch(response.body, /unauthorized/);
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("shipping SafeRoute HTML contains no client credential or client-key header", () => {
  const htmlPath = path.join(__dirname, "..", "..", "assets", "cesium", "Apps", "HelloWorld.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.doesNotMatch(html, /SAFEROUTE_CLIENT_KEY|X-SafeRoute-Client-Key/);
  assert.doesNotMatch(html, /mm\/hr/);
  assert.match(html, /Hazard references/);
  assert.match(html, /https:\/\/tile\.openstreetmap\.org\//);
  assert.match(html, /globe:\s*false/);
  assert.match(html, /photorealisticTileset\.tileLoad\.addEventListener/);
  assert.match(html, /photorealisticTileset\.tileFailed\.addEventListener/);
  assert.match(html, /window\.__srFormatDistance/);
  assert.match(html, /OpenStreetMap<\/a> contributors/);
  assert.doesNotMatch(html, /new Cesium\.OpenStreetMapImageryProvider/);
  assert.doesNotMatch(html, /globe\.tileLoadProgressEvent\.addEventListener/);
  assert.doesNotMatch(html, /Cesium\.Ion\.defaultAccessToken\s*=\s*["'][^"']/);
});
