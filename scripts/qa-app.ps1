param(
    [Parameter(Mandatory)] [string]$Gameplay,
    [Parameter(Mandatory)] [string]$Music,
    [Parameter(Mandatory)] [string]$Artifacts,
    [string]$ReviewedProject,
    [switch]$TestRecovery,
    [switch]$TestKillReview
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$desktop = Join-Path $repo 'apps/desktop'
$game = (Resolve-Path -LiteralPath $Gameplay).Path
$song = (Resolve-Path -LiteralPath $Music).Path
$root = [IO.Path]::GetFullPath($Artifacts)
if (Test-Path -LiteralPath $root) { throw 'Choose a new artifact directory.' }
New-Item -ItemType Directory -Path $root | Out-Null
$env:VMS_AUDIT_ROOT = $root
$env:VMS_AUDIT_REPO = $repo
$env:VMS_AUDIT_VIDEO = $game
$env:VMS_AUDIT_MUSIC = $song
$localRuntime = Join-Path $repo '.build-tools/node-v22.12.0-win-x64'
if (Test-Path -LiteralPath $localRuntime) { $env:Path = "$localRuntime;$env:Path" }
$upstreamPython = Join-Path $repo '.build-tools/upstream-venv/Scripts/python.exe'
if (!$env:VMS_UPSTREAM_PYTHON -and (Test-Path -LiteralPath $upstreamPython)) { $env:VMS_UPSTREAM_PYTHON = $upstreamPython }
$before = Get-FileHash -LiteralPath @($game, $song)
Push-Location $desktop
try {
    & npm.cmd run build *> "$root/build.log"
    if ($LASTEXITCODE -ne 0) { throw "Build failed. See $root/build.log." }
    & (Join-Path $repo 'scripts/test.ps1') *> "$root/tests.log"
    Set-Location -LiteralPath $desktop
    & .\node_modules\.bin\electron-builder.cmd --win nsis --x64 '-c.electronDist=./node_modules/electron/dist' "-c.directories.output=$root/release" *> "$root/package.log"
    if ($LASTEXITCODE -ne 0) { throw "Packaging failed. See $root/package.log." }
    & node (Join-Path $PSScriptRoot 'qa-app.mjs') stage
    if ($LASTEXITCODE -ne 0) { throw 'QA staging failed.' }
    $p = Start-Process -FilePath "$desktop/node_modules/electron/dist/electron.exe" -ArgumentList ('"' + "$root/tested" + '"') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput "$root/electron-out.log" -RedirectStandardError "$root/electron-err.log"
    if (!$p.WaitForExit(600000)) { Stop-Process -Id $p.Id; throw 'QA exceeded the UI test timeout.' }
    $after = Get-FileHash -LiteralPath @($game, $song)
    if (Compare-Object $before $after -Property Path,Hash) { throw 'Source hash changed during testing.' }
    $before | ConvertTo-Json | Set-Content -Encoding utf8NoBOM "$root/input-hashes.json"
    $outcome = Get-Content -LiteralPath "$root/ui-evidence.json" -Raw | ConvertFrom-Json
    if (!$outcome.finished) { throw "UI checks failed. See $root/ui-evidence.json." }
    $env:VMS_AUDIT_RESTART_CHECK = '1'
    try {
        $p = Start-Process -FilePath "$desktop/node_modules/electron/dist/electron.exe" -ArgumentList ('"' + "$root/tested" + '"') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput "$root/restart-out.log" -RedirectStandardError "$root/restart-err.log"
        if (!$p.WaitForExit(90000)) { Stop-Process -Id $p.Id; throw 'Restart check exceeded its timeout.' }
        $restart = Get-Content -LiteralPath "$root/restart-evidence.json" -Raw | ConvertFrom-Json
        if (!$restart.finished) { throw "Restart check failed. See $root/restart-evidence.json." }
    } finally {
        Remove-Item Env:VMS_AUDIT_RESTART_CHECK -ErrorAction SilentlyContinue
    }
    if ($TestRecovery) {
        $baselineOutput = Get-FileHash -LiteralPath "$root/master-2.mp4"
        foreach ($phase in @('RECOVERY_CHECK', 'CRASH_IDLE', 'CRASH_RENDER', 'AFTER_CRASH')) {
            $crashMode = if ($phase -eq 'CRASH_IDLE') { 'idle' } elseif ($phase -eq 'CRASH_RENDER') { 'render' }
            $setting = if ($crashMode) { 'Env:VMS_AUDIT_CRASH_CHECK' } else { "Env:VMS_AUDIT_$phase" }
            Set-Item -Path $setting -Value $(if ($crashMode) { $crashMode } else { '1' })
            try {
                $p = Start-Process -FilePath "$desktop/node_modules/electron/dist/electron.exe" -ArgumentList ('"' + "$root/tested" + '"') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput "$root/$phase-out.log" -RedirectStandardError "$root/$phase-err.log"
                if (!$p.WaitForExit(180000)) { Stop-Process -Id $p.Id; throw "$phase exceeded its timeout." }
                if ($crashMode) {
                    $crash = Get-Content -LiteralPath "$root/crash-$crashMode-evidence.json" -Raw | ConvertFrom-Json
                    $interrupt = $crash.interruption
                    if ($p.ExitCode -ne 37 -or !$interrupt) { throw 'Studio interruption was not reproduced.' }
                    $oldWorker = Get-Process -Id $interrupt.workerPid -ErrorAction SilentlyContinue
                    if ($oldWorker -and !$oldWorker.WaitForExit(15000)) { throw 'Worker survived its interrupted parent.' }
                    if ($crashMode -eq 'render' -and (!$interrupt.partial -or (Test-Path -LiteralPath "$root/app-interrupted.mp4"))) {
                        throw 'An interrupted export was published or the active partial was not observed.'
                    }
                } else {
                    $file = if ($phase -eq 'RECOVERY_CHECK') { 'recovery-evidence.json' } else { 'after-crash-evidence.json' }
                    $result = Get-Content -LiteralPath "$root/$file" -Raw | ConvertFrom-Json
                    if (!$result.finished) { throw "$phase failed. See $root/$file." }
                    if ($phase -eq 'AFTER_CRASH') {
                        $renderCrash = Get-Content -LiteralPath "$root/crash-render-evidence.json" -Raw | ConvertFrom-Json
                        if (Test-Path -LiteralPath "$root/$($renderCrash.interruption.partial)") {
                            throw 'Restart did not remove the interrupted partial video.'
                        }
                    }
                }
            } finally {
                Remove-Item -LiteralPath $setting -ErrorAction SilentlyContinue
            }
        }
        if ((Get-FileHash -LiteralPath $baselineOutput.Path).Hash -ne $baselineOutput.Hash) { throw 'Recovery changed a previous export.' }
        $after = Get-FileHash -LiteralPath @($game, $song)
        if (Compare-Object $before $after -Property Path,Hash) { throw 'Source hash changed during recovery testing.' }
    }
    if ($TestKillReview) {
        $env:VMS_AUDIT_KILL_REVIEW_CHECK = '1'
        try {
            $p = Start-Process -FilePath "$desktop/node_modules/electron/dist/electron.exe" -ArgumentList ('"' + "$root/tested" + '"') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput "$root/kill-review-out.log" -RedirectStandardError "$root/kill-review-err.log"
            if (!$p.WaitForExit(540000)) { Stop-Process -Id $p.Id; throw 'Kill-review check timed out.' }
            $review = Get-Content -LiteralPath "$root/kill-review-evidence.json" -Raw | ConvertFrom-Json
            if (!$review.finished) { throw "Kill-review check failed. See $root/kill-review-evidence.json." }
            $after = Get-FileHash -LiteralPath @($game, $song)
            if (Compare-Object $before $after -Property Path,Hash) { throw 'Source hash changed during kill review.' }
        } finally {
            Remove-Item Env:VMS_AUDIT_KILL_REVIEW_CHECK -ErrorAction SilentlyContinue
        }
        $env:PYTHONPATH = $repo
        & python (Join-Path $PSScriptRoot 'qa-timeline-fixtures.py') $root
        if ($LASTEXITCODE -ne 0) { throw 'Could not prepare timeline review fixtures.' }
        $env:VMS_AUDIT_TIMELINE_CHECK = '1'
        try {
            $p = Start-Process -FilePath "$desktop/node_modules/electron/dist/electron.exe" -ArgumentList ('"' + "$root/tested" + '"') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput "$root/timeline-out.log" -RedirectStandardError "$root/timeline-err.log"
            if (!$p.WaitForExit(150000)) { Stop-Process -Id $p.Id; throw 'Timeline check timed out.' }
            $timeline = Get-Content -LiteralPath "$root/timeline-evidence.json" -Raw | ConvertFrom-Json
            if (!$timeline.finished) { throw "Timeline check failed. See $root/timeline-evidence.json." }
            $after = Get-FileHash -LiteralPath @($game, $song)
            if (Compare-Object $before $after -Property Path,Hash) { throw 'Source hash changed during timeline validation.' }
        } finally {
            Remove-Item Env:VMS_AUDIT_TIMELINE_CHECK -ErrorAction SilentlyContinue
        }
    }
    if ($ReviewedProject) {
        $reviewedPath = (Resolve-Path -LiteralPath $ReviewedProject).Path
        $env:PYTHONPATH = $repo
        & python -u (Join-Path $PSScriptRoot 'qa-native.py') --project $reviewedPath --output "$root/native" *> "$root/native.log"
        if ($LASTEXITCODE -ne 0) { throw "Native QA failed. See $root/native.log." }
    }
    Write-Output "Regression and packaged-renderer evidence: $root"
} finally {
    Pop-Location
}
