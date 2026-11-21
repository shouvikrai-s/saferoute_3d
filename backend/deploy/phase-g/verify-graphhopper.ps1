$ErrorActionPreference = 'Stop'
$BaseUrl = 'http://127.0.0.1:8998/route'
$routes = @(
    @{
        Name = 'Gangtok to Pakyong'
        Start = '27.3389,88.6065'
        End = '27.2306,88.6138'
    },
    @{
        Name = 'Gangtok to Namchi'
        Start = '27.3389,88.6065'
        End = '27.1663,88.3639'
    },
    @{
        Name = 'Namchi to road control'
        Start = '27.1663,88.3639'
        End = '27.10,88.60'
    }
)

function Test-RouteGeometry($path) {
    $coordinates = @($path.points.coordinates)
    if ($coordinates.Count -lt 2) {
        return $false
    }

    foreach ($coordinate in $coordinates) {
        if ($coordinate.Count -lt 2) {
            return $false
        }

        $longitude = 0.0
        $latitude = 0.0
        if (-not [double]::TryParse([string]$coordinate[0], [ref]$longitude) -or
            -not [double]::TryParse([string]$coordinate[1], [ref]$latitude)) {
            return $false
        }

        if ($longitude -lt -180 -or $longitude -gt 180 -or
            $latitude -lt -90 -or $latitude -gt 90) {
            return $false
        }
    }

    return $true
}

foreach ($route in $routes) {
    $url = "${BaseUrl}?point=$($route.Start)&point=$($route.End)&profile=car&locale=en&points_encoded=false&instructions=true&algorithm=alternative_route&alternative_route.max_paths=3"
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing
    if ($response.StatusCode -ne 200) {
        throw "$($route.Name): GraphHopper returned HTTP $($response.StatusCode)"
    }

    $data = $response.Content | ConvertFrom-Json
    $validPaths = @($data.paths | Where-Object { Test-RouteGeometry $_ })
    if ($validPaths.Count -eq 0) {
        throw "$($route.Name): GraphHopper returned no valid route geometry."
    }

    $geometryCount = @($validPaths[0].points.coordinates).Count
    Write-Host "PASS: $($route.Name); valid_paths=$($validPaths.Count); geometry_coordinates=$geometryCount; distance_m=$($validPaths[0].distance)"
}
