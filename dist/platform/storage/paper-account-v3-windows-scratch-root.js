import { win32 } from 'node:path';
import { runBoundedChildProcess } from './bounded-child-process.js';
const ROOT_NAME = 'SylphFusion-PaperAccountV3-Scratch';
const PROTOCOL = 'sylph-paper-account-v3-scratch-root-v1';
const SYSTEM_SID = 'S-1-5-18';
const ADMINISTRATORS_SID = 'S-1-5-32-544';
const MAX_OUTPUT_BYTES = 16_384;
const PROVIDER_TIMEOUT_MS = 8_000;
const POWERSHELL_SOURCE = String.raw `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$protocol = 'sylph-paper-account-v3-scratch-root-v1'
function Assert-NoReparseComponents([string]$path) {
  $full = [System.IO.Path]::GetFullPath($path)
  $volume = [System.IO.Path]::GetPathRoot($full)
  if ([string]::IsNullOrWhiteSpace($volume) -or $full.StartsWith('\\')) { throw 'PATH_UNSUPPORTED' }
  $remaining = $full.Substring($volume.Length)
  $parts = $remaining.Split([char[]]@('\','/'), [System.StringSplitOptions]::RemoveEmptyEntries)
  $current = $volume
  foreach ($part in $parts) {
    $current = [System.IO.Path]::Combine($current, $part)
    if (-not ([System.IO.Directory]::Exists($current) -or [System.IO.File]::Exists($current))) { throw 'PATH_COMPONENT_MISSING' }
    $attributes = [System.IO.File]::GetAttributes($current)
    if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE_POINT' }
  }
}
try {
  $localAppData = [Environment]::GetEnvironmentVariable('LOCALAPPDATA','Process')
  if ([string]::IsNullOrWhiteSpace($localAppData) -or -not [System.IO.Path]::IsPathRooted($localAppData) -or $localAppData.StartsWith('\\')) { throw 'LOCALAPPDATA_INVALID' }
  $localFull = [System.IO.Path]::GetFullPath($localAppData).TrimEnd('\')
  $volume = [System.IO.Path]::GetPathRoot($localFull)
  if ($volume -notmatch '^[A-Za-z]:\\$') { throw 'VOLUME_UNSUPPORTED' }
  $driveInfo = [System.IO.DriveInfo]::new($volume)
  $driveType = $driveInfo.DriveType.ToString()
  if ($driveType -ne 'Fixed') { throw 'VOLUME_NOT_LOCAL_FIXED' }
  $filesystem = $driveInfo.DriveFormat
  if ($filesystem -ne 'NTFS') { throw 'VOLUME_FILESYSTEM_UNSUPPORTED' }
  Assert-NoReparseComponents $localFull
  $root = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($localFull, 'SylphFusion-PaperAccountV3-Scratch'))
  if (-not $root.StartsWith(($localFull + '\'), [System.StringComparison]::OrdinalIgnoreCase) -or
      [System.IO.Path]::GetPathRoot($root) -ne $volume) { throw 'ROOT_PATH_INVALID' }
  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544') | Sort-Object -Unique
  if ($allowedSids.Count -ne 3) { throw 'PRINCIPAL_SET_INVALID' }
  if (-not [System.IO.Directory]::Exists($root)) {
    if ([System.IO.File]::Exists($root)) { throw 'ROOT_NOT_DIRECTORY' }
    $security = New-Object System.Security.AccessControl.DirectorySecurity
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner([System.Security.Principal.SecurityIdentifier]::new($currentSid))
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($sid in $allowedSids) {
      $rule = [System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new($sid),
        [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance,
        [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
      $security.AddAccessRule($rule)
    }
    ([System.IO.DirectoryInfo]::new($root)).Create($security)
  }
  Assert-NoReparseComponents $root
  $directory = [System.IO.DirectoryInfo]::new($root)
  $acl = $directory.GetAccessControl()
  $ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  if ($ownerSid -ne $currentSid -or -not $acl.AreAccessRulesProtected) { throw 'ROOT_OWNER_OR_PROTECTION_INVALID' }
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 3) { throw 'ROOT_ACE_COUNT_INVALID' }
  $actualSids = @()
  $aces = @()
  foreach ($rule in $rules) {
    $sid = $rule.IdentityReference.Value
    $actualSids += $sid
    if ($allowedSids -notcontains $sid -or $rule.IsInherited -or $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
        $rule.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or
        [int]$rule.InheritanceFlags -ne 3 -or [int]$rule.PropagationFlags -ne 0) { throw 'ROOT_ACE_INVALID' }
    $aces += [ordered]@{sid=$sid;access='Allow';rights='FullControl';inheritance=3;propagation=0;inherited=$false}
  }
  $actualSids = @($actualSids | Sort-Object -Unique)
  if ($actualSids.Count -ne 3 -or (Compare-Object -ReferenceObject $allowedSids -DifferenceObject $actualSids).Count -ne 0) { throw 'ROOT_PRINCIPAL_SET_INVALID' }
  $reportedPath = [System.IO.Path]::GetFullPath($directory.FullName)
  if (-not $reportedPath.Equals($root, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'ROOT_FINAL_PATH_MISMATCH' }
  $response = [ordered]@{protocol=$protocol;ok=$true;path=$reportedPath;currentSid=$currentSid;ownerSid=$ownerSid;volume=$volume;
    driveType=$driveType;filesystem=$filesystem;
    daclProtected=$true;reparsePoint=$false;aces=@($aces | Sort-Object sid)}
  [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 4))
  exit 0
} catch {
  $response = [ordered]@{protocol=$protocol;ok=$false;code='PROVISION_OR_VERIFY_FAILED'}
  [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 3))
  exit 1
}
`;
const fail = (code) => { throw new Error(code); };
function exactKeys(value, keys) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function expectedRoot(localAppData) {
    if (!win32.isAbsolute(localAppData) || localAppData.startsWith('\\\\'))
        fail('PAPER_ACCOUNT_V3_SCRATCH_LOCALAPPDATA_INVALID');
    const path = win32.resolve(localAppData, ROOT_NAME);
    const volume = win32.parse(path).root;
    if (!/^[A-Za-z]:\\$/.test(volume) || win32.relative(localAppData, path) !== ROOT_NAME)
        fail('PAPER_ACCOUNT_V3_SCRATCH_ROOT_PATH_INVALID');
    return { path, volume };
}
/** Strict response decoder; exposed for deterministic protocol tests, not as an authority check by itself. */
export function parsePaperAccountV3ScratchRootResponse(stdout, localAppData) {
    const expected = expectedRoot(localAppData);
    if (typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT_BYTES)
        fail('PAPER_ACCOUNT_V3_SCRATCH_RESPONSE_INVALID');
    const lines = stdout.split(/\r?\n/).filter(line => line.length > 0);
    if (lines.length !== 1)
        fail('PAPER_ACCOUNT_V3_SCRATCH_RESPONSE_INVALID');
    let parsed;
    try {
        parsed = JSON.parse(lines[0]);
    }
    catch {
        return fail('PAPER_ACCOUNT_V3_SCRATCH_RESPONSE_INVALID');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        fail('PAPER_ACCOUNT_V3_SCRATCH_RESPONSE_INVALID');
    const response = parsed;
    const responseKeys = ['protocol', 'ok', 'path', 'currentSid', 'ownerSid', 'volume', 'driveType', 'filesystem', 'daclProtected', 'reparsePoint', 'aces'];
    if (!exactKeys(response, responseKeys) || response.protocol !== PROTOCOL || response.ok !== true || typeof response.path !== 'string' ||
        typeof response.currentSid !== 'string' || typeof response.ownerSid !== 'string' || typeof response.volume !== 'string' ||
        typeof response.driveType !== 'string' || typeof response.filesystem !== 'string' ||
        response.daclProtected !== true || response.reparsePoint !== false || !Array.isArray(response.aces))
        fail('PAPER_ACCOUNT_V3_SCRATCH_RESPONSE_INVALID');
    const responsePath = response.path;
    const currentSid = response.currentSid;
    const ownerSid = response.ownerSid;
    const volume = response.volume;
    const aces = response.aces;
    if (response.driveType !== 'Fixed')
        fail('PAPER_ACCOUNT_V3_SCRATCH_VOLUME_NOT_LOCAL_FIXED');
    if (response.filesystem !== 'NTFS')
        fail('PAPER_ACCOUNT_V3_SCRATCH_VOLUME_FILESYSTEM_UNSUPPORTED');
    if (!/^S-1-[0-9]+(?:-[0-9]+)+$/.test(currentSid) || ownerSid !== currentSid ||
        win32.resolve(responsePath).toLowerCase() !== expected.path.toLowerCase() || volume.toLowerCase() !== expected.volume.toLowerCase())
        fail('PAPER_ACCOUNT_V3_SCRATCH_RESPONSE_IDENTITY_MISMATCH');
    const principalSet = [currentSid, SYSTEM_SID, ADMINISTRATORS_SID].sort();
    if (new Set(principalSet).size !== 3 || aces.length !== 3)
        fail('PAPER_ACCOUNT_V3_SCRATCH_RESPONSE_ACL_INVALID');
    const seen = new Set();
    for (const raw of aces) {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
            fail('PAPER_ACCOUNT_V3_SCRATCH_RESPONSE_ACL_INVALID');
        const ace = raw;
        if (!exactKeys(ace, ['sid', 'access', 'rights', 'inheritance', 'propagation', 'inherited']) || typeof ace.sid !== 'string' ||
            ace.access !== 'Allow' || ace.rights !== 'FullControl' || ace.inheritance !== 3 || ace.propagation !== 0 || ace.inherited !== false ||
            !principalSet.includes(ace.sid) || seen.has(ace.sid))
            fail('PAPER_ACCOUNT_V3_SCRATCH_RESPONSE_ACL_INVALID');
        seen.add(ace.sid);
    }
    if (principalSet.some(sid => !seen.has(sid)))
        fail('PAPER_ACCOUNT_V3_SCRATCH_RESPONSE_ACL_INVALID');
    return { path: expected.path, ownerSid, volume: expected.volume, driveType: 'Fixed', filesystem: 'NTFS', daclProtected: true, principals: principalSet };
}
/** Creates or verifies the stable Windows scratch root with an explicit protected DACL. */
export async function ensurePaperAccountV3ProtectedScratchRoot() {
    if (process.platform !== 'win32')
        fail('PAPER_ACCOUNT_V3_SCRATCH_PLATFORM_UNSUPPORTED');
    const localAppData = process.env.LOCALAPPDATA;
    if (typeof localAppData !== 'string' || localAppData.length === 0)
        fail('PAPER_ACCOUNT_V3_SCRATCH_LOCALAPPDATA_INVALID');
    const expected = expectedRoot(localAppData);
    const systemRoot = process.env.SystemRoot;
    if (typeof systemRoot !== 'string' || !win32.isAbsolute(systemRoot))
        fail('PAPER_ACCOUNT_V3_SCRATCH_SYSTEMROOT_INVALID');
    const powerShell = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const encoded = Buffer.from(POWERSHELL_SOURCE, 'utf16le').toString('base64');
    let result;
    try {
        result = await runBoundedChildProcess(powerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { timeoutMs: PROVIDER_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES, windowsHide: true });
    }
    catch (error) {
        throw new Error(`PAPER_ACCOUNT_V3_SCRATCH_PROVIDER_FAILED:${error.message}`, { cause: error });
    }
    if (result.stderr.length !== 0 || result.exitCode !== 0)
        fail('PAPER_ACCOUNT_V3_SCRATCH_PROVIDER_RESPONSE_INVALID');
    const root = parsePaperAccountV3ScratchRootResponse(result.stdout, localAppData);
    if (root.path.toLowerCase() !== expected.path.toLowerCase())
        fail('PAPER_ACCOUNT_V3_SCRATCH_ROOT_IDENTITY_MISMATCH');
    return root;
}
export const paperAccountV3ScratchRootName = ROOT_NAME;
//# sourceMappingURL=paper-account-v3-windows-scratch-root.js.map