import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,win32} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runBoundedChildProcess} from '../../dist/platform/storage/bounded-child-process.js';

const testDistRoot=process.env.PAPER_ACCOUNT_V3_TEST_DIST;
const scratchModule=testDistRoot?pathToFileURL(join(testDistRoot,'platform/storage/paper-account-v3-windows-scratch-root.js')).href:
  new URL('../../dist/platform/storage/paper-account-v3-windows-scratch-root.js',import.meta.url).href;
const {ensurePaperAccountV3ProtectedScratchRoot,parsePaperAccountV3ScratchRootResponse,paperAccountV3ScratchRootName}=
  await import(scratchModule);

test('bounded child succeeds without a shell and caps output and lifetime',async()=>{
  const ok=await runBoundedChildProcess(process.execPath,['-e','process.stdout.write("ok")'],{timeoutMs:3000,maxOutputBytes:10});
  assert.deepEqual(ok,{stdout:'ok',stderr:'',exitCode:0});
  await assert.rejects(runBoundedChildProcess(process.execPath,['-e','process.stdout.write("0123456789")'],
    {timeoutMs:3000,maxOutputBytes:5}),/BOUNDED_CHILD_OUTPUT_LIMIT/);
  await assert.rejects(runBoundedChildProcess(process.execPath,['-e','setInterval(()=>{},1000)'],
    {timeoutMs:100,maxOutputBytes:10}),/BOUNDED_CHILD_TIMEOUT/);
  await assert.rejects(runBoundedChildProcess(process.execPath,['-e','process.exit(9)'],
    {timeoutMs:3000,maxOutputBytes:10}),/BOUNDED_CHILD_EXIT_NONZERO/);
});

test('scratch-root response parser rejects malformed, extra, or mismatched ACL claims',()=>{
  const parent='C:\\Users\\fixture\\AppData\\Local';
  const path=win32.join(parent,paperAccountV3ScratchRootName);
  const currentSid='S-1-5-21-100-200-300-1001';
  const aces=[currentSid,'S-1-5-18','S-1-5-32-544'].map(sid=>({sid,access:'Allow',rights:'FullControl',inheritance:3,propagation:0,inherited:false}));
  const response={protocol:'sylph-paper-account-v3-scratch-root-v1',ok:true,path,currentSid,ownerSid:currentSid,volume:'C:\\',driveType:'Fixed',filesystem:'NTFS',
    daclProtected:true,reparsePoint:false,aces};
  assert.equal(parsePaperAccountV3ScratchRootResponse(JSON.stringify(response),parent).ownerSid,currentSid);
  assert.throws(()=>parsePaperAccountV3ScratchRootResponse(JSON.stringify({...response,unexpected:true}),parent),/RESPONSE_INVALID/);
  assert.throws(()=>parsePaperAccountV3ScratchRootResponse(JSON.stringify({...response,aces:[...aces,{...aces[0]}]}),parent),/ACL_INVALID/);
  assert.throws(()=>parsePaperAccountV3ScratchRootResponse(JSON.stringify({...response,ownerSid:'S-1-5-18'}),parent),/IDENTITY_MISMATCH/);
  assert.throws(()=>parsePaperAccountV3ScratchRootResponse(JSON.stringify({...response,driveType:'Network'}),parent),/VOLUME_NOT_LOCAL_FIXED/);
  assert.throws(()=>parsePaperAccountV3ScratchRootResponse(JSON.stringify({...response,driveType:'Removable'}),parent),/VOLUME_NOT_LOCAL_FIXED/);
  for(const filesystem of ['ReFS','exFAT','FAT32',''])
    assert.throws(()=>parsePaperAccountV3ScratchRootResponse(JSON.stringify({...response,filesystem}),parent),/VOLUME_FILESYSTEM_UNSUPPORTED/);
  assert.throws(()=>parsePaperAccountV3ScratchRootResponse('not-json',parent),/RESPONSE_INVALID/);
});

test('protected root is unsupported off Windows',async()=>{
  if(process.platform==='win32')return;
  await assert.rejects(ensurePaperAccountV3ProtectedScratchRoot(),/PLATFORM_UNSUPPORTED/);
});

test('Windows root is atomically protected and child attempt directories inherit its exact ACE set',
  {skip:process.platform!=='win32'&&'Windows integration only'},async t=>{
    const folder=await mkdtemp(join(tmpdir(),'sylph-paper-v3-acl-'));
    const previous=process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA=folder;
    t.after(async()=>{
      if(previous===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=previous;
      const resolved=win32.resolve(folder);
      if(!resolved.startsWith(win32.resolve(tmpdir()).replace(/[\\/]$/,'')+'\\'))throw new Error('TEST_CLEANUP_PATH_ESCAPE');
      await rm(folder,{recursive:true,force:true});
    });
    const root=await ensurePaperAccountV3ProtectedScratchRoot();
    assert.equal(root.path,win32.join(folder,paperAccountV3ScratchRootName));
    assert.equal(root.daclProtected,true);
    assert.equal(root.driveType,'Fixed');assert.equal(root.filesystem,'NTFS');
    assert.equal((await lstat(root.path)).isDirectory(),true);
    const repeated=await ensurePaperAccountV3ProtectedScratchRoot();
    assert.deepEqual(repeated,root,'exact existing root is verified and reused');
    const attempt=await mkdtemp(join(root.path,'attempt-'));
    const inspectAcl=String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$path=[Environment]::GetEnvironmentVariable('SYLPH_TEST_PATH','Process')
$item=[System.IO.DirectoryInfo]::new($path)
$acl=$item.GetAccessControl()
$rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))
$rows=@($rules | ForEach-Object { [ordered]@{sid=$_.IdentityReference.Value;inherited=$_.IsInherited;type=$_.AccessControlType.ToString();rights=$_.FileSystemRights.ToString();inheritance=[int]$_.InheritanceFlags;propagation=[int]$_.PropagationFlags} })
[Console]::Out.WriteLine(($rows | ConvertTo-Json -Compress -Depth 3))
`;
    const encoded=Buffer.from(inspectAcl,'utf16le').toString('base64');
    const result=await runBoundedChildProcess(join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
      ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded],
      {timeoutMs:5000,maxOutputBytes:8192,windowsHide:true,env:{...process.env,SYLPH_TEST_PATH:attempt}});
    assert.equal(result.exitCode,0);assert.equal(result.stderr,'');
    const rows=JSON.parse(result.stdout);
    assert.equal(Array.isArray(rows),true);assert.equal(rows.length,3);
    assert.deepEqual(rows.map(row=>row.sid).sort(),root.principals);
    for(const row of rows) {
      assert.equal(row.inherited,true);assert.equal(row.type,'Allow');assert.equal(row.rights,'FullControl');
      assert.equal(row.inheritance,3);assert.equal(row.propagation,0);
    }
  });

test('Windows provider refuses a pre-existing permissive root and does not repair it',
  {skip:process.platform!=='win32'&&'Windows integration only'},async t=>{
    const folder=await mkdtemp(join(tmpdir(),'sylph-paper-v3-permissive-'));
    const previous=process.env.LOCALAPPDATA;process.env.LOCALAPPDATA=folder;
    const root=join(folder,paperAccountV3ScratchRootName);await mkdir(root);
    const before=await lstat(root);
    t.after(async()=>{
      if(previous===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=previous;
      const resolved=win32.resolve(folder);
      if(!resolved.startsWith(win32.resolve(tmpdir()).replace(/[\\/]$/,'')+'\\'))throw new Error('TEST_CLEANUP_PATH_ESCAPE');
      await rm(folder,{recursive:true,force:true});
    });
    await assert.rejects(ensurePaperAccountV3ProtectedScratchRoot(),/PROVIDER_FAILED|RESPONSE_INVALID/);
    const after=await lstat(root);
    assert.equal(after.ino,before.ino);assert.equal(after.mtimeMs,before.mtimeMs,'provider must refuse, not repair');
  });
