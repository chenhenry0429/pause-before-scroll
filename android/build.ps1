param(
    [Parameter(Mandatory)][string]$Jdk,
    [Parameter(Mandatory)][string]$Platform,
    [Parameter(Mandatory)][string]$BuildTools,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory)][string]$Keystore
)
$ErrorActionPreference = 'Stop'
$Jdk = (Resolve-Path -LiteralPath $Jdk).Path
$Platform = (Resolve-Path -LiteralPath $Platform).Path
$BuildTools = (Resolve-Path -LiteralPath $BuildTools).Path
$Keystore = (Resolve-Path -LiteralPath $Keystore).Path
$Output = [IO.Path]::GetFullPath($Output)
if (!$env:PAUSE_KEYSTORE_PASSWORD) { throw 'Set PAUSE_KEYSTORE_PASSWORD for this build process.' }
function Run([string]$Tool, [string[]]$Arguments) {
    & $Tool @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$(Split-Path -Leaf $Tool) failed ($LASTEXITCODE)" }
}

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$java = Join-Path $Jdk 'bin/java.exe'
$jar = Join-Path $Platform 'android.jar'
$classes = Join-Path $PSScriptRoot 'build/classes'
$generated = Join-Path $PSScriptRoot 'build/generated'
$dex = Join-Path $PSScriptRoot 'build/dex'
$assets = Join-Path $PSScriptRoot 'build/assets/www'
$build = Join-Path $PSScriptRoot 'build'
New-Item -Path $classes,$generated,$dex,$assets -ItemType Directory -Force | Out-Null
$env:JAVA_HOME = $Jdk

Push-Location $repo
try { Run 'node' @('scripts/build.mjs') } finally { Pop-Location }
$webAssets = @('index.html','app-compat.js','style.css','icon.svg','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png')
foreach ($name in $webAssets) {
    Copy-Item -LiteralPath (Join-Path $repo "docs/$name") -Destination (Join-Path $assets $name) -Force
}

$resources = Join-Path $build 'resources.zip'
$unsigned = Join-Path $build 'unsigned.apk'
$aligned = Join-Path $build 'aligned.apk'
$aapt = Join-Path $BuildTools 'aapt2.exe'
Run $aapt @('compile','--dir',(Join-Path $PSScriptRoot 'res'),'-o',$resources)
Run $aapt @('link','-o',$unsigned,'-I',$jar,'--manifest',(Join-Path $PSScriptRoot 'AndroidManifest.xml'),
    '--java',$generated,$resources)
$source = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src') -Filter '*.java' -File | ForEach-Object FullName)
$source += @(Get-ChildItem -LiteralPath $generated -Filter '*.java' -File -Recurse | ForEach-Object FullName)
Run (Join-Path $Jdk 'bin/javac.exe') (@('--release','8','-encoding','UTF-8','-cp',$jar,'-d',$classes) + $source)
$bytecode = @(Get-ChildItem -LiteralPath $classes -Filter '*.class' -File -Recurse | ForEach-Object FullName)
Run $java (@('-cp',(Join-Path $BuildTools 'lib/d8.jar'),'com.android.tools.r8.D8','--min-api','26','--lib',$jar,'--output',$dex) + $bytecode)
# Java's ZIP writer uses forward slashes for asset paths on Windows too.
Run (Join-Path $Jdk 'bin/jar.exe') @('uf',$unsigned,'-C',$dex,'classes.dex','-C',$build,'assets')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($unsigned)
try {
    foreach ($name in $webAssets) {
        if (!$archive.GetEntry("assets/www/$name")) { throw "Missing APK asset $name" }
    }
} finally { $archive.Dispose() }
Run (Join-Path $BuildTools 'zipalign.exe') @('-f','4',$unsigned,$aligned)
Run $java @('-jar',(Join-Path $BuildTools 'lib/apksigner.jar'),'sign','--ks',$Keystore,'--ks-key-alias','pause-release',
    '--ks-pass','env:PAUSE_KEYSTORE_PASSWORD','--v4-signing-enabled','false','--out',$Output,$aligned)
Run $java @('-jar',(Join-Path $BuildTools 'lib/apksigner.jar'),'verify','--verbose','--print-certs',$Output)
