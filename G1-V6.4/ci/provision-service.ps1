function Grant-SylphServiceTree {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$ServiceSid,
    [Parameter(Mandatory)][string]$AccountSid
  )
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
  # The shared LocalService SID is deliberately not granted access. A
  # restricted service SID is expected to satisfy the restricted-token check;
  # if it does not, this setup must fail closed instead of broadening access.
  $entries = @("*${ServiceSid}:(OI)(CI)F", '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
  & icacls.exe $Path /inheritance:r /grant:r @entries | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "ICACLS_SERVICE_TREE_FAILED:$LASTEXITCODE" }
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetOwner([System.Security.Principal.SecurityIdentifier]::new($ServiceSid))
  Set-Acl -LiteralPath $Path -AclObject $acl
  $verified = Get-Acl -LiteralPath $Path
  $ownerSid = ([System.Security.Principal.NTAccount]::new($verified.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value
  $expectedSids = @($ServiceSid,'S-1-5-18','S-1-5-32-544') | Sort-Object
  $rules = @($verified.Access)
  $actualSids = @($rules | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Sort-Object)
  if ($ownerSid -ne $ServiceSid -or $rules.Count -ne 3 -or ($actualSids -join ',') -ne ($expectedSids -join ',') -or
      @($rules | Where-Object { $_.AccessControlType -ne 'Allow' -or $_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or $_.IsInherited }).Count -ne 0) {
    throw "SERVICE_TREE_ACL_VERIFICATION_FAILED:$Path"
  }
}

function Grant-SylphServiceFile {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$ServiceSid,
    [Parameter(Mandatory)][string]$AccountSid
  )
  # Do not grant the shared LocalService account SID access to protected
  # objects; only the dedicated service SID, SYSTEM, and Administrators.
  $entries = @("*${ServiceSid}:F", '*S-1-5-18:F', '*S-1-5-32-544:F')
  & icacls.exe $Path /inheritance:r /grant:r @entries | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "ICACLS_SERVICE_FILE_FAILED:$LASTEXITCODE" }
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetOwner([System.Security.Principal.SecurityIdentifier]::new($ServiceSid))
  Set-Acl -LiteralPath $Path -AclObject $acl
  $verified = Get-Acl -LiteralPath $Path
  $ownerSid = ([System.Security.Principal.NTAccount]::new($verified.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value
  $expectedSids = @($ServiceSid,'S-1-5-18','S-1-5-32-544') | Sort-Object
  $rules = @($verified.Access)
  $actualSids = @($rules | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Sort-Object)
  if ($ownerSid -ne $ServiceSid -or $rules.Count -ne 3 -or ($actualSids -join ',') -ne ($expectedSids -join ',') -or
      @($rules | Where-Object { $_.AccessControlType -ne 'Allow' -or $_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or $_.IsInherited }).Count -ne 0) {
    throw "SERVICE_FILE_ACL_VERIFICATION_FAILED:$Path"
  }
}

function Protect-SylphScratchRoot {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][string]$ClientSid)
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
  $entries = @('*S-1-5-18:F','*S-1-5-32-544:F',"*${ClientSid}:RX")
  & icacls.exe $Path /inheritance:r /grant:r @entries | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "SCRATCH_ROOT_ACL_FAILED:$LASTEXITCODE" }
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetOwner([System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
  Set-Acl -LiteralPath $Path -AclObject $acl
  $actualAcl = Get-Acl -LiteralPath $Path
  $ownerSid = ([System.Security.Principal.NTAccount]::new($actualAcl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value
  $expected = @('S-1-5-18','S-1-5-32-544',$ClientSid) | Sort-Object
  $rules = @($actualAcl.Access)
  $actual = @($rules | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Sort-Object)
  if ($ownerSid -ne 'S-1-5-32-544' -or $rules.Count -ne 3 -or ($actual -join ',') -ne ($expected -join ',') -or
      @($rules | Where-Object { $_.AccessControlType -ne 'Allow' -or $_.IsInherited }).Count -ne 0) {
    throw "SCRATCH_ROOT_ACL_MISMATCH:$Path"
  }
  $clientRule = @($rules | Where-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $ClientSid })[0]
  $unsafeRights = [int]([System.Security.AccessControl.FileSystemRights]::Write -bor
    [System.Security.AccessControl.FileSystemRights]::Delete -bor
    [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
    [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [System.Security.AccessControl.FileSystemRights]::TakeOwnership)
  if (([int]$clientRule.FileSystemRights -band $unsafeRights) -ne 0) { throw "SCRATCH_ROOT_CLIENT_HAS_MUTATION_RIGHTS:$Path" }
}

function Grant-SylphScratchRootTraverse {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][string]$ServiceSid,[Parameter(Mandatory)][string]$ClientSid)
  & icacls.exe $Path /grant "*${ServiceSid}:RX" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "SCRATCH_ROOT_SERVICE_TRAVERSE_FAILED:$LASTEXITCODE" }
  $acl = Get-Acl -LiteralPath $Path
  $ownerSid = ([System.Security.Principal.NTAccount]::new($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value
  $rules = @($acl.Access)
  $actual = @($rules | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Sort-Object)
  $baseExpected = @('S-1-5-18','S-1-5-32-544',$ClientSid)
  $serviceSids = @($actual | Where-Object { $_ -like 'S-1-5-80-*' })
  $unknown = @($actual | Where-Object { $_ -notin $baseExpected -and $_ -notlike 'S-1-5-80-*' })
  $baseRulesValid = $true
  foreach ($baseSid in $baseExpected) {
    $matching = @($rules | Where-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $baseSid })
    if ($matching.Count -ne 1 -or $matching[0].AccessControlType -ne 'Allow' -or $matching[0].IsInherited) { $baseRulesValid = $false }
    elseif ($baseSid -eq $ClientSid -and
        ([int]$matching[0].FileSystemRights -band [int]([System.Security.AccessControl.FileSystemRights]::Write -bor
          [System.Security.AccessControl.FileSystemRights]::Delete -bor
          [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
          [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
          [System.Security.AccessControl.FileSystemRights]::TakeOwnership)) -ne 0) { $baseRulesValid = $false }
    elseif ($baseSid -ne $ClientSid -and $matching[0].FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl) { $baseRulesValid = $false }
  }
  $serviceRules = @($rules | Where-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -like 'S-1-5-80-*' })
  $serviceRulesValid = $serviceSids.Count -ge 1 -and $serviceRules.Count -eq $serviceSids.Count -and
    @($serviceRules | Where-Object {
      $_.AccessControlType -ne 'Allow' -or $_.IsInherited -or
      ([int]$_.FileSystemRights -band [int]([System.Security.AccessControl.FileSystemRights]::Write -bor
        [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership)) -ne 0
    }).Count -eq 0
  if ($ownerSid -ne 'S-1-5-32-544' -or $unknown.Count -ne 0 -or $actual.Count -ne ($baseExpected.Count + $serviceSids.Count) -or
      -not $baseRulesValid -or -not $serviceRulesValid -or $ServiceSid -notin $serviceSids) {
    throw "SCRATCH_ROOT_SERVICE_TRAVERSE_ACL_MISMATCH:$Path"
  }
}

function Install-SylphProbeService {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][ValidateSet('LocalServiceRestricted','VirtualAccount')][string]$IdentityMode,
    [Parameter(Mandatory)][string]$BrokerExe,
    [Parameter(Mandatory)][string]$DataDir,
    [Parameter(Mandatory)][string]$ClientSid
  )
  if (Get-Service -Name $Name -ErrorAction SilentlyContinue) { throw "SERVICE_ALREADY_EXISTS:$Name" }
  if (-not (Test-Path -LiteralPath $BrokerExe -PathType Leaf)) { throw "BROKER_BINARY_MISSING:$BrokerExe" }

  if ($IdentityMode -eq 'LocalServiceRestricted') {
    $account = 'NT AUTHORITY\LocalService'
    $accountSid = 'S-1-5-19'
  } else {
    $account = "NT SERVICE\$Name"
    $accountSid = $null
  }

  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  $protectedBinary = Join-Path $DataDir 'g1-broker.exe'
  Copy-Item -LiteralPath $BrokerExe -Destination $protectedBinary -Force
  $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $BrokerExe).Hash
  $protectedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $protectedBinary).Hash
  if ($sourceHash -ne $protectedHash) { throw 'PROTECTED_EXECUTABLE_COPY_HASH_MISMATCH' }
  $image = '"{0}" --service-name {1} --data-dir "{2}" --client-sid {3}' -f $protectedBinary,$Name,$DataDir,$ClientSid
  $createOutput = & sc.exe create $Name "binPath= $image" 'start= demand' "obj= $account" 'password= '
  $createCode = $LASTEXITCODE
  if ($createCode -ne 0) { throw "SC_CREATE_FAILED:${createCode}:$($createOutput -join ' ')" }
  # Record creation immediately so the caller's finally block can remove the
  # service even if SID type or ACL setup fails before this function returns.
  $script:installedService = $true
  $sidOutput = & sc.exe sidtype $Name restricted
  $sidCode = $LASTEXITCODE
  if ($sidCode -ne 0) { throw "SC_SIDTYPE_FAILED:${sidCode}:$($sidOutput -join ' ')" }
  $serviceSid = ([System.Security.Principal.NTAccount]::new("NT SERVICE\$Name")).Translate([System.Security.Principal.SecurityIdentifier]).Value
  if (-not $accountSid) { $accountSid = $serviceSid }
  $parent = Split-Path -Parent $DataDir
  Grant-SylphScratchRootTraverse -Path $parent -ServiceSid $serviceSid -ClientSid $ClientSid
  Grant-SylphServiceTree -Path $DataDir -ServiceSid $serviceSid -AccountSid $accountSid
  Grant-SylphServiceFile -Path $protectedBinary -ServiceSid $serviceSid -AccountSid $accountSid
  $query = & sc.exe qc $Name 2>&1
  if ($LASTEXITCODE -ne 0 -or ($query -join "`n") -notmatch [regex]::Escape($protectedBinary)) { throw 'SERVICE_IMAGE_PATH_NOT_PROTECTED_BINARY' }
  [pscustomobject]@{
    serviceName = $Name
    identityMode = $IdentityMode
    configuredAccount = $account
    accountSid = $accountSid
    serviceSid = $serviceSid
    sidType = 'RESTRICTED'
    dataDir = $DataDir
    createExitCode = $createCode
    sidTypeExitCode = $sidCode
    imagePath = $image
    protectedBinary = $protectedBinary
    sourceBinarySha256 = $sourceHash
    protectedBinarySha256 = $protectedHash
  }
}

function Start-SylphProbeService {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Name,[Parameter(Mandatory)][string]$DataDir,[int]$TimeoutSeconds = 20)
  $readyPath = Join-Path $DataDir 'broker-ready.json'
  if (Test-Path -LiteralPath $readyPath) {
    Remove-Item -LiteralPath $readyPath -Force -ErrorAction Stop
  }
  $output = & sc.exe start $Name
  $startCode = $LASTEXITCODE
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 250
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($service -and $service.Status -eq 'Running') { break }
  } while ([DateTime]::UtcNow -lt $deadline)
  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  $ready = $null
  if (Test-Path -LiteralPath $readyPath) { $ready = Get-Content -Raw -LiteralPath $readyPath | ConvertFrom-Json }
  [pscustomobject]@{ serviceName=$Name; startExitCode=$startCode; startOutput=($output -join ' '); state=if($service){$service.Status.ToString()}else{'MISSING'}; ready=$ready; readyFile=$readyPath }
}

function Stop-SylphProbeService {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Name)
  $output = & sc.exe stop $Name 2>&1
  $code = $LASTEXITCODE
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 250
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  } while ($service -and $service.Status -ne 'Stopped' -and [DateTime]::UtcNow -lt $deadline)
  [pscustomobject]@{ serviceName=$Name; stopExitCode=$code; stopOutput=($output -join ' '); state=if($service){$service.Status.ToString()}else{'MISSING'} }
}

function Remove-SylphProbeService {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Name)
  if (Get-Service -Name $Name -ErrorAction SilentlyContinue) {
    $stopped = Stop-SylphProbeService -Name $Name
    if ($stopped.state -ne 'Stopped') { throw "SERVICE_DID_NOT_STOP_BEFORE_DELETE:${Name}:$($stopped.state)" }
    $output = & sc.exe delete $Name 2>&1
    $code = $LASTEXITCODE
    if ($code -ne 0) { throw "SC_DELETE_FAILED:${Name}:${code}:$($output -join ' ')" }
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
      Start-Sleep -Milliseconds 250
      $remaining = Get-Service -Name $Name -ErrorAction SilentlyContinue
    } while ($remaining -and [DateTime]::UtcNow -lt $deadline)
    if ($remaining) { throw "SERVICE_DELETE_PENDING_TIMEOUT:${Name}:$($remaining.Status)" }
  }
  $script:installedService = $false
}
