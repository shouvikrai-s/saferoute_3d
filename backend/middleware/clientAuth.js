// Optional credential check for confidential server-to-server callers.
// Never embed SAFEROUTE_CLIENT_KEY in a browser or mobile app: distributed
// client code cannot keep a credential secret. Public app APIs use input
// validation and per-IP rate limiting instead.

const EXPECTED_KEY = process.env.SAFEROUTE_CLIENT_KEY || "";

function requireClientKey(req, res, next) {
  if (!EXPECTED_KEY) {
    // No key configured server-side — fail OPEN with a clear log, not
    // silently. This matches the "graceful fallback, never a hard
    // outage" pattern already used for Redis in this backend: a
    // missing optional-hardening config shouldn't take routing down,
    // but it must be visible that the check isn't actually active.
    console.warn(
      "[auth] SAFEROUTE_CLIENT_KEY is not set in the environment — " +
      "client-key check is DISABLED. Set it in backend/.env before " +
      "relying on this as an abuse-reduction layer."
    );
    return next();
  }

  const provided = req.get("X-SafeRoute-Client-Key");
  if (provided !== EXPECTED_KEY) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Missing or invalid client credential.",
    });
  }

  next();
}

module.exports = { requireClientKey };