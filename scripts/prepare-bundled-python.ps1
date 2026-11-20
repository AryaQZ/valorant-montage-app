param(
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repoRoot = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $repoRoot 'apps\desktop\build\python-runtime'
$targetExe = Join-Path $targetDir 'python.exe'

if (!$Force -and (Test-Path -LiteralPath $targetExe -PathType Leaf)) {
    Write-Host "Bundled Python runtime already staged at $targetDir" -ForegroundColor Green
    exit 0
}

if (Test-Path -LiteralPath $targetDir) {
    Remove-Item -LiteralPath $targetDir -Recurse -Force
}
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

# 1. Prefer local standalone CPython 3.11 in .build-tools/python (offline, fast)
$standaloneRoot = Get-ChildItem -Path (Join-Path $repoRoot '.build-tools\python') -Directory -Filter 'cpython-3.11.*-windows-x86_64-none' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1

if ($standaloneRoot -and (Test-Path -LiteralPath (Join-Path $standaloneRoot.FullName 'python.exe') -PathType Leaf)) {
    Write-Host "Staging slim bundled Python runtime from $($standaloneRoot.Name)..."
    $src = $standaloneRoot.FullName
    foreach ($file in @('python.exe', 'python3.dll', 'python311.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'LICENSE.txt')) {
        $srcFile = Join-Path $src $file
        if (Test-Path -LiteralPath $srcFile -PathType Leaf) {
            Copy-Item -LiteralPath $srcFile -Destination $targetDir -Force
        }
    }
    if (Test-Path -LiteralPath (Join-Path $targetDir 'LICENSE.txt') -PathType Leaf) {
        Copy-Item -LiteralPath (Join-Path $targetDir 'LICENSE.txt') -Destination (Join-Path $targetDir 'PYTHON-PSF-LICENSE.txt') -Force
    }

    # Copy DLLs excluding Tcl/Tk and test extensions
    $dstDlls = Join-Path $targetDir 'DLLs'
    New-Item -ItemType Directory -Path $dstDlls -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $src 'DLLs') -File | Where-Object {
        $_.Name -notlike 'tcl*' -and $_.Name -notlike 'tk*' -and $_.Name -notlike '_tkinter*' -and
        $_.Name -notlike '_test*' -and $_.Extension -ne '.pdb' -and $_.Extension -ne '.ico'
    } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $dstDlls -Force
    }

    # Copy stdlib excluding dev/GUI/test packages via robocopy (fast and preserves full tree)
    $dstLib = Join-Path $targetDir 'Lib'
    New-Item -ItemType Directory -Path $dstLib -Force | Out-Null
    & robocopy (Join-Path $src 'Lib') $dstLib /E /XD test tkinter idlelib turtledemo ensurepip venv pydoc_data distutils lib2to3 site-packages __pycache__ /XF *.pyc *.pyo /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Failed to copy Python stdlib (robocopy exit $LASTEXITCODE)." }

    # Write python311._pth so the bundled runtime is 100% isolated from system PYTHONHOME/Registry
    # and always resolves .\Lib, .\DLLs, ..\worker (packaged resources\worker), and .
    $pthLines = @('.\Lib', '.\DLLs', '..\worker', '.')
    [IO.File]::WriteAllText((Join-Path $targetDir 'python311._pth'), ($pthLines -join "`r`n") + "`r`n", [Text.UTF8Encoding]::new($false))
} else {
    # 2. Download official Python 3.11.9 Windows x64 embeddable package (for GitHub Actions / fresh machines)
    $embedUrl = 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip'
    $tmpZip = Join-Path $env:TEMP 'python-3.11.9-embed-amd64.zip'
    Write-Host "Downloading official Windows embeddable Python from $embedUrl..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $embedUrl -OutFile $tmpZip -UseBasicParsing
    $actualHash = (Get-FileHash -LiteralPath $tmpZip -Algorithm SHA256).Hash
    Write-Host "Downloaded embeddable Python SHA-256: $actualHash"
    Expand-Archive -LiteralPath $tmpZip -DestinationPath $targetDir -Force
    Remove-Item -LiteralPath $tmpZip -Force -ErrorAction SilentlyContinue

    # Configure python311._pth so packaged resources\worker and current working dir are always importable
    $pthFile = Join-Path $targetDir 'python311._pth'
    if (Test-Path -LiteralPath $pthFile -PathType Leaf) {
        $lines = @(Get-Content -LiteralPath $pthFile | Where-Object { $_.Trim() -ne '' })
        foreach ($entry in @('..\worker', '.')) {
            if ($lines -notcontains $entry) { $lines += $entry }
        }
        [IO.File]::WriteAllText($pthFile, ($lines -join "`r`n") + "`r`n", [Text.UTF8Encoding]::new($false))
    }

    # Include PSF license text for redistribution
    $psfNotice = @"
Python 3.11 Windows Embeddable Runtime
Licensed under the Python Software Foundation License Version 2 (PSF-2.0).
Official source and full license text: https://docs.python.org/3.11/license.html
"@
    [IO.File]::WriteAllText((Join-Path $targetDir 'PYTHON-PSF-LICENSE.txt'), $psfNotice, [Text.UTF8Encoding]::new($false))
}

# Self-test the staged runtime under a clean PATH without system Python or PYTHONHOME
$savedPath = $env:Path
$savedPyHome = $env:PYTHONHOME
$savedPyPath = $env:PYTHONPATH
$savedNoUser = $env:PYTHONNOUSERSITE
try {
    $env:Path = 'C:\Windows\System32;C:\Windows'
    Remove-Item Env:PYTHONHOME -ErrorAction SilentlyContinue
    Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
    $env:PYTHONNOUSERSITE = '1'
    $repoEsc = $repoRoot.Replace('\', '\\')
    $check = & $targetExe -c "import sys, sqlite3, http.server, json, hashlib; sys.path.insert(0, '$repoEsc'); import services.worker.server, services.worker.media, services.worker.render, services.worker.quality, services.worker.library, services.worker.reference; print(sys.version.split()[0], sys.executable)"
    if ($LASTEXITCODE -ne 0) { throw 'Staged bundled Python runtime failed worker import self-test.' }
    $totalBytes = (Get-ChildItem -LiteralPath $targetDir -Recurse -File | Measure-Object Length -Sum).Sum
    Write-Host ("Bundled Python ready: " + $check + " (" + [math]::Round($totalBytes / 1MB, 2) + " MB unpacked)") -ForegroundColor Green
} finally {
    $env:Path = $savedPath
    if ($null -ne $savedPyHome) { $env:PYTHONHOME = $savedPyHome }
    if ($null -ne $savedPyPath) { $env:PYTHONPATH = $savedPyPath } else { Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue }
    if ($null -ne $savedNoUser) { $env:PYTHONNOUSERSITE = $savedNoUser } else { Remove-Item Env:PYTHONNOUSERSITE -ErrorAction SilentlyContinue }
}
