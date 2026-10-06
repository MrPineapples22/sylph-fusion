import { Worker } from 'node:worker_threads';
import {canonicalSylphJcs1Snapshot} from './paper-account-v3-codec.js';
import type {PaperAccountV3BootstrapResult} from './paper-account-v3-bootstrap.js';

export interface PaperAccountV3SchemaStatus {
  readonly userVersion:3;
  readonly sourceUserVersion:number;
  readonly migrationSourceUserVersion:number;
  readonly schemaSha256:string;
  readonly accountCount:number;
  readonly generationCount:number;
  readonly eventCount:number;
}
export interface PaperAccountV3Inspection {
  readonly userVersion:3;
  readonly accountCount:number;
  readonly generationCount:number;
  readonly eventCount:number;
}
type Pending = {resolve:(value:string|null)=>void;reject:(error:Error)=>void};

/**
 * Isolated schema/migration store with one explicit bootstrap-only operation.
 * It cannot append later events, acquire a lease, activate, admit, or recover an account.
 */
export class PaperAccountV3BootstrapStore {
  private readonly worker:Worker;
  private sequence=0;
  private closed=false;
  private failure:Error|null=null;
  private readyResolve!:(status:PaperAccountV3SchemaStatus)=>void;
  private readyReject!:(error:Error)=>void;
  private readonly readyPromise:Promise<PaperAccountV3SchemaStatus>;
  private readonly calls=new Map<number,Pending>();
  private closePromise:Promise<void>|null=null;

  constructor(path:string) {
    if(typeof path!=='string'||!path||path===':memory:') throw new Error('PAPER_ACCOUNT_V3_FILE_DATABASE_REQUIRED');
    this.readyPromise=new Promise((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;});
    this.worker=new Worker(new URL('./paper-account-v3-worker.js',import.meta.url),{workerData:{path}});
    this.worker.on('message',(message:{kind?:string;status?:PaperAccountV3SchemaStatus;error?:string;id?:number;value?:string|null})=>{
      if(message.kind==='ready') { this.readyResolve(message.status!); return; }
      if(message.kind==='fatal') { const error=new Error(message.error??'PAPER_ACCOUNT_V3_WORKER_FAILED'); this.fail(error); return; }
      if(typeof message.id!=='number') return;
      const call=this.calls.get(message.id); if(!call) return; this.calls.delete(message.id);
      if(message.error) call.reject(new Error(message.error)); else call.resolve(message.value??null);
    });
    this.worker.on('error',error=>this.fail(error));
    this.worker.on('exit',code=>{if(!this.closed&&code!==0)this.fail(new Error('PAPER_ACCOUNT_V3_WORKER_EXITED'));});
  }

  private fail(error:Error):void {
    this.failure??=error; this.readyReject(this.failure);
    for(const pending of this.calls.values()) pending.reject(this.failure);
    this.calls.clear();
  }
  private call(op:string,input?:unknown):Promise<string|null> {
    if(this.closed||this.failure) return Promise.reject(this.failure??new Error('PAPER_ACCOUNT_V3_CLOSED'));
    return new Promise((resolve,reject)=>{
      const id=++this.sequence; this.calls.set(id,{resolve,reject});
      try { this.worker.postMessage({id,op,input}); } catch(error) { this.calls.delete(id); reject(error instanceof Error?error:new Error('PAPER_ACCOUNT_V3_WORKER_FAILED')); }
    });
  }
  ready():Promise<PaperAccountV3SchemaStatus> { return this.readyPromise; }
  async inspect():Promise<PaperAccountV3Inspection> {
    await this.readyPromise;
    return JSON.parse((await this.call('inspect'))!) as PaperAccountV3Inspection;
  }
  /**
   * Records the supplied operator identity; it does not authenticate credentials or activate/admit the account.
   * A production caller must already hold the same-host startup OS process lock. SQLite's immediate transaction
   * serializes database writers and makes exact retries safe, but does not implement or replace that lifecycle lock.
   */
  async bootstrap(genesisBytes:Uint8Array,operatorAuthorization:string,recordedAtMs:number):Promise<PaperAccountV3BootstrapResult> {
    await this.readyPromise;
    if(typeof operatorAuthorization!=='string'||operatorAuthorization.length===0)throw new Error('PAPER_ACCOUNT_V3_BOOTSTRAP_AUTHORIZATION_IDENTITY_INVALID');
    if(typeof recordedAtMs!=='number'||!Number.isSafeInteger(recordedAtMs)||recordedAtMs<0||recordedAtMs>=Number.MAX_SAFE_INTEGER)
      throw new Error('PAPER_ACCOUNT_V3_BOOTSTRAP_RECORDED_TIME_INVALID');
    const stable=canonicalSylphJcs1Snapshot(genesisBytes);
    return JSON.parse((await this.call('bootstrap',{genesisBytes:stable.bytes,operatorAuthorization,recordedAtMs}))!) as PaperAccountV3BootstrapResult;
  }
  async close():Promise<void> {
    if(this.closePromise) return this.closePromise;
    this.closed=true;
    if(this.failure) { this.closePromise=this.worker.terminate().then(()=>undefined); return this.closePromise; }
    this.closePromise=new Promise<void>((resolve,reject)=>{
      const id=++this.sequence; this.calls.set(id,{resolve:()=>resolve(),reject});
      try { this.worker.postMessage({id,op:'close'}); } catch(error) { this.calls.delete(id); reject(error); }
    }).finally(async()=>{await this.worker.terminate();});
    return this.closePromise;
  }
}
