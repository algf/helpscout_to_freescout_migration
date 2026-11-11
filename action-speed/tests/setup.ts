import {mkdirSync,writeFileSync} from 'node:fs';
import {verifyVariant} from '../scripts/local.mjs';
export default async function setup(){
 const variant=process.env.BENCH_VARIANT||'candidate';
 if(!['baseline','candidate'].includes(variant))throw Error('BENCH_VARIANT must be baseline or candidate');
 const repeats=Number(process.env.BENCH_REPEATS||1);
 if(!Number.isSafeInteger(repeats)||repeats<1)throw Error('BENCH_REPEATS must be a positive integer');
 const verifiedRuntime=verifyVariant(variant);
 const runId=process.env.BENCH_RUN_ID||`${variant}-${Date.now()}`;
 process.env.BENCH_RUN_ID=runId;
 const expected=[];
 for(let repeat=0;repeat<repeats;repeat++)for(const project of ['desktop','mobile'])for(const mailbox of [1,2,3])for(const scenario of ['close-only','unsubscribe-pending','unsubscribe-rejected','unsubscribe-uncertain',...(project==='desktop'?['unsubscribe-only']:[])])expected.push({project,mailbox,scenario,repeat});
 mkdirSync('results',{recursive:true});
 writeFileSync(`results/${variant}-manifest.json`,JSON.stringify({runId,variant,repeats,startedAt:new Date().toISOString(),verifiedRuntime,expected},null,2));
}
