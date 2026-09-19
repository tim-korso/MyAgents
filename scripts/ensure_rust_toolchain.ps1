param(
    [string[]]$Targets = @()
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$ToolchainFile = Join-Path $ProjectDir "rust-toolchain.toml"

function Get-CargoBinPath {
    if ($env:CARGO_HOME) {
        return (Join-Path $env:CARGO_HOME "bin")
    }
    return (Join-Path $env:USERPROFILE ".cargo\bin")
}

function Refresh-ProcessPath {
    $cargoBin = Get-CargoBinPath
    $pathValues = @(
        [Environment]::GetEnvironmentVariable("Path", "Process"),
        [Environment]::GetEnvironmentVariable("Path", "Machine"),
        [Environment]::GetEnvironmentVariable("Path", "User"),
        $cargoBin
    )

    $seen = @{}
    $segments = @()
    foreach ($pathValue in $pathValues) {
        if ([string]::IsNullOrWhiteSpace($pathValue)) { continue }
        foreach ($part in ($pathValue -split ';')) {
            $trimmed = $part.Trim()
            if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
            $key = $trimmed.TrimEnd('\').ToLowerInvariant()
            if (-not $seen.ContainsKey($key)) {
                $seen[$key] = $true
                $segments += $trimmed
            }
        }
    }

    $env:Path = ($segments -join ';')
}

function Resolve-ToolPath {
    param([string]$Name)
    Refresh-ProcessPath
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }
    $exeName = if ($Name.EndsWith(".exe")) { $Name } else { "$Name.exe" }
    $fallback = Join-Path (Get-CargoBinPath) $exeName
    if (Test-Path $fallback) {
        return $fallback
    }
    return $null
}

function Require-CommandPath {
    param([string]$Name, [string]$InstallHint)
    $cmdPath = Resolve-ToolPath $Name
    if (-not $cmdPath) {
        throw "$Name is required. $InstallHint"
    }
    return $cmdPath
}

function Ensure-RustupProxy {
    param([string]$ProxyName, [string]$RustupExe)
    $cargoBin = Get-CargoBinPath
    New-Item -ItemType Directory -Path $cargoBin -Force | Out-Null
    $proxyPath = Join-Path $cargoBin "$ProxyName.exe"
    if (-not (Test-Path $proxyPath)) {
        Copy-Item -Path $RustupExe -Destination $proxyPath -Force
    }
}

if (-not (Test-Path $ToolchainFile)) {
    throw "rust-toolchain.toml not found: $ToolchainFile"
}

$RustupExe = Require-CommandPath "rustup" "Install Rust via https://rustup.rs, then rerun setup/build."

$ToolchainText = Get-Content $ToolchainFile -Raw
if ($ToolchainText -notmatch 'channel\s*=\s*"([^"]+)"') {
    throw "Cannot parse Rust channel from rust-toolchain.toml"
}
$RustToolchain = $Matches[1]

$Components = @()
if ($ToolchainText -match 'components\s*=\s*\[([^\]]*)\]') {
    $Components = [regex]::Matches($Matches[1], '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
}
if ($Components.Count -eq 0) {
    $Components = @("rustfmt", "clippy")
}

Write-Host "  Rust toolchain: $RustToolchain" -ForegroundColor Cyan
& $RustupExe toolchain install $RustToolchain --profile minimal
if ($LASTEXITCODE -ne 0) {
    throw "rustup toolchain install $RustToolchain failed"
}

foreach ($Component in $Components) {
    Write-Host "  Rust component: $Component" -ForegroundColor Cyan
    & $RustupExe component add $Component --toolchain $RustToolchain
    if ($LASTEXITCODE -ne 0) {
        throw "rustup component add $Component --toolchain $RustToolchain failed"
    }
}

foreach ($Target in $Targets) {
    if ([string]::IsNullOrWhiteSpace($Target)) { continue }
    Write-Host "  Rust target: $Target" -ForegroundColor Cyan
    & $RustupExe target add $Target --toolchain $RustToolchain
    if ($LASTEXITCODE -ne 0) {
        throw "rustup target add $Target --toolchain $RustToolchain failed"
    }
}

foreach ($ProxyName in @("rustc", "rustdoc", "cargo")) {
    Ensure-RustupProxy $ProxyName $RustupExe
}
if ($Components -contains "rustfmt") {
    foreach ($ProxyName in @("rustfmt", "cargo-fmt")) {
        Ensure-RustupProxy $ProxyName $RustupExe
    }
}
if ($Components -contains "clippy") {
    foreach ($ProxyName in @("cargo-clippy", "clippy-driver")) {
        Ensure-RustupProxy $ProxyName $RustupExe
    }
}
Refresh-ProcessPath

$CargoExe = Require-CommandPath "cargo" "Install Rust via rustup."
& $CargoExe "+$RustToolchain" --version | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "cargo +$RustToolchain is not usable"
}

if ($Components -contains "rustfmt") {
    $RustfmtExe = Require-CommandPath "rustfmt" "Run this script after rustup installs the rustfmt component."
    & $RustfmtExe "+$RustToolchain" --version | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "rustfmt +$RustToolchain is not usable"
    }
}

if ($Components -contains "clippy") {
    & $CargoExe "+$RustToolchain" clippy --version | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "cargo +$RustToolchain clippy is not usable"
    }
}

Write-Host "  OK - Rust toolchain ready" -ForegroundColor Green
