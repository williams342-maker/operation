$session = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$csrf = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$encryption = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
"CONTROL_CENTER_SESSION_SECRET=$session"
"CONTROL_CENTER_CSRF_SECRET=$csrf"
"CONTROL_CENTER_ENCRYPTION_KEY=$encryption"
