param([Parameter(Mandatory = $true)][string] $Root)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

# Read-only Win32 inspection. Node lstat does not expose every reparse tag or ADS.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SylphPlainCandidatePath {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  private struct StreamData {
    public long Size;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=296)] public string Name;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern uint GetFileAttributesW(string path);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern IntPtr FindFirstStreamW(string path, int level, out StreamData data, uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern bool FindNextStreamW(IntPtr handle, out StreamData data);
  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern bool FindClose(IntPtr handle);
  public static void InspectAncestor(string path) {
    uint attrs=GetFileAttributesW(path);
    if(attrs==0xffffffff) throw new Exception("PATH_UNAVAILABLE");
    if((attrs & 0x400)!=0) throw new Exception("REPARSE_POINT");
    if((attrs & 0x10)==0) throw new Exception("ROOT_NOT_DIRECTORY");
  }
  public static bool Inspect(string path) {
    uint attrs=GetFileAttributesW(path);
    if(attrs==0xffffffff) throw new Exception("PATH_UNAVAILABLE");
    if((attrs & 0x400)!=0) throw new Exception("REPARSE_POINT");
    bool isDirectory = (attrs & 0x10) != 0;
    StreamData data;
    IntPtr handle=FindFirstStreamW(path,0,out data,0);
    if(handle==new IntPtr(-1)) {
      if(Marshal.GetLastWin32Error()!=38) throw new Exception("STREAM_INSPECTION_FAILED");
    } else {
      try {
        if(isDirectory) throw new Exception("ALTERNATE_STREAM");
        do { if(data.Name!="::$DATA") throw new Exception("ALTERNATE_STREAM"); }
        while(FindNextStreamW(handle,out data));
        if(Marshal.GetLastWin32Error()!=38) throw new Exception("STREAM_INSPECTION_FAILED");
      } finally { FindClose(handle); }
    }
    return isDirectory;
  }
}
'@
$full = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
if ($full -notmatch '^[A-Za-z]:\\' -or $full.Length -lt 4) { throw 'LOCAL_ROOT_REQUIRED' }
$volume = [System.IO.Path]::GetPathRoot($full)
$current = $volume
$parts = $full.Substring($volume.Length).Split('\')
for ($i = 0; $i -lt $parts.Length; $i++) {
  $part = $parts[$i]
  if ([string]::IsNullOrEmpty($part) -or $part -eq '.' -or $part -eq '..' -or $part.Contains(':') -or $part.EndsWith('.') -or $part.EndsWith(' ')) { throw 'PATH_INVALID' }
  $current = [System.IO.Path]::Combine($current,$part)
  if ($i -lt $parts.Length - 1) {
    [SylphPlainCandidatePath]::InspectAncestor($current)
  } else {
    if (-not [SylphPlainCandidatePath]::Inspect($current)) { throw 'ROOT_NOT_DIRECTORY' }
  }
}
$entries = New-Object 'System.Collections.Generic.List[object]'
$pending = New-Object 'System.Collections.Generic.Stack[object]'
$pending.Push(@{full=$full;relative='';depth=0})
while ($pending.Count -gt 0) {
  $item=$pending.Pop()
  if ($item.depth -gt 64 -or $entries.Count -ge 10000) { throw 'TREE_LIMIT' }
  $directory=[SylphPlainCandidatePath]::Inspect($item.full)
  $kind=if($directory){'directory'}else{'file'}
  $entries.Add([ordered]@{path=$item.relative;kind=$kind})
  if ($directory) {
    foreach($child in [System.IO.Directory]::EnumerateFileSystemEntries($item.full)) {
      $name=[System.IO.Path]::GetFileName($child)
      $relative=if($item.relative){$item.relative+'/'+$name}else{$name}
      $pending.Push(@{full=$child;relative=$relative;depth=$item.depth+1})
      if ($pending.Count+$entries.Count -gt 10000) { throw 'TREE_LIMIT' }
    }
  }
}
# JavaScript sorts and validates entries independently; ordinal sorting avoids
# locale/case-dependent PowerShell Sort-Object behavior.
$names = [string[]]@($entries | ForEach-Object { $_.path })
[Array]::Sort($names,[StringComparer]::Ordinal)
$lookup = @{}
foreach($entry in $entries) {
  if($lookup.ContainsKey($entry.path)){throw 'CASE_COLLISION'}
  $lookup[$entry.path]=$entry
}
[ordered]@{schemaVersion='sylph.plain-candidate-tree.v1';entries=@($names | ForEach-Object {$lookup[$_]})} | ConvertTo-Json -Depth 5 -Compress
