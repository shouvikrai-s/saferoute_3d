$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$GhDir = Join-Path $Root 'graphhopper'
$DataFile = Join-Path $Root 'data\sikkim-kalimpong.osm.pbf'
$Jar = Join-Path $GhDir 'graphhopper-web-11.0.jar'
$Config = Join-Path $GhDir 'config.yml'
foreach ($p in @($Jar, $Config, $DataFile)) {
    if (-not (Test-Path $p)) {
        throw "Required file is missing: $p"
    }
}
New-Item -ItemType Directory -Force -Path (Join-Path $GhDir 'logs') | Out-Null
Set-Location $GhDir
Write-Host 'Starting GraphHopper using the repository configuration.'
java '-Xms2g' '-Xmx4g' "-Ddw.graphhopper.datareader.file=$DataFile" '-jar' $Jar 'server' $Config
