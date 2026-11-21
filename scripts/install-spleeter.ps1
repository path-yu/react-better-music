param(
  [string]$InstallRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$Proxy = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# PowerShell 5.1 writes native stdout using the Windows ANSI/OEM code page by
# default. The Bun install reader decodes the pipe as UTF-8, which corrupts
# Chinese stage labels such as "正在安装依赖". Force UTF-8 for the whole script.
$utf8 = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $utf8
[Console]::OutputEncoding = $utf8
[Console]::InputEncoding = $utf8
# Python's redirected stdout otherwise uses the system code page (GBK on
# Chinese Windows), corrupting Unicode paths returned by imageio_ffmpeg.
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'

# Do not let a parent process's Python injection (for example an IDE shim in
# PYTHONPATH) leak into the private venv. It can break pip's uninstall step and
# leave spleeter half-installed.
Remove-Item Env:PYTHONPATH, Env:PYTHONHOME, Env:PYTHONSTARTUP -ErrorAction SilentlyContinue

$proxyValue = $Proxy.Trim()
if ($proxyValue) {
  $env:HTTP_PROXY = $proxyValue
  $env:HTTPS_PROXY = $proxyValue
  $env:ALL_PROXY = $proxyValue
}

function Download-File(
  [string]$Url,
  [string]$OutFile,
  [int]$TimeoutSeconds = 300,
  [int]$Attempts = 3
) {
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      if ($curl) {
        $curlArgs = @(
          '-L',
          '--fail',
          '--retry',
          '1',
          '--connect-timeout',
          '15',
          '--max-time',
          "$TimeoutSeconds"
        )
        if ($proxyValue) { $curlArgs += @('-x', $proxyValue) }
        $curlArgs += @('-o', $OutFile, $Url)
        & $curl.Source @curlArgs 2>$null
        if ($LASTEXITCODE -eq 0 -and (Test-Path $OutFile)) {
          return
        }
      } else {
        $params = @{
          Uri = $Url
          OutFile = $OutFile
          UseBasicParsing = $true
          TimeoutSec = $TimeoutSeconds
        }
        if ($proxyValue) { $params.Proxy = $proxyValue }
        Invoke-WebRequest @params
        return
      }
    } catch {
      # Retry transient TLS/connection resets.
    }
    Start-Sleep -Seconds 1
  }
  throw "下载失败：$Url"
}

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
  $basePython = $python

  # Prefer a working Python 3.9 already on the machine. This avoids touching
  # the Windows Installer at all and also rescues machines whose previous
  # per-user Python bundle is stuck in a broken repair/uninstall state.
  if (!(Test-Path $basePython)) {
    $pythonCandidates = @(
      (Join-Path $env:USERPROFILE 'miniconda3\python.exe'),
      (Join-Path $env:USERPROFILE 'anaconda3\python.exe'),
      (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python39\python.exe'),
      (Join-Path $env:ProgramFiles 'Python39\python.exe'),
      'C:\Python39\python.exe'
    )
    $pathPython = Get-Command python.exe -All -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue
    if ($pathPython) { $pythonCandidates += $pathPython }

    foreach ($candidate in $pythonCandidates) {
      if (!$candidate -or !(Test-Path $candidate)) { continue }
      $is39 = & $candidate -c "import sys; print(1 if sys.version_info[:2] == (3, 9) else 0)" 2>$null
      if (($is39 -join '').Trim() -eq '1') {
        $basePython = $candidate
        Stage '检测到系统 Python 3.9，正在创建虚拟环境…' 12
        break
      }
    }
  }

  if (!(Test-Path $basePython)) {
    Stage '正在下载 Python 3.9…' 5
    $installer = Join-Path $env:TEMP 'qimiao-python-3.9.13.exe'
    if (!(Test-Path $installer)) {
      Download-File `
        'https://www.python.org/ftp/python/3.9.13/python-3.9.13-amd64.exe' `
        $installer
    }

    # A previous install can leave the per-user Python 3.9 bundle registered
    # while its files were rolled back. The installer then enters repair mode
    # and exits with 1603 before writing python.exe. Try removing that stale
    # private runtime first, but never touch a Python outside our target.
    $registeredPath = $null
    $pythonRegistry = 'HKCU:\Software\Python\PythonCore\3.9\InstallPath'
    if (Test-Path $pythonRegistry) {
      $registeredPath = (Get-ItemProperty -Path $pythonRegistry).'(default)'
    }
    $ourPath = $pythonDir.TrimEnd('\').ToLowerInvariant()
    $stalePrivateRuntime =
      $registeredPath -and
      $registeredPath.TrimEnd('\').ToLowerInvariant() -eq $ourPath
    if ($stalePrivateRuntime) {
      Stage '正在清理上次失败的 Python 安装…' 8
      $uninstall = Start-Process -FilePath $installer -ArgumentList @(
        '/uninstall',
        '/quiet'
      ) -Wait -PassThru
      if ($uninstall.ExitCode -eq 0 -and (Test-Path $pythonDir)) {
        Remove-Item $pythonDir -Recurse -Force -ErrorAction SilentlyContinue
      } elseif ($uninstall.ExitCode -ne 0) {
        # A broken MSI uninstall must not block a fresh install forever.
        Stage 'Python 残留无法卸载，改用独立安装位置…' 9
        $pythonDir = Join-Path $env:TEMP 'qimiao-spleeter-python39'
      }
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
    $python = Join-Path $pythonDir 'python.exe'
    if ($process.ExitCode -ne 0 -or !(Test-Path $python)) {
      throw "Python 3.9 安装失败 (exit $($process.ExitCode))"
    }
    $basePython = $python
  }

  if (!(Test-Path $venvPython)) {
    Stage '正在创建 Python 虚拟环境…' 22
    & $basePython -m venv $venv
    if (!(Test-Path $venvPython)) { throw '虚拟环境创建失败' }
  }

  Stage '正在升级 pip…' 28
  & $venvPython -m pip install --upgrade pip | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "pip 升级失败 (exit $LASTEXITCODE)"
  }

  Stage '正在安装 Spleeter / TensorFlow（约 700 MB，请耐心等待）…' 35
  & $venvPython -m pip install spleeter==2.4.0 numpy==1.23.5 imageio-ffmpeg | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Spleeter 依赖安装失败 (exit $LASTEXITCODE)"
  }
  if (!(Test-Path $spleeter)) { throw 'Spleeter 安装失败：未生成 spleeter.exe' }

  Stage '正在配置 FFmpeg…' 82
  $ffmpegSource = (& $venvPython -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())").Trim()
  if (!(Test-Path -LiteralPath $ffmpegSource)) {
    throw "找不到 imageio-ffmpeg 的 ffmpeg：$ffmpegSource"
  }
  New-Item -ItemType Directory -Force $venvScripts | Out-Null
  Copy-Item -LiteralPath $ffmpegSource (Join-Path $venvScripts 'ffmpeg.exe') -Force

  $ffprobe = Join-Path $venvScripts 'ffprobe.exe'
  if (!(Test-Path $ffprobe)) {
    Stage '正在下载 FFprobe…' 88
    $staging = Join-Path $env:TEMP ('qimiao-ffprobe-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force $staging | Out-Null
    $sources = @(
      @{ Url = 'https://registry.npmjs.org/@ffprobe-installer/win32-x64/-/win32-x64-5.1.0.tgz'; Ext = '.tgz'; Label = 'npm 镜像' },
      @{ Url = 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffprobe-6.1-win-64.zip'; Ext = '.zip'; Label = 'ffbinaries' },
      @{ Url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'; Ext = '.zip'; Label = 'gyan.dev' }
    )
    $installed = $false
    foreach ($source in $sources) {
      try {
        Stage "正在下载 FFprobe（$($source.Label)）…" 88
        $archive = Join-Path $staging ('ffprobe' + $source.Ext)
        Download-File $source.Url $archive -TimeoutSeconds 90 -Attempts 2
        $extract = Join-Path $staging 'extract'
        New-Item -ItemType Directory -Force $extract | Out-Null
        if ($source.Ext -eq '.zip') {
          Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
        } else {
          $tar = Get-Command tar.exe -ErrorAction Stop
          & $tar.Source -xzf $archive -C $extract
        }
        $found = Get-ChildItem -LiteralPath $extract -Recurse -Filter 'ffprobe.exe' |
          Select-Object -First 1
        if (!$found) { throw '压缩包中没有 ffprobe.exe' }
        Copy-Item -LiteralPath $found.FullName $ffprobe -Force
        $installed = $true
        break
      } catch {
        # Try the next mirror/source.
      }
    }
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
    if (!$installed) {
      throw 'FFprobe 下载失败。请检查网络或配置下载代理后重试。'
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
