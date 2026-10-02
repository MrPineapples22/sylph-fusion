// Owned subprocess fixture only. No environment fault controls in production code.
import {writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../../dist/store.js';
import {openGenerationDatabase, registerInitialGenerationSync} from '../../dist/platform/storage/generation-sqlite.js';

const [mode,path,point,marker] = process.argv.slice(2);
const barrier = observed => {
  if (observed === point) {
    writeFileSync(marker, observed, {flag:'wx'});
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
};
if (mode === 'migration-crash') {
  const {db} = openGenerationDatabase(path, {hook:barrier});
  db.close();
  throw new Error('fault point not reached');
} else if (mode === 'registration-crash') {
  const {db,registrationCapable} = openGenerationDatabase(path);
  registerInitialGenerationSync(db, registrationCapable, JSON.stringify({intentId:'crash-intent',registrationRequestId:'crash-request',intentSha256:'a'.repeat(64)}),barrier);
  db.close();
  throw new Error('fault point not reached');
} else if (mode === 'lock') {
  const db = new DatabaseSync(path,{timeout:5000});
  db.exec('BEGIN IMMEDIATE');
  process.send({kind:'ready'});
  process.once('message',()=>{db.exec('ROLLBACK');db.close();process.disconnect();});
} else {
  const store = new Store(path);
  try {
    await store.load();
    process.send({kind:'ready'});
    process.once('message',async message=>{
      try {
        const result = mode === 'legacy' ? await store.prepareSigningIntent(message.input) : await store.registerInitialGeneration(message.input);
        process.send({kind:'result',ok:true,result});
      } catch(error) {process.send({kind:'result',ok:false,code:error.code,message:error.message});}
      finally {await store.close().catch(()=>{}); process.disconnect();}
    });
  } catch(error) {process.send({kind:'result',ok:false,code:error.code,message:error.message});await store.close().catch(()=>{});process.disconnect();}
}
