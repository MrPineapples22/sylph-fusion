import { execFileSync } from 'node:child_process';
import { realpathSync, statfsSync } from 'node:fs';
import { win32 } from 'node:path';
// Linux statfs(2) filesystem magic values from the Linux UAPI. These identify
// common remote or cluster filesystems that cannot satisfy this runtime's
// single-host SQLite WAL contract.
const LINUX_SHARED_FILESYSTEMS = new Map([
    [0x6969, 'NFS'],
    [0xff534d42, 'CIFS'],
    [0xfe534d42, 'SMB2'],
    [0x517b, 'SMB'],
    [0x00c36400, 'CEPH'],
    [0x5346414f, 'AFS'],
    [0x6b414653, 'AFS'],
    [0x73757245, 'CODA'],
    [0x564c, 'NCP'],
    [0x01021997, '9P'],
    [0x7461636f, 'OCFS2'],
    // Generic FUSE can be backed by a network daemon and does not expose a
    // portable capability bit proving SQLite-compatible locking/durability.
    [0x65735546, 'FUSE_UNVERIFIED'],
    [0x00c0ffee, 'HOSTFS'],
    // OverlayFS hides whether its writable upper layer is ephemeral, remote, or
    // otherwise unsuitable for the local SQLite durability contract.
    [0x794c7630, 'OVERLAYFS_UNVERIFIED'],
]);
// Linux UAPI filesystem types accepted for normal single-host SQLite WAL use.
// This identifies a filesystem family; it does not prove nonvolatile media,
// safe mount options, or honest device-cache behavior.
const LINUX_LOCAL_FILESYSTEMS = new Map([
    [0xef53, 'EXT2_3_4'],
    [0x9123683e, 'BTRFS'],
    [0xf2f52010, 'F2FS'],
    [0x58465342, 'XFS'],
    [0x3434, 'NILFS2'],
]);
const WINDOWS_DRIVE_TYPE_SCRIPT = [
    "$ErrorActionPreference = 'Stop'",
    "$source = 'using System; using System.Text; using System.ComponentModel; using System.Runtime.InteropServices; public static class SylphFusionVolumeProbe { [DllImport(\"kernel32.dll\", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetVolumePathName(string path, StringBuilder volumePath, uint length); [DllImport(\"kernel32.dll\", CharSet=CharSet.Unicode)] static extern uint GetDriveType(string rootPathName); public static uint GetDriveTypeForPath(string path) { var volumePath = new StringBuilder(32768); if (!GetVolumePathName(path, volumePath, (uint)volumePath.Capacity)) throw new Win32Exception(Marshal.GetLastWin32Error()); return GetDriveType(volumePath.ToString()); } }'",
    'Add-Type -TypeDefinition $source -ErrorAction Stop',
    '[Console]::Out.Write([SylphFusionVolumeProbe]::GetDriveTypeForPath($env:SYLPH_FUSION_DATABASE_DIRECTORY))',
].join('; ');
function isWindowsNetworkNamespacePath(value) {
    const normalized = value.replaceAll('/', '\\');
    if (/^(?:\\\\\?\\UNC\\|\\\\\.\\UNC\\|\\\?\?\\UNC\\|\\\\\?\\GLOBALROOT\\Device\\Mup\\)/i.test(normalized))
        return true;
    if (!normalized.startsWith('\\\\'))
        return false;
    return !/^\\\\\?\\(?:[A-Za-z]:\\|Volume\{[0-9a-f-]+\}\\)/i.test(normalized);
}
/** Bounded Windows API bridge; the fixed script receives paths only through the environment. */
export function probeWindowsDriveType(path) {
    const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR;
    const executable = windowsRoot
        ? win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        : 'powershell.exe';
    let output;
    try {
        output = execFileSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_DRIVE_TYPE_SCRIPT], {
            encoding: 'utf8',
            timeout: 2500,
            maxBuffer: 4096,
            windowsHide: true,
            env: {
                SystemRoot: process.env.SystemRoot,
                WINDIR: process.env.WINDIR,
                PATH: process.env.PATH,
                TEMP: process.env.TEMP,
                TMP: process.env.TMP,
                SYLPH_FUSION_DATABASE_DIRECTORY: path,
            },
        });
    }
    catch (cause) {
        throw new Error('DATABASE_WINDOWS_VOLUME_PROBE_FAILED', { cause });
    }
    const value = output.trim();
    if (!/^[0-6]$/.test(value))
        throw new Error('DATABASE_WINDOWS_VOLUME_PROBE_INVALID_RESULT');
    return Number(value);
}
function assertWindowsDriveTypeAllowed(driveType) {
    // Only DRIVE_FIXED=3 is accepted. Removable, network, unknown, missing,
    // optical, and RAM-disk roots do not meet the deployment contract.
    if (driveType === 4)
        throw new Error('DATABASE_FILESYSTEM_UNSUPPORTED_SHARED:WINDOWS_REMOTE');
    if (driveType !== 3)
        throw new Error(`DATABASE_WINDOWS_DRIVE_TYPE_UNSUPPORTED:${driveType}`);
}
/**
 * Classify supported local volumes and reject unsupported/unclassified storage
 * before opening SQLite WAL. The paper-only operator attestation escape hatch
 * must never be treated as proof of locality or power-loss durability.
 */
export function assertDatabaseFilesystemPolicy(path, platform = process.platform, probe = statfsSync, windowsProbe = probeWindowsDriveType, pathResolver = realpathSync, options = {}) {
    if (platform === 'win32') {
        let canonicalPath;
        try {
            canonicalPath = pathResolver(path);
        }
        catch (cause) {
            throw new Error('DATABASE_FILESYSTEM_PATH_RESOLUTION_FAILED', { cause });
        }
        if (isWindowsNetworkNamespacePath(canonicalPath)) {
            throw new Error('DATABASE_FILESYSTEM_UNSUPPORTED_SHARED:WINDOWS_UNC');
        }
        const driveType = windowsProbe(canonicalPath);
        assertWindowsDriveTypeAllowed(driveType);
        return { status: 'LOCAL_VOLUME_CLASSIFIED', driveType };
    }
    if (platform !== 'linux') {
        if (options.allowUnclassified)
            return { status: 'PLATFORM_UNCLASSIFIED' };
        throw new Error(`DATABASE_FILESYSTEM_PLATFORM_UNCLASSIFIED:${platform}`);
    }
    let rawType;
    try {
        rawType = Number(probe(path).type) >>> 0;
    }
    catch (cause) {
        throw new Error('DATABASE_FILESYSTEM_PROBE_FAILED', { cause });
    }
    const filesystem = LINUX_SHARED_FILESYSTEMS.get(rawType);
    if (filesystem)
        throw new Error(`DATABASE_FILESYSTEM_UNSUPPORTED_SHARED:${filesystem}`);
    const localFilesystem = LINUX_LOCAL_FILESYSTEMS.get(rawType);
    if (localFilesystem)
        return { status: 'LOCAL_FILESYSTEM_CLASSIFIED', filesystemType: rawType, filesystem: localFilesystem };
    if (options.allowUnclassified)
        return { status: 'UNCLASSIFIED_FILESYSTEM', filesystemType: rawType };
    throw new Error(`DATABASE_FILESYSTEM_UNCLASSIFIED:LINUX:${rawType.toString(16)}`);
}
//# sourceMappingURL=filesystem-policy.js.map