param(
    [ValidateSet("x64", "arm64")]
    [string[]]$Arch = @()
)

$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectDir

if ($env:OS -ne "Windows_NT") {
    Write-Host "Skipping Claude SDK native package validation on non-Windows host" -ForegroundColor Yellow
    exit 0
}

$Script:CurrentTmpDir = $null
function Clear-CurrentTmpDir {
    if ($Script:CurrentTmpDir -and (Test-Path $Script:CurrentTmpDir)) {
        Remove-Item -Recurse -Force $Script:CurrentTmpDir -ErrorAction SilentlyContinue
    }
}
Register-EngineEvent PowerShell.Exiting -Action { Clear-CurrentTmpDir } | Out-Null

function Get-SdkVersion {
    $pkg = Get-Content (Join-Path $ProjectDir "package.json") -Raw | ConvertFrom-Json
    $deps = $pkg.optionalDependencies
    $x64 = $deps.'@anthropic-ai/claude-agent-sdk-win32-x64'
    $arm64 = $deps.'@anthropic-ai/claude-agent-sdk-win32-arm64'
    if (-not $x64 -and -not $arm64) {
        throw "Claude Agent SDK win32 optionalDependencies are missing"
    }
    if ($x64 -and $arm64 -and $x64 -ne $arm64) {
        throw "Claude Agent SDK win32 package versions differ: x64=$x64, arm64=$arm64"
    }
    if ($x64) { return $x64 }
    return $arm64
}

function Get-ExpectedMachine {
    param([string]$PackageArch)
    switch ($PackageArch) {
        "x64" { return 0x8664 }
        "arm64" { return 0xAA64 }
        default { throw "Unsupported Claude SDK arch: $PackageArch" }
    }
}

function Get-UInt16 {
    param([byte[]]$Bytes, [int]$Offset)
    return [BitConverter]::ToUInt16($Bytes, $Offset)
}

function Get-UInt32 {
    param([byte[]]$Bytes, [int]$Offset)
    return [BitConverter]::ToUInt32($Bytes, $Offset)
}

function Test-PeBinary {
    param(
        [string]$Path,
        [string]$PackageArch,
        [string]$Label
    )

    if (-not (Test-Path $Path)) {
        Write-Host "  $Label missing: $Path" -ForegroundColor Yellow
        return $false
    }

    $fileInfo = Get-Item $Path
    if ($fileInfo.Length -lt 1MB) {
        Write-Host "  $Label is too small to be a valid SDK native binary: $($fileInfo.Length) bytes" -ForegroundColor Yellow
        return $false
    }

    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    try {
        $headerSize = [Math]::Min([int]$fs.Length, 4096)
        $bytes = New-Object byte[] $headerSize
        $read = $fs.Read($bytes, 0, $headerSize)
        if ($read -lt 512) {
            Write-Host "  $Label has an incomplete PE header" -ForegroundColor Yellow
            return $false
        }

        if ($bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) {
            Write-Host "  $Label is not an MZ executable" -ForegroundColor Yellow
            return $false
        }

        $peOffset = Get-UInt32 $bytes 0x3C
        if ($peOffset -le 0 -or ($peOffset + 24) -ge $fs.Length) {
            Write-Host "  $Label has an invalid PE header offset" -ForegroundColor Yellow
            return $false
        }

        if (($peOffset + 512) -gt $bytes.Length) {
            $fs.Position = 0
            $headerSize = [Math]::Min([int]$fs.Length, [int]($peOffset + 512))
            $bytes = New-Object byte[] $headerSize
            $null = $fs.Read($bytes, 0, $headerSize)
        }

        if ($bytes[$peOffset] -ne 0x50 -or $bytes[$peOffset + 1] -ne 0x45 -or $bytes[$peOffset + 2] -ne 0 -or $bytes[$peOffset + 3] -ne 0) {
            Write-Host "  $Label is not a PE executable" -ForegroundColor Yellow
            return $false
        }

        $machine = Get-UInt16 $bytes ($peOffset + 4)
        $expectedMachine = Get-ExpectedMachine $PackageArch
        if ($machine -ne $expectedMachine) {
            Write-Host ("  {0} machine mismatch: expected=0x{1:X}, actual=0x{2:X}" -f $Label, $expectedMachine, $machine) -ForegroundColor Yellow
            return $false
        }

        $sectionCount = Get-UInt16 $bytes ($peOffset + 6)
        $optionalHeaderSize = Get-UInt16 $bytes ($peOffset + 20)
        $sectionTableOffset = [int]($peOffset + 24 + $optionalHeaderSize)
        $sectionTableEnd = $sectionTableOffset + ($sectionCount * 40)

        if ($sectionCount -le 0 -or $sectionCount -gt 128 -or $sectionTableEnd -gt $fs.Length) {
            Write-Host "  $Label has invalid PE section metadata" -ForegroundColor Yellow
            return $false
        }

        if ($sectionTableEnd -gt $bytes.Length) {
            $fs.Position = 0
            $headerSize = [Math]::Min([int]$fs.Length, $sectionTableEnd)
            $bytes = New-Object byte[] $headerSize
            $null = $fs.Read($bytes, 0, $headerSize)
        }

        for ($i = 0; $i -lt $sectionCount; $i++) {
            $sectionOffset = $sectionTableOffset + ($i * 40)
            $rawSize = Get-UInt32 $bytes ($sectionOffset + 16)
            $rawPointer = Get-UInt32 $bytes ($sectionOffset + 20)
            if ($rawSize -eq 0) { continue }
            if ($rawPointer -eq 0 -or ([int64]$rawPointer + [int64]$rawSize) -gt $fs.Length) {
                Write-Host "  $Label has a PE section pointing past end of file" -ForegroundColor Yellow
                return $false
            }
        }
    }
    finally {
        $fs.Dispose()
    }

    $signature = Get-AuthenticodeSignature $Path
    if ($signature.Status -ne "Valid") {
        Write-Host "  $Label has invalid Authenticode signature: $($signature.Status)" -ForegroundColor Yellow
        return $false
    }

    return $true
}

function Test-SdkPackage {
    param(
        [string]$PackageArch,
        [string]$SdkVersion
    )

    $pkgName = "@anthropic-ai/claude-agent-sdk-win32-$PackageArch"
    $pkgDir = Join-Path $ProjectDir "node_modules\$pkgName"
    $pkgJson = Join-Path $pkgDir "package.json"
    $binary = Join-Path $pkgDir "claude.exe"

    if (-not (Test-Path $pkgJson)) {
        Write-Host "  $pkgName package.json missing" -ForegroundColor Yellow
        return $false
    }

    try {
        $pkg = Get-Content $pkgJson -Raw | ConvertFrom-Json
        if ($pkg.name -ne $pkgName -or $pkg.version -ne $SdkVersion) {
            Write-Host "  $pkgName package.json does not match $SdkVersion" -ForegroundColor Yellow
            return $false
        }
    }
    catch {
        Write-Host "  $pkgName package.json is unreadable: $_" -ForegroundColor Yellow
        return $false
    }

    return (Test-PeBinary -Path $binary -PackageArch $PackageArch -Label "$pkgName/claude.exe")
}

function Repair-SdkPackage {
    param(
        [string]$PackageArch,
        [string]$SdkVersion
    )

    $pkgName = "@anthropic-ai/claude-agent-sdk-win32-$PackageArch"
    $pkgDir = Join-Path $ProjectDir "node_modules\$pkgName"
    $tmpDir = Join-Path $ProjectDir ".tmp-claude-sdk-$PackageArch-$(Get-Random)"
    $Script:CurrentTmpDir = $tmpDir

    Write-Host "Repairing $pkgName@$SdkVersion..." -ForegroundColor Blue
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

    try {
        & npm install --prefix "$tmpDir" --force --prefer-online --no-save --package-lock=false `
            --no-audit --no-fund --ignore-scripts `
            --os=win32 --cpu="$PackageArch" `
            "$pkgName@$SdkVersion"
        if ($LASTEXITCODE -ne 0) {
            throw "npm install exited with $LASTEXITCODE"
        }

        $installedPkg = Join-Path $tmpDir "node_modules\$pkgName"
        if (-not (Test-Path $installedPkg)) {
            throw "Temporary install did not produce $pkgName"
        }

        if (Test-Path $pkgDir) {
            Remove-Item -Recurse -Force $pkgDir
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $pkgDir) -Force | Out-Null
        Copy-Item -Recurse -Force $installedPkg $pkgDir
    }
    finally {
        Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
        $Script:CurrentTmpDir = $null
    }

    if (-not (Test-SdkPackage -PackageArch $PackageArch -SdkVersion $SdkVersion)) {
        throw "$pkgName@$SdkVersion is still invalid after repair"
    }
}

$sdkVersion = Get-SdkVersion

if ($Arch.Count -eq 0) {
    switch ($env:PROCESSOR_ARCHITECTURE) {
        "AMD64" { $Arch = @("x64") }
        "ARM64" { $Arch = @("arm64") }
        default { throw "Unsupported Windows host arch: $env:PROCESSOR_ARCHITECTURE" }
    }
}

foreach ($archName in $Arch) {
    if (Test-SdkPackage -PackageArch $archName -SdkVersion $sdkVersion) {
        Write-Host "Claude SDK win32-$archName@$sdkVersion is valid" -ForegroundColor Green
    }
    else {
        Repair-SdkPackage -PackageArch $archName -SdkVersion $sdkVersion
        Write-Host "Claude SDK win32-$archName@$sdkVersion repaired" -ForegroundColor Green
    }
}
