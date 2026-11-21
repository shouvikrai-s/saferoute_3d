# SafeRoute Phase G — Self-hosted GraphHopper

The active local setup uses GraphHopper 11.0 on port `8998` and the
expanded Sikkim road extract at
`backend/data/replacement-20261010/sikkim-network-expanded-20261010.osm.pbf`.
The active graph cache is kept separately at
`backend/graphhopper/graph-cache-expanded-20261010`; the previous PBF and
both existing cache directories were backed up before the replacement was
built.

`install-graphhopper.ps1` installs the service config and its
`saferoute-car.json` custom model. GraphHopper 11 rejects
`custom_model_files: [car.json]` because that name is reserved for its
built-in car model; keep the external custom model under the distinct
`saferoute-car.json` name.

The existing Node `/api/route` contract is unchanged. Keep its provider
URL configured for `http://127.0.0.1:8998/route`, and do not treat a
successful `/health` check as proof of routing coverage. Verify the
requested routes with `verify-graphhopper.ps1`, which checks for usable
route geometry.
