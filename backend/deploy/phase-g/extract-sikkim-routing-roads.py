import argparse
import math
import os
from pathlib import Path

import osmium


BBOX = (87.90, 26.45, 89.15, 28.10)
PLACES = {
    "Gangtok": (27.3389, 88.6065),
    "Pakyong": (27.2306, 88.6138),
    "Namchi": (27.1663, 88.3639),
    "Soreng": (27.1683, 88.1874),
    "Gyalshing": (27.2896, 88.2597),
    "Mangan": (27.5083, 88.5322),
    "Rangpo": (27.1761, 88.5287),
    "Singtam": (27.2340, 88.5014),
    "Ravangla": (27.3061, 88.3631),
    "Jorethang": (27.1482, 88.2673),
    "Nayabazar": (27.13211, 88.27614),
    "Yuksom": (27.3710, 88.2254),
    "Lachen": (27.7156, 88.5561),
    "Lachung": (27.6893, 88.7425),
    "NH-10": (27.1730, 88.5300),
}


def extract_highways(source: Path, output: Path) -> int:
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite {output}")

    west, south, east, north = BBOX
    selected = 0
    with osmium.BackReferenceWriter(output, source) as writer:
        processor = osmium.FileProcessor(source).with_locations("sparse_file_array")
        for obj in processor:
            if not obj.is_way() or not obj.tags.get("highway"):
                continue

            intersects = False
            for node in obj.nodes:
                location = node.location
                if (
                    location.valid()
                    and west <= location.lon <= east
                    and south <= location.lat <= north
                ):
                    intersects = True
                    break

            if intersects:
                writer.add_way(obj)
                selected += 1

    return selected


def merge_sources(inputs: list[Path], output: Path) -> None:
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite {output}")

    reader = osmium.MergeInputReader()
    for path in inputs:
        if not path.is_file() or path.stat().st_size == 0:
            raise FileNotFoundError(f"Missing or empty intermediate extract: {path}")
        reader.add_file(path)

    with osmium.SimpleWriter(output) as writer:
        reader.apply(writer)


def verify_output(
    path: Path,
) -> tuple[int, int, tuple[float, float, float, float], dict[str, float]]:
    highway_ways = 0
    nodes = 0
    bounds = [math.inf, math.inf, -math.inf, -math.inf]
    nearest = {name: math.inf for name in PLACES}

    processor = osmium.FileProcessor(path).with_locations("sparse_file_array")
    for obj in processor:
        if not obj.is_way() or not obj.tags.get("highway"):
            continue
        highway_ways += 1

        for node in obj.nodes:
            location = node.location
            if not location.valid():
                continue

            lon, lat = location.lon, location.lat
            bounds[0] = min(bounds[0], lon)
            bounds[1] = min(bounds[1], lat)
            bounds[2] = max(bounds[2], lon)
            bounds[3] = max(bounds[3], lat)

            for name, (place_lat, place_lon) in PLACES.items():
                if abs(lat - place_lat) > 0.025 or abs(lon - place_lon) > 0.03:
                    continue
                dx = (lon - place_lon) * 111_320 * math.cos(math.radians(place_lat))
                dy = (lat - place_lat) * 111_320
                nearest[name] = min(nearest[name], math.hypot(dx, dy))
            nodes += 1

    missing = [name for name, distance in nearest.items() if distance > 1000]
    if highway_ways == 0 or missing:
        raise RuntimeError(
            "Regional road coverage check failed"
            + (f"; no highway ways found" if highway_ways == 0 else "")
            + (f"; no nearby road nodes for: {', '.join(missing)}" if missing else "")
        )

    return nodes, highway_ways, tuple(bounds), nearest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--north-east-source", required=True, type=Path)
    parser.add_argument("--east-source", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=False)
    north_east_roads = args.output_dir / "north-east-roads.osm.pbf"
    east_roads = args.output_dir / "east-zone-roads.osm.pbf"
    output = args.output_dir / (
        "sikkim-network-expanded-"
        f"{args.output_dir.name.removeprefix('replacement-')}.osm.pbf"
    )

    ne_count = extract_highways(args.north_east_source, north_east_roads)
    east_count = extract_highways(args.east_source, east_roads)
    merge_sources([north_east_roads, east_roads], output)
    node_count, highway_count, bounds, nearest = verify_output(output)

    print(f"North-Eastern Zone highway ways selected: {ne_count}")
    print(f"Eastern Zone highway ways selected: {east_count}")
    print(f"Output highway ways: {highway_count}; highway node references: {node_count}")
    print(
        "Verified node extent: "
        f"{bounds[0]:.6f},{bounds[1]:.6f} to {bounds[2]:.6f},{bounds[3]:.6f}"
    )
    print(f"Output PBF: {output}; bytes={os.path.getsize(output)}")
    for name, distance in sorted(nearest.items()):
        print(f"Nearest road-node distance, {name}: {distance:.0f} m")


if __name__ == "__main__":
    main()
