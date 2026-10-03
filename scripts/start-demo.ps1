param(
    [switch]$Build,
    [switch]$Reset
)

$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
$composeArguments = @('compose', '-f', (Join-Path $repoPath 'docker-compose.yml'),
    '-f', (Join-Path $repoPath 'docker-compose.demo.yml'))

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Brak Dockera. Użyj instrukcji lokalnego uruchomienia demo w README.'
}

function Invoke-DemoCompose {
    param([string[]]$CommandArguments)
    & docker @composeArguments @CommandArguments
    if ($LASTEXITCODE -ne 0) {
        throw 'Uruchomienie demo nie powiodło się. Sprawdź Docker Desktop i obecność zbudowanych obrazów; -Build wymaga internetu przy pierwszym przygotowaniu.'
    }
}

# Only an explicit preparation run may build/download dependencies.
if ($Build) {
    Invoke-DemoCompose -CommandArguments @('build')
}

if ($Reset) {
    Invoke-DemoCompose -CommandArguments @('stop', 'backend')
    Invoke-DemoCompose -CommandArguments @('run', '--rm', '--no-deps', '--pull', 'never',
        'backend', 'python', '-m', 'app.demo', '--reset')
}

Invoke-DemoCompose -CommandArguments @('up', '-d', '--no-build', '--pull', 'never')
Write-Host 'Demo offline: http://localhost:5173'
Write-Host 'Plik do importu: http://localhost:5173/demo-offline.xlsx'
Write-Host 'Dane demo są w osobnym wolumenie demo-data. Kolejna próba: scripts/start-demo.ps1 -Reset'
