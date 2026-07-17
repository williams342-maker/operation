param([Parameter(Mandatory=$true)][string]$BaseUrl)
$ErrorActionPreference = "Stop"
$health = Invoke-WebRequest -Uri "$BaseUrl/healthz" -UseBasicParsing
if ($health.StatusCode -ne 200) { throw "healthz failed" }
$headers = Invoke-WebRequest -Uri $BaseUrl -UseBasicParsing
"Verified $BaseUrl returned HTTP $($headers.StatusCode)"
