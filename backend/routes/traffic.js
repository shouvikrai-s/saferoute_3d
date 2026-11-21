const express = require("express");
const { rateLimit } = require("../middleware/rateLimit");
const { fetchFlowTile } = require("../services/tomtomTraffic");

const router = express.Router();

function parseTileCoordinate(value, maximum) {
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) {
    return null;
  }
  return number;
}

router.get(
  "/traffic/tile/:z/:x/:y",
  rateLimit,
  async (req, res) => {
    const z = parseTileCoordinate(req.params.z, 22);
    const maxCoordinate = z === null ? null : 2 ** z - 1;
    const x = maxCoordinate === null
      ? null
      : parseTileCoordinate(req.params.x, maxCoordinate);
    const y = maxCoordinate === null
      ? null
      : parseTileCoordinate(req.params.y, maxCoordinate);

    if (z === null || x === null || y === null) {
      return res.status(400).json({
        error: "invalid_request",
        message: "Traffic tile coordinates are invalid.",
      });
    }

    try {
      const tile = await fetchFlowTile(z, x, y);
      res.status(200);
      res.set("Content-Type", tile.contentType);
      res.set("Cache-Control", tile.cacheControl || "public, max-age=30");
      if (tile.etag) res.set("ETag", tile.etag);
      return res.send(tile.body);
    } catch (error) {
      const status = Number.isInteger(error.statusCode)
        ? error.statusCode
        : 502;
      console.error(
        `[traffic-tile] request failed z=${z} x=${x} y=${y} code=${error.code || "UNKNOWN"}`
      );
      return res.status(status).json({
        error: status === 503 ? "traffic_unavailable" : "traffic_upstream_error",
        message: status === 503
          ? "Traffic service is temporarily unavailable."
          : "Unable to retrieve traffic tile.",
      });
    }
  }
);

module.exports = router;
