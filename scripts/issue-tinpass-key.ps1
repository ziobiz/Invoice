# Issue tinpass API key on Invoice host (non-interactive)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Pw = $env:INVOICE_SSH_PASSWORD
if (-not $Pw) { throw "Set INVOICE_SSH_PASSWORD" }
$HostKey = "SHA256:MC7o5R39O5gj9oIkHT2H4pNSgIGFi2dEyuRcyZuI9Jc"
$Plink = "C:\Program Files\PuTTY\plink.exe"
$Pscp = "C:\Program Files\PuTTY\pscp.exe"
$Local = Join-Path $Root "scripts\remote-issue-tinpass-key.sh"
$Remote = "/tmp/remote-issue-tinpass-key.sh"

& $Pscp -pw $Pw -hostkey $HostKey $Local "root@153.75.235.61:$Remote"
& $Plink -ssh 153.75.235.61 -l root -pw $Pw -hostkey $HostKey -batch "sed -i 's/\r$//' $Remote && chmod +x $Remote && bash $Remote"
