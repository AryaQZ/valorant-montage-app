$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$upstreamRoot = Join-Path $repoRoot 'third_party\editing-gameplay-montages\skills\editing-gameplay-montages'
$requirements = Join-Path $upstreamRoot 'scripts\requirements.txt'
$userData = if ($env:VMS_DATA_DIR) {
    $env:VMS_DATA_DIR
} else {
    Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'VALORANTMontageStudio'
}
$venv = Join-Path $userData 'upstream-venv'
$python = Join-Path $venv 'Scripts\python.exe'

if (-not (Test-Path -LiteralPath $requirements -PathType Leaf)) { throw "Pinned upstream requirements were not found: $requirements" }
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    $launcher = Get-Command py -ErrorAction SilentlyContinue
    $basePython = $null
    if ($launcher) {
        $registeredRuntimes = & $launcher.Source -0p 2>$null
        foreach ($runtime in $registeredRuntimes) {
            if ($runtime -match '^\s*-V:[^\s]*3\.11[^\s]*\s+(?<path>.+)$' -and
                (Test-Path -LiteralPath $Matches.path.Trim() -PathType Leaf)) {
                $basePython = $Matches.path.Trim()
                break
            }
        }
    }
    if (-not $basePython) {
        $buildPythonRoot = Join-Path $repoRoot '.build-tools\python'
        if (Test-Path -LiteralPath $buildPythonRoot -PathType Container) {
            foreach ($candidate in Get-ChildItem -LiteralPath $buildPythonRoot -Filter python.exe -File -Recurse -ErrorAction SilentlyContinue) {
                try {
                    $candidateVersion = (& $candidate.FullName -c 'import sys; print("%d.%d" % sys.version_info[:2])').Trim()
                } catch {
                    continue
                }
                if ($candidateVersion -eq '3.11') {
                    $basePython = $candidate.FullName
                    break
                }
            }
        }
    }
    if (-not $basePython -and $launcher) {
        # Keep the conventional Python launcher path for machines whose 3.11
        # runtime is not registered with a vendor-qualified version tag.
        & $launcher.Source -3.11 -m venv $venv
    } elseif ($basePython) {
        & $basePython -m venv $venv
    } else {
        throw 'Python 3.11 is required for the pinned RIFE v4.25 Windows binding. Install Python 3.11 and the Python launcher first.'
    }
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the upstream Python 3.11 environment.' }
}

$version = (& $python -c 'import sys; print("%d.%d" % sys.version_info[:2])').Trim()
if ($version -ne '3.11') { throw "Upstream RIFE requires Python 3.11; found $version at $python" }
& $python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'Could not update pip in the isolated upstream environment.' }
& $python -m pip install -r $requirements
if ($LASTEXITCODE -ne 0) { throw 'Could not install the pinned upstream requirements.' }

$env:VMS_UPSTREAM_ROOT = $upstreamRoot
$env:RIFE_MODEL = Join-Path $upstreamRoot 'models\rife-v4.25'
$env:RIFE_GPU = if ($env:VMS_RIFE_GPU) { $env:VMS_RIFE_GPU } else { '0' }
Set-Content -LiteralPath (Join-Path $userData 'rife_gpu.txt') -Value $env:RIFE_GPU -Encoding ascii
Write-Host "Upstream interpreter: $python"
Write-Host "Upstream source: $upstreamRoot"
Write-Host "Vulkan device index: $env:RIFE_GPU (set VMS_RIFE_GPU to choose another device)"
Write-Host 'Running the upstream doctor against the local RIFE model and GPU...'
Push-Location (Join-Path $upstreamRoot 'scripts')
try {
    & $python '.\doctor.py'
    if ($LASTEXITCODE -ne 0) { throw 'Upstream doctor did not pass. Review the diagnostic above before enabling RIFE.' }
} finally {
    Pop-Location
}
Write-Host 'Upstream pipeline setup complete. Media remains local.' -ForegroundColor Green
