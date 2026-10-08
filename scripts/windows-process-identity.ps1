param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int] $ProcessId
)

$ErrorActionPreference = 'Stop'

$nativeSource = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class SylphWindowsProcessIdentity {
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const uint SYNCHRONIZE = 0x00100000;
    private const uint WAIT_OBJECT_0 = 0;
    private const uint WAIT_TIMEOUT = 258;

    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME { public uint Low; public uint High; }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(IntPtr handle, out FILETIME creation, out FILETIME exit,
        out FILETIME kernel, out FILETIME user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "QueryFullProcessImageNameW", SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr handle, uint flags, StringBuilder name, ref uint size);

    private sealed class Snapshot {
        public long ProcessStartedAtMs { get; set; }
        public string CreationFileTime100ns { get; set; }
        public string ImagePath { get; set; }
    }

    private static long ToInt64(FILETIME value) {
        return ((long)value.High << 32) | value.Low;
    }

    private static Snapshot ReadSnapshot(IntPtr handle) {
        uint wait = WaitForSingleObject(handle, 0);
        if (wait != WAIT_TIMEOUT) throw new InvalidOperationException("Process has exited or cannot be queried.");
        FILETIME creation, exit, kernel, user;
        if (!GetProcessTimes(handle, out creation, out exit, out kernel, out user))
            throw new InvalidOperationException("GetProcessTimes failed: " + Marshal.GetLastWin32Error());
        var buffer = new StringBuilder(32768);
        uint size = (uint)buffer.Capacity;
        if (!QueryFullProcessImageName(handle, 0, buffer, ref size))
            throw new InvalidOperationException("QueryFullProcessImageNameW failed: " + Marshal.GetLastWin32Error());
        long creationFileTime = ToInt64(creation);
        long unixMs = (creationFileTime - 116444736000000000L) / 10000L;
        if (unixMs < 1) throw new InvalidOperationException("Invalid process creation time.");
        return new Snapshot { ProcessStartedAtMs = unixMs,
            CreationFileTime100ns = creationFileTime.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ImagePath = buffer.ToString() };
    }

    public static object Read(uint processId) {
        IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, false, processId);
        if (handle == IntPtr.Zero) throw new InvalidOperationException("OpenProcess failed: " + Marshal.GetLastWin32Error());
        try {
            Snapshot first = ReadSnapshot(handle);
            Snapshot second = ReadSnapshot(handle);
            if (first.ProcessStartedAtMs != second.ProcessStartedAtMs ||
                !String.Equals(first.CreationFileTime100ns, second.CreationFileTime100ns, StringComparison.Ordinal) ||
                !String.Equals(first.ImagePath, second.ImagePath, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Process identity changed during query.");
            return new { processId = processId, processStartedAtMs = second.ProcessStartedAtMs,
                creationFileTime100ns = second.CreationFileTime100ns, imagePath = second.ImagePath };
        } finally {
            CloseHandle(handle);
        }
    }
}
'@

try {
  Add-Type -TypeDefinition $nativeSource -Language CSharp
  [SylphWindowsProcessIdentity]::Read([uint32] $ProcessId) | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 3
}
