import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {guard} from './local.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// This named stack is dedicated to synthetic local tests. No host/SSH input accepted.
execFileSync('docker',['compose','-f',path.join(root,'local-stack/compose.yml'),'up','-d'],{stdio:'inherit'});
const deadline=Date.now()+120000;
let ready=false;
while(Date.now()<deadline){
 try {const r=await fetch('http://localhost:53927/login',{redirect:'manual',signal:AbortSignal.timeout(10000)});if(r.status===200||r.status===302){ready=true;break;}} catch {}
 await new Promise(resolve=>setTimeout(resolve,1000));
}
if(!ready)throw Error('Local app did not become ready; inspect local Docker logs.');
guard();
console.log('Local synthetic app ready. Install baseline or candidate next.');
