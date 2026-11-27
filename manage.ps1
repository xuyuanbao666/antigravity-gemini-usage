param(
    [ValidateSet('Install', 'Restore')][string]$Action = 'Install',
    [string]$AntigravityPath = (Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\Antigravity.exe'),
    [string]$NodePath = 'node'
)

$ErrorActionPreference = 'Stop'
$app = (Get-Item -LiteralPath $AntigravityPath).FullName
$resources = Join-Path (Split-Path -Parent $app) 'resources'
$archive = Join-Path $resources 'app.asar'
$stateFile = Join-Path $PSScriptRoot 'installation.json'
$version = (Get-Item -LiteralPath $app).VersionInfo.FileVersion

function Get-ArchiveHash([string]$File) {
    (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash
}

function Get-AppWindows {
    Get-Process -Name Antigravity -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $app -and $_.MainWindowHandle -ne 0 }
}

$current = Get-ArchiveHash $archive
$state = if (Test-Path -LiteralPath $stateFile) {
    Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
}
if ($Action -eq 'Restore') {
    if (!$state -or $state.patchedHash -ne $current -or $state.version -ne $version) {
        throw 'Current Antigravity does not match this installation. The archive was left alone.'
    }
    if ($state.baseHash -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid backup metadata.' }
    $replacement = Join-Path $PSScriptRoot ('backup-' + $state.baseHash + '.asar')
    $expected = $state.baseHash
} else {
    $base = $current
    if ($state -and $state.version -eq $version -and $state.patchedHash -eq $current) {
        if ($state.baseHash -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid backup metadata.' }
        $base = $state.baseHash
    }
    $backup = Join-Path $PSScriptRoot ('backup-' + $base + '.asar')
    if (!(Test-Path -LiteralPath $backup) -and $base -eq $current) {
        Copy-Item -LiteralPath $archive -Destination $backup
    }
    if ((Get-ArchiveHash $backup) -ne $base) { throw 'Failed to verify the backup.' }
    $replacement = Join-Path $PSScriptRoot ('patched-' + [guid]::NewGuid().ToString('N') + '.asar')
    & $NodePath (Join-Path $PSScriptRoot 'build.cjs') $backup $replacement
    if ($LASTEXITCODE -ne 0) { throw 'Failed to build the usage capsule for the current app.' }
    $expected = Get-ArchiveHash $replacement
    if ($expected -eq $current) {
        Remove-Item -LiteralPath $replacement
        Write-Output 'Gemini Usage is already installed.'
        return
    }
}
if ((Get-ArchiveHash $replacement) -ne $expected) { throw 'Failed to verify the replacement archive.' }

$windows = @(Get-AppWindows)
foreach ($window in $windows) { [void]$window.CloseMainWindow() }
for ($i = 0; $i -lt 12 -and (Get-AppWindows); $i++) { Start-Sleep -Seconds 1 }
if (Get-AppWindows) { throw 'Antigravity did not close normally. Close the window and run this script again.' }
if ((Get-ArchiveHash $archive) -ne $current) { throw 'Antigravity updated while closing. Run the script again for the new version.' }

$swap = Join-Path $resources ('app.asar.gemini-usage-' + [guid]::NewGuid().ToString('N') + '.tmp')
try {
    Copy-Item -LiteralPath $replacement -Destination $swap
    if ((Get-ArchiveHash $swap) -ne $expected) { throw 'The copied archive did not match.' }
    for ($attempt = 0; ; $attempt++) {
        if ((Get-ArchiveHash $archive) -ne $current) { throw 'Antigravity changed during installation.' }
        try {
            [IO.File]::Replace($swap, $archive, [NullString]::Value)
            break
        } catch {
            if ($attempt -ge 15 -or ($_.Exception.InnerException.HResult -band 0xffff) -notin 32,33) { throw }
            Start-Sleep -Milliseconds 400
        }
    }
    if ($Action -eq 'Install') {
        @{version=$version; baseHash=$base; patchedHash=$expected} |
            ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
    }
    if ((Get-ArchiveHash $archive) -ne $expected) { throw 'The installed archive did not match.' }
} finally {
    if (Test-Path -LiteralPath $swap) { Remove-Item -LiteralPath $swap }
    if ($Action -eq 'Install' -and (Test-Path -LiteralPath $replacement)) { Remove-Item -LiteralPath $replacement }
}

foreach ($name in 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY') {
    [Environment]::SetEnvironmentVariable($name, [Environment]::GetEnvironmentVariable($name, 'User'), 'Process')
}
Start-Process -FilePath $app -WorkingDirectory (Split-Path -Parent $app)
Write-Output ('Gemini Usage ' + $Action + ' verified for Antigravity ' + $version)
