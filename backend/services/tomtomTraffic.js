const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY || "";
const TOMTOM_BASE_URL =
  "https://api.tomtom.com/maps/orbis/traffic/tile/flow";
const UPSTREAM_TIMEOUT_MS = 12000;
const MAX_TILE_BYTES = 5 * 1024 * 1024;

function buildTileUrl(z, x, y) {
  const url = new URL(`${TOMTOM_BASE_URL}/${z}/${x}/${y}.pbf`);
  url.searchParams.set("apiVersion", "1");
  url.searchParams.set("tags", "relative_speed");
  url.searchParams.set("key", TOMTOM_API_KEY);
  return url;
}

async function readLimitedBody(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TILE_BYTES) {
    throw new Error("TomTom traffic tile exceeded the response size limit.");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_TILE_BYTES) {
      throw new Error("TomTom traffic tile exceeded the response size limit.");
    }
    return body;
  }

  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_TILE_BYTES) {
        await reader.cancel();
        throw new Error("TomTom traffic tile exceeded the response size limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

async function fetchFlowTile(z, x, y) {
  if (!TOMTOM_API_KEY) {
    const error = new Error("TomTom traffic service is not configured.");
    error.statusCode = 503;
    error.code = "TOMTOM_NOT_CONFIGURED";
    throw error;
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), UPSTREAM_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(buildTileUrl(z, x, y), {
      method: "GET",
      headers: {
        Accept: "application/x-protobuf, application/octet-stream",
        "TomTom-Api-Version": "1",
      },
      signal: abortController.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("TomTom traffic service timed out.");
      timeoutError.statusCode = 504;
      timeoutError.code = "TOMTOM_TIMEOUT";
      throw timeoutError;
    }
    error.statusCode = 502;
    error.code = "TOMTOM_NETWORK_ERROR";
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const error = new Error(`TomTom traffic service returned HTTP ${response.status}.`);
    error.statusCode = response.status === 429 ? 503 : 502;
    error.code = "TOMTOM_UPSTREAM_ERROR";
    error.upstreamStatus = response.status;
    throw error;
  }

  const body = await readLimitedBody(response);
  return {
    body,
    contentType: response.headers.get("content-type") || "application/x-protobuf",
    cacheControl: response.headers.get("cache-control"),
    etag: response.headers.get("etag"),
  };
}

module.exports = {
  fetchFlowTile,
};
