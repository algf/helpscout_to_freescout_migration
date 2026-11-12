import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {guard,docker,copy,root} from './local.mjs';
const [action,run,scenario='standard']=process.argv.slice(2);
if(!['standard','folders'].includes(scenario))throw Error('Invalid fixture scenario');
if(!/^[a-z0-9-]{8,40}$/.test(run||''))throw Error('Unique synthetic run ID required');
const dir=`/tmp/mail-arrival-${run}`, state=path.join(root,'results',`${run}-provider.json`);
const result=path.join(root,'results',`${run}-provider-receipt.json`);
if(action==='start') {
 guard();mkdirSync(path.dirname(state),{recursive:true});
 execFileSync('python3',[path.join(root,'fixtures/make_state.py'),state,'--run',run,'--scenario',scenario],{stdio:'pipe'});
 docker(['exec',guard(),'mkdir','-m','700',dir]);
 docker(['exec',guard(),'chown','nginx:www-data',dir]);
 copy(path.join(root,'harness/imap_fixture.py'),`${dir}/server.py`);copy(path.join(root,'harness/inject.py'),`${dir}/inject.py`);copy(path.join(root,'harness/control.py'),`${dir}/control.py`);copy(path.join(root,'fixtures/make_state.py'),`${dir}/make_state.py`);copy(state,`${dir}/state.json`);
 docker(['exec',guard(),'chown','nginx:www-data',`${dir}/state.json`,`${dir}/server.py`,`${dir}/inject.py`,`${dir}/control.py`,`${dir}/make_state.py`]);
 docker(['exec','-d','-u','nginx',guard(),'sh','-c',`python3 ${dir}/server.py --state ${dir}/state.json --port 11430 --events ${dir}/events.jsonl > ${dir}/server.log 2>&1 & echo $! > ${dir}/pid`]);
 const pid=Number(docker(['exec',guard(),'cat',`${dir}/pid`]));if(!Number.isSafeInteger(pid)||pid<2)throw Error('Invalid fixture PID');
 docker(['exec',guard(),'python3','-c',`import pathlib,socket,time,sys
pid=int(sys.argv[1]); expected=sys.argv[2]; log=pathlib.Path(sys.argv[3])
for _ in range(50):
 try:
  command=pathlib.Path('/proc/%d/cmdline'%pid).read_bytes().replace(b'\\0',b' ').decode()
  if expected in command and log.exists() and 'fixture IMAP bound' in log.read_text():
   s=socket.create_connection(('127.0.0.1',11430),timeout=1); s.close(); break
 except (OSError,ValueError): pass
 time.sleep(.1)
else: raise SystemExit('fixture failed to bind')`,String(pid),`${dir}/server.py`,`${dir}/server.log`]);
 writeFileSync(result,JSON.stringify({run,container:guard(),pid,dir,host:'127.0.0.1',port:11430,state},null,2),{mode:0o600});
 console.log(JSON.stringify({run,container:guard(),pid,dir,host:'127.0.0.1',port:11430}));
} else if(action==='stop') {
 const receipt=JSON.parse(readFileSync(result,'utf8'));if(receipt.container!==guard()||receipt.dir!==dir||!Number.isSafeInteger(receipt.pid))throw Error('Fixture receipt mismatch');
 const command=docker(['exec',guard(),'sh','-c',`tr '\\0' ' ' < /proc/${receipt.pid}/cmdline`]);
 if(!command.includes(`${dir}/server.py`))throw Error('PID does not belong to this fixture');
 // Preserve the synthetic provider's current state and transcript before stopping it.
 for(const [source,suffix] of [['state.json','state-final.json'],['events.jsonl','events.jsonl'],['server.log','server.log']]) {
  const data=docker(['exec',guard(),'sh','-c',`if [ -f ${dir}/${source} ]; then cat ${dir}/${source}; fi`]);
  writeFileSync(path.join(root,'results',`${run}-${suffix}`),data+(data?'\n':''),{mode:0o600});
 }
 docker(['exec',guard(),'kill',String(receipt.pid)]);receipt.stoppedAt=new Date().toISOString();writeFileSync(result,JSON.stringify(receipt,null,2),{mode:0o600});console.log(JSON.stringify({run,stopped:receipt.pid}));
} else throw Error('Use start|stop RUN_ID');
