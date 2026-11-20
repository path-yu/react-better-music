param(
  [string]$InstallRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'SilentlyContinue'
$venv = Join-Path $InstallRoot '.venv-spleeter39'
$scripts = Join-Path $venv 'Scripts'
$python = Join-Path $scripts 'python.exe'
$spleeter = Join-Path $scripts 'spleeter.exe'
$ffmpeg = Join-Path $scripts 'ffmpeg.exe'
$ffprobe = Join-Path $scripts 'ffprobe.exe'

$result = [ordered]@{
  available = (Test-Path $python) -and (Test-Path $spleeter) -and (Test-Path $ffmpeg) -and (Test-Path $ffprobe)
  installRoot = $InstallRoot
  venv = if (Test-Path $venv) { $venv } else { $null }
  python = Test-Path $python
  spleeter = Test-Path $spleeter
  ffmpeg = Test-Path $ffmpeg
  ffprobe = Test-Path $ffprobe
}

if ($result.available) {
  $version = & $spleeter --version 2>$null
  if ($LASTEXITCODE -eq 0 -and $version) {
    $result['version'] = ($version | Select-Object -First 1)
  }
}

$result | ConvertTo-Json -Compress
