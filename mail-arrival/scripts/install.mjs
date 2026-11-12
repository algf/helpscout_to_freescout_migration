import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,statSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {root,guard,docker,php,copy,backup} from './local.mjs';
const id=guard();
if(!existsSync(path.join(root,'results/backup-path.txt')))backup();
const source=path.join(root,'src/Modules/MailArrival');
function files(dir,prefix=''){return readdirSync(dir).flatMap(name=>statSync(path.join(dir,name)).isDirectory()?files(path.join(dir,name),prefix+name+'/'):[prefix+name]);}
const hashes={};
for(const relative of files(source)){
 const data=readFileSync(path.join(source,relative));
 if(relative.endsWith('.php'))docker(['exec','-i',id,'php','-l'],data);
 hashes[relative]=createHash('sha256').update(data).digest('hex');
}
copy(source,'/data/Modules/');
docker(['exec',id,'chown','-R','nginx:www-data','/data/Modules/MailArrival']);
console.log(php("$m=App\\Module::getByAliasOrCreate('mailarrival');$m->active=1;$m->activated=1;$m->save();App\\Module::clearModulesCache();\\Module::clearCache();echo 'Local MailArrival enabled';"));
console.log(php("require_once '/data/Modules/MailArrival/bootstrap.php';\\Modules\\MailArrival\\Installer::install();echo 'Local schema installed';"));
for(const [relative,hash] of Object.entries(hashes)){
 const actual=docker(['exec',id,'sha256sum','/data/Modules/MailArrival/'+relative]).split(/\s+/)[0];
 if(actual!==hash)throw Error('Installed source mismatch '+relative);
}
mkdirSync(path.join(root,'results'),{recursive:true});
writeFileSync(path.join(root,'results/installed.json'),JSON.stringify({at:new Date().toISOString(),base:'http://localhost:53927',container:id,hashes},null,2));
