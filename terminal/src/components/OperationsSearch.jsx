import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ArrowUpRight, Command, Search, X} from 'lucide-react';
import {Dialog} from '../design-system/primitives.jsx';
import {moveSearchSelection, searchOperations, selectedSearchIndex} from '../operator-search.js';

export function OperationsSearch({open, onDismiss, tokens, current, onNavigate, onInvestigate}) {
  const [query,setQuery]=useState(''),[activeId,setActiveId]=useState(null);
  const input=useRef(null),list=useRef(null);
  const results=useMemo(()=>searchOperations(query,tokens),[query,tokens]);
  const selection=selectedSearchIndex(results,activeId);
  useEffect(()=>{if(open){setQuery('');setActiveId(null);input.current?.focus();}},[open]);
  useEffect(()=>{if(open)setActiveId(results[selection]?.id??null);},[open,results,selection]);
  useEffect(()=>{list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});},[selection,query]);
  function choose(result,event){
    if(!result)return;
    onDismiss();
    if(result.kind==='workspace')onNavigate(result.workspace);
    else onInvestigate(result.token,event);
  }
  function keydown(event){
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();setActiveId(results[moveSearchSelection(selection,event.key==='ArrowDown'?1:-1,results.length)]?.id??null);
    }else if(event.key==='Enter'){
      event.preventDefault();choose(results[selection],event);
    }else if(event.key==='Home'&&event.ctrlKey){event.preventDefault();setActiveId(null);}
    else if(event.key==='End'&&event.ctrlKey){event.preventDefault();setActiveId(results.at(-1)?.id??null);}
  }
  return <Dialog open={open} onDismiss={onDismiss} labelledBy="op-search-title" className="op-dialog op-search-dialog">
    <div className="op-search-title"><Command size={18} aria-hidden="true"/><h2 id="op-search-title">Go anywhere</h2><button type="button" aria-label="Close commands" onClick={onDismiss}><X size={18}/></button></div>
    <label className="op-search-input"><Search size={20} aria-hidden="true"/><span className="op-sr-only">Find a workspace or token</span><input ref={input} autoFocus role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="op-search-results" aria-activedescendant={results.length?`op-search-option-${selection}`:undefined} value={query} placeholder="Search workspaces, symbols or mint addresses…" onChange={event=>{setQuery(event.target.value);setActiveId(null);}} onKeyDown={keydown}/></label>
    <div className="op-search-meta" role="status">{query.trim()?`${results.length} ${results.length===1?'match':'matches'}`:'Workspaces'}<span>{current?'Token results are observations':'Token results may be historical'}</span></div>
    <div ref={list} id="op-search-results" role="listbox" aria-label="Navigation results" className="op-search-results">{results.map((result,index)=><div key={result.id} id={`op-search-option-${index}`} role="option" aria-selected={selection===index} className="op-search-option" onMouseDown={event=>event.preventDefault()} onClick={event=>choose(result,event)}><span className="op-search-kind">{result.kind==='token'?'TK':'WS'}</span><span><strong>{result.label}</strong><small>{result.detail}</small></span><ArrowUpRight size={17} aria-hidden="true"/></div>)}</div>
    {!results.length&&<div className="op-search-empty"><Search size={24} aria-hidden="true"/><h3>No matching destinations</h3><p>Try a workspace name, token symbol or mint address.</p><button type="button" onClick={()=>{setQuery('');setActiveId(null);input.current?.focus();}}>Show all workspaces</button></div>}
    <div className="op-search-footer"><span><kbd>↑</kbd> <kbd>↓</kbd> navigate <kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
  </Dialog>;
}
