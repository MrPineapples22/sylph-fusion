import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const dependency=require.resolve('@tailwindcss/node',{paths:[dirname(require.resolve('@tailwindcss/vite'))]});
const {compile}=await import(pathToFileURL(dependency));
const compiler=await compile(readFileSync('src/style.css','utf8')+'\n'+readFileSync('src/cockpit.css','utf8'),{base:resolve('src'),onDependency:()=>{}});
// Classes outside the design-system stylesheet; Vite scans automatically in dev.
const oxide=require(require.resolve('@tailwindcss/oxide',{paths:[dirname(require.resolve('@tailwindcss/vite'))]}));
const scanner=new oxide.Scanner({sources:[{base:resolve('src'),pattern:'**/*.{js,jsx}',negated:false}]});
writeFileSync('dist/assets/app.css',compiler.build(scanner.scan()));
const t=Date.now();
writeFileSync('dist/index.html',readFileSync('index.html','utf8').replace('/src/main.jsx',`/assets/app.js?t=${t}`).replace('</head>',`<link rel="stylesheet" href="/assets/app.css?t=${t}"/></head>`));
console.log('Tailwind styles and production entry built.');
copyFileSync('public/sylph-fusion.svg','dist/sylph-fusion.svg');
