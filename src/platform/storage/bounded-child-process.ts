import {spawn, type SpawnOptions} from 'node:child_process';

export interface BoundedChildProcessOptions {
  readonly timeoutMs:number;
  readonly maxOutputBytes:number;
  readonly windowsHide?:boolean;
  readonly env?:NodeJS.ProcessEnv;
}
export interface BoundedChildProcessResult {readonly stdout:string;readonly stderr:string;readonly exitCode:number}

/** Runs one fixed executable without a shell; timeout termination covers only this direct child, not a process tree. */
export function runBoundedChildProcess(file:string,args:readonly string[],options:BoundedChildProcessOptions):Promise<BoundedChildProcessResult> {
  if(!file||!Array.isArray(args)||args.some(value=>typeof value!=='string')||!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<1||
     !Number.isSafeInteger(options.maxOutputBytes)||options.maxOutputBytes<1)
    return Promise.reject(new Error('BOUNDED_CHILD_ARGUMENT_INVALID'));
  return new Promise((resolve,reject)=>{
    let child;
    try {
      const spawnOptions:SpawnOptions={shell:false,windowsHide:options.windowsHide??true,stdio:['ignore','pipe','pipe'],env:options.env};
      child=spawn(file,[...args],spawnOptions);
    } catch {reject(new Error('BOUNDED_CHILD_SPAWN_FAILED'));return;}
    let stdoutBytes=0;let stderrBytes=0;let totalBytes=0;let failureCode:string|null=null;let finished=false;
    const stdout:Buffer[]=[];const stderr:Buffer[]=[];
    let timeout:NodeJS.Timeout|undefined;let killDeadline:NodeJS.Timeout|undefined;
    const finishError=(code:string)=>{if(finished)return;finished=true;clearTimeout(timeout);clearTimeout(killDeadline);reject(new Error(code));};
    const terminate=(code:string)=>{
      if(failureCode===null)failureCode=code;
      try {child.kill('SIGKILL');} catch {}
      if(killDeadline===undefined)killDeadline=setTimeout(()=>finishError('BOUNDED_CHILD_TERMINATION_UNCONFIRMED'),1500);
    };
    timeout=setTimeout(()=>terminate('BOUNDED_CHILD_TIMEOUT'),options.timeoutMs);
    timeout.unref?.();
    child.stdout?.on('data',(chunk:Buffer|string)=>{
      const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);stdoutBytes+=bytes.length;totalBytes+=bytes.length;
      if(totalBytes>options.maxOutputBytes)terminate('BOUNDED_CHILD_OUTPUT_LIMIT');
      else stdout.push(bytes);
    });
    child.stderr?.on('data',(chunk:Buffer|string)=>{
      const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);stderrBytes+=bytes.length;totalBytes+=bytes.length;
      if(totalBytes>options.maxOutputBytes)terminate('BOUNDED_CHILD_OUTPUT_LIMIT');
      else stderr.push(bytes);
    });
    child.once('error',()=>finishError('BOUNDED_CHILD_SPAWN_FAILED'));
    child.once('close',(code:number|null)=>{
      if(finished)return;
      finished=true;clearTimeout(timeout);clearTimeout(killDeadline);
      if(failureCode!==null){reject(new Error(failureCode));return;}
      if(code!==0){reject(new Error('BOUNDED_CHILD_EXIT_NONZERO'));return;}
      resolve({stdout:Buffer.concat(stdout,stdoutBytes).toString('utf8'),stderr:Buffer.concat(stderr,stderrBytes).toString('utf8'),exitCode:code});
    });
  });
}
