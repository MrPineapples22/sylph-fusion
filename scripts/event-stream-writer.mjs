import { appendFileSync, mkdirSync } from 'node:fs'; import { dirname } from 'node:path';
export function createEventStreamWriter(path){mkdirSync(dirname(path),{recursive:true});return event=>{if(!event||typeof event!=='object')return false;appendFileSync(path,JSON.stringify(event,(_,v)=>typeof v==='bigint'?v.toString():v)+'\n','utf8');return true}}

