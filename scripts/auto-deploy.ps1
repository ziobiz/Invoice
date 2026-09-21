# Auto-deploy Invoice Service to production VPS
# Usage: powershell -File scripts/auto-deploy.ps1
# Secrets are never packaged.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Tar = Join-Path (Split-Path -Parent $Root) "invoice-service-deploy.tgz"
$HostKey = "SHA256:MC7o5R39O5gj9oIkHT2H4pNSgIGFi2dEyuRcyZuI9Jc"
$Server = "root@153.75.235.61"
$Plink = "C:\Program Files\PuTTY\plink.exe"
$Pscp = "C:\Program Files\PuTTY\pscp.exe"

# Password from env INVOICE_SSH_PASSWORD (preferred) or prompt
$Pw = $env:INVOICE_SSH_PASSWORD
if (-not $Pw) { throw "Set INVOICE_SSH_PASSWORD env var before deploy" }

Push-Location $Root
if (Test-Path $Tar) { Remove-Item $Tar -Force }
tar -czf $Tar --exclude=node_modules --exclude=dist --exclude=.env --exclude=.git --exclude="*.tgz" .
Pop-Location

& $Pscp -pw $Pw -hostkey $HostKey $Tar "${Server}:/tmp/invoice-service-deploy.tgz"
& $Plink -ssh $Server.Split("@")[1] -l root -pw $Pw -hostkey $HostKey -batch @"
set -e
mkdir -p /opt/invoice-service
cd /opt/invoice-service
tar -xzf /tmp/invoice-service-deploy.tgz
sed -i 's/\r$//' scripts/*.sh 2>/dev/null || true
chmod +x scripts/*.sh
# Keep existing .env; only refresh PUBLIC_BASE_URL if domain set
if [ -f .env ]; then
  grep -q '^PUBLIC_BASE_URL=' .env && sed -i 's|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://invoice.icopay.net|' .env || echo 'PUBLIC_BASE_URL=https://invoice.icopay.net' >> .env
fi
bash scripts/deploy.sh
curl -fsS https://invoice.icopay.net/health || curl -fsS http://127.0.0.1:3100/health
echo
echo DEPLOY_DONE
"@

Write-Host "Auto-deploy finished."
