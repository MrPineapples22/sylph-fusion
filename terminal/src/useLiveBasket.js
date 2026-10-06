import {readJson} from './read-json.js';
import {mapLiveObservations} from './live-observations.js';
import {useEffect,useState} from 'react';
export function useLiveBasket(){
 const [state,setState]=useState({assets:[],error:'',at:0});
 useEffect(()=>{let stopped=false,timer;const controller=new AbortController();const histories=new Map();
 async function poll(){try{const data=await readJson('/live/api/market',controller.signal);const assets=mapLiveObservations(data.tokens,histories);
 const ids=new Set(assets.map(a=>a.id));for(const id of histories.keys())if(!ids.has(id))histories.delete(id);
 if(!stopped)setState({assets,error:'',at:Date.now()});
 }catch(e){if(!stopped)setState(s=>({...s,error:e.message || 'Failed to load data'}));}finally{if(!stopped)timer=setTimeout(poll,2000);}}
 poll();return()=>{stopped=true;controller.abort();clearTimeout(timer);};},[]);return state;
}
