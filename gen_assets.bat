@echo off
setlocal enabledelayedexpansion
set "BASE=%cd%\"
> cesium_assets_list.txt (
  for /f "delims=" %%D in ('dir /s /b /ad "assets\cesium"') do (
    set "full=%%D"
    set "rel=!full:%BASE%=!"
    set "rel=!rel:\=/!"
    echo     - !rel!/
  )
)
echo Done. Check cesium_assets_list.txt