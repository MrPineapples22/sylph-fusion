import { useRef,useEffect } from 'react';
export function useRenderCounter(name){const n=useRef(0);n.current++;useEffect(()=>{globalThis.__RENDER_COUNTS__=globalThis.__RENDER_COUNTS__||{};globalThis.__RENDER_COUNTS__[name]=n.current});return n.current}
