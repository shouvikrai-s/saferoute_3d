$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$GhDir = Join-Path $Root 'graphhopper'
New-Item -ItemType Directory -Force -Path $GhDir | Out-Null

$javaExe = (Get-Command java -ErrorAction Stop).Source
$javaFileVersion = (Get-Item $javaExe).VersionInfo.ProductVersion
$major = [int]($javaFileVersion -split "\.")[0]
Write-Host "Java executable: $javaExe"
Write-Host "Java file version: $javaFileVersion"
if ($major -lt 25) { throw "Detected Java major version '$major'. GraphHopper 11.0 requires Java 25+." }
$jarUrl = 'https://repo1.maven.org/maven2/com/graphhopper/graphhopper-web/11.0/graphhopper-web-11.0.jar'
$jarPath = Join-Path $GhDir 'graphhopper-web-11.0.jar'
if (-not (Test-Path $jarPath)) { Invoke-WebRequest -Uri $jarUrl -OutFile $jarPath }
Copy-Item (Join-Path $PSScriptRoot 'graphhopper-config.yml') (Join-Path $GhDir 'config.yml') -Force
Copy-Item (Join-Path $PSScriptRoot 'saferoute-car.json') (Join-Path $GhDir 'saferoute-car.json') -Force
Write-Host "GraphHopper files ready in $GhDir"
