[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Running','Stopped')][string]$ServiceExpected,
    [Parameter(Mandatory)][string]$ServiceName,
    [Parameter(Mandatory)][string]$DataDirectory,
    [Parameter(Mandatory)][string]$TokenMetadataPath,
    [Parameter(Mandatory)][string]$ClientExe,
    [Parameter(Mandatory)][string]$AttackerExe,
    [Parameter(Mandatory)][string]$VerifierExe,
    [Parameter(Mandatory)][System.Management.Automation.PSCredential]$CallerCredential,
    [Parameter(Mandatory)][string]$ExpectedCallerSid,
    [Parameter(Mandatory)][string]$ExpectedServiceSid,
    [Parameter(Mandatory)][string]$ReportPath,
    [string]$AliasPath,
    [string]$ApprovedSqliteSourceId
)

$ErrorActionPreference = 'Stop'
$testResults = [ordered]@{}
$serviceDb = Join-Path $DataDirectory 'registry.sqlite'
$runRoot = Split-Path -Parent $ReportPath
New-Item -ItemType Directory -Force -Path $runRoot | Out-Null

function Invoke-AsCaller {
    param([Parameter(Mandatory)][string]$Name,[Parameter(Mandatory)][string]$FilePath,[string[]]$Arguments=@())
    $stdoutPath = Join-Path $runRoot "$Name.stdout.txt"
    $stderrPath = Join-Path $runRoot "$Name.stderr.txt"
    Remove-Item -LiteralPath $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
    $quoted = ($Arguments | ForEach-Object { '"' + $_.Replace('"','\"') + '"' }) -join ' '
    $process = Start-Process -FilePath $FilePath -ArgumentList $quoted -Credential $CallerCredential `
        -PassThru -Wait -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    [pscustomobject]@{
        exitCode = $process.ExitCode
        stdout = if (Test-Path -LiteralPath $stdoutPath) { (Get-Content -Raw -LiteralPath $stdoutPath).Trim() } else { '' }
        stderr = if (Test-Path -LiteralPath $stderrPath) { (Get-Content -Raw -LiteralPath $stderrPath).Trim() } else { '' }
    }
}

function Add-Result([string]$Name,[ValidateSet('PASS','FAIL','BLOCKED','NOT_RUN','INVALID_TEST')][string]$Status,[object]$Evidence) {
    $testResults[$Name] = [ordered]@{ status=$Status; evidence=$Evidence }
}

function Assert-DirectWriteDenied([string]$Label,[string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Add-Result $Label 'INVALID_TEST' @{reason='target file does not exist';path=$Path}; return
    }
    $identity = Invoke-AsCaller "$Label-identity" $AttackerExe @('identity')
    $attempt = Invoke-AsCaller $Label $AttackerExe @('write',$Path)
    $isExpectedCaller = $identity.stdout -match [regex]::Escape($ExpectedCallerSid)
    if (-not $isExpectedCaller) {
        Add-Result $Label 'INVALID_TEST' @{reason='attacker process SID did not match expected test identity';identity=$identity;attempt=$attempt;expectedSid=$ExpectedCallerSid}; return
    }
    if ($attempt.stdout -eq 'ACCESS_DENIED|win32=5') {
        Add-Result $Label 'PASS' @{attackerIdentity=$identity.stdout;requestedAccess='GENERIC_READ|GENERIC_WRITE';observed=$attempt.stdout;exitCode=$attempt.exitCode;target=$Path}
    } elseif ($attempt.stdout -match 'SHARING_VIOLATION|win32=32') {
        Add-Result $Label 'FAIL' @{reason='sharing violation is not ACL evidence';attackerIdentity=$identity.stdout;observed=$attempt.stdout;target=$Path}
    } elseif ($attempt.stdout -match 'WRITE_SUCCEEDED') {
        Add-Result $Label 'FAIL' @{reason='unauthorized writable open succeeded';attackerIdentity=$identity.stdout;observed=$attempt.stdout;target=$Path}
    } else {
        Add-Result $Label 'FAIL' @{reason='unexpected access result';attackerIdentity=$identity.stdout;attempt=$attempt;target=$Path}
    }
}

function Get-DataInventory {
    if (-not (Test-Path -LiteralPath $DataDirectory -PathType Container)) { return @() }
    return @(Get-ChildItem -LiteralPath $DataDirectory -File -Force | Sort-Object Name | ForEach-Object {
        $identity = if (Test-Path -LiteralPath $VerifierExe -PathType Leaf) {
            (& $VerifierExe identity $_.FullName 2>&1 | Out-String).Trim()
        } else { 'VERIFIER_MISSING' }
        [ordered]@{name=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant();fileIdentity=$identity}
    })
}

$os = Get-CimInstance Win32_OperatingSystem
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
$metadata = $null
try { $metadata = Get-Content -Raw -LiteralPath $TokenMetadataPath | ConvertFrom-Json } catch { }

$report = [ordered]@{
    schema='SYLPH_G1_V64_SQLITE_BROKER_CHECK_1'
    capturedAtUtc=[DateTime]::UtcNow.ToString('o')
    environment=[ordered]@{osCaption=$os.Caption;osVersion=$os.Version;buildNumber=$os.BuildNumber;runnerImage=$env:ImageOS;runnerImageVersion=$env:ImageVersion;currentVerifierSid=$currentSid}
    service=[ordered]@{name=$ServiceName;state=if($svc){$svc.Status.ToString()}else{'NOT_FOUND'};expectedState=$ServiceExpected;tokenMetadata=$metadata}
    binaries=[ordered]@{}
    tests=$testResults
    storageInventoryBefore=@()
    storageInventoryAfter=@()
    verdict='PASS'
}
foreach($pair in @(@('client',$ClientExe),@('attacker',$AttackerExe),@('verifier',$VerifierExe))){
    $report.binaries[$pair[0]] = if(Test-Path -LiteralPath $pair[1]){(Get-FileHash -LiteralPath $pair[1] -Algorithm SHA256).Hash.ToLowerInvariant()}else{$null}
}

if (-not $metadata) {
    Add-Result 'service-token-metadata' 'INVALID_TEST' @{reason='cannot parse broker-token.json';path=$TokenMetadataPath}
} elseif ($metadata.schema -ne 'SYLPH_G1_BROKER_TOKEN_1' -or $metadata.serviceName -ne $ServiceName -or
    $metadata.tokenUserSid -ne 'S-1-5-19' -or $metadata.serviceSid -ne $ExpectedServiceSid -or $metadata.serviceSidPresent -ne $true) {
    Add-Result 'service-token-metadata' 'FAIL' @{expectedUserSid='S-1-5-19';expectedServiceSid=$ExpectedServiceSid;observed=$metadata}
} else {
    Add-Result 'service-token-metadata' 'PASS' $metadata
}

if ($metadata) {
    $expectedDbPath = [IO.Path]::GetFullPath($serviceDb)
    $reportedDbPath = if ($metadata.databasePath) { [IO.Path]::GetFullPath([string]$metadata.databasePath) } else { '' }
    if (-not $reportedDbPath -or -not [string]::Equals($reportedDbPath,$expectedDbPath,[StringComparison]::OrdinalIgnoreCase)) {
        Add-Result 'database-path-binding' 'FAIL' @{expected=$expectedDbPath;reported=$metadata.databasePath}
    } elseif (-not $metadata.databaseIdentity -or -not (Test-Path -LiteralPath $VerifierExe -PathType Leaf)) {
        Add-Result 'database-object-identity' 'INVALID_TEST' @{reason='database identity metadata or independent verifier unavailable';reported=$metadata.databaseIdentity}
    } else {
        $identityText = & $VerifierExe identity $serviceDb 2>&1
        $identityExit = $LASTEXITCODE
        $identityObject = $null
        try { $identityObject = ($identityText -join "`n") | ConvertFrom-Json } catch { }
        $reportedIdentity = $metadata.databaseIdentity
        $identityMatches = $identityExit -eq 0 -and $identityObject -and
            [string]$identityObject.volumeSerial -eq [string]$reportedIdentity.volumeSerial -and
            [string]$identityObject.fileIndexHigh -eq [string]$reportedIdentity.fileIndexHigh -and
            [string]$identityObject.fileIndexLow -eq [string]$reportedIdentity.fileIndexLow
        if ($identityMatches) {
            Add-Result 'database-object-identity' 'PASS' @{metadata=$reportedIdentity;independentlyObserved=$identityObject}
        } else {
            Add-Result 'database-object-identity' 'FAIL' @{metadata=$reportedIdentity;independentlyObserved=$identityObject;exitCode=$identityExit;rawOutput=($identityText -join "`n")}
        }
    }
}

$expectedPragmas = @{journalMode='wal';synchronous=2;foreignKeys=1;trustedSchema=0}
if ($metadata -and $metadata.pragmas) {
    $pragmaMismatches = @($expectedPragmas.Keys | Where-Object { $metadata.pragmas.$_ -ne $expectedPragmas[$_] })
    if ($pragmaMismatches.Count -eq 0) {
        Add-Result 'sqlite-connection-profile' 'PASS' @{observed=$metadata.pragmas;expected=$expectedPragmas;sqliteVersion=$metadata.sqliteVersion;sqliteSourceId=$metadata.sqliteSourceId}
    } else {
        Add-Result 'sqlite-connection-profile' 'FAIL' @{mismatched=$pragmaMismatches;observed=$metadata.pragmas;expected=$expectedPragmas}
    }
} else {
    Add-Result 'sqlite-connection-profile' 'INVALID_TEST' @{reason='missing actual-connection PRAGMA readback'}
}

if (-not $metadata.sqliteVersion -or -not $metadata.sqliteSourceId) {
    Add-Result 'sqlite-runtime-identity' 'FAIL' @{reason='SQLite version or source ID missing';metadata=$metadata}
} elseif (-not $ApprovedSqliteSourceId) {
    Add-Result 'sqlite-runtime-identity' 'BLOCKED' @{observedVersion=$metadata.sqliteVersion;observedSourceId=$metadata.sqliteSourceId;reason='no independently approved SQLite source ID is configured'}
} elseif ($metadata.sqliteSourceId -ne $ApprovedSqliteSourceId) {
    Add-Result 'sqlite-runtime-identity' 'FAIL' @{observedVersion=$metadata.sqliteVersion;observedSourceId=$metadata.sqliteSourceId;approvedSourceId=$ApprovedSqliteSourceId}
} else {
    Add-Result 'sqlite-runtime-identity' 'PASS' @{observedVersion=$metadata.sqliteVersion;sourceId=$metadata.sqliteSourceId}
}

$actualServiceState = if($svc){$svc.Status.ToString()}else{'NOT_FOUND'}
if ($actualServiceState -ne $ServiceExpected) {
    Add-Result 'service-state' 'INVALID_TEST' @{expected=$ServiceExpected;actual=$actualServiceState}
} else {
    Add-Result 'service-state' 'PASS' @{expected=$ServiceExpected;actual=$actualServiceState}
}

if ($ServiceExpected -eq 'Running') {
    $report.storageInventoryBefore = Get-DataInventory
    if ($AliasPath) {
        $same = & $VerifierExe same $serviceDb $AliasPath 2>&1
        $sameExit = $LASTEXITCODE
        $sameObject = $null
        try { $sameObject = ($same -join "`n") | ConvertFrom-Json } catch { }
        if ($sameExit -eq 0 -and $sameObject.sameObject -eq $true) { Add-Result 'preexisting-alias-identity' 'PASS' @{db=$serviceDb;alias=$AliasPath;output=$sameObject} }
        else { Add-Result 'preexisting-alias-identity' 'INVALID_TEST' @{db=$serviceDb;alias=$AliasPath;exitCode=$sameExit;output=($same -join "`n")} }
    }
    $identity = Invoke-AsCaller 'caller-identity' $AttackerExe @('identity')
    $identityMatches = $identity.stdout -match [regex]::Escape($ExpectedCallerSid)
    if ($identityMatches) { Add-Result 'attacker-token' 'PASS' @{expectedSid=$ExpectedCallerSid;observed=$identity.stdout} }
    else { Add-Result 'attacker-token' 'INVALID_TEST' @{expectedSid=$ExpectedCallerSid;observed=$identity.stdout;stderr=$identity.stderr} }

    $status = Invoke-AsCaller 'client-status' $ClientExe @('status')
    if ($status.stdout.StartsWith('STATUS|')) { Add-Result 'broker-status-ipc' 'PASS' $status } else { Add-Result 'broker-status-ipc' 'FAIL' $status }

    $baselineText = & $VerifierExe sqlite $serviceDb 2>&1
    $baselineExit = $LASTEXITCODE
    $baselineObject = $null
    try { $baselineObject = ($baselineText -join "`n") | ConvertFrom-Json } catch { }
    if ($baselineExit -eq 0 -and $baselineObject.schema -eq 'SYLPH_G1_SQLITE_READONLY_1' -and
        $baselineObject.integrity -eq 'ok' -and $baselineObject.effectCount -is [ValueType] -and
        $baselineObject.effectCount -ge 0) {
        Add-Result 'sqlite-baseline-state' 'PASS' @{exitCode=$baselineExit;output=$baselineObject}
    } else {
        Add-Result 'sqlite-baseline-state' 'INVALID_TEST' @{exitCode=$baselineExit;output=($baselineText -join "`n");reason='unable to establish pre-write integrity and effect-count baseline'}
    }

    $requestId = [guid]::NewGuid().ToString('N')
    $payload = "g1-synthetic-$requestId"
    $first = Invoke-AsCaller 'client-first-write' $ClientExe @('write',$requestId,$payload)
    $retry = Invoke-AsCaller 'client-duplicate-write' $ClientExe @('write',$requestId,$payload)
    $conflictingRetry = Invoke-AsCaller 'client-conflicting-duplicate-write' $ClientExe @('write',$requestId,"different-$payload")
    if ($first.stdout -eq 'OK|inserted' -and $retry.stdout -eq 'OK|duplicate') {
        Add-Result 'fixed-write-and-idempotent-retry' 'PASS' @{requestId=$requestId;first=$first;retry=$retry}
    } else {
        Add-Result 'fixed-write-and-idempotent-retry' 'FAIL' @{requestId=$requestId;first=$first;retry=$retry}
    }
    if ($conflictingRetry.exitCode -eq 2 -and $conflictingRetry.stdout -eq 'ERR|REQUEST_ID_CONFLICT' -and
        [string]::IsNullOrWhiteSpace($conflictingRetry.stderr)) {
        Add-Result 'conflicting-duplicate-rejected' 'PASS' @{requestId=$requestId;observed=$conflictingRetry}
    } else {
        Add-Result 'conflicting-duplicate-rejected' 'FAIL' @{requestId=$requestId;reason='expected exact protocol response ERR|REQUEST_ID_CONFLICT (exit 2); transport or generic errors are not accepted';observed=$conflictingRetry}
    }

    foreach($p in @(@('client-forbidden',$ClientExe),@('attacker-forbidden',$AttackerExe))) {
        $result = Invoke-AsCaller $p[0] $p[1] @('forbidden')
        if ($result.stdout -eq 'ERR|FORBIDDEN_OPERATION') { Add-Result $p[0] 'PASS' $result }
        else { Add-Result $p[0] 'FAIL' $result }
    }

    Assert-DirectWriteDenied 'direct-write-original-running' $serviceDb
    if ($AliasPath) { Assert-DirectWriteDenied 'direct-write-alias-running' $AliasPath }
    else { Add-Result 'direct-write-alias-running' 'NOT_RUN' @{reason='pre-existing alias path not supplied'} }
    foreach ($suffix in @('-wal','-shm')) {
        $sidecar = "$serviceDb$suffix"
        if (Test-Path -LiteralPath $sidecar -PathType Leaf) {
            Assert-DirectWriteDenied "direct-write-sidecar$suffix-running" $sidecar
        } else {
            Add-Result "direct-write-sidecar$suffix-running" 'NOT_RUN' @{reason='SQLite sidecar did not exist at observation time';path=$sidecar}
        }
    }

    if (Test-Path -LiteralPath $VerifierExe) {
        $verifyDb = & $VerifierExe sqlite $serviceDb 2>&1
        $verifyExit = $LASTEXITCODE
        $verifyText = ($verifyDb -join "`n")
        $verifyObject = $null
        try { $verifyObject = $verifyText | ConvertFrom-Json } catch { }
        if ($verifyExit -eq 0 -and $verifyObject.schema -eq 'SYLPH_G1_SQLITE_READONLY_1' -and
            $verifyObject.integrity -eq 'ok' -and $null -ne $baselineObject -and
            $verifyObject.effectCount -eq ($baselineObject.effectCount + 1)) {
            Add-Result 'sqlite-readonly-verifier' 'PASS' @{exitCode=$verifyExit;before=$baselineObject;after=$verifyObject;expectedEffectDelta=1;reason='one fixed write adds exactly one effect; identical/conflicting retries add none'}
        } else {
            Add-Result 'sqlite-readonly-verifier' 'FAIL' @{exitCode=$verifyExit;before=$baselineObject;output=$verifyText;expectedEffectDelta=1;reason='read-only verifier did not establish integrity=ok and exactly one additional effect over baseline'}
        }
    } else { Add-Result 'sqlite-readonly-verifier' 'NOT_RUN' @{reason='independent verifier binary missing'} }
} else {
    Assert-DirectWriteDenied 'direct-write-original-stopped' $serviceDb
    if ($AliasPath) { Assert-DirectWriteDenied 'direct-write-alias-stopped' $AliasPath }
    else { Add-Result 'direct-write-alias-stopped' 'NOT_RUN' @{reason='pre-existing alias path not supplied'} }
    foreach ($suffix in @('-wal','-shm')) {
        $sidecar = "$serviceDb$suffix"
        if (Test-Path -LiteralPath $sidecar -PathType Leaf) {
            Assert-DirectWriteDenied "direct-write-sidecar$suffix-stopped" $sidecar
        } else {
            Add-Result "direct-write-sidecar$suffix-stopped" 'NOT_RUN' @{reason='SQLite sidecar did not exist at observation time';path=$sidecar}
        }
    }
    Add-Result 'pipe-and-transaction-tests' 'NOT_RUN' @{reason='service is intentionally stopped'}
}
$report.storageInventoryAfter = Get-DataInventory

$failed = @($testResults.Values | Where-Object { $_.status -in @('FAIL','INVALID_TEST') })
if ($failed.Count -gt 0) { $report.verdict='FAIL' }
elseif (@($testResults.Values | Where-Object { $_.status -in @('BLOCKED','NOT_RUN') }).Count -gt 0) { $report.verdict='PARTIAL_BLOCKED' }
else { $report.verdict='PASS_FOR_LISTED_SCRATCH_CHECKS_ONLY' }

$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $ReportPath -Encoding utf8
Get-Content -Raw -LiteralPath $ReportPath
if ($report.verdict -eq 'FAIL') { exit 1 }
