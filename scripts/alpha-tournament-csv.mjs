import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { evaluate } from './alpha-tournament.mjs';

const fields = ['strategy','split','eventId','timestamp','entryValue','exitValue','networkFee','priorityFee','tip','priceImpact','otherCosts','baselinePnl'];
function parseCsv(text) {
  const rows=[]; let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
    else if(c==='"'){if(cell)throw Error('BAD_QUOTE');quoted=true;}
    else if(c===','){row.push(cell);cell='';}
    else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw Error('UNCLOSED_QUOTE');
  if(cell.length||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
  return rows.filter(r=>r.some(x=>x.trim()));
}
export function convertCsv(text) {
  const rows=parseCsv(text);
  if(rows.length<2)throw Error('NO_DATA');
  const header=rows.shift().map(x=>x.trim());
  if(new Set(header).size!==header.length || header.length!==fields.length || fields.some(f=>!header.includes(f)))throw Error('INVALID_COLUMNS');
  return rows.map((r,i)=>{
    if(r.length!==header.length)throw Error('INVALID_COLUMN_COUNT_ROW_'+(i+2));
    const x=Object.fromEntries(header.map((h,j)=>[h,r[j]]));
    for(const f of fields.slice(4)){if(!x[f].trim())throw Error('MISSING_'+f+'_ROW_'+(i+2));x[f]=Number(x[f]);}
    return x;
  });
}
export function runCsvTournament(text,opts){
  const rows=convertCsv(text);
  return evaluate(rows,opts);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [input,output]=process.argv.slice(2);
  if(!input||!output){console.error('Usage: node scripts/alpha-tournament-csv.mjs normalized-trades.csv report.json');process.exit(2);}
  try{
    const raw=readFileSync(input);
    const result=runCsvTournament(raw.toString('utf8'));
    result.inputSha256=createHash('sha256').update(raw).digest('hex');
    result.inputRows=convertCsv(raw.toString('utf8')).length;
    writeFileSync(output,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({output,inputRows:result.inputRows,certification:result.certification}));
  }catch(e){console.error('ALPHA_CSV_BLOCKED:',e.message);process.exitCode=1;}
}
