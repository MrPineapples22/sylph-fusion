import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {syncBuiltinESMExports} from 'node:module';
import {verifyExtractedCandidate} from '../scripts/candidate-extracted-integrity.mjs';
import {CANDIDATE_REPOSITORY, CANDIDATE_WORKFLOW, CANDIDATE_REF, hashArtifact} from '../scripts/candidate-provenance.mjs';
import {verifyRuntimeTelemetryEvidence} from '../scripts/runtime-telemetry-evidence.mjs';

const expected = {sourceCommitSha: 'a'.repeat(40), sourceTreeSha: 'b'.repeat(40)};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function tarMember(name, bytes = Buffer.alloc(0), type = '0', size = bytes.length) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'ascii');
  for (const [offset, length, value] of [[100,8,420], [108,8,0], [116,8,0], [124,12,size], [136,12,0]]) {
    header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
  }
  header.fill(32, 148, 156); header.write(type, 156, 1);
  Buffer.from('7573746172003030', 'hex').copy(header, 257);
  header.write([...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}
function fixture(t, extra = [], alterManifest = value => value) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sylph-extracted-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const extractedDirectory = path.join(root, 'candidate'); fs.mkdirSync(extractedDirectory);
  const files = {'dist/fusion.js': Buffer.from('export {};\n'), 'package.json': Buffer.from('{"name":"fixture"}')};
  const manifest = alterManifest({application:'sylph-fusion', version:'1.0.0', releaseStatus:'UNVERIFIED_CANDIDATE',
    packagedAtUtc:'2026-10-08T00:00:00Z', dependenciesIncluded:false, totalFiles:2,
    files:Object.entries(files).map(([name, bytes]) => ({path:name, sizeBytes:bytes.length, sha256:hash(bytes)}))});
  files['RELEASE_MANIFEST.json'] = Buffer.from(JSON.stringify(manifest));
  for (const [name, bytes] of Object.entries(files)) {
    const full = path.join(extractedDirectory, name); fs.mkdirSync(path.dirname(full), {recursive: true}); fs.writeFileSync(full, bytes);
  }
  const archive = path.join(root, 'sylph-windows-candidate.tar.gz'), bundle = path.join(root, 'bundle.json'), identityFile = path.join(root, 'identity.json');
  fs.writeFileSync(bundle, 'test-only fake signature bundle');
  const identity = {schemaVersion:'sylph.candidate.identity.v1', repository:CANDIDATE_REPOSITORY, workflow:CANDIDATE_WORKFLOW,
    sourceRef:CANDIDATE_REF, ...expected, artifactName:'sylph-windows-candidate.tar.gz', artifactSha256:'',
    releaseStatus:'UNVERIFIED_CANDIDATE', runtimeAuthority:false};
  function writeArchive(raw) {
    fs.writeFileSync(archive, gzipSync(raw));
    identity.artifactSha256 = hashArtifact(archive); fs.writeFileSync(identityFile, JSON.stringify(identity));
  }
  const raw = Buffer.concat([tarMember('./', Buffer.alloc(0), '5'), tarMember('./dist/', Buffer.alloc(0), '5'),
    ...Object.entries(files).map(([name, bytes]) => tarMember('./' + name, bytes)), ...extra, Buffer.alloc(1024)]);
  writeArchive(raw);
  return {archive, bundle, identityFile, expected, extractedDirectory, raw, writeArchive};
}
function authenticated(callback, gh = (_command, args) => JSON.stringify([{verificationResult:{statement:{
  _type:'https://in-toto.io/Statement/v1', predicateType:'https://slsa.dev/provenance/v1', subject:[{digest:{sha256:hashArtifact(args[2])}}],
}}}])) {
  const original = cp.execFileSync;
  const stub = mock.method(cp, 'execFileSync', (command, ...args) => command === 'gh' ? gh(command, ...args) : original(command, ...args));
  syncBuiltinESMExports();
  try { return callback(stub); } finally { stub.mock.restore(); syncBuiltinESMExports(); }
}

test('extracted candidate reruns both signed-subject verifications and emits no runtime authority', t => {
  const input = fixture(t);
  authenticated(stub => {
    const receipt = verifyExtractedCandidate({...input, verifiedReceipt:{valid:true}});
    assert.equal(stub.mock.calls.filter(call => call.arguments[0] === 'gh').length, 2);
    const win32TreeVerified = process.platform === 'win32';
    assert.equal(receipt.status, win32TreeVerified ? 'VERIFIED_EXTRACTED_CANDIDATE' : 'EXTRACTED_INVENTORY_MATCHED');
    assert.equal(receipt.win32TreeVerified, win32TreeVerified);
    for (const flag of ['dependenciesVerified', 'loadedCodeVerified', 'runtimeAuthority', 'certificationGranted']) assert.equal(receipt[flag], false);
    assert.equal(receipt.candidateSubjectSha256, hashArtifact(input.archive));
    assert.match(receipt.inventoryRootSha256, /^[a-f0-9]{64}$/);
    assert.equal(verifyRuntimeTelemetryEvidence(receipt).valid, false, 'clean extraction is not eligible C5 telemetry');
  });
});

test('oversized or multiply-linked archive is rejected before candidate provenance invokes gh', t => {
  const oversized = fixture(t);
  fs.truncateSync(oversized.archive, 64 * 1024 * 1024 + 1);
  authenticated(stub => {
    assert.throws(() => verifyExtractedCandidate(oversized), /CANDIDATE_EXTRACTION_SIZE_LIMIT/);
    assert.equal(stub.mock.calls.filter(call => call.arguments[0] === 'gh').length, 0);
  });

  const linked = fixture(t);
  fs.linkSync(linked.archive, path.join(path.dirname(linked.archive), 'archive-hardlink.tar.gz'));
  authenticated(stub => {
    assert.throws(() => verifyExtractedCandidate(linked), /CANDIDATE_EXTRACTION_NOT_PLAIN_FILE/);
    assert.equal(stub.mock.calls.filter(call => call.arguments[0] === 'gh').length, 0);
  });
});

test('caller receipts and edited extracted manifest cannot bypass provenance or inventory checks', t => {
  const input = fixture(t);
  authenticated(() => assert.throws(() => verifyExtractedCandidate({...input, verifiedReceipt:{valid:true}}), /signature rejected/), () => {throw new Error('signature rejected');});
  authenticated(() => assert.throws(() => verifyExtractedCandidate({...input, expected:{...expected, sourceTreeSha:'c'.repeat(40)}}), /IDENTITY_MISMATCH/));
  fs.writeFileSync(path.join(input.extractedDirectory, 'RELEASE_MANIFEST.json'), '{}');
  authenticated(() => assert.throws(() => verifyExtractedCandidate(input), /FILE_MISMATCH/));
});

test('strict archive path policy denies traversal, absolute, UNC, devices, ADS, reserved names and ambiguous spelling', t => {
  for (const name of ['../escape', '/absolute', '\\\\server\\share', '\\\\?\\C:\\device', 'C:/absolute', 'x:stream', 'CON', 'aux.txt', 'LPT1.js', 'dir/NUL',
    'trailing.', 'trailing ', 'dir//file', '././ambiguous', 'dir/../file', 'a\\b', 'bad?name']) {
    const input = fixture(t, [tarMember(name, Buffer.from('x'))]);
    authenticated(() => assert.throws(() => verifyExtractedCandidate(input), /PATH_INVALID/, name));
  }
});

test('archive rejects duplicate paths, case aliases, file/directory collisions and links or extension records', t => {
  for (const extra of [[tarMember('./dist/fusion.js')], [tarMember('./DIST/other.js')], [tarMember('./dist')],
    ...['1','2','3','4','6','x','g','L','S'].map(type => [tarMember('./unsupported', Buffer.alloc(0), type)])]) {
    const input = fixture(t, extra);
    authenticated(() => assert.throws(() => verifyExtractedCandidate(input), /DUPLICATE_MEMBER|PATH_COLLISION|TAR_TYPE_UNSUPPORTED/));
  }
});

test('archive authenticates inventory entries against actual member bytes and rejects malformed bounds/truncation', t => {
  const mismatch = fixture(t, [], value => ({...value, files:value.files.map((entry,i) => i ? entry : {...entry, sha256:'0'.repeat(64)})}));
  authenticated(() => assert.throws(() => verifyExtractedCandidate(mismatch), /MANIFEST_MEMBER_MISMATCH/));
  const oversized = fixture(t, [tarMember('./too-large', Buffer.alloc(0), '0', 65*1024*1024)]);
  authenticated(() => assert.throws(() => verifyExtractedCandidate(oversized), /SIZE_LIMIT/));
  const truncated = fixture(t); truncated.writeArchive(truncated.raw.subarray(0, truncated.raw.length - 1024));
  authenticated(() => assert.throws(() => verifyExtractedCandidate(truncated), /TAR_END_INVALID/));
  const changed = fixture(t); const bad = Buffer.from(changed.raw); bad[0] ^= 1; changed.writeArchive(bad);
  authenticated(() => assert.throws(() => verifyExtractedCandidate(changed), /TAR_CHECKSUM_INVALID/));
});

test('extracted exact inventory denies changed, missing and extra files, hardlinks and directory junctions', t => {
  for (const mutate of [input => fs.appendFileSync(path.join(input.extractedDirectory,'dist/fusion.js'),'changed'),
    input => fs.unlinkSync(path.join(input.extractedDirectory,'dist/fusion.js')),
    input => fs.writeFileSync(path.join(input.extractedDirectory,'extra'),'extra'),
    input => {const original=path.join(input.extractedDirectory,'dist/fusion.js');fs.linkSync(original,path.join(input.extractedDirectory,'linked'));},
    input => fs.symlinkSync(path.join(input.extractedDirectory,'dist'),path.join(input.extractedDirectory,'redirect'), process.platform === 'win32' ? 'junction' : 'dir')]) {
    const input=fixture(t); mutate(input);
    authenticated(() => assert.throws(() => verifyExtractedCandidate(input)));
  }
});

test('Windows alternate streams fail closed even when regular file bytes match', {skip:process.platform !== 'win32'}, t => {
  const input=fixture(t); fs.writeFileSync(path.join(input.extractedDirectory,'dist/fusion.js:extra'),'hidden');
  authenticated(() => assert.throws(() => verifyExtractedCandidate(input)));
});

test('mutation during an extracted file read is detected', t => {
  const input=fixture(t), target=path.join(input.extractedDirectory,'dist/fusion.js');
  const original=fs.readSync;
  let changed=false;
  const stub=mock.method(fs,'readSync',(fd,buffer,offset,length,position) => {
    const n=original(fd,buffer,offset,length,position);
    if(!changed && buffer.length === Buffer.byteLength('export {};\n')) {changed=true;fs.appendFileSync(target,'edit');}
    return n;
  });
  try { authenticated(() => assert.throws(() => verifyExtractedCandidate(input), /FILE_CHANGED/)); }
  finally {stub.mock.restore();}
  assert.equal(changed,true);
});
