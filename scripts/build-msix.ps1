[CmdletBinding()]
param(
  [string]$IdentityFile,
  [string]$IdentityName,
  [string]$Publisher,
  [string]$PublisherDisplayName,
  [string]$PackageVersion,
  [string]$OutputDirectory,
  [switch]$LocalUnsigned,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$tauriRoot = Join-Path $repoRoot "apps\desktop\src-tauri"
$defaultIdentityFile = Join-Path $tauriRoot "msix\partner-center-identity.local.json"
$releaseExe = Join-Path $tauriRoot "target\release\popo.exe"
$sourceIcon = Join-Path $tauriRoot "icons\128x128@2x.png"

function Find-WindowsSdkTool([string]$ToolName) {
  $command = Get-Command $ToolName -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $sdkBin = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  if (-not (Test-Path $sdkBin)) {
    throw "Windows 10/11 SDK was not found. Install it before building MSIX."
  }

  $versions = Get-ChildItem $sdkBin -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
    Sort-Object { [version]$_.Name } -Descending

  foreach ($version in $versions) {
    $candidate = Join-Path $version.FullName "x64\$ToolName"
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "$ToolName was not found in the Windows SDK."
}

function Assert-PackageVersion([string]$Version, [bool]$StoreBuild) {
  if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') {
    throw "MSIX version must contain four numeric parts, for example 1.0.0.0."
  }

  $parts = @($Version.Split('.') | ForEach-Object { [int]$_ })
  $oversizedParts = @($parts | Where-Object { $_ -gt 65535 })
  if ($parts[0] -lt 1 -or $oversizedParts.Count -gt 0) {
    throw "MSIX version parts must be 0-65535 and the first part must be at least 1."
  }
  if ($StoreBuild -and $parts[3] -ne 0) {
    throw "Partner Center reserves the fourth version part; Store MSIX builds must end in .0."
  }
}

function Assert-StoreIdentity(
  [string]$Name,
  [string]$PublisherValue,
  [string]$PublisherDisplayValue
) {
  if ([string]::IsNullOrWhiteSpace($Name) -or
      [string]::IsNullOrWhiteSpace($PublisherValue) -or
      [string]::IsNullOrWhiteSpace($PublisherDisplayValue)) {
    throw "Store MSIX identity is incomplete. Copy the three exact Product identity values from Partner Center into $defaultIdentityFile."
  }
  if ($Name.StartsWith("COPY ") -or $PublisherValue.StartsWith("COPY ") -or $PublisherDisplayValue.StartsWith("COPY ")) {
    throw "Replace every COPY... placeholder in the Partner Center identity file before building."
  }
  if ($Name -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]{2,49}$') {
    throw "Package/Identity/Name has an invalid MSIX format. Copy it exactly from Partner Center."
  }
  if ($PublisherValue -notmatch '^CN=' -or $PublisherValue.Contains("`n") -or $PublisherValue.Contains("`r")) {
    throw "Package/Identity/Publisher must be the exact Partner Center distinguished name beginning with CN=."
  }
}

function Write-SquarePng([string]$Source, [string]$Destination, [int]$Size) {
  Add-Type -AssemblyName System.Drawing
  $sourceImage = [System.Drawing.Image]::FromFile($Source)
  try {
    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($sourceImage, 0, 0, $Size, $Size)
      }
      finally {
        $graphics.Dispose()
      }
      $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
      $bitmap.Dispose()
    }
  }
  finally {
    $sourceImage.Dispose()
  }
}

if ($LocalUnsigned) {
  if ($IdentityName -or $Publisher -or $PublisherDisplayName -or $IdentityFile) {
    throw "Do not combine -LocalUnsigned with Partner Center identity values. Unsigned local packages must use a separate special-OID identity."
  }
  $IdentityName = "PoPo.LocalTest"
  $Publisher = "CN=PoPo Local Test, OID.2.25.311729368913984317654407730594956997722=1"
  $PublisherDisplayName = "PoPo Local Test"
  if (-not $PackageVersion) {
    $PackageVersion = "1.0.0.0"
  }
}
else {
  if (-not $IdentityFile) {
    $IdentityFile = $defaultIdentityFile
  }
  if (Test-Path $IdentityFile) {
    $identity = Get-Content $IdentityFile -Raw | ConvertFrom-Json
    if (-not $IdentityName) { $IdentityName = [string]$identity.identityName }
    if (-not $Publisher) { $Publisher = [string]$identity.publisher }
    if (-not $PublisherDisplayName) { $PublisherDisplayName = [string]$identity.publisherDisplayName }
    if (-not $PackageVersion -and $identity.packageVersion) {
      $PackageVersion = [string]$identity.packageVersion
    }
  }
  elseif (-not ($IdentityName -and $Publisher -and $PublisherDisplayName)) {
    throw "Partner Center identity file not found: $IdentityFile`nCopy partner-center-identity.example.json to partner-center-identity.local.json and replace all values with Product management > Product identity values."
  }

  Assert-StoreIdentity $IdentityName $Publisher $PublisherDisplayName
  if (-not $PackageVersion) {
    $PackageVersion = "1.0.0.0"
  }
}

Assert-PackageVersion $PackageVersion (-not $LocalUnsigned)

if (-not $SkipBuild) {
  $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if (-not $pnpm) { $pnpm = Get-Command pnpm -ErrorAction Stop }
  Push-Location $repoRoot
  try {
    & $pnpm.Source --filter desktop tauri build --no-bundle
    if ($LASTEXITCODE -ne 0) {
      throw "Tauri release build failed with exit code $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }
}

if (-not (Test-Path $releaseExe)) {
  throw "Release executable not found: $releaseExe. Run without -SkipBuild first."
}
if (-not (Test-Path $sourceIcon)) {
  throw "MSIX source icon not found: $sourceIcon"
}

$makeAppx = Find-WindowsSdkTool "makeappx.exe"
$msixRoot = Join-Path $tauriRoot "target\release\bundle\msix"
if (-not $OutputDirectory) { $OutputDirectory = $msixRoot }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$modeName = if ($LocalUnsigned) { "local-unsigned" } else { "partner-center" }
$stageRoot = Join-Path $tauriRoot "target\release\msix\$modeName"
if (Test-Path $stageRoot) { Remove-Item $stageRoot -Recurse -Force }
$assetsDir = Join-Path $stageRoot "Assets"
New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null

Copy-Item $releaseExe (Join-Path $stageRoot "PoPo.exe")
Write-SquarePng $sourceIcon (Join-Path $assetsDir "StoreLogo.png") 50
Write-SquarePng $sourceIcon (Join-Path $assetsDir "Square44x44Logo.png") 44
Write-SquarePng $sourceIcon (Join-Path $assetsDir "Square150x150Logo.png") 150

$xmlName = [System.Security.SecurityElement]::Escape($IdentityName)
$xmlPublisher = [System.Security.SecurityElement]::Escape($Publisher)
$xmlPublisherDisplay = [System.Security.SecurityElement]::Escape($PublisherDisplayName)
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap uap10 rescap">
  <Identity
    Name="$xmlName"
    Publisher="$xmlPublisher"
    Version="$PackageVersion"
    ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>PoPo</DisplayName>
    <PublisherDisplayName>$xmlPublisherDisplay</PublisherDisplayName>
    <Description>System-wide AI voice dictation for Windows.</Description>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily
      Name="Windows.Desktop"
      MinVersion="10.0.19044.0"
      MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Applications>
    <Application
      Id="PoPo"
      Executable="PoPo.exe"
      uap10:RuntimeBehavior="packagedClassicApp"
      uap10:TrustLevel="mediumIL">
      <uap:VisualElements
        DisplayName="PoPo"
        Description="System-wide AI voice dictation for Windows."
        BackgroundColor="transparent"
        Square44x44Logo="Assets\Square44x44Logo.png"
        Square150x150Logo="Assets\Square150x150Logo.png" />
    </Application>
  </Applications>
  <Capabilities>
    <Capability Name="internetClient" />
    <rescap:Capability Name="runFullTrust" />
    <DeviceCapability Name="microphone" />
  </Capabilities>
</Package>
"@
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $stageRoot "AppxManifest.xml"), $manifest, $utf8NoBom)

$suffix = if ($LocalUnsigned) { "_LocalTest" } else { "" }
$outputPath = Join-Path $OutputDirectory "PoPo_${PackageVersion}_x64${suffix}.msix"
if (Test-Path $outputPath) { Remove-Item $outputPath -Force }

& $makeAppx pack /d $stageRoot /p $outputPath /o
if ($LASTEXITCODE -ne 0) {
  throw "MakeAppx failed with exit code $LASTEXITCODE."
}

# Unpack once with the same SDK tool and verify identity/executable metadata.
$verifyRoot = Join-Path $tauriRoot "target\release\msix\verify-$modeName"
if (Test-Path $verifyRoot) { Remove-Item $verifyRoot -Recurse -Force }
& $makeAppx unpack /p $outputPath /d $verifyRoot /o | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "MakeAppx could not unpack the generated package."
}

[xml]$verifiedManifest = Get-Content (Join-Path $verifyRoot "AppxManifest.xml") -Raw
$ns = New-Object System.Xml.XmlNamespaceManager($verifiedManifest.NameTable)
$ns.AddNamespace("f", "http://schemas.microsoft.com/appx/manifest/foundation/windows10")
$verifiedIdentity = $verifiedManifest.SelectSingleNode("/f:Package/f:Identity", $ns)
$verifiedApplication = $verifiedManifest.SelectSingleNode("/f:Package/f:Applications/f:Application", $ns)
if ($verifiedIdentity.Name -cne $IdentityName -or
    $verifiedIdentity.Publisher -cne $Publisher -or
    $verifiedIdentity.Version -cne $PackageVersion -or
    $verifiedIdentity.ProcessorArchitecture -cne "x64" -or
    $verifiedApplication.Executable -cne "PoPo.exe") {
  throw "Generated MSIX identity validation failed."
}
if (-not (Test-Path (Join-Path $verifyRoot "PoPo.exe"))) {
  throw "Generated MSIX does not contain PoPo.exe."
}
$signatureStatus = if (Test-Path (Join-Path $verifyRoot "AppxSignature.p7x")) {
  "SignaturePresent"
}
else {
  "NotSigned"
}
Remove-Item $verifyRoot -Recurse -Force

$stream = [System.IO.File]::OpenRead($outputPath)
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  $hashBytes = $sha256.ComputeHash($stream)
  $hashValue = -join ($hashBytes | ForEach-Object { $_.ToString("X2") })
}
finally {
  $sha256.Dispose()
  $stream.Dispose()
}
$sidecar = "$hashValue  $([System.IO.Path]::GetFileName($outputPath))`n"
[System.IO.File]::WriteAllText("$outputPath.sha256", $sidecar, $utf8NoBom)

[pscustomobject]@{
  Mode = if ($LocalUnsigned) { "Local unsigned test (not Partner Center identity)" } else { "Partner Center" }
  Package = [System.IO.Path]::GetFullPath($outputPath)
  SizeBytes = (Get-Item $outputPath).Length
  SHA256 = $hashValue
  SignatureStatus = $signatureStatus
  IdentityName = $IdentityName
  Publisher = $Publisher
  PublisherDisplayName = $PublisherDisplayName
  Version = $PackageVersion
  Architecture = "x64"
} | Format-List

if ($LocalUnsigned) {
  Write-Warning "This special-OID package is only for local Windows 11 testing with Add-AppxPackage -AllowUnsigned. It cannot be uploaded as the Partner Center product."
}
else {
  Write-Host "Partner Center MSIX created. Re-check all three case-sensitive identity values before upload." -ForegroundColor Green
}
