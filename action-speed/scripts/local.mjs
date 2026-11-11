import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import traceReader from './trace-reader.cjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const BASE='http://localhost:53927';
const name='freescout-ui-local-app-1';
let container;
function run(args,input){return execFileSync('docker',args,{encoding:'utf8',input,timeout:120000,maxBuffer:8*1024*1024}).trim();}
export function guard(){
 if(container)return container;
 const c=JSON.parse(run(['inspect',name,'--format','{{json .}}']));
 if(c.Config.Labels['com.docker.compose.project']!=='freescout-ui-local'||!c.State.Running)throw Error('Local synthetic stack must be running');
 const nets=Object.keys(c.NetworkSettings.Networks);
 if(nets.length!==1||nets[0]!=='freescout-ui-local_isolated')throw Error('App must only use the isolated local network');
 const network=JSON.parse(run(['network','inspect',nets[0]]))[0];
 if(!network.Internal)throw Error('Local app network must deny external traffic');
 container=c.Id;
 const url=php("echo config('app.url');");
 if(url!==BASE){container=undefined;throw Error('Unexpected app URL');}
 return container;
}
export function php(code){
 const id=container||guard();
 return run(['exec','-i','-u','nginx',id,'sh','-c','action_php_path=$(mktemp /tmp/action-speed-php.XXXXXX) && trap \'rm -f "$action_php_path"\' EXIT && cat > "$action_php_path" && php "$action_php_path"'],`<?php chdir('/www/html');require 'vendor/autoload.php';$app=require 'bootstrap/app.php';$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();\n${code}`);
}
function copy(file,dest){run(['cp',file,`${guard()}:${dest}`]);}
export function configure(options={}){
 const control={delayMs:10000,outcome:'accepted',closeDelayMs:0,closeDelayIds:[],...options};
 if(!Number.isInteger(control.closeDelayMs)||control.closeDelayMs<0||control.closeDelayMs>10000||!Array.isArray(control.closeDelayIds)||control.closeDelayIds.length>50||control.closeDelayIds.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error('Invalid close delay fixture');
 if(!Number.isFinite(control.delayMs)||control.delayMs<0||control.delayMs>30000||!['accepted','rejected','uncertain'].includes(control.outcome))throw Error('Invalid fake transport settings');
 run(['exec','-i','-u','nginx',guard(),'sh','-c','cat > /tmp/action-speed/control.json'],JSON.stringify(control));
 return control;
}
export function readTrace(){guard();return traceReader.readJsonLines(BASE+'/action-speed-trace.jsonl');}
export function readCloseTrace(){guard();return traceReader.readJsonLines(BASE+'/action-speed-close-trace.jsonl');}
export function reset(options={}){
 guard();
 const encoded=Buffer.from(JSON.stringify(options)).toString('base64');
 return JSON.parse(php(`$options=json_decode(base64_decode('${encoded}'),true);require '/tmp/action-speed/reset-fixture.php';`));
}
export function inspect(){
 const conversations=JSON.parse(php(`$rows=[];foreach(App\\Conversation::where('subject','like','Action speed fixture:%')->get() as $c){$rows[]=['id'=>$c->id,'mailbox_id'=>$c->mailbox_id,'status'=>$c->status,'accepted'=>(bool)$c->getMeta('unsub.accepted',[]),'activityCount'=>$c->threads()->where('action_type',167)->count(),'closeActivityCount'=>$c->threads()->where('type',4)->where('action_type',1)->where('status',3)->count()];}echo json_encode($rows);`));
 return {conversations,transport:readTrace()};
}
export function install(variant='candidate'){
 if(!['baseline','candidate'].includes(variant))throw Error('Unknown variant');
 guard();
 const out=path.join(root,'.local');mkdirSync(out,{recursive:true});
 run(['exec',guard(),'mkdir','-p','/tmp/action-speed']);
 run(['exec',guard(),'chown','nginx','/tmp/action-speed']);
 copy(path.join(root,'fixtures/transport.php'),'/tmp/action-speed/transport.php');
 copy(path.join(root,'fixtures/close-delay.php'),'/tmp/action-speed/close-delay.php');
 copy(path.join(root,'fixtures/lifecycle.php'),'/tmp/action-speed/lifecycle.php');
 copy(path.join(root,'fixtures/records.php'),'/tmp/action-speed/records.php');
 copy(path.join(root,'scripts/reset-fixture.php'),'/tmp/action-speed/reset-fixture.php');
 run(['exec','-u','nginx',guard(),'touch','/tmp/action-speed/lifecycle.lock']);
 // Nginx caches static file sizes for two minutes. Never cache the changing test trace.
 const vhost='/etc/nginx/sites.available/freescout.conf';
 let config=run(['exec',guard(),'cat',vhost]);
 if(!config.includes('location = /action-speed-trace.jsonl')){
  const patched=config.replace('server {','server {\n  location = /action-speed-trace.jsonl { open_file_cache off; add_header Cache-Control "no-store"; try_files $uri =404; }');
  if(patched===config)throw Error('Local nginx server block not found');
  run(['exec','-i',guard(),'sh','-c','cat > /etc/nginx/sites.available/freescout.conf'],patched);
  run(['exec',guard(),'nginx','-t']);
  run(['exec',guard(),'nginx','-s','reload']);
 }
 config=run(['exec',guard(),'cat',vhost]);
 if(!config.includes('location = /action-speed-close-trace.jsonl')){
  run(['exec','-i',guard(),'sh','-c','cat > /etc/nginx/sites.available/freescout.conf'],config.replace('server {','server {\n  location = /action-speed-close-trace.jsonl { open_file_cache off; add_header Cache-Control \"no-store\"; try_files $uri =404; }'));
  run(['exec',guard(),'nginx','-t']);run(['exec',guard(),'nginx','-s','reload']);
 }

 const start=run(['exec',guard(),'cat','/data/Modules/StagingLogin/start.php']);
 const clean=start.replace(/\n\/\/ ACTION SPEED LOCAL FIXTURE[\s\S]*$/,'');
 writeFileSync(path.join(out,'staging-start.original.php'),clean+'\n');
 const injected=clean+"\n// ACTION SPEED LOCAL FIXTURE\nif ((string)config('app.url') === 'http://localhost:53927' && is_file('/tmp/action-speed/lifecycle.php')) require_once '/tmp/action-speed/lifecycle.php';\nif ((string)config('app.url') === 'http://localhost:53927' && is_file('/tmp/action-speed/transport.php')) require_once '/tmp/action-speed/transport.php';\nif ((string)config('app.url') === 'http://localhost:53927' && is_file('/tmp/action-speed/close-delay.php')) require_once '/tmp/action-speed/close-delay.php';\n";
 run(['exec','-i',guard(),'sh','-c','cat > /data/Modules/StagingLogin/start.php'],injected);
 for(const [relative,base,dest] of [
  ['CrockdHelpScoutFolders/quick-close.js','quick-close.js','CrockdHelpScoutFolders/quick-close.js'],
  ['UnSub/Resources/assets/unsub.js','unsub.js','UnSub/Resources/assets/unsub.js'],
  ['UnSub/Http/Controllers/UnsubscribeController.php','UnsubscribeController.php','UnSub/Http/Controllers/UnsubscribeController.php'],
  ['InboxShortcuts/Resources/assets/inbox-shortcuts.js','inbox-shortcuts.js','InboxShortcuts/Resources/assets/inbox-shortcuts.js'],
  ['InboxSpeed/Middleware.php','Middleware.php','InboxSpeed/Middleware.php']]){
  copy(path.join(root,variant==='baseline'?'baseline/'+base:'src/'+relative),'/data/Modules/'+dest);
 }
 run(['exec','-u','nginx',guard(),'sh','-c','cd /www/html && php artisan freescout:clear-cache']);
 configure();
 run(['exec',guard(),'touch','/www/html/public/action-speed-trace.jsonl','/www/html/public/action-speed-close-trace.jsonl']);
 run(['exec',guard(),'chown','nginx','/www/html/public/action-speed-trace.jsonl','/www/html/public/action-speed-close-trace.jsonl']);
 run(['exec','-u','nginx',guard(),'touch','/tmp/action-speed/transport.jsonl','/tmp/action-speed/close.jsonl']);
 return {variant,baseURL:BASE};
}

export function verifyVariant(variant='candidate') {
 if(!['baseline','candidate'].includes(variant))throw Error('Invalid benchmark variant');
 const files=[['CrockdHelpScoutFolders/quick-close.js','quick-close.js'],['UnSub/Resources/assets/unsub.js','unsub.js'],['UnSub/Http/Controllers/UnsubscribeController.php','UnsubscribeController.php'],['InboxShortcuts/Resources/assets/inbox-shortcuts.js','inbox-shortcuts.js'],['InboxSpeed/Middleware.php','Middleware.php']];
 const evidence={variant,baseURL:BASE,container:guard(),files:{}};
 for(const [relative,baseline] of files){
  const expected=createHash('sha256').update(readFileSync(path.join(root,variant==='baseline'?'baseline/'+baseline:'src/'+relative))).digest('hex');
  const observed=run(['exec',guard(),'sha256sum','/data/Modules/'+relative]).split(/\s+/)[0];
  if(observed!==expected)throw Error(`Installed source mismatch for ${relative}. Run local.mjs install ${variant}`);
  evidence.files[relative]=observed;
 }
 return evidence;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [command,arg]=process.argv.slice(2);
 if(command==='install')console.log(JSON.stringify(install(arg)));
 else if(command==='reset')console.log(JSON.stringify(reset(arg&&arg!=='--json'?JSON.parse(arg):{})));
 else if(command==='verify')console.log(JSON.stringify(verifyVariant(arg)));
 else if(command==='inspect')console.log(JSON.stringify(inspect()));
 else if(command==='trace')console.log(JSON.stringify(readTrace()));
 else if(command==='configure')console.log(JSON.stringify(configure(JSON.parse(arg||'{}'))));
 else throw Error('Use install baseline|candidate, reset [JSON], inspect, trace, configure JSON');
}
