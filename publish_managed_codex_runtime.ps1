# Publish the MyAgents-managed Codex runtime bundle to Cloudflare R2.
# This is intentionally separate from publish_windows.ps1: App releases do not
# upload runtime resources.

param(
    [string]$Platforms = "",
    [string]$OutDir = "",
    [switch]$ForceRepublish,
    [switch]$Yes,
    [switch]$NoPurge,
    [switch]$NoVerify
)

$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

$EnvFile = Join-Path $ProjectDir ".env"
$RuntimeLockFile = Join-Path $ProjectDir "src\shared\managed-codex-runtime.json"
$R2Bucket = "myagents-releases"
$DownloadBaseUrl = "https://download.myagents.io"
if (-not $OutDir) {
    $OutDir = Join-Path $ProjectDir "dist\managed-codex"
}
elseif (-not [System.IO.Path]::IsPathRooted($OutDir)) {
    $OutDir = Join-Path $ProjectDir $OutDir
}

function Read-RuntimeLock {
    if (-not (Test-Path -LiteralPath $RuntimeLockFile)) {
        throw "Managed Codex runtime lock not found: $RuntimeLockFile"
    }
    $lock = Get-Content -LiteralPath $RuntimeLockFile -Raw | ConvertFrom-Json
    $versionProperty = $lock.PSObject.Properties['version']
    if (-not $versionProperty -or -not ($versionProperty.Value -is [string])) {
        throw "Managed Codex runtime lock requires a string version: $RuntimeLockFile"
    }
    $version = [string]$versionProperty.Value
    if ($version.Trim() -ne $version -or $version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
        throw "Managed Codex runtime lock requires a canonical semver version: $RuntimeLockFile"
    }
    return @{ Version = $version; RuntimeSet = "codex-$version" }
}

function Assert-RuntimeSetSlug {
    param([string]$Value)
    if ($Value -notmatch '^codex-[0-9A-Za-z._-]+$') {
        throw "Invalid runtime set '$Value'. Expected codex-[0-9A-Za-z._-]+."
    }
}

function Load-DotEnv {
    if (-not (Test-Path $EnvFile)) {
        throw ".env file not found"
    }
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^([^#=]+)=(.*)$') {
            $name = $Matches[1].Trim()
            $value = $Matches[2].Trim()
            if ($value -match '^"([^"]*)"' -or $value -match "^'([^']*)'") {
                $value = $Matches[1]
            }
            else {
                $value = ($value -replace '\s+#.*$', '').Trim()
            }
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

function Get-RclonePath {
    $localRclone = Join-Path $ProjectDir "rclone.exe"
    if (Test-Path $localRclone) {
        return $localRclone
    }
    $rclone = Get-Command rclone -ErrorAction SilentlyContinue
    if (-not $rclone) {
        throw "rclone not found. Put rclone.exe in the project root or add rclone to PATH."
    }
    return $rclone.Source
}

$runtimeLock = Read-RuntimeLock
$RuntimeSet = $runtimeLock.RuntimeSet
$CodexVersion = $runtimeLock.Version
Assert-RuntimeSetSlug $RuntimeSet

$RuntimeDir = Join-Path (Join-Path $OutDir "sets") $RuntimeSet
$PublicBaseUrl = "$DownloadBaseUrl/runtimes/codex/sets/$RuntimeSet"
$R2Target = "r2:$R2Bucket/runtimes/codex/sets/$RuntimeSet/"

Write-Host ""
Write-Host "Managed Codex Runtime publish" -ForegroundColor Green
Write-Host "  Runtime set:  $RuntimeSet" -ForegroundColor Cyan
Write-Host "  Codex runtime: $CodexVersion" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/6] Load config..." -ForegroundColor Blue
Load-DotEnv
$R2AccessKeyId = $env:R2_ACCESS_KEY_ID
$R2SecretAccessKey = $env:R2_SECRET_ACCESS_KEY
$R2AccountId = $env:R2_ACCOUNT_ID
if (-not $R2AccessKeyId -or -not $R2SecretAccessKey -or -not $R2AccountId) {
    throw "Missing R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ACCOUNT_ID in .env"
}
Write-Host "[OK] R2 config loaded" -ForegroundColor Green

Write-Host "[2/6] Check dependencies..." -ForegroundColor Blue
$rclonePath = Get-RclonePath
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw "node not found"
}
Write-Host "[OK] Dependencies ready" -ForegroundColor Green

Write-Host "[3/6] Package runtime..." -ForegroundColor Blue
$packageArgs = @(
    (Join-Path $ProjectDir "scripts\package-managed-codex-runtime.mjs"),
    "--out", $OutDir
)
if ($Platforms) {
    $packageArgs += @("--platforms", $Platforms)
}
& node @packageArgs
if ($LASTEXITCODE -ne 0) {
    throw "Managed Codex runtime packaging failed"
}

if (-not (Test-Path $RuntimeDir)) {
    throw "Runtime directory not found: $RuntimeDir"
}

$manifests = @(Get-ChildItem -Path $RuntimeDir -Filter "manifest-v1.json" -File -Recurse -ErrorAction SilentlyContinue)
$manifestSigs = @(Get-ChildItem -Path $RuntimeDir -Filter "manifest-v1.json.sig" -File -Recurse -ErrorAction SilentlyContinue)
$artifacts = @(Get-ChildItem -Path $RuntimeDir -Filter "*.zip" -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like "*\artifacts\*" })
if ($manifests.Count -eq 0 -or $manifestSigs.Count -eq 0 -or $artifacts.Count -eq 0) {
    throw "Runtime artifacts are incomplete. manifests=$($manifests.Count), manifestSigs=$($manifestSigs.Count), artifacts=$($artifacts.Count)"
}

foreach ($manifestFile in ($manifests | Sort-Object FullName)) {
    $relative = $manifestFile.FullName.Substring($RuntimeDir.Length).TrimStart([char[]]@('\', '/')) -replace '\\', '/'
    $platform = Split-Path -Leaf (Split-Path -Parent $manifestFile.FullName)
    $manifest = Get-Content $manifestFile.FullName -Raw | ConvertFrom-Json
    if ($manifest.runtimeSet -ne $RuntimeSet) {
        throw "$relative runtimeSet mismatch"
    }
    if ($manifest.codexVersion -ne $CodexVersion) {
        throw "$relative codexVersion mismatch"
    }
    if ($manifest.platform -and $manifest.platform -ne $platform) {
        throw "$relative platform mismatch"
    }
    $sigPath = "$($manifestFile.FullName).sig"
    if (-not (Test-Path $sigPath) -or -not ((Get-Content $sigPath -Raw).Trim())) {
        throw "$relative missing manifest signature"
    }
    $artifactProperty = $manifest.artifacts.PSObject.Properties[$platform]
    $artifact = if ($artifactProperty) { $artifactProperty.Value } else { $null }
    if (-not $artifact) {
        throw "$relative missing artifact for $platform"
    }
    $expectedUrlPrefix = "$PublicBaseUrl/$platform/artifacts/"
    if (-not $artifact.url -or -not $artifact.url.StartsWith($expectedUrlPrefix)) {
        throw "$relative artifact URL must start with $expectedUrlPrefix"
    }
    $artifactName = Split-Path ([Uri]$artifact.url).AbsolutePath -Leaf
    $artifactPath = Join-Path (Join-Path (Split-Path -Parent $manifestFile.FullName) "artifacts") $artifactName
    if (-not (Test-Path $artifactPath)) {
        throw "$relative missing local artifact $artifactName"
    }
    if (-not (Test-Path "$artifactPath.sha256")) {
        throw "$relative missing local artifact sha256"
    }
    if (-not $artifact.signature) {
        throw "$relative missing artifact signature"
    }
}

if (-not $ForceRepublish) {
    $existing = @()
    foreach ($manifest in $manifests) {
        $relative = $manifest.FullName.Substring($RuntimeDir.Length).TrimStart([char[]]@('\', '/')) -replace '\\', '/'
        $url = "$PublicBaseUrl/$relative"
        try {
            $response = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                $existing += $url
            }
        }
        catch {
            if (-not $_.Exception.Response) {
                throw "Cannot determine whether remote manifest exists: $url"
            }
            if ([int]$_.Exception.Response.StatusCode -ne 404) {
                throw "Cannot determine whether remote manifest exists: $url (HTTP $([int]$_.Exception.Response.StatusCode))"
            }
        }
    }
    if ($existing.Count -gt 0) {
        Write-Host "[X] Remote runtime set already has these manifests:" -ForegroundColor Red
        $existing | ForEach-Object { Write-Host "  $_" }
        throw "Use -ForceRepublish to overwrite the same runtime set/platform path."
    }
}

Write-Host ""
Write-Host "Files to upload:" -ForegroundColor Cyan
Get-ChildItem -Path $RuntimeDir -File -Recurse | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($RuntimeDir.Length).TrimStart([char[]]@('\', '/')) -replace '\\', '/'
    Write-Host "  $relative"
}
Write-Host "Target: $PublicBaseUrl/" -ForegroundColor Cyan
Write-Host ""

if (-not $Yes) {
    $confirm = Read-Host "Upload? (Y/n)"
    if ($confirm -match '^[Nn]$') {
        throw "Publish cancelled"
    }
}

$rcloneConfig = [System.IO.Path]::GetTempFileName()
try {
    @"
[r2]
type = s3
provider = Cloudflare
env_auth = true
endpoint = https://$R2AccountId.r2.cloudflarestorage.com
acl = private
"@ | Set-Content $rcloneConfig -Encoding UTF8

    $env:RCLONE_CONFIG_R2_ACCESS_KEY_ID = $R2AccessKeyId
    $env:RCLONE_CONFIG_R2_SECRET_ACCESS_KEY = $R2SecretAccessKey

    Write-Host "[4/6] Upload to R2..." -ForegroundColor Blue
    $copyArgs = @("--config=$rcloneConfig", "copy", "$RuntimeDir/", $R2Target, "--s3-no-check-bucket", "--progress")
    if (-not $ForceRepublish) {
        $copyArgs += "--immutable"
    }
    & $rclonePath @copyArgs
    if ($LASTEXITCODE -ne 0) {
        throw "R2 upload failed"
    }
    Write-Host "[OK] Runtime uploaded" -ForegroundColor Green
}
finally {
    Remove-Item $rcloneConfig -Force -ErrorAction SilentlyContinue
}

if (-not $NoPurge) {
    Write-Host "[5/6] Purge Cloudflare cache..." -ForegroundColor Blue
    if ($env:CF_ZONE_ID -and $env:CF_API_TOKEN) {
        $purgeUrls = @()
        Get-ChildItem -Path $RuntimeDir -File -Recurse | Sort-Object FullName | ForEach-Object {
            $relative = $_.FullName.Substring($RuntimeDir.Length).TrimStart([char[]]@('\', '/')) -replace '\\', '/'
            $purgeUrls += "$PublicBaseUrl/$relative"
        }
        $body = @{ files = $purgeUrls } | ConvertTo-Json
        $response = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$($env:CF_ZONE_ID)/purge_cache" `
            -Method Post `
            -Headers @{ "Authorization" = "Bearer $($env:CF_API_TOKEN)"; "Content-Type" = "application/json" } `
            -Body $body
        if ($response.success) {
            Write-Host "[OK] CDN cache purged" -ForegroundColor Green
        }
        else {
            Write-Host "[!] CDN purge may have failed" -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "[!] CF_ZONE_ID / CF_API_TOKEN missing, skip purge" -ForegroundColor Yellow
    }
}
else {
    Write-Host "[5/6] Skip CDN purge" -ForegroundColor Blue
}

if (-not $NoVerify) {
    Write-Host "[6/6] HTTP verify..." -ForegroundColor Blue
    foreach ($file in Get-ChildItem -Path $RuntimeDir -File -Recurse | Sort-Object FullName) {
        $relative = $file.FullName.Substring($RuntimeDir.Length).TrimStart([char[]]@('\', '/')) -replace '\\', '/'
        $url = "$PublicBaseUrl/$relative"
        Write-Host "  Check $relative..." -NoNewline
        $response = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -ErrorAction Stop
        if ($response.StatusCode -ne 200) {
            throw "HTTP verify failed for $url ($($response.StatusCode))"
        }
        Write-Host " OK" -ForegroundColor Green
    }
}
else {
    Write-Host "[6/6] Skip HTTP verify" -ForegroundColor Blue
}

Write-Host ""
Write-Host "Managed Codex runtime publish complete" -ForegroundColor Green
Write-Host "Manifest URLs:" -ForegroundColor Cyan
$manifests | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($RuntimeDir.Length).TrimStart([char[]]@('\', '/')) -replace '\\', '/'
    Write-Host "  $PublicBaseUrl/$relative"
}
