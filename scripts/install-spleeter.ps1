param(
  [string]$InstallRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force $InstallRoot | Out-Null

function Emit([string]$line) {
  Write-Output $line
  [Console]::Out.Flush()
}

function Stage([string]$name, [int]$progress) {
  Emit "PROGRESS:$progress"
  Emit "LOG:$name"
}

$pythonDir = Join-Path $InstallRoot '.python39'
$python = Join-Path $pythonDir 'python.exe'
$venv = Join-Path $InstallRoot '.venv-spleeter39'
$venvPython = Join-Path $venv 'Scripts\python.exe'
$venvScripts = Join-Path $venv 'Scripts'
$spleeter = Join-Path $venvScripts 'spleeter.exe'

try {
  if (!(Test-Path $python)) {
    Stage '正在下载 Python 3.9…' 5
    $installer = Join-Path $env:TEMP 'qimiao-python-3.9.13.exe'
    if (!(Test-Path $installer)) {
      Invoke-WebRequest -UseBasicParsing `
        'https://www.python.org/ftp/python/3.9.13/python-3.9.13-amd64.exe' `
        -OutFile $installer
    }
    Stage '正在安装 Python 3.9…' 12
    $process = Start-Process -FilePath $installer -ArgumentList @(
      '/quiet',
      'InstallAllUsers=0',
      "TargetDir=$pythonDir",
      'Include_pip=1',
      'Include_test=0',
      'Include_launcher=0',
      'Shortcuts=0',
      'PrependPath=0'
    ) -Wait -PassThru
    if ($process.ExitCode -ne 0 -or !(Test-Path $python)) {
      throw "Python 3.9 安装失败 (exit $($process.ExitCode))"
    }
  }

  if (!(Test-Path $venvPython)) {
    Stage '正在创建 Python 虚拟环境…' 22
    & $python -m venv $venv
    if (!(Test-Path $venvPython)) { throw '虚拟环境创建失败' }
  }

  Stage '正在升级 pip…' 28
  & $venvPython -m pip install --upgrade pip | Out-Host

  Stage '正在安装 Spleeter / TensorFlow（约 700 MB，请耐心等待）…' 35
  & $venvPython -m pip install spleeter==2.4.0 numpy==1.23.5 imageio-ffmpeg | Out-Host
  if (!(Test-Path $spleeter)) { throw 'Spleeter 安装失败' }

  Stage '正在配置 FFmpeg…' 82
  $ffmpegSource = & $venvPython -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
  New-Item -ItemType Directory -Force $venvScripts | Out-Null
  Copy-Item $ffmpegSource (Join-Path $venvScripts 'ffmpeg.exe') -Force

  $ffprobe = Join-Path $venvScripts 'ffprobe.exe'
  if (!(Test-Path $ffprobe)) {
    Stage '正在下载 FFprobe…' 88
    $zip = Join-Path $env:TEMP 'qimiao-ffmpeg-essentials.zip'
    if (!(Test-Path $zip)) {
      Invoke-WebRequest -UseBasicParsing `
        'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' `
        -OutFile $zip
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
    try {
      $entry = $archive.Entries | Where-Object { $_.Name -eq 'ffprobe.exe' } | Select-Object -First 1
      if (!$entry) { throw 'FFprobe 压缩包中没有 ffprobe.exe' }
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $ffprobe, $true)
    } finally {
      $archive.Dispose()
    }
  }

  Stage '验证安装…' 96
  & $venvPython -c "import tensorflow, spleeter, numpy; print('spleeter-runtime-ok')" | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Spleeter 运行验证失败' }

  Stage 'Spleeter 安装完成' 100
} catch {
  Emit "ERROR:$($_.Exception.Message)"
  exit 1
}
