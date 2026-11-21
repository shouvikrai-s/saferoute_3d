// LOCAL MOCK GRAPHHOPPER — testing only, never called by production code.
//
// Simulates the upstream behaviors Phase 1 needs to prove against:
// fast 200, slow (configurable delay), 429, 502/503/504, and a
// "persistent_fail" mode that always errors (for circuit-breaker
// testing). Behavior is controlled via POST /mock/config so test
// scripts can flip modes without restarting this process or touching
// the real backend's coordinate values.
//
// Run standalone: node test/mock-graphhopper.js
// Default port: 8990 (does not collide with the real backend on 3000
// or real self-hosted GraphHopper's usual 8989).

const express = require("express");
const app = express();
app.use(express.json());

const PORT = Number(process.env.MOCK_PORT || 8990);

let state = {
  mode: "fast", // "fast" | "slow" | "429" | "502" | "503" | "504" | "persistent_fail"
  delayMs: 3000, // used by "slow" mode
};

let requestCount = 0;

function samplePathResponse() {
  // Minimal but shape-correct GraphHopper response — real coordinates
  // near Gangtok/Rangpo so it's obviously mock data, never confusable
  // with a real route.
  return {
    paths: [
      {
        points: {
          type: "LineString",
          coordinates: [
            [88.6065, 27.3389],
            [88.6142, 27.3314],
          ],
        },
        instructions: [
          { text: "MOCK ROUTE — not a real GraphHopper response", distance: 1000, time: 60000, interval: [0, 1] },
        ],
        distance: 1000,
        time: 60000,
      },
    ],
  };
}

app.post("/mock/config", (req, res) => {
  const { mode, delayMs } = req.body || {};
  const validModes = ["fast", "slow", "429", "502", "503", "504", "persistent_fail"];
  if (mode !== undefined) {
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: "invalid_mode", validModes });
    }
    state.mode = mode;
  }
  if (delayMs !== undefined) {
    state.delayMs = Number(delayMs);
  }
  console.log(`[mock-graphhopper] config set: mode=${state.mode} delayMs=${state.delayMs}`);
  res.status(200).json({ state });
});

app.post("/mock/reset", (req, res) => {
  requestCount = 0;
  res.status(200).json({ requestCount });
});

app.get("/mock/status", (req, res) => {
  res.status(200).json({ state, requestCount });
});

app.get("/route", async (req, res) => {
  requestCount++;
  const thisRequestNum = requestCount;
  console.log(`[mock-graphhopper] GET /route #${thisRequestNum} (mode=${state.mode})`);

  switch (state.mode) {
    case "fast":
      return res.status(200).json(samplePathResponse());

    case "slow":
      await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      return res.status(200).json(samplePathResponse());

    case "429":
      return res.status(429).json({ message: "MOCK: rate limit exceeded" });

    case "502":
      return res.status(502).json({ message: "MOCK: bad gateway" });

    case "503":
      return res.status(503).json({ message: "MOCK: service unavailable" });

    case "504":
      return res.status(504).json({ message: "MOCK: gateway timeout" });

    case "persistent_fail":
      return res.status(500).json({ message: "MOCK: persistent upstream failure" });

    default:
      return res.status(500).json({ message: "MOCK: unknown state" });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-graphhopper] listening on http://127.0.0.1:${PORT}`);
  console.log(`  GET  /route`);
  console.log(`  POST /mock/config   { "mode": "fast|slow|429|502|503|504|persistent_fail", "delayMs": 3000 }`);
  console.log(`  GET  /mock/status`);
  console.log(`  POST /mock/reset`);
});
