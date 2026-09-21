// Bound response-body reads as well as connection time; always release the timer.
export async function readJson(url,signal,timeoutMs=20000){
 const controller=new AbortController();
 const abort=()=>controller.abort(signal.reason);
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(new Error('Request timed out; retrying on the next refresh.')),timeoutMs);
 try{
  const response=await fetch(url,{signal:controller.signal});
  const data=await response.json();
  if(controller.signal.aborted)throw controller.signal.reason;
  if(!response.ok)throw Error(data?.error||`Request failed (${response.status})`);
  return data;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
