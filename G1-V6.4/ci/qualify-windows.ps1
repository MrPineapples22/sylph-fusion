[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$BrokerExe,
  [Parameter(Mandatory)][string]$ClientExe,
  [Parameter(Mandatory)][string]$AttackerExe,
  [Parameter(Mandatory)][string]$VerifierExe
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$packageRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$evidenceRoot = Join-Path $packageRoot 'verification\ci-preflight'
$runId = [Guid]::NewGuid().ToString('N')
$evidenceDir = Join-Path $evidenceRoot "run-$runId"
New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null
. (Join-Path $PSScriptRoot 'provision-service.ps1')

$serviceName = 'SylphG1Broker'
$testUserName = 'sg' + $runId.Substring(0, 10)
$dataRoot = Join-Path $env:ProgramData "SylphG1V64-$runId"
$userRoot = Join-Path $dataRoot 'standard-user'
$vulnOriginalDir = Join-Path $userRoot 'vulnerable-original'
$vulnAliasDir = Join-Path $userRoot 'vulnerable-alias'
$brokerRoot = Join-Path $dataRoot 'broker-localservice'
$brokerAliasDir = Join-Path $userRoot 'broker-alias'
$virtualBrokerRoot = Join-Path $dataRoot 'broker-virtual-account'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$identityProbe = Join-Path $packageRoot 'verification\ci-preflight\identity-probe.mjs'
$createHardlinkScript = Join-Path $packageRoot 'verification\ci-preflight\create-hardlink-control.mjs'
$attackHardlinkScript = Join-Path $packageRoot 'verification\ci-preflight\attack-hardlink-control.mjs'
$linkExistingScript = Join-Path $packageRoot 'verification\ci-preflight\link-existing.mjs'
$holdFileScript = Join-Path $packageRoot 'verification\ci-preflight\hold-file.mjs'
$createdUser = $false
$installedService = $false
$handleHolder = $null
$handleReleasePath = $null
$pipeHolder = $null
$pipeReleasePath = $null
$result = [ordered]@{
  schema = 'SYLPH_G1_V64_WINDOWS_PREFLIGHT_1'
  runId = $runId
  startedAtUtc = [DateTime]::UtcNow.ToString('O')
  status = 'RUNNING'
  phases = [ordered]@{}
  failures = @()
}

function Save-Record([string]$Name, $Value) {
  $path = Join-Path $evidenceDir $Name
  $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $path -Encoding utf8NoBOM
}

function Get-SidFromWhoami([string]$Text) {
  $match = [regex]::Match($Text, 'S-1-\d+(?:-\d+)+')
  if (-not $match.Success) { throw "TOKEN_SID_NOT_FOUND:$Text" }
  return $match.Value
}

function ConvertTo-JsonResult([string]$StdOut) {
  $lines = @($StdOut -split "`r?`n" | Where-Object { $_.Trim() })
  for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    $line = $lines[$i].Trim()
    if ($line.StartsWith('{') -and $line.EndsWith('}')) {
      try { return $line | ConvertFrom-Json } catch { }
    }
  }
  return $null
}

function Invoke-AsTestUser([string]$FilePath, [string[]]$Arguments, [string]$Label) {
  $stdout = Join-Path $userRoot "$Label.stdout.txt"
  $stderr = Join-Path $userRoot "$Label.stderr.txt"
  $argumentString = ($Arguments | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + $_.Replace('"','\"') + '"' } else { $_ }
  }) -join ' '
  $process = Start-Process -FilePath $FilePath -ArgumentList $argumentString -Credential $credential `
    -WorkingDirectory $packageRoot -Wait -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $outText = if (Test-Path -LiteralPath $stdout) { Get-Content -Raw -LiteralPath $stdout } else { '' }
  $errText = if (Test-Path -LiteralPath $stderr) { Get-Content -Raw -LiteralPath $stderr } else { '' }
  [pscustomobject]@{ exitCode=$process.ExitCode; processId=$process.Id; stdout=$outText; stderr=$errText; json=(ConvertTo-JsonResult $outText) }
}

function Invoke-AsAdmin([string]$FilePath, [string[]]$Arguments) {
  $output = & $FilePath @Arguments 2>&1
  $code = $LASTEXITCODE
  [pscustomobject]@{ exitCode=$code; output=($output -join "`n"); json=(ConvertTo-JsonResult ($output -join "`n")) }
}

function Start-AsTestUser([string]$FilePath, [string[]]$Arguments, [string]$Label) {
  $stdout = Join-Path $userRoot "$Label.stdout.txt"
  $stderr = Join-Path $userRoot "$Label.stderr.txt"
  $argumentString = ($Arguments | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + $_.Replace('"','\"') + '"' } else { $_ }
  }) -join ' '
  return Start-Process -FilePath $FilePath -ArgumentList $argumentString -Credential $credential `
    -WorkingDirectory $packageRoot -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr
}

function Assert-Win32AccessDenied($Attempt, [string]$Label) {
  if (-not $Attempt.json) { throw "ATTACK_RESULT_NOT_JSON:${Label}:$($Attempt.stdout):$($Attempt.stderr)" }
  if (-not $Attempt.json.requestedAccess) { throw "ATTACK_ACCESS_MASK_MISSING:$Label" }
  if ([string]$Attempt.json.userSid -ne [string]$script:clientSid) { throw "ATTACK_TOKEN_SID_MISMATCH:$Label" }
  if ($Attempt.json.win32Error -ne 5 -or $Attempt.json.result -ne 'ACCESS_DENIED' -or
      $Attempt.json.requestedAccess -ne 3221225472) {
    throw "UNEXPECTED_ACCESS_RESULT:${Label}:$($Attempt.stdout):$($Attempt.stderr)"
  }
}

function Assert-Win32ReadDenied($Attempt, [string]$Label) {
  if (-not $Attempt.json) { throw "READ_ATTACK_RESULT_NOT_JSON:${Label}:$($Attempt.stdout):$($Attempt.stderr)" }
  if ([string]$Attempt.json.userSid -ne [string]$script:clientSid) { throw "READ_ATTACK_TOKEN_SID_MISMATCH:$Label" }
  if ($Attempt.json.win32Error -ne 5 -or $Attempt.json.result -ne 'ACCESS_DENIED' -or
      $Attempt.json.requestedAccess -ne 2147483648) {
    throw "UNEXPECTED_READ_ACCESS_RESULT:${Label}:$($Attempt.stdout):$($Attempt.stderr)"
  }
}

function Assert-PipeServerCreationDenied($Attempt, [string]$Label) {
  if (-not $Attempt.json -or $Attempt.exitCode -ne 0) { throw "PIPE_ATTACK_RESULT_INVALID:${Label}:$($Attempt.stdout):$($Attempt.stderr)" }
  if ([string]$Attempt.json.callerSid -ne [string]$script:clientSid) { throw "PIPE_ATTACK_TOKEN_MISMATCH:${Label}" }
  if ($Attempt.json.result -ne 'CREATE_DENIED' -or $Attempt.json.win32Error -ne 5) {
    throw "UNAUTHORIZED_PIPE_SERVER_CREATION_NOT_DENIED:${Label}:$($Attempt.stdout)"
  }
}

function Assert-PrivilegeReport($Record,[string]$Label) {
  if (-not $Record -or $null -eq $Record.privileges -or $null -eq $Record.privilegeCount -or
      $null -eq $Record.enabledPrivilegeCount -or @($Record.privileges).Count -eq 0 -or
      @($Record.privileges).Count -ne [int]$Record.privilegeCount) {
    throw "PRIVILEGE_REPORT_MISSING_OR_COUNT_MISMATCH:${Label}"
  }
  $enabled = 0
  foreach ($privilege in @($Record.privileges)) {
    if ([string]::IsNullOrWhiteSpace([string]$privilege.name) -or $null -eq $privilege.attributes -or $null -eq $privilege.enabled) {
      throw "PRIVILEGE_ENTRY_INVALID:$Label"
    }
    $observedEnabled = (([int64]$privilege.attributes -band 2) -ne 0)
    if ([bool]$privilege.enabled -ne $observedEnabled) { throw "PRIVILEGE_ATTRIBUTE_INCONSISTENT:${Label}:$($privilege.name)" }
    if ($observedEnabled) { $enabled++ }
  }
  if ($enabled -ne [int]$Record.enabledPrivilegeCount) { throw "ENABLED_PRIVILEGE_COUNT_MISMATCH:${Label}:$enabled/$($Record.enabledPrivilegeCount)" }
}

function Get-WhoamiPrivilegeNames([string]$CsvText) {
  $rows = @($CsvText -split "`r?`n" | Where-Object { $_.Trim() } | ConvertFrom-Csv -Header name,displayName,state)
  $valid = @($rows | Where-Object { $_.name -match '^Se[A-Za-z0-9]+Privilege$' })
  if ($valid.Count -eq 0) { throw 'WHOAMI_PRIVILEGE_LIST_EMPTY' }
  $normalized = @($valid | ForEach-Object { [pscustomobject]@{name=[string]$_.name;enabled=([string]$_.state -match '(?i)enabled')} })
  return @($normalized | Sort-Object name)
}

function Set-ProtectedFileAcl([string]$Path, [string]$ServiceSid, [string]$AccountSid) {
  $entries = @("*${ServiceSid}:F", '*S-1-5-18:F', '*S-1-5-32-544:F')
  # Intentionally never grant shared LocalService (S-1-5-19) access here.
  & icacls.exe $Path /inheritance:r /grant:r @entries | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "PROTECT_FILE_ACL_FAILED:$LASTEXITCODE" }
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetOwner([System.Security.Principal.SecurityIdentifier]::new($ServiceSid))
  Set-Acl -LiteralPath $Path -AclObject $acl
  $verified = Get-Acl -LiteralPath $Path
  $ownerSid = ([System.Security.Principal.NTAccount]::new($verified.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value
  if ($ownerSid -ne $ServiceSid) { throw "PROTECTED_FILE_OWNER_MISMATCH:${Path}:${ownerSid}" }
  $expectedSids = @($ServiceSid,'S-1-5-18','S-1-5-32-544') | Sort-Object
  $actualRules = @($verified.Access)
  $actualSids = @($actualRules | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Sort-Object)
  if ($actualRules.Count -ne 3 -or ($actualSids -join ',') -ne ($expectedSids -join ',') -or
      @($actualRules | Where-Object { $_.AccessControlType -ne 'Allow' -or $_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or $_.IsInherited }).Count -ne 0) {
    throw "PROTECTED_FILE_DACL_MISMATCH:$Path"
  }
}

function Save-AclSnapshot([string]$Label,[string[]]$Paths) {
  $records = @()
  foreach ($path in $Paths) {
    if (-not (Test-Path -LiteralPath $path)) { $records += [ordered]@{path=$path;exists=$false}; continue }
    $acl = Get-Acl -LiteralPath $path
    $records += [ordered]@{
      path=$path;exists=$true;owner=$acl.Owner;ownerSid=([System.Security.Principal.NTAccount]::new($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value
      sddl=$acl.Sddl;access=@($acl.Access | ForEach-Object { [ordered]@{identity=$_.IdentityReference.Value;type=$_.AccessControlType.ToString();rights=$_.FileSystemRights.ToString();inherited=$_.IsInherited;inheritance=$_.InheritanceFlags.ToString();propagation=$_.PropagationFlags.ToString()} })
    }
  }
  Save-Record "$Label-acl.json" $records
}

function Set-TestUserWritable([string]$Path, [string]$ClientSid) {
  & icacls.exe $Path /grant "*${ClientSid}:(OI)(CI)M" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "TEMP_TEST_ACE_FAILED:$LASTEXITCODE" }
}

function Read-IdentityArtifact([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "IDENTITY_ARTIFACT_MISSING:$Path" }
  return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
}

function Assert-NonReparsePathChain([string]$Path,[string]$TrustedBase) {
  $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $basePath = [IO.Path]::GetFullPath($TrustedBase).TrimEnd('\')
  if (-not $fullPath.StartsWith($basePath + '\',[StringComparison]::OrdinalIgnoreCase)) {
    throw "SCRATCH_PATH_OUTSIDE_TRUSTED_BASE:$fullPath"
  }
  $records = @()
  $cursor = Get-Item -LiteralPath $fullPath -Force
  $reachedBase = $false
  while ($cursor) {
    if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "REPARSE_POINT_IN_SCRATCH_PATH_CHAIN:$($cursor.FullName)" }
    $identity = Invoke-AsAdmin -FilePath $VerifierExe -Arguments @('identity',$cursor.FullName)
    if ($identity.exitCode -ne 0 -or -not $identity.json -or $null -eq $identity.json.volumeSerial -or
        $null -eq $identity.json.fileIndexLow -or $null -eq $identity.json.fileIndexHigh) {
      throw "SCRATCH_PATH_FILE_IDENTITY_UNAVAILABLE:$($cursor.FullName):$($identity.output)"
    }
    $records += [ordered]@{path=$cursor.FullName;attributes=$cursor.Attributes.ToString();identity=$identity.json}
    if ([string]::Equals([IO.Path]::GetFullPath($cursor.FullName).TrimEnd('\'),$basePath,[StringComparison]::OrdinalIgnoreCase)) {
      $reachedBase = $true
      break
    }
    $cursor = $cursor.Parent
  }
  if (-not $reachedBase) { throw "TRUSTED_BASE_NOT_REACHED:$basePath" }
  Save-Record 'scratch-path-chain.json' $records
}

function Start-BrokerAndCheck([string]$Mode, [string]$DataDir, [string]$ClientSid) {
  $install = Install-SylphProbeService -Name $serviceName -IdentityMode $Mode -BrokerExe $BrokerExe `
    -DataDir $DataDir -ClientSid $ClientSid
  $script:installedService = $true
  Save-Record "$Mode-service-config.json" $install
  $started = Start-SylphProbeService -Name $serviceName -DataDir $DataDir
  Save-Record "$Mode-service-start.json" $started
  if ($started.state -ne 'Running' -or -not $started.ready -or
      $started.ready.schema -ne 'SYLPH_G1_BROKER_READY_2' -or $started.ready.firstPipeInstanceCreated -ne $true -or
      $null -eq $started.ready.processId -or [string]::IsNullOrWhiteSpace([string]$started.ready.startupNonce)) {
    throw "BROKER_SERVICE_NOT_READY_OR_NOT_BOUND_TO_FRESH_PIPE:$Mode"
  }
  $tokenPath = Join-Path $DataDir 'broker-token.json'
  if (-not (Test-Path -LiteralPath $tokenPath)) { throw "BROKER_TOKEN_REPORT_MISSING:$Mode" }
  $token = Get-Content -Raw -LiteralPath $tokenPath | ConvertFrom-Json
  Save-Record "$Mode-broker-token.json" $token
  $serviceProcess = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
  if (-not $serviceProcess -or $serviceProcess.State -ne 'Running' -or
      [long]$serviceProcess.ProcessId -ne [long]$started.ready.processId -or
      $null -eq $token.processId -or [long]$token.processId -ne [long]$serviceProcess.ProcessId) {
    $servicePid = if ($serviceProcess) { [long]$serviceProcess.ProcessId } else { 'MISSING' }
    $readyPid = if ($started.ready) { [string]$started.ready.processId } else { 'MISSING' }
    $tokenPid = if ($token) { [string]$token.processId } else { 'MISSING' }
    $serviceState = if ($serviceProcess) { [string]$serviceProcess.State } else { 'MISSING' }
    throw "BROKER_PID_BINDING_MISMATCH:${Mode}:state=${serviceState}:servicePid=${servicePid}:readyPid=${readyPid}:tokenPid=${tokenPid}"
  }
  Save-Record "$Mode-service-process-binding.json" ([ordered]@{serviceProcessId=[long]$serviceProcess.ProcessId;readyProcessId=[long]$started.ready.processId;tokenProcessId=[long]$token.processId;startupNonce=$started.ready.startupNonce;bound=$true})
  $imageIdentity = Invoke-AsAdmin -FilePath $VerifierExe -Arguments @('identity',$install.protectedBinary)
  if ($imageIdentity.exitCode -ne 0 -or -not $imageIdentity.json -or $imageIdentity.json.links -ne 1) {
    throw "SERVICE_IMAGE_NOT_SINGLE_LINK_OBJECT:${Mode}:$($imageIdentity.output)"
  }
  Save-Record "$Mode-service-image-file-identity.json" $imageIdentity
  [pscustomobject]@{ install=$install; start=$started; token=$token; imageIdentity=$imageIdentity.json; dbPath=(Join-Path $DataDir 'registry.sqlite') }
}

function Test-ClientOperation([string]$Label, [string]$Verb, [string[]]$Tail = @()) {
  $run = Invoke-AsTestUser -FilePath $ClientExe -Arguments (@($Verb) + $Tail) -Label $Label
  Save-Record "$Label.json" $run
  if ($run.exitCode -ne 0) { throw "AUTHORIZED_CLIENT_OPERATION_FAILED:${Label}:$($run.stdout):$($run.stderr)" }
  return $run
}

try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  $admin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { throw 'CI_RUNNER_NOT_ADMINISTRATOR' }
  $os = Get-CimInstance Win32_OperatingSystem
  $runnerRecord = [ordered]@{
    schema='SYLPH_G1_V64_CI_ENVIRONMENT_1'; capturedAtUtc=[DateTime]::UtcNow.ToString('O')
    runnerOS=$env:RUNNER_OS; runnerArch=$env:RUNNER_ARCH; imageOS=$env:ImageOS; imageVersion=$env:ImageVersion
    osCaption=$os.Caption; osVersion=$os.Version; osBuild=$os.BuildNumber; nodeVersion=(& node.exe --version)
    rustcVersion=(& rustc.exe --version 2>&1 | Out-String).Trim(); cargoVersion=(& cargo.exe --version 2>&1 | Out-String).Trim()
    runnerIdentity=$identity.Name; runnerSid=$identity.User.Value; runnerAdmin=$admin
    runnerWhoamiAll=(& whoami.exe /all 2>&1 | Out-String)
  }
  Save-Record 'environment.json' $runnerRecord
  $volumeInfo = & fsutil.exe fsinfo volumeinfo $env:SystemDrive 2>&1
  if ($LASTEXITCODE -ne 0 -or ($volumeInfo -join "`n") -notmatch '(?im)File System Name\s*:\s*NTFS') {
    throw "SCRATCH_VOLUME_NOT_NTFS:$($volumeInfo -join ' ')"
  }
  Save-Record 'volume.json' ([ordered]@{ drive=$env:SystemDrive; fsutilOutput=($volumeInfo -join "`n"); isNTFS=$true })
  $result.phases.CI_P0_Environment = 'PASS_ADMIN_TOKEN_NTFS_RUNNER'

  $random = [byte[]]::new(24)
  [Security.Cryptography.RandomNumberGenerator]::Fill($random)
  $passwordPlain = 'aA1!' + [Convert]::ToBase64String($random).Replace('=','Q')
  $password = ConvertTo-SecureString $passwordPlain -AsPlainText -Force
  $user = New-LocalUser -Name $testUserName -Password $password -FullName 'SYLPH Disposable G1 Test' `
    -Description 'Disposable CI security fixture account' -AccountNeverExpires -PasswordNeverExpires
  $createdUser = $true
  $clientSid = $user.SID.Value
  $credential = [pscredential]::new("$env:COMPUTERNAME\$testUserName",$password)
  Protect-SylphScratchRoot -Path $dataRoot -ClientSid $clientSid
  Assert-NonReparsePathChain -Path $dataRoot -TrustedBase $env:ProgramData
  New-Item -ItemType Directory -Force -Path $userRoot | Out-Null
  $icacls = @("*${clientSid}:(OI)(CI)M", '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
  & icacls.exe $userRoot /inheritance:r /grant:r @icacls | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "TEST_USER_ACL_FAILED:$LASTEXITCODE" }
  New-Item -ItemType Directory -Force -Path $vulnOriginalDir,$vulnAliasDir,$brokerAliasDir | Out-Null
  $scratchRootProbe = Invoke-AsTestUser -FilePath $node -Arguments @(
    (Join-Path $packageRoot 'verification\ci-preflight\attempt-create-child.mjs'),(Join-Path $dataRoot 'attacker-child')
  ) -Label 'scratch-root-replacement-denied'
  if ($scratchRootProbe.exitCode -ne 0 -or -not $scratchRootProbe.json -or
      $scratchRootProbe.json.result -ne 'ACCESS_DENIED' -or $scratchRootProbe.json.userSid -ne $clientSid) {
    throw "UNTRUSTED_CLIENT_CAN_CREATE_SCRATCH_ROOT_CHILD:$($scratchRootProbe.stdout):$($scratchRootProbe.stderr)"
  }
  Save-Record 'scratch-root-replacement-denied.json' $scratchRootProbe
  Save-AclSnapshot 'scratch-root' @($env:ProgramData,$dataRoot)
  $credentialRecord = [ordered]@{ userName=$testUserName; userSid=$clientSid; group='Users'; passwordRecorded=$false; created=$true }
  Save-Record 'standard-user.json' $credentialRecord

  $nodeIdentityPath = Join-Path $userRoot 'node-identity.json'
  $probe = Invoke-AsTestUser -FilePath $node -Arguments @($identityProbe,$nodeIdentityPath) -Label 'node-identity'
  if ($probe.exitCode -ne 0) { throw "NODE_IDENTITY_PROBE_FAILED:$($probe.stderr)" }
  $nodeIdentity = Read-IdentityArtifact $nodeIdentityPath
  if ([long]$nodeIdentity.processId -ne [long]$probe.processId) { throw 'NODE_IDENTITY_PID_MISMATCH' }
  $nodeSid = Get-SidFromWhoami $nodeIdentity.user
  if ($nodeSid -ne $clientSid) { throw "NODE_PROCESS_TOKEN_MISMATCH:${nodeSid}:${clientSid}" }
  $nodeGroupsText = [string]::Join("`n", @($nodeIdentity.groups))
  if ($nodeGroupsText -match 'S-1-5-32-544' -or $nodeGroupsText -match '(?i)BUILTIN\\Administrators') {
    throw 'TEMP_TEST_USER_HAS_ADMINISTRATORS_GROUP'
  }
  if ($nodeGroupsText -notmatch 'S-1-16-8192') { throw 'TEMP_TEST_USER_NOT_MEDIUM_INTEGRITY' }
  Save-Record 'node-process-identity.json' $nodeIdentity
  $attackerIdentity = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('identity') -Label 'attacker-identity'
  if ($attackerIdentity.exitCode -ne 0 -or -not $attackerIdentity.json) { throw "ATTACKER_IDENTITY_PROBE_FAILED:$($attackerIdentity.stdout):$($attackerIdentity.stderr)" }
  if (-not $attackerIdentity.json.userSid -or $null -eq $attackerIdentity.json.integrityRid -or
      $null -eq $attackerIdentity.json.privilegeCount -or $null -eq $attackerIdentity.json.enabledPrivilegeCount) {
    throw 'ATTACKER_TOKEN_REPORT_INCOMPLETE'
  }
  $attackerSid = [string]$attackerIdentity.json.userSid
  if ([long]$attackerIdentity.json.processId -ne [long]$attackerIdentity.processId) { throw 'ATTACKER_IDENTITY_PID_MISMATCH' }
  if ($attackerSid -ne $nodeSid -or $attackerSid -ne $clientSid) { throw "NODE_ATTACKER_TOKEN_MISMATCH:${nodeSid}:${attackerSid}:${clientSid}" }
  if ($attackerIdentity.json.integrityRid -ne 8192) { throw 'ATTACKER_NOT_MEDIUM_INTEGRITY' }
  Assert-PrivilegeReport $attackerIdentity.json 'attacker'
  $nodePrivilegeNames = Get-WhoamiPrivilegeNames ([string]$nodeIdentity.privileges)
  $attackerPrivilegeNames = @($attackerIdentity.json.privileges | ForEach-Object { [pscustomobject]@{name=[string]$_.name;enabled=((([int64]$_.attributes -band 2) -ne 0))} } | Sort-Object name)
  if (($nodePrivilegeNames | ConvertTo-Json -Compress) -ne ($attackerPrivilegeNames | ConvertTo-Json -Compress)) {
    throw 'NODE_AND_ATTACKER_PRIVILEGE_SET_MISMATCH'
  }
  Save-Record 'node-attacker-privilege-comparison.json' ([ordered]@{node=$nodePrivilegeNames;attacker=$attackerPrivilegeNames;sameTokenPrivilegeSet=$true})
  Save-Record 'attacker-process-identity.json' $attackerIdentity
  $script:clientSid = $clientSid
  $result.phases.CI_P0_Identity = 'PASS_NODE_AND_ATTACKER_SAME_STANDARD_USER_SID'

  $original = Join-Path $vulnOriginalDir 'legacy.sqlite'
  $alias = Join-Path $vulnAliasDir 'in-scope-alias.sqlite'
  $setup = Invoke-AsTestUser -FilePath $node -Arguments @($createHardlinkScript,$vulnOriginalDir,$vulnAliasDir) -Label 'hardlink-setup'
  if ($setup.exitCode -ne 0) { throw "HARDLINK_SETUP_FAILED:$($setup.stderr)" }
  $nodeIdentityFromSetup = Invoke-AsAdmin -FilePath $VerifierExe -Arguments @('same',$original,$alias)
  if ($nodeIdentityFromSetup.exitCode -ne 0) { throw "HARDLINK_OBJECT_IDENTITY_FAILED:$($nodeIdentityFromSetup.output)" }
  Save-Record 'hardlink-object-identity.json' $nodeIdentityFromSetup
  $nodeAttack = Invoke-AsTestUser -FilePath $node -Arguments @(
    '--permission', '--allow-child-process',
    "--allow-fs-read=$packageRoot\verification\ci-preflight",
    "--allow-fs-read=$vulnAliasDir", "--allow-fs-write=$vulnAliasDir",
    $attackHardlinkScript, $original, $alias, (Join-Path $vulnAliasDir 'node-attack.json')
  ) -Label 'node-hardlink-attack'
  if ($nodeAttack.exitCode -ne 0) { throw "NODE_HARDLINK_POSITIVE_CONTROL_FAILED:$($nodeAttack.stdout):$($nodeAttack.stderr)" }
  $nodeAttackEvidence = Read-IdentityArtifact (Join-Path $vulnAliasDir 'node-attack.json')
  if (-not $nodeAttackEvidence.directPathDeniedByNodePolicy -or -not $nodeAttackEvidence.aliasWriteSucceeded) {
    throw 'NODE_HARDLINK_POSITIVE_CONTROL_ASSERTION_FAILED'
  }
  Save-Record 'node-hardlink-attack.json' $nodeAttackEvidence
  $beforeNativeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $original).Hash
  $nativeAttack = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('write',$original) -Label 'native-hardlink-positive-control'
  if ($nativeAttack.exitCode -ne 0 -or -not $nativeAttack.json -or $nativeAttack.json.win32Error -ne 0 -or
      $nativeAttack.json.result -ne 'WRITE_SUCCEEDED' -or
      $nativeAttack.json.requestedAccess -ne 3221225472 -or $nativeAttack.json.userSid -ne $clientSid -or
      $nativeAttack.json.writtenByte -eq $nativeAttack.json.originalByte) {
    throw "NATIVE_HARDLINK_POSITIVE_CONTROL_FAILED:$($nativeAttack.stdout):$($nativeAttack.stderr)"
  }
  $afterNativeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $original).Hash
  if ($afterNativeHash -eq $beforeNativeHash) { throw 'NATIVE_ATTACK_DID_NOT_CHANGE_PERSISTED_FILE_BYTES' }
  $nativeRestore = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('write',$alias) -Label 'native-hardlink-positive-control-restore'
  if ($nativeRestore.exitCode -ne 0 -or -not $nativeRestore.json -or $nativeRestore.json.result -ne 'WRITE_SUCCEEDED' -or
      $nativeRestore.json.userSid -ne $clientSid -or $nativeRestore.json.writtenByte -ne $nativeAttack.json.originalByte) {
    throw "NATIVE_HARDLINK_RESTORE_FAILED:$($nativeRestore.stdout):$($nativeRestore.stderr)"
  }
  $restoredNativeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $original).Hash
  if ($restoredNativeHash -ne $beforeNativeHash) { throw 'NATIVE_HARDLINK_RESTORE_BYTES_MISMATCH' }
  Save-Record 'native-hardlink-positive-control.json' ([ordered]@{
    beforeSha256=$beforeNativeHash; changedSha256=$afterNativeHash; restoredSha256=$restoredNativeHash
    identityPreservingAliasWrite=$nativeAttack; aliasRestore=$nativeRestore
    requestedAccessMask=$nativeAttack.json.requestedAccess; attackerSid=$nativeAttack.json.userSid
  })
  $vulnIntegrity = Invoke-AsAdmin -FilePath $VerifierExe -Arguments @('sqlite',$original)
  if ($vulnIntegrity.exitCode -ne 0) { throw "VULNERABLE_DB_INTEGRITY_FAILED:$($vulnIntegrity.output)" }
  Save-Record 'vulnerable-db-integrity.json' $vulnIntegrity
  $result.phases.CI_P1 = 'PASS_VULNERABLE_NODE_ALIAS_MUTATION_AND_NATIVE_ATTACK'

  # Keep a genuine same-user writable handle to the legacy object across
  # creation of the broker's new database and the later ACL change. This
  # demonstrates that ACL edits do not revoke an already-issued handle.
  $holderReady = Join-Path $userRoot 'held-handle-ready.json'
  $handleReleasePath = Join-Path $userRoot 'held-handle-release.signal'
  $holderComplete = Join-Path $userRoot 'held-handle-complete.json'
  $handleHolder = Start-AsTestUser -FilePath $node -Arguments @(
    $holdFileScript,$original,$holderReady,$handleReleasePath,$holderComplete
  ) -Label 'legacy-retained-writable-handle'
  $holderDeadline = [DateTime]::UtcNow.AddSeconds(15)
  while (-not (Test-Path -LiteralPath $holderReady) -and [DateTime]::UtcNow -lt $holderDeadline) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path -LiteralPath $holderReady) -or $handleHolder.HasExited) { throw 'LEGACY_WRITABLE_HANDLE_NOT_ESTABLISHED' }
  Save-Record 'legacy-retained-handle-open.json' (Read-IdentityArtifact $holderReady)

  $local = Start-BrokerAndCheck -Mode 'LocalServiceRestricted' -DataDir $brokerRoot -ClientSid $clientSid
  $localServiceSid = [string]$local.token.tokenUserSid
  if ($localServiceSid -ne 'S-1-5-19') { throw "LOCAL_SERVICE_TOKEN_SID_MISMATCH:$localServiceSid" }
  if ([string]$local.token.serviceSid -ne [string]$local.install.serviceSid -or
      $local.token.identityMode -ne 'LocalServiceRestricted' -or
      $local.token.serviceSidMember -ne $true -or $local.token.serviceSidGroupPresent -ne $true -or
      $local.token.serviceSidInRestrictedList -ne $true -or
      $local.token.serviceSidPresent -ne $true -or -not $local.token.databaseIdentity -or
      $null -eq $local.token.integrityRid -or [int]$local.token.integrityRid -le 0 -or
      $local.token.sqliteVersion -ne '3.54.1' -or [string]::IsNullOrWhiteSpace([string]$local.token.sqliteSourceId) -or
      $local.token.pragmas.journalMode -ne 'wal' -or $local.token.pragmas.synchronous -ne 2 -or
      $local.token.pragmas.foreignKeys -ne 1 -or $local.token.pragmas.trustedSchema -ne 0 -or
      [string]$local.token.databasePath -ne [string]$local.dbPath) {
    $tokenSummary = ConvertTo-Json -InputObject $local.token -Depth 8 -Compress
    throw "LOCAL_SERVICE_TOKEN_OR_FILE_IDENTITY_MISSING:$tokenSummary"
  }
  Assert-PrivilegeReport $local.token 'LocalServiceRestricted'
  Save-AclSnapshot 'broker-directory' @($env:ProgramData,(Split-Path -Parent $dataRoot),$dataRoot,$brokerRoot)
  $clientStatus = Test-ClientOperation -Label 'localservice-client-status' -Verb 'status'
  $clientWrite = Test-ClientOperation -Label 'localservice-client-write' -Verb 'write' -Tail @("ci-$runId",'preflight-proof')
  $walPath = "$($local.dbPath)-wal"
  $shmPath = "$($local.dbPath)-shm"
  foreach ($sidecarPath in @($walPath,$shmPath)) {
    if (-not (Test-Path -LiteralPath $sidecarPath -PathType Leaf)) { throw "SQLITE_SIDECAR_NOT_PRESENT_WHILE_OPEN:$sidecarPath" }
    Save-AclSnapshot ("sidecar-" + [IO.Path]::GetFileName($sidecarPath)) @($sidecarPath)
    $sidecarWrite = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('write',$sidecarPath) -Label ("sidecar-write-denied-" + [IO.Path]::GetFileName($sidecarPath))
    Assert-Win32AccessDenied $sidecarWrite ("sidecar-write-" + [IO.Path]::GetFileName($sidecarPath))
    Save-Record ("sidecar-write-denied-" + [IO.Path]::GetFileName($sidecarPath) + '.json') $sidecarWrite
    $sidecarRead = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('read',$sidecarPath) -Label ("sidecar-read-denied-" + [IO.Path]::GetFileName($sidecarPath))
    Assert-Win32ReadDenied $sidecarRead ("sidecar-read-" + [IO.Path]::GetFileName($sidecarPath))
    Save-Record ("sidecar-read-denied-" + [IO.Path]::GetFileName($sidecarPath) + '.json') $sidecarRead
  }
  $forbidden = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('forbidden') -Label 'localservice-forbidden'
  if ($forbidden.exitCode -ne 0 -or ($forbidden.stdout + $forbidden.stderr) -notmatch 'ERR\|FORBIDDEN_OPERATION') {
    throw "IPC_FORBIDDEN_OPERATION_NOT_DENIED:$($forbidden.stdout):$($forbidden.stderr)"
  }
  Save-Record 'localservice-attacker-forbidden.json' $forbidden
  $clientForbidden = Invoke-AsTestUser -FilePath $ClientExe -Arguments @('forbidden') -Label 'localservice-client-forbidden'
  if ($clientForbidden.exitCode -ne 2 -or ($clientForbidden.stdout + $clientForbidden.stderr) -notmatch 'ERR\|FORBIDDEN_OPERATION') {
    throw "CLIENT_FORBIDDEN_OPERATION_NOT_DENIED:$($clientForbidden.stdout):$($clientForbidden.stderr)"
  }
  Save-Record 'localservice-client-forbidden.json' $clientForbidden
  $serviceImage = [string]$local.install.protectedBinary
  if (-not (Test-Path -LiteralPath $serviceImage -PathType Leaf)) { throw 'PROTECTED_SERVICE_IMAGE_MISSING' }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $serviceImage).Hash -ne $local.install.protectedBinarySha256) {
    throw 'PROTECTED_SERVICE_IMAGE_HASH_CHANGED_AFTER_INSTALL'
  }
  Save-AclSnapshot 'service-image' @($serviceImage)
  $imageRead = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('read',$serviceImage) -Label 'service-image-read-denied-running'
  Assert-Win32ReadDenied $imageRead 'service-image-read-running'
  Save-Record 'service-image-read-denied-running.json' $imageRead
  $imageWrite = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('write',$serviceImage) -Label 'service-image-write-denied-running'
  Assert-Win32AccessDenied $imageWrite 'service-image-write-running'
  Save-Record 'service-image-write-denied-running.json' $imageWrite
  $serviceConfigBefore = Invoke-AsAdmin -FilePath (Get-Command sc.exe).Source -Arguments @('qc',$serviceName)
  if ($serviceConfigBefore.exitCode -ne 0 -or $serviceConfigBefore.output -notmatch [regex]::Escape($serviceImage)) { throw 'SERVICE_CONFIG_IMAGE_BINDING_MISSING' }
  $serviceConfigAttack = Invoke-AsTestUser -FilePath (Get-Command sc.exe).Source -Arguments @('config',$serviceName,"binPath= `"$serviceImage`" --forged") -Label 'service-config-modification-denied'
  if ($serviceConfigAttack.exitCode -eq 0 -or ($serviceConfigAttack.stdout + $serviceConfigAttack.stderr) -notmatch '(?i)(FAILED\s+5|error\s+5|access is denied)') {
    throw "UNAUTHORIZED_SERVICE_CONFIG_CHANGE_NOT_DENIED:$($serviceConfigAttack.stdout):$($serviceConfigAttack.stderr)"
  }
  Save-Record 'service-config-modification-denied.json' $serviceConfigAttack
  $serviceConfigAfter = Invoke-AsAdmin -FilePath (Get-Command sc.exe).Source -Arguments @('qc',$serviceName)
  if ($serviceConfigAfter.exitCode -ne 0 -or $serviceConfigAfter.output -notmatch [regex]::Escape($serviceImage)) { throw 'UNAUTHORIZED_SERVICE_CONFIG_CHANGE_MUTATED_CONFIGURATION' }
  Save-Record 'service-config-before-after.json' ([ordered]@{before=$serviceConfigBefore;attack=$serviceConfigAttack;after=$serviceConfigAfter;unchanged=$true})

  $activePipeServer = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('pipe-server') -Label 'running-unauthorized-pipe-server'
  Assert-PipeServerCreationDenied $activePipeServer 'running-pipe-server'
  Save-Record 'running-unauthorized-pipe-server.json' $activePipeServer
  $result.phases.LocalService = 'PASS_TOKEN_CONFIRMED_SERVICE_WRITE_FORBIDDEN_REQUEST_DENIED'

  $brokerDb = Join-Path $brokerRoot 'registry.sqlite'
  if (-not (Test-Path -LiteralPath $brokerDb -PathType Leaf)) { throw "BROKER_DB_MISSING:$brokerDb" }
  # The vulnerable synthetic database and its alias were created before the
  # protection step and already demonstrated a successful same-user write.
  # This isolates the historical object-ACL experiment from the broker DB.
  $stop = Stop-SylphProbeService -Name $serviceName
  Save-Record 'broker-stopped-before-protected-check.json' $stop
  if ($stop.state -ne 'Stopped') { throw "BROKER_NOT_STOPPED_FOR_ACL_TEST:$($stop.state)" }

  # At this point no legitimate pipe exists. A same-user process can squat
  # the name, so the client must authenticate the server process before
  # sending even a STATUS request. This is a fail-closed DoS defense; a DACL
  # cannot reserve a nonexistent pipe name.
  $pipeReadyPath = Join-Path $userRoot 'fake-pipe-ready.txt'
  $pipeReleasePath = Join-Path $userRoot 'fake-pipe-release.txt'
  $pipeHolder = Start-AsTestUser -FilePath $AttackerExe -Arguments @(
    'pipe-server-hold',$pipeReadyPath,$pipeReleasePath
  ) -Label 'same-user-fake-pipe-server'
  $pipeDeadline = [DateTime]::UtcNow.AddSeconds(10)
  while (-not (Test-Path -LiteralPath $pipeReadyPath) -and -not $pipeHolder.HasExited -and [DateTime]::UtcNow -lt $pipeDeadline) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path -LiteralPath $pipeReadyPath) -or $pipeHolder.HasExited) { throw 'FAKE_PIPE_SERVER_NOT_ESTABLISHED' }
  $fakePipeIdentity = Get-Content -Raw -LiteralPath $pipeReadyPath
  if ($fakePipeIdentity -notmatch "pid=$($pipeHolder.Id);sid=$([regex]::Escape($clientSid));") { throw 'FAKE_PIPE_SERVER_IDENTITY_MISMATCH' }
  Save-Record 'same-user-fake-pipe-server-ready.json' ([ordered]@{identity=$fakePipeIdentity;processId=$pipeHolder.Id;userSid=$clientSid})
  $fakePipeClient = Invoke-AsTestUser -FilePath $ClientExe -Arguments @('status') -Label 'client-rejects-fake-pipe-server'
  if ($fakePipeClient.exitCode -ne 1 -or $fakePipeClient.stderr -notmatch 'PIPE_SERVER_IDENTITY_REJECTED|PIPE_SERVER_PID_MISMATCH') {
    throw "CLIENT_ACCEPTED_OR_DID_NOT_IDENTIFY_FAKE_PIPE_SERVER:$($fakePipeClient.stdout):$($fakePipeClient.stderr)"
  }
  Save-Record 'client-rejected-fake-pipe-server.json' $fakePipeClient
  $brokerReadyPath = Join-Path $brokerRoot 'broker-ready.json'
  if (Test-Path -LiteralPath $brokerReadyPath) { Remove-Item -LiteralPath $brokerReadyPath -Force -ErrorAction Stop }
  $squatStart = Invoke-AsAdmin -FilePath (Get-Command sc.exe).Source -Arguments @('start',$serviceName)
  Start-Sleep -Seconds 2
  $squatServiceState = (Get-Service -Name $serviceName -ErrorAction Stop).Status.ToString()
  if ($squatServiceState -eq 'Running' -or (Test-Path -LiteralPath $brokerReadyPath)) {
    $readyDuringSquat = if (Test-Path -LiteralPath $brokerReadyPath) { Get-Content -Raw -LiteralPath $brokerReadyPath } else { 'MISSING' }
    $holderStatus = [ordered]@{ pid=$pipeHolder.Id; exited=$pipeHolder.HasExited; exitCode=if($pipeHolder.HasExited){$pipeHolder.ExitCode}else{$null}; start=$squatStart; state=$squatServiceState; ready=$readyDuringSquat }
    throw "BROKER_REPORTED_READY_WHILE_UNTRUSTED_FIRST_PIPE_INSTANCE_HELD:$(ConvertTo-Json $holderStatus -Compress -Depth 6)"
  }
  Save-Record 'service-first-pipe-squat-blocked.json' ([ordered]@{start=$squatStart;serviceState=$squatServiceState;readyFileExists=(Test-Path -LiteralPath $brokerReadyPath);blockedBeforeReadiness=$true})
  Set-Content -LiteralPath $pipeReleasePath -Value 'release' -NoNewline -Encoding ascii
  if (-not $pipeHolder.WaitForExit(5000)) { throw 'FAKE_PIPE_SERVER_RELEASE_TIMEOUT' }
  if ($pipeHolder.ExitCode -ne 0) { throw 'FAKE_PIPE_SERVER_HOLDER_FAILED' }
  $fakePipeEvidence = ConvertTo-JsonResult (Get-Content -Raw -LiteralPath (Join-Path $userRoot 'same-user-fake-pipe-server.stdout.txt'))
  if (-not $fakePipeEvidence -or $fakePipeEvidence.result -ne 'CONNECTED_ZERO_REQUEST_BYTES' -or
      [string]$fakePipeEvidence.callerSid -ne [string]$clientSid -or
      [long]$fakePipeEvidence.callerPid -ne [long]$pipeHolder.Id -or
      [long]$fakePipeEvidence.connectedClientPid -ne [long]$fakePipeClient.processId -or
      $fakePipeEvidence.requestedOpenMode -ne 524291 -or $fakePipeEvidence.peekSucceeded -ne $true -or
      $fakePipeEvidence.peekAvailableBytes -ne 0 -or $fakePipeEvidence.readSucceeded -ne $false -or
      $fakePipeEvidence.readWin32Error -ne 232) {
    throw "FAKE_PIPE_CLIENT_DID_NOT_PROVE_ZERO_REQUEST_BYTES:$(ConvertTo-Json $fakePipeEvidence -Compress)"
  }
  Save-Record 'fake-pipe-zero-request-evidence.json' $fakePipeEvidence
  $pipeHolder = $null
  $recoveryDeadline = [DateTime]::UtcNow.AddSeconds(20)
  $serviceAfterRelease = Get-Service -Name $serviceName -ErrorAction Stop
  while ($serviceAfterRelease.Status -eq 'StartPending' -and [DateTime]::UtcNow -lt $recoveryDeadline) {
    Start-Sleep -Milliseconds 250
    $serviceAfterRelease = Get-Service -Name $serviceName -ErrorAction Stop
  }
  if ($serviceAfterRelease.Status -eq 'Stopped') {
    $serviceAfterReleaseStart = Start-SylphProbeService -Name $serviceName -DataDir $brokerRoot
    $serviceAfterRelease = Get-Service -Name $serviceName -ErrorAction Stop
  }
  if ($serviceAfterRelease.Status -ne 'Running' -or -not (Test-Path -LiteralPath $brokerReadyPath)) {
    throw 'BROKER_DID_NOT_BIND_AND_REPORT_READY_AFTER_FAKE_PIPE_RELEASE'
  }
  $recoveredReady = Get-Content -Raw -LiteralPath $brokerReadyPath | ConvertFrom-Json
  $recoveredServiceProcess = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
  $recoveredToken = Get-Content -Raw -LiteralPath (Join-Path $brokerRoot 'broker-token.json') | ConvertFrom-Json
  if ($recoveredReady.firstPipeInstanceCreated -ne $true -or
      [long]$recoveredReady.processId -ne [long]$recoveredServiceProcess.ProcessId -or
      [long]$recoveredToken.processId -ne [long]$recoveredServiceProcess.ProcessId) {
    throw 'BROKER_POST_SQUAT_READINESS_NOT_BOUND_TO_CURRENT_SERVICE_PROCESS'
  }
  Save-Record 'service-first-pipe-squat-recovery.json' ([ordered]@{ready=$recoveredReady;serviceProcessId=[long]$recoveredServiceProcess.ProcessId;tokenProcessId=[long]$recoveredToken.processId;restartedAfterScmStop=($null -ne $serviceAfterReleaseStart)})
  $postSquatStop = Stop-SylphProbeService -Name $serviceName
  if ($postSquatStop.state -ne 'Stopped') { throw 'SERVICE_NOT_STOPPED_AFTER_PIPE_SQUAT_RECOVERY' }
  Save-Record 'service-post-squat-stop.json' $postSquatStop
  $result.phases.IPC_FakeServerIdentity = 'PASS_CLIENT_REJECTED_FAKE_SERVER_AND_BROKER_WAITED_FOR_FIRST_PIPE'

  Set-ProtectedFileAcl -Path $original -ServiceSid $local.install.serviceSid -AccountSid $local.install.accountSid
  $same = Invoke-AsAdmin -FilePath $VerifierExe -Arguments @('same',$original,$alias)
  if ($same.exitCode -ne 0) { throw "PROTECTED_ALIAS_IDENTITY_CHANGED:$($same.output)" }
  Save-Record 'protected-alias-object-identity.json' $same
  $preLockdownIdentity = $nodeIdentityFromSetup.json
  $postLockdownIdentity = $same.json
  if (-not $preLockdownIdentity -or -not $postLockdownIdentity -or
      $preLockdownIdentity.leftVolume -ne $postLockdownIdentity.leftVolume -or
      $preLockdownIdentity.leftIndexHigh -ne $postLockdownIdentity.leftIndexHigh -or
      $preLockdownIdentity.leftIndexLow -ne $postLockdownIdentity.leftIndexLow -or
      $preLockdownIdentity.rightVolume -ne $postLockdownIdentity.rightVolume -or
      $preLockdownIdentity.rightIndexHigh -ne $postLockdownIdentity.rightIndexHigh -or
      $preLockdownIdentity.rightIndexLow -ne $postLockdownIdentity.rightIndexLow) {
    throw 'PROTECTED_FILE_IDENTITY_CHANGED_AFTER_ACL'
  }
  Save-Record 'pre-post-lockdown-file-identity-comparison.json' ([ordered]@{
    before=$preLockdownIdentity; after=$postLockdownIdentity; unchanged=$true
  })

  # Create a second name for the broker's actual SQLite object while stopped,
  # then protect the object and verify that both names identify the same file.
  $brokerAlias = Join-Path $brokerAliasDir 'registry-alias.sqlite'
  $brokerAliasReport = Join-Path $brokerAliasDir 'registry-alias-identity.json'
  $brokerAliasCreate = Invoke-AsAdmin -FilePath $node -Arguments @($linkExistingScript,$brokerDb,$brokerAlias,$brokerAliasReport)
  if ($brokerAliasCreate.exitCode -ne 0) { throw "BROKER_DB_ALIAS_CREATE_FAILED:$($brokerAliasCreate.output)" }
  $brokerIdentityBeforeLockdown = Invoke-AsAdmin -FilePath $VerifierExe -Arguments @('same',$brokerDb,$brokerAlias)
  if ($brokerIdentityBeforeLockdown.exitCode -ne 0 -or -not $brokerIdentityBeforeLockdown.json -or
      $brokerIdentityBeforeLockdown.json.sameObject -ne $true) {
    throw "BROKER_DB_ALIAS_NOT_SAME_OBJECT:$($brokerIdentityBeforeLockdown.output)"
  }
  Save-Record 'broker-db-preexisting-alias-identity.json' $brokerIdentityBeforeLockdown
  Set-ProtectedFileAcl -Path $brokerDb -ServiceSid $local.install.serviceSid -AccountSid $local.install.accountSid
  $brokerIdentityAfterLockdown = Invoke-AsAdmin -FilePath $VerifierExe -Arguments @('same',$brokerDb,$brokerAlias)
  if ($brokerIdentityAfterLockdown.exitCode -ne 0 -or -not $brokerIdentityAfterLockdown.json -or
      $brokerIdentityAfterLockdown.json.sameObject -ne $true -or
      $brokerIdentityAfterLockdown.json.leftVolume -ne $brokerIdentityBeforeLockdown.json.leftVolume -or
      $brokerIdentityAfterLockdown.json.leftIndexHigh -ne $brokerIdentityBeforeLockdown.json.leftIndexHigh -or
      $brokerIdentityAfterLockdown.json.leftIndexLow -ne $brokerIdentityBeforeLockdown.json.leftIndexLow -or
      $brokerIdentityAfterLockdown.json.rightVolume -ne $brokerIdentityBeforeLockdown.json.rightVolume -or
      $brokerIdentityAfterLockdown.json.rightIndexHigh -ne $brokerIdentityBeforeLockdown.json.rightIndexHigh -or
      $brokerIdentityAfterLockdown.json.rightIndexLow -ne $brokerIdentityBeforeLockdown.json.rightIndexLow) {
    throw 'BROKER_DB_IDENTITY_CHANGED_DURING_PROTECTION'
  }
  Save-Record 'broker-db-post-lockdown-alias-identity.json' $brokerIdentityAfterLockdown

  $stoppedOriginal = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('write',$original) -Label 'stopped-protected-original'
  Assert-Win32AccessDenied $stoppedOriginal 'stopped-original'
  Save-Record 'stopped-protected-original.json' $stoppedOriginal
  $stoppedAlias = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('write',$alias) -Label 'stopped-protected-alias'
  Assert-Win32AccessDenied $stoppedAlias 'stopped-alias'
  Save-Record 'stopped-protected-alias.json' $stoppedAlias
  $stoppedOriginalRead = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('read',$original) -Label 'stopped-protected-original-read'
  Assert-Win32ReadDenied $stoppedOriginalRead 'stopped-original-read'
  Save-Record 'stopped-protected-original-read.json' $stoppedOriginalRead
  $stoppedAliasRead = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('read',$alias) -Label 'stopped-protected-alias-read'
  Assert-Win32ReadDenied $stoppedAliasRead 'stopped-alias-read'
  Save-Record 'stopped-protected-alias-read.json' $stoppedAliasRead
  $stoppedBrokerDb = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('write',$brokerDb) -Label 'stopped-broker-db-direct-access'
  Assert-Win32AccessDenied $stoppedBrokerDb 'stopped-broker-db'
  Save-Record 'stopped-broker-db-direct-access.json' $stoppedBrokerDb
  $stoppedBrokerAlias = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('write',$brokerAlias) -Label 'stopped-broker-db-alias-direct-access'
  Assert-Win32AccessDenied $stoppedBrokerAlias 'stopped-broker-db-alias'
  Save-Record 'stopped-broker-db-alias-direct-access.json' $stoppedBrokerAlias
  $stoppedBrokerRead = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('read',$brokerDb) -Label 'stopped-broker-db-read'
  Assert-Win32ReadDenied $stoppedBrokerRead 'stopped-broker-db-read'
  Save-Record 'stopped-broker-db-read.json' $stoppedBrokerRead
  $stoppedBrokerAliasRead = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('read',$brokerAlias) -Label 'stopped-broker-db-alias-read'
  Assert-Win32ReadDenied $stoppedBrokerAliasRead 'stopped-broker-db-alias-read'
  Save-Record 'stopped-broker-db-alias-read.json' $stoppedBrokerAliasRead
  $stoppedImageRead = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('read',$serviceImage) -Label 'service-image-read-denied-stopped'
  Assert-Win32ReadDenied $stoppedImageRead 'service-image-read-stopped'
  Save-Record 'service-image-read-denied-stopped.json' $stoppedImageRead
  $stoppedImageWrite = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('write',$serviceImage) -Label 'service-image-write-denied-stopped'
  Assert-Win32AccessDenied $stoppedImageWrite 'service-image-write-stopped'
  Save-Record 'service-image-write-denied-stopped.json' $stoppedImageWrite
  $result.phases.StoppedPipeNamespace = 'BLOCKED_NO_NAMED_PIPE_OBJECT_EXISTS_FOR_DACL_CHECK_WHILE_BROKER_STOPPED'
  $result.blockedRequirements = @($result.blockedRequirements) + @('Stopped-service named-pipe name squatting is not prevented by a DACL on a nonexistent pipe; broker must fail closed and client must authenticate server identity')
  $result.phases.CI_P2_Stopped = 'PASS_ERROR_ACCESS_DENIED_ON_LEGACY_AND_BROKER_OBJECT_NAMES'

  $localRestart = Start-SylphProbeService -Name $serviceName -DataDir $brokerRoot
  if ($localRestart.state -ne 'Running' -or -not $localRestart.ready -or
      $localRestart.ready.schema -ne 'SYLPH_G1_BROKER_READY_2' -or
      $localRestart.ready.firstPipeInstanceCreated -ne $true -or
      [string]$localRestart.ready.startupNonce -eq [string]$local.start.ready.startupNonce) {
    throw 'LOCAL_SERVICE_RESTART_READINESS_NOT_FRESH'
  }
  $restartServiceProcess = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
  $restartToken = Get-Content -Raw -LiteralPath (Join-Path $brokerRoot 'broker-token.json') | ConvertFrom-Json
  if ([long]$localRestart.ready.processId -ne [long]$restartServiceProcess.ProcessId -or
      [long]$restartToken.processId -ne [long]$restartServiceProcess.ProcessId) { throw 'LOCAL_SERVICE_RESTART_PID_BINDING_MISMATCH' }
  Save-Record 'localservice-restart-readiness.json' ([ordered]@{ready=$localRestart.ready;tokenProcessId=[long]$restartToken.processId;serviceProcessId=[long]$restartServiceProcess.ProcessId;nonceChanged=$true})
  $protectedWrite = Test-ClientOperation -Label 'localservice-protected-client-write' -Verb 'write' -Tail @("protected-$runId",'authorized-effect')
  $runningOriginal = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('write',$original) -Label 'running-protected-original'
  Assert-Win32AccessDenied $runningOriginal 'running-original'
  Save-Record 'running-protected-original.json' $runningOriginal
  $runningAlias = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('write',$alias) -Label 'running-protected-alias'
  Assert-Win32AccessDenied $runningAlias 'running-alias'
  Save-Record 'running-protected-alias.json' $runningAlias
  $runningOriginalRead = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('read',$original) -Label 'running-protected-original-read'
  Assert-Win32ReadDenied $runningOriginalRead 'running-original-read'
  Save-Record 'running-protected-original-read.json' $runningOriginalRead
  $runningAliasRead = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('read',$alias) -Label 'running-protected-alias-read'
  Assert-Win32ReadDenied $runningAliasRead 'running-alias-read'
  Save-Record 'running-protected-alias-read.json' $runningAliasRead
  $runningBrokerDb = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('write',$brokerDb) -Label 'running-broker-db-direct-access'
  Assert-Win32AccessDenied $runningBrokerDb 'running-broker-db'
  Save-Record 'running-broker-db-direct-access.json' $runningBrokerDb
  $runningBrokerAlias = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('write',$brokerAlias) -Label 'running-broker-db-alias-direct-access'
  Assert-Win32AccessDenied $runningBrokerAlias 'running-broker-db-alias'
  Save-Record 'running-broker-db-alias-direct-access.json' $runningBrokerAlias
  $runningBrokerRead = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('read',$brokerDb) -Label 'running-broker-db-read'
  Assert-Win32ReadDenied $runningBrokerRead 'running-broker-db-read'
  Save-Record 'running-broker-db-read.json' $runningBrokerRead
  $runningBrokerAliasRead = Invoke-AsTestUser -FilePath $AttackerExe -Arguments @('read',$brokerAlias) -Label 'running-broker-db-alias-read'
  Assert-Win32ReadDenied $runningBrokerAliasRead 'running-broker-db-alias-read'
  Save-Record 'running-broker-db-alias-read.json' $runningBrokerAliasRead
  $result.phases.CI_P2_Running = 'PASS_AUTHORIZED_BROKER_WRITE_AND_ERROR_ACCESS_DENIED_ON_LEGACY_AND_BROKER_OBJECT_NAMES'

  $brokerDbBeforeLegacyHandleMutation = (Get-FileHash -Algorithm SHA256 -LiteralPath $brokerDb).Hash
  $brokerStateBeforeLegacyHandleMutation = Invoke-AsAdmin -FilePath $VerifierExe -Arguments @('sqlite',$brokerDb)
  if ($brokerStateBeforeLegacyHandleMutation.exitCode -ne 0 -or -not $brokerStateBeforeLegacyHandleMutation.json -or
      $brokerStateBeforeLegacyHandleMutation.json.integrity -ne 'ok') { throw 'CLEAN_ROOM_BROKER_DATABASE_NOT_VALID_BEFORE_HANDLE_MUTATION' }
  $brokerIdentityDifferent = Invoke-AsAdmin -FilePath $VerifierExe -Arguments @('different',$original,$brokerDb)
  if ($brokerIdentityDifferent.exitCode -ne 0 -or -not $brokerIdentityDifferent.json -or
      $brokerIdentityDifferent.json.sameObject -ne $false) { throw 'CLEAN_ROOM_DATABASE_OBJECT_IDENTITY_NOT_DISTINCT' }
  Save-Record 'clean-room-distinct-file-identity.json' $brokerIdentityDifferent

  Set-Content -LiteralPath $handleReleasePath -Value 'release' -NoNewline -Encoding ascii
  if (-not $handleHolder.WaitForExit(15000)) { throw 'LEGACY_HANDLE_RELEASE_TIMEOUT' }
  if (-not (Test-Path -LiteralPath $holderComplete)) { throw 'LEGACY_HANDLE_MUTATION_RESULT_MISSING' }
  $holderResult = Get-Content -Raw -LiteralPath $holderComplete | ConvertFrom-Json
  if (-not $holderResult.changed -or $holderResult.closed -ne $true) { throw 'LEGACY_HANDLE_MUTATION_NOT_CONFIRMED' }
  $legacyHashAfterHeldMutation = (Get-FileHash -Algorithm SHA256 -LiteralPath $original).Hash
  $brokerDbAfterLegacyHandleMutation = (Get-FileHash -Algorithm SHA256 -LiteralPath $brokerDb).Hash
  if ($brokerDbAfterLegacyHandleMutation -ne $brokerDbBeforeLegacyHandleMutation) {
    throw 'OLD_HANDLE_MUTATION_CHANGED_NEW_BROKER_DATABASE'
  }
  $brokerStateAfterLegacyHandleMutation = Invoke-AsAdmin -FilePath $VerifierExe -Arguments @('sqlite',$brokerDb)
  if ($brokerStateAfterLegacyHandleMutation.exitCode -ne 0 -or -not $brokerStateAfterLegacyHandleMutation.json -or
      $brokerStateAfterLegacyHandleMutation.json.integrity -ne 'ok') { throw 'NEW_BROKER_DATABASE_INTEGRITY_CHANGED_BY_OLD_HANDLE' }
  Save-Record 'clean-room-old-handle-isolation.json' ([ordered]@{
    result=$holderResult; legacyObjectHashAfter=$legacyHashAfterHeldMutation
    brokerDbHashBefore=$brokerDbBeforeLegacyHandleMutation; brokerDbHashAfter=$brokerDbAfterLegacyHandleMutation
    brokerStateBefore=$brokerStateBeforeLegacyHandleMutation.json; brokerStateAfter=$brokerStateAfterLegacyHandleMutation.json
    oldAndNewObjectsDistinct=$true; oldHandleCouldNotChangeNewObject=$true
    importInterface='NOT_IMPLEMENTED'; importValidation='NOT_RUN'
  })
  $result.phases.ExperimentC_ObjectIsolation = 'PASS_OLD_HANDLE_MUTATED_OLD_OBJECT_NEW_DB_UNCHANGED'
  $result.phases.ExperimentC_ValidatedImport = 'BLOCKED_BROKER_HAS_NO_VALIDATED_IMPORT_OPERATION'

  Stop-SylphProbeService -Name $serviceName | Out-Null
  Remove-SylphProbeService -Name $serviceName
  $installedService = $false

  $virtual = $null
  try {
    $virtual = Start-BrokerAndCheck -Mode 'VirtualAccount' -DataDir $virtualBrokerRoot -ClientSid $clientSid
    if ($virtual.token.identityMode -ne 'VirtualServiceAccount' -or
        [string]$virtual.token.tokenUserSid -ne [string]$virtual.token.serviceSid -or
        $virtual.token.serviceSidMember -ne $true -or $virtual.token.serviceSidGroupPresent -ne $true -or
        $virtual.token.serviceSidInRestrictedList -ne $true -or
        $null -eq $virtual.token.integrityRid -or [int]$virtual.token.integrityRid -le 0 -or
        $virtual.token.sqliteVersion -ne '3.54.1' -or [string]::IsNullOrWhiteSpace([string]$virtual.token.sqliteSourceId) -or
        [string]$virtual.token.sqliteSourceId -notmatch '3\.54\.1' -or
        $virtual.token.pragmas.journalMode -ne 'wal' -or $virtual.token.pragmas.synchronous -ne 2 -or
        $virtual.token.pragmas.foreignKeys -ne 1 -or $virtual.token.pragmas.trustedSchema -ne 0 -or
        -not $virtual.token.databaseIdentity) {
      throw 'VIRTUAL_ACCOUNT_TOKEN_REPORT_INCOMPLETE'
    }
    Assert-PrivilegeReport $virtual.token 'VirtualAccount'
    $virtualStatus = Test-ClientOperation -Label 'virtual-account-client-status' -Verb 'status'
    $virtualWrite = Test-ClientOperation -Label 'virtual-account-client-write' -Verb 'write' -Tail @("virtual-$runId",'virtual-account-proof')
    $result.phases.VirtualAccount = 'PASS_SERVICE_STARTED_AND_CLIENT_SQLITE_WRITE'
    Save-Record 'service-identity-comparison.json' ([ordered]@{
      localService=$local.token; virtualAccount=$virtual.token
      selectedConfiguration='VirtualAccount (dedicated per-service identity; use only if independent Astra review accepts token and ACL evidence)'
      qualification='preliminary CI evidence; no G1 certification'
    })
    Stop-SylphProbeService -Name $serviceName | Out-Null
    Remove-SylphProbeService -Name $serviceName
    $installedService = $false
  } catch {
    $result.phases.VirtualAccount = "BLOCKED_OR_FAIL:$($_.Exception.Message)"
    $result.blockedRequirements = @($result.blockedRequirements) + @("Dedicated virtual-account broker probe: $($_.Exception.Message)")
    Save-Record 'virtual-account-attempt.json' ([ordered]@{status=$result.phases.VirtualAccount;identityMode='VirtualAccount'})
    if ($installedService) { Remove-SylphProbeService -Name $serviceName; $installedService=$false }
  }

  if ($result.phases.VirtualAccount -like 'PASS*') { $result.selectedServiceConfiguration='UNSELECTED_BOTH_IDENTITIES_TESTED_PENDING_INDEPENDENT_PRIVILEGE_COMPARISON' }
  else { $result.selectedServiceConfiguration='UNDETERMINED_VIRTUAL_ACCOUNT_TEST_BLOCKED' }
  $result.status = 'COMPLETED_WITH_BLOCKERS_NO_G1_QUALIFICATION'
  $result.blockedRequirements = @($result.blockedRequirements) + @('Experiment C validated synthetic-state import is not implemented by the broker contract')
}
catch {
  $result.status = 'FAIL_OR_BLOCKED'
  $result.failures = @($result.failures) + @($_.Exception.Message)
  Save-Record 'failure.json' ([ordered]@{message=$_.Exception.Message;scriptStack=$_.ScriptStackTrace;errorRecord=($_ | Out-String)})
  throw
}
finally {
  $result.completedAtUtc = [DateTime]::UtcNow.ToString('O')
  if ($installedService) {
    try { Remove-SylphProbeService -Name $serviceName } catch { $result.failures += "SERVICE_CLEANUP_FAILED:$($_.Exception.Message)"; $result.status='FAIL_OR_BLOCKED_CLEANUP' }
  }
  if ($handleHolder -and -not $handleHolder.HasExited -and $handleReleasePath) {
    try {
      Set-Content -LiteralPath $handleReleasePath -Value 'cleanup-release' -NoNewline -Encoding ascii
      if (-not $handleHolder.WaitForExit(5000)) { $handleHolder.Kill(); $result.failures += 'HANDLE_HOLDER_FORCED_TERMINATION'; $result.status='FAIL_OR_BLOCKED_CLEANUP' }
    } catch { $result.failures += "HANDLE_HOLDER_CLEANUP_FAILED:$($_.Exception.Message)"; $result.status='FAIL_OR_BLOCKED_CLEANUP' }
  }
  if ($pipeHolder -and -not $pipeHolder.HasExited -and $pipeReleasePath) {
    try {
      Set-Content -LiteralPath $pipeReleasePath -Value 'cleanup-release' -NoNewline -Encoding ascii
      if (-not $pipeHolder.WaitForExit(5000)) { $pipeHolder.Kill(); $result.failures += 'PIPE_HOLDER_FORCED_TERMINATION'; $result.status='FAIL_OR_BLOCKED_CLEANUP' }
    } catch { $result.failures += "PIPE_HOLDER_CLEANUP_FAILED:$($_.Exception.Message)"; $result.status='FAIL_OR_BLOCKED_CLEANUP' }
  }
  if ($createdUser) {
    try { Remove-LocalUser -Name $testUserName -ErrorAction Stop } catch { $result.failures += "USER_CLEANUP_FAILED:$($_.Exception.Message)"; $result.status='FAIL_OR_BLOCKED_CLEANUP' }
  }
  if ($dataRoot -and (Test-Path -LiteralPath $dataRoot)) {
    $fullRoot = [IO.Path]::GetFullPath($dataRoot)
    $programDataPrefix = [IO.Path]::GetFullPath($env:ProgramData).TrimEnd('\') + '\'
    if (-not $fullRoot.StartsWith($programDataPrefix,[StringComparison]::OrdinalIgnoreCase)) {
      $result.failures += "REFUSING_UNSAFE_SCRATCH_DELETE:$fullRoot"
      $result.status='FAIL_OR_BLOCKED_CLEANUP'
    } else {
      try { Remove-Item -LiteralPath $fullRoot -Recurse -Force -ErrorAction Stop }
      catch { $result.failures += "SCRATCH_CLEANUP_FAILED:$($_.Exception.Message)"; $result.status='FAIL_OR_BLOCKED_CLEANUP' }
    }
  }
  $result.cleanupFailures = @($result.failures | Where-Object { $_ -match 'CLEANUP|UNSAFE_SCRATCH' })
  $result.cleanupCompleted = ($result.cleanupFailures.Count -eq 0)
  try { Save-Record 'summary.json' $result } catch { Write-Error "SUMMARY_WRITE_FAILED:$($_.Exception.Message)" }
  if ($result.cleanupFailures.Count -gt 0) { throw "CI_CLEANUP_FAILED:$($result.cleanupFailures -join ';')" }
}
