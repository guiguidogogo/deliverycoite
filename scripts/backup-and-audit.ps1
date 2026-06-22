param(
  [string]$ProductionUrl = $env:PRODUCTION_DATABASE_URL,
  [string]$HomologationUrl = $env:HOMOLOGATION_DATABASE_URL,
  [string]$PostgresBin = $env:POSTGRES_BIN
)

$ErrorActionPreference = "Stop"

if (-not $ProductionUrl -or -not $HomologationUrl) {
  throw "Defina PRODUCTION_DATABASE_URL e HOMOLOGATION_DATABASE_URL somente na sessao atual."
}
if ($ProductionUrl -eq $HomologationUrl) {
  throw "As URLs de producao e homologacao apontam para o mesmo banco."
}

function Resolve-PostgresTool([string]$name) {
  if ($PostgresBin) {
    $candidate = Join-Path $PostgresBin "$name.exe"
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  $command = Get-Command $name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw "$name nao encontrado. Instale os clientes PostgreSQL ou defina POSTGRES_BIN."
}

$pgDump = Resolve-PostgresTool "pg_dump"
$pgRestore = Resolve-PostgresTool "pg_restore"
$psql = Resolve-PostgresTool "psql"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputDir = [IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot "..\backups\promotion-audit-$timestamp")
)
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

function Invoke-DatabaseBackup {
  param([string]$DatabaseUrl, [string]$EnvironmentName)

  $environmentDir = Join-Path $outputDir $EnvironmentName
  New-Item -ItemType Directory -Path $environmentDir -Force | Out-Null

  & $pgDump --dbname=$DatabaseUrl --format=custom --file=(Join-Path $environmentDir "full.dump") --no-owner --no-acl
  if ($LASTEXITCODE -ne 0) { throw "Falha no backup completo de $EnvironmentName." }

  & $pgDump --dbname=$DatabaseUrl --schema-only --file=(Join-Path $environmentDir "schema.sql") --no-owner --no-acl
  if ($LASTEXITCODE -ne 0) { throw "Falha no backup de schema de $EnvironmentName." }

  & $pgDump --dbname=$DatabaseUrl --data-only --file=(Join-Path $environmentDir "data.sql") --no-owner --no-acl --inserts
  if ($LASTEXITCODE -ne 0) { throw "Falha no backup de dados de $EnvironmentName." }

  & $pgRestore --schema-only --schema=public --no-owner --no-acl --file=(Join-Path $environmentDir "public-schema.sql") (Join-Path $environmentDir "full.dump")
  if ($LASTEXITCODE -ne 0) { throw "Falha ao extrair schema public de $EnvironmentName." }

  & $psql $DatabaseUrl -X -v ON_ERROR_STOP=1 -f (Join-Path $PSScriptRoot "production-preflight.sql") -o (Join-Path $environmentDir "preflight.txt")
  if ($LASTEXITCODE -ne 0) { throw "Falha na auditoria somente leitura de $EnvironmentName." }
}

Invoke-DatabaseBackup -DatabaseUrl $ProductionUrl -EnvironmentName "production"
Invoke-DatabaseBackup -DatabaseUrl $HomologationUrl -EnvironmentName "homologation"

& git diff --no-index -- `
  (Join-Path $outputDir "production\public-schema.sql") `
  (Join-Path $outputDir "homologation\public-schema.sql") `
  *> (Join-Path $outputDir "schema-production-vs-homologation.diff")
if ($LASTEXITCODE -gt 1) { throw "Falha ao comparar os schemas." }

Get-ChildItem -Path $outputDir -Recurse -File |
  Get-FileHash -Algorithm SHA256 |
  Select-Object Path, Hash |
  ConvertTo-Json |
  Set-Content -LiteralPath (Join-Path $outputDir "SHA256SUMS.json") -Encoding UTF8

Write-Host "Backups e comparacao gerados em: $outputDir"
