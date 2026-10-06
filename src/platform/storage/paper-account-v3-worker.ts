import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { initializePaperAccountV3Schema, inspectPaperAccountV3Source, verifyPaperAccountV3Schema } from './paper-account-v3-schema.js';
import {bootstrapPaperAccountV3,verifyPaperAccountV3Bootstrap} from './paper-account-v3-bootstrap.js';

if (!parentPort) throw new Error('PAPER_ACCOUNT_V3_WORKER_PORT_MISSING');
if (typeof workerData?.path !== 'string' || !workerData.path || workerData.path === ':memory:') {
  throw new Error('PAPER_ACCOUNT_V3_FILE_DATABASE_REQUIRED');
}
mkdirSync(dirname(workerData.path), {recursive:true});

function open(): DatabaseSync {
  const db = new DatabaseSync(workerData.path, {timeout:5000});
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  return db;
}
function checkDurability(db: DatabaseSync): void {
  if (db.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'wal' ||
      db.prepare('PRAGMA synchronous').get()?.synchronous !== 2 ||
      db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1 ||
      db.prepare('PRAGMA busy_timeout').get()?.timeout !== 5000) {
    throw new Error('PAPER_ACCOUNT_V3_DURABILITY_UNAVAILABLE');
  }
}

let db: DatabaseSync | undefined;
try {
  db = open();
  const sourceUserVersion = inspectPaperAccountV3Source(db);
  const migration = initializePaperAccountV3Schema(db);
  db.close();
  db = open();
  inspectPaperAccountV3Source(db);
  verifyPaperAccountV3Schema(db);
  checkDurability(db);
  const accountCount = Number(db.prepare('SELECT count(*) AS count FROM pa2_accounts').get()?.count);
  const generationCount = Number(db.prepare('SELECT count(*) AS count FROM pa2_generations').get()?.count);
  const eventCount = Number(db.prepare('SELECT count(*) AS count FROM pa2_events').get()?.count);
  parentPort.postMessage({kind:'ready',status:{sourceUserVersion,migrationSourceUserVersion:migration.sourceUserVersion,
    userVersion:3,schemaSha256:migration.schemaSha256,accountCount,generationCount,eventCount}});
} catch (error) {
  try { db?.close(); } catch {}
  parentPort.postMessage({kind:'fatal',error:error instanceof Error ? error.message : 'PAPER_ACCOUNT_V3_WORKER_FAILED'});
}

parentPort.on('message', (message: {id:number;op:string;input?:{genesisBytes:Uint8Array;operatorAuthorization:string;recordedAtMs:number}}) => {
  if (message.op === 'close') {
    try { db?.close(); db = undefined; parentPort!.postMessage({id:message.id,value:null}); }
    catch (error) { parentPort!.postMessage({id:message.id,error:error instanceof Error ? error.message : 'PAPER_ACCOUNT_V3_CLOSE_FAILED'}); }
    return;
  }
  if (message.op === 'inspect') {
    try {
      if (!db) throw new Error('PAPER_ACCOUNT_V3_CLOSED');
      verifyPaperAccountV3Schema(db); checkDurability(db);
      const value={userVersion:3,accountCount:Number(db.prepare('SELECT count(*) AS count FROM pa2_accounts').get()?.count),
        generationCount:Number(db.prepare('SELECT count(*) AS count FROM pa2_generations').get()?.count),
        eventCount:Number(db.prepare('SELECT count(*) AS count FROM pa2_events').get()?.count)};
      parentPort!.postMessage({id:message.id,value:JSON.stringify(value)});
    } catch (error) { parentPort!.postMessage({id:message.id,error:error instanceof Error ? error.message : 'PAPER_ACCOUNT_V3_INSPECT_FAILED'}); }
    return;
  }
  if (message.op === 'bootstrap') {
    try {
      if (!db||!message.input) throw new Error('PAPER_ACCOUNT_V3_CLOSED');
      const input=message.input;
      const committed=bootstrapPaperAccountV3(db,input.genesisBytes,input.operatorAuthorization,input.recordedAtMs);
      db.close();db=undefined;db=open();
      inspectPaperAccountV3Source(db);verifyPaperAccountV3Schema(db);checkDurability(db);
      const verified=verifyPaperAccountV3Bootstrap(db,input.genesisBytes,input.operatorAuthorization);
      parentPort!.postMessage({id:message.id,value:JSON.stringify({...verified,created:committed.created})});
    } catch (error) {
      if(error&&typeof error==='object'&&(error as {code?:unknown}).code==='PAPER_ACCOUNT_V3_ROLLBACK_FAILED') {
        // Never service inspect/retry against a connection with an unknown transaction outcome.
        try { db?.close(); } catch {}
        db=undefined;
        parentPort!.postMessage({kind:'fatal',error:'PAPER_ACCOUNT_V3_ROLLBACK_FAILED'});
        parentPort!.close();
        return;
      }
      parentPort!.postMessage({id:message.id,error:error instanceof Error ? error.message : 'PAPER_ACCOUNT_V3_BOOTSTRAP_FAILED'});
    }
    return;
  }
  parentPort!.postMessage({id:message.id,error:'PAPER_ACCOUNT_V3_OPERATION_UNSUPPORTED'});
});
