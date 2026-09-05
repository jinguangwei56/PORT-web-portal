import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
const root=path.resolve(import.meta.dirname,'..');
const loader=await fs.readFile(path.join(root,'app-r11-1.html'),'utf8');
const script=loader.match(/<script>([\s\S]*)<\/script>/)[1];
let assembled='';
await vm.runInNewContext(script,{
  console,
  fetch:async p=>({ok:true,text:()=>fs.readFile(path.join(root,p.split('?')[0]),'utf8')}),
  document:{getElementById:()=>({textContent:''}),querySelector:()=>null,open(){},write(html){assembled=html;},close(){}},
});
if(!assembled)throw Error('Loader did not assemble the application');
let scripts=0;
for(const match of assembled.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)){
  new vm.Script(match[1],{filename:'assembled-script-'+(++scripts)});
}
if(!assembled.includes('data-fonkon-module="assets/r11/customer-linkage.js.txt"'))throw Error('Linkage consumer missing from actual loader');
console.log(JSON.stringify({loader:'app-r11-1.html',compiledScripts:scripts,customerLinkageIncluded:true}));
