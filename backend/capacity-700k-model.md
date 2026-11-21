# SafeRoute 3D - 700k Capacity Workload Model

Population target: 700000

## Initial planning assumptions
- Daily active users: 122500
- Peak-hour users: 24500
- Peak concurrent active users: 2450

## Initial workload target
- Normal planning load: approximately 5 RPS
- Elevated load: approximately 10 RPS
- Burst load: approximately 20 RPS
- Engineering headroom target: approximately 40 RPS

## Important
These are engineering assumptions, not measured production traffic.
They must be replaced with real SafeRoute usage analytics after deployment.

## Measurement
Record:
- sustained RPS
- concurrency
- p50 latency
- p95 latency
- p99 latency
- error rate
- rate limiting
- Node CPU/RAM
- PostgreSQL CPU/connections/query latency
- Redis latency/cache hit rate
- GraphHopper latency/errors
- Nginx connections/errors
- upstream queue depth
- circuit breaker state
