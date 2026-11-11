import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {guard,php,reset,verifyVariant} from './local.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
verifyVariant('candidate');
const container=guard();
function run(args){return execFileSync('docker',args,{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024}).trim();}
run(['exec',container,'mkdir','-p','/tmp/action-speed/checks/tests','/tmp/action-speed/checks/src']);
run(['cp',path.join(root,'src')+'/.',container+':/tmp/action-speed/checks/src']);
for(const file of ['status-controller.php','counter-middleware.php']){
 run(['cp',path.join(root,'tests',file),container+':/tmp/action-speed/checks/tests/'+file]);
 console.log(run(['exec','-u','nginx',container,'php','/tmp/action-speed/checks/tests/'+file]));
}
for(const file of ['/data/Modules/UnSub/Http/Controllers/UnsubscribeController.php','/data/Modules/InboxSpeed/Middleware.php','/tmp/action-speed/lifecycle.php','/tmp/action-speed/reset-fixture.php','/tmp/action-speed/close-delay.php','/tmp/action-speed/transport.php'])console.log(run(['exec',container,'php','-l',file]));
reset();
console.log(php(readFileSync(path.join(root,'tests/status-app.php'),'utf8').replace(/^<\?php\s*/,'')));
// Existing module integration harness uses a fake transport and rolls back its records.
console.log(run(['exec','-u','nginx','-w','/www/html',container,'php','/data/Modules/UnSub/Tests/unsubscribe-integration.php']));
