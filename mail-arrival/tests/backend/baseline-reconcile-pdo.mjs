import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {guard, php, root} from '../../scripts/local.mjs';
guard();
const files=['cutover-seed.php','cutover-pdo-store.php','baseline-reconcile.php','baseline-reconcile-pdo-store.php'];
const literal=text=>`base64_decode('${Buffer.from(text).toString('base64')}')`;
const code=files.map(name=>{
 const source=readFileSync(path.join(root,'harness',name),'utf8').replace(/^<\?php\s*/,'');
 return `eval(${literal(source)});`;
}).join('\n');
const test=readFileSync(path.join(root,'harness/baseline-reconcile-pdo-test.php'),'utf8').replace(/^<\?php\s*/,'');
const log=php(code+'\n'+test);
writeFileSync(path.join(root,'tests/backend/results/baseline-reconcile-pdo.log'),log+'\n');
console.log(log);
