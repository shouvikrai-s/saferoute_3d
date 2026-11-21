param(
    [string]$DataStamp = (Get-Date -Format 'yyyyMMdd')
)

$ErrorActionPreference = 'Stop'

if ($DataStamp -notmatch '^\d{8}$') {
    throw 'DataStamp must use YYYYMMDD format.'
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$DataDir = Join-Path $Root 'data'
$SourceDir = Join-Path $DataDir "sources-$DataStamp"
$OutputDir = Join-Path $DataDir "replacement-$DataStamp"
$NorthEastSource = Join-Path $SourceDir 'north-eastern-zone-latest.osm.pbf'
$EastSource = Join-Path $SourceDir 'eastern-zone-latest.osm.pbf'
$Extractor = Join-Path $PSScriptRoot 'extract-sikkim-routing-roads.py'
$RequiredFreeBytes = 1.5GB

if (Test-Path $OutputDir) {
    throw "Refusing to overwrite existing replacement data: $OutputDir"
}

$driveName = [System.IO.Path]::GetPathRoot($DataDir).Substring(0, 1)
$drive = Get-PSDrive -Name $driveName
if ($drive.Free -lt $RequiredFreeBytes) {
    throw "At least 1.5 GB must be free on $($drive.Name): before downloading and importing."
}

$python = (Get-Command python -ErrorAction Stop).Source
& $python -c 'import osmium' 2>$null
if ($LASTEXITCODE -ne 0) {
    throw 'PyOsmium is required. Install it with: python -m pip install osmium==4.3.1'
}

New-Item -ItemType Directory -Force -Path $SourceDir | Out-Null
$sources = @(
    @{
        Path = $NorthEastSource
        Url = 'https://download.geofabrik.de/asia/india/north-eastern-zone-latest.osm.pbf'
        MinimumBytes = 50000000
    },
    @{
        Path = $EastSource
        Url = 'https://download.geofabrik.de/asia/india/eastern-zone-latest.osm.pbf'
        MinimumBytes = 100000000
    }
)

foreach ($source in $sources) {
    if (-not (Test-Path $source.Path)) {
        Write-Host "Downloading $([System.IO.Path]::GetFileName($source.Path))"
        Invoke-WebRequest -Uri $source.Url -OutFile $source.Path
    }

    if ((Get-Item $source.Path).Length -lt $source.MinimumBytes) {
        throw "Source extract is unexpectedly small: $($source.Path)"
    }
}

& $python $Extractor `
    --north-east-source $NorthEastSource `
    --east-source $EastSource `
    --output-dir $OutputDir
if ($LASTEXITCODE -ne 0) {
    throw "Regional routing extract preparation failed with exit code $LASTEXITCODE"
}

Write-Host "Regional routing data prepared at $OutputDir"
