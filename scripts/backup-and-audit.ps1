param(
  [string]$ProductionUrl = $env:PRODUCTION_DATABASE_URL,
  [string]$HomologationUrl = $env:HOMOLOGATION_DATABASE_URL
)

$ErrorActionPreference = "Stop"

if (-not $ProductionUrl -or -not $HomologationUrl) {
  throw "Defina PRODUCTION_DATABASE_URL e HOMOLOGATION_DATABASE_URL. As URLs nao sao gravadas em arquivos."
}

if ($ProductionUrl -eq $HomologationUrl) {
  throw "As URLs de producao e homologacao apontam para o mesmo banco."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputDir = Join-Path $PSScriptRoot "..\backups\promotion-audit-$timestamp"
$outputDir = [IO.Path]::GetFullPath($outputDir)
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

function Invoke-SupabaseDump {
  param(
    [string]$DatabaseUrl,
    [string]$EnvironmentName
  )

  $environmentDir = Join-Path $outputDir $EnvironmentName
  New-Item -ItemType Directory -Path $environmentDir -Force | Out-Null

  & npx --yes supabase db dump --db-url $DatabaseUrl -f (Join-Path $environmentDir "roles.sql") --role-only
  if ($LASTEXITCODE -ne 0) { throw "Falha no backup de roles de $EnvironmentName." }

  & npx --yes supabase db dump --db-url $DatabaseUrl -f (Join-Path $environmentDir "schema.sql")
  if ($LASTEXITCODE -ne 0) { throw "Falha no backup de schema de $EnvironmentName." }

  & npx --yes supabase db dump --db-url $DatabaseUrl -f (Join-Path $environmentDir "data.sql") --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
  if ($LASTEXITCODE -ne 0) { throw "Falha no backup de dados de $EnvironmentName." }
}

Invoke-SupabaseDump -DatabaseUrl $ProductionUrl -EnvironmentName "production"
Invoke-SupabaseDump -DatabaseUrl $HomologationUrl -EnvironmentName "homologation"

$productionSchema = Join-Path $outputDir "production\schema.sql"
$homologationSchema = Join-Path $outputDir "homologation\schema.sql"
$schemaDiff = Join-Path $outputDir "schema-production-vs-homologation.diff"

& git diff --no-index -- $productionSchema $homologationSchema *> $schemaDiff
if ($LASTEXITCODE -gt 1) {
  throw "Falha ao comparar os schemas."
}

Get-ChildItem -Path $outputDir -Recurse -File |
  Get-FileHash -Algorithm SHA256 |
  Select-Object Path, Hash |
  ConvertTo-Json |
  Set-Content -LiteralPath (Join-Path $outputDir "SHA256SUMS.json") -Encoding UTF8

Write-Host "Backups e comparacao gerados em: $outputDir"
