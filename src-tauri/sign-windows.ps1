# Firma un binario de Windows con Azure Trusted Signing.
#
# NO-OP SEGURO: si las variables de Azure no están configuradas, imprime un aviso y sale 0
# (los builds sin credenciales salen SIN firmar, en vez de fallar). Cuando estén cargadas
# —endpoint/account/profile + AZURE_CLIENT_ID/SECRET/TENANT para el service principal— firma
# automáticamente con trusted-signing-cli. Tauri invoca este script por cada artefacto (%1).
param([Parameter(Mandatory = $true)][string]$Path)

if (-not $env:TRUSTED_SIGNING_ENDPOINT -or -not $env:TRUSTED_SIGNING_ACCOUNT -or -not $env:TRUSTED_SIGNING_PROFILE) {
  Write-Host "[sign-windows] Azure Trusted Signing no configurado -> se omite la firma de: $Path"
  exit 0
}

Write-Host "[sign-windows] Firmando con Azure Trusted Signing: $Path"
trusted-signing-cli -e $env:TRUSTED_SIGNING_ENDPOINT -a $env:TRUSTED_SIGNING_ACCOUNT -c $env:TRUSTED_SIGNING_PROFILE "$Path"
exit $LASTEXITCODE
