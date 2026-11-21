# SafeRoute 3D Startup Guide

This guide reflects the actual repository state in this workspace and the verified service layout used by the SafeRoute backend.

## 1. Prerequisites

- Node.js 18+
- PowerShell 5+ or PowerShell 7+
- A working browser for the frontend demo
- Optional: a GraphHopper API key for cloud routing
- Optional: Redis for shared cache/rate limiting
- Optional: PostgreSQL if you want the database health checks to succeed end-to-end

The repository does not require a separate Node frontend server. The backend is the only required app process for the local browser demo; the app's HTML file can be opened in a browser after the backend is running.

## 2. Required environment setup

From a PowerShell terminal:

```powershell
Set-Location "C:\projects\saferoute_3d\backend"
Copy-Item .env.example .env
notepad .env
```

Set at least the following values in `.env`:

```env
PORT=3000
ROUTING_MODE=cloud
GRAPHHOPPER_API_KEY=your_graphhopper_key_here
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=30
CACHE_TTL_MS=300000
CACHE_MAX_ENTRIES=500
```

Optional values you may also set if you are testing the advanced infrastructure path:

```env
REDIS_URL=redis://127.0.0.1:6379
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DATABASE=saferoute
POSTGRES_USER=saferoute
POSTGRES_PASSWORD=your_password
TOMTOM_API_KEY=your_tomtom_key
GRAPHHOPPER_SELF_HOSTED_URL=http://127.0.0.1:8989/route
```

## 3. Install dependencies

```powershell
Set-Location "C:\projects\saferoute_3d\backend"
npm install
```

## 4. Start the backend (required)

Use one terminal for the backend:

```powershell
Set-Location "C:\projects\saferoute_3d\backend"
node server.js
```

Expected result:

- The backend binds to `0.0.0.0:3000`
- It logs the active interfaces and reachable LAN URLs
- It prints endpoints such as `/health`, `/ready`, and `/api/route`

## 5. Verify readiness

Open a second PowerShell terminal and run:

```powershell
Invoke-WebRequest "http://127.0.0.1:3000/health" | Select-Object -ExpandProperty Content
Invoke-WebRequest "http://127.0.0.1:3000/ready" | Select-Object -ExpandProperty Content
```

Expected outcome:

- `GET /health` returns HTTP 200
- `GET /ready` returns HTTP 200 when routing is configured, or HTTP 503 when it is not
- The response includes routing metadata and whether Redis is connected

## 6. Browser-only local demonstration

After the backend is ready:

1. Open the frontend file in a browser:

```powershell
Start-Process "C:\projects\saferoute_3d\assets\cesium\Apps\HelloWorld.html"
```

2. Use the page normally.
3. Confirm the app resolves the backend route API at `http://127.0.0.1:3000/api/route` or the configured equivalent.

This is the minimum working setup for the repo as delivered. No separate frontend server is required.

## 7. Access from another device on the LAN

The backend listens on `0.0.0.0:3000`, so it can be reached from other devices on the same local network when the host machine has a valid LAN IP.

Check the startup logs for a local LAN address, then test the backend directly from another device with:

```text
http://<host-machine-ip>:3000/health
```

If the phone or another laptop cannot reach the backend, the issue is usually:

- the machine is not on the same LAN or Wi‑Fi network
- the Windows firewall is blocking inbound connections
- the host is not exposing the correct network interface
- the backend is not running or failed to bind

## 8. Flutter Android app using wireless debugging

For a physical Android device, the app still depends on the backend being reachable from the device. The server is not started by Flutter itself and no special app-side service is required beyond the correct backend URL.

Recommended flow:

```powershell
Set-Location "C:\projects\saferoute_3d"
flutter pub get
flutter devices
flutter run -d <device-id>
```

If using wireless debugging, start adb and pair the device first, then run the app with the actual device ID. The backend must be reachable from the phone on the same LAN or through your deployment target. The repo does not require a second Node server for the mobile app work.

## 9. Production-style deployment

The repo is designed around a single Node backend service with optional supporting infrastructure:

- backend on port 3000
- optional self-hosted GraphHopper on `127.0.0.1:8989/route`
- optional Redis on `6379`
- optional PostgreSQL if you enable the DB health checks and connected services

A production-style deployment therefore uses at least:

- 1 terminal for the backend
- 1 terminal for Redis if enabled
- 1 terminal for self-hosted GraphHopper if using the self_hosted routing mode

There is no separate frontend app runtime required for the web demo.

## 10. Minimum terminals for each supported mode

- Browser-only local demo: 1 terminal for the backend
- LAN access from another device: 1 terminal for the backend
- Flutter Android app with wireless debugging: 1 terminal for the backend, plus the device's own Android debugging workflow
- Production-style deployment with cloud routing: 1 terminal for the backend
- Production-style deployment with self-hosted GraphHopper + Redis: 3 terminals total in the common case (backend, GraphHopper, Redis)

## 11. Shutdown

Stop the backend with Ctrl+C in the terminal where `node server.js` is running.

If using the graceful shutdown logic in the server, the process waits up to `SHUTDOWN_TIMEOUT_MS` (default 10000 ms) for in-flight requests to finish before forcing exit.

## 12. Quick sanity checks

Use these commands after startup:

```powershell
Invoke-WebRequest "http://127.0.0.1:3000/health" | Select-Object -ExpandProperty Content
Invoke-WebRequest "http://127.0.0.1:3000/live" | Select-Object -ExpandProperty Content
Invoke-WebRequest "http://127.0.0.1:3000/ready" | Select-Object -ExpandProperty Content
```

For route testing:

```powershell
Invoke-WebRequest "http://127.0.0.1:3000/api/route?startLat=27.3389&startLon=88.6065&endLat=27.3314&endLon=88.6142" | Select-Object -ExpandProperty Content
```

## 13. Known limitations

This repository does not include a validated, production-grade official flood warning feed, verified live dam feed, or real live traffic stream by default. The model outputs and monitoring features are intentionally labelled as contextual, experimental, or unavailable unless a verified source is actually configured and tested.
