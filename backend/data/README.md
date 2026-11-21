# Self-hosted routing data

## Active extract and graph

The active SafeRoute GraphHopper 11 setup uses:

- Regional road extract:
  `replacement-20261010/sikkim-network-expanded-20261010.osm.pbf`
- Graph cache:
  `../graphhopper/graph-cache-expanded-20261010`
- GraphHopper config:
  `../graphhopper/config.yml`
- Start script:
  `../deploy/phase-g/start-graphhopper.ps1`

The extract combines the current Geofabrik North-Eastern Zone and Eastern
Zone sources. This includes Sikkim and the Siliguri-side road connection
for NH-10. The source files used for this build were staged at
`G:\SafeRoute3D-OSM-staging-20261010`.

The road-only extract selected highway ways intersecting
`87.90,26.45,89.15,28.10` and retained their referenced nodes. Its verified
node extent is longitude `87.875477..89.170252`, latitude
`26.389662..28.205434`; GraphHopper 11 reported the same graph bounds.
It contains 68,881 highway ways, 1,375,446 unique highway nodes, and
1,471,968 way-node references. Road nodes were
verified within 327 m of every configured destination from Gangtok,
Pakyong, Namchi, Soreng, Gyalshing, Mangan, Rangpo, Singtam, Ravangla,
Jorethang, Nayabazar, Yuksom, Lachen, Lachung, and the NH-10 reference.

To prepare a fresh dated extract without overwriting existing files, run
`../deploy/phase-g/download-sikkim-kalimpong-data.ps1`. It requires
Python and PyOsmium (`python -m pip install osmium==4.3.1`) and checks
available disk space before downloading. The script stages new region
sources and writes into a new dated output directory. It fails rather than
overwriting an existing output.

## Previous data and rollback

The original `sikkim-kalimpong.osm.pbf` and both pre-existing graph-cache
directories remain untouched. Byte-identical copies of the source,
`graphhopper/graph-cache`, the secondary `backend/graph-cache`, and the
routing configuration are preserved at:

`../backups/graphhopper-pre-replacement-20261010-0015`

The expanded graph was built in its own cache. To roll back, stop
GraphHopper and use
`../backups/graphhopper-pre-replacement-20261010-0015/config/rollback-config.yml`
with the original PBF at `sikkim-kalimpong.osm.pbf`. That rollback config
uses the original `graph-cache` and the valid `saferoute-car.json` profile.
The byte-for-byte saved `active-config.yml` is retained for audit, but
contains the rejected `car.json` model filename and must not be used for
restart. SafeRoute's backend URL remains `127.0.0.1:8998/route`.

## Resource estimate for this build

Before downloading, C: had approximately 6.85 GB free. The two Geofabrik
source PBFs were 109,749,843 and 247,225,365 bytes (about 341 MiB total)
and were staged on G:, which had about 83 GB free. A conservative
1.5-GB allowance was reserved for source, extraction, import, and the new
cache. The merged road extract is 8,103,622 bytes and its graph cache is
about 21 MB. The prior data was backed up before creating the replacement.

## GraphHopper 11 profile configuration

The profile uses the distinct `saferoute-car.json` file. GraphHopper 11
reserves the `car.json` custom-model name for its built-in car model and
rejects it when listed as an external `custom_model_files` entry. The
installed `car` profile was verified through `/info` and real route
requests.

## Route verification

The replacement graph returned non-empty provider-generated geometry for
Gangtok–Pakyong, Gangtok–Namchi, Namchi–control, and direct connection
checks from Gangtok to all listed destinations. SafeRoute's `/api/route`
was separately tested against the replacement provider before switching
the main GraphHopper instance. Browser/UI verification is not covered by
these backend checks.
