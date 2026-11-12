import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync,readFileSync,existsSync,openSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const BASE='http://localhost:53927';
export const APP='freescout-ui-local-app-1';
export function docker(args,input){return execFileSync('docker',args,{encoding:'utf8',input,timeout:120000,maxBuffer:16*1024*1024}).trim();}
let checked;
export function guard(){
 if(checked)return checked;
 if(process.env.FS_BASE && process.env.FS_BASE!==BASE)throw Error('Only isolated local URL allowed');
 const c=JSON.parse(docker(['inspect',APP,'--format','{{json .}}']));
 if(!c.State.Running||c.Config.Labels['com.docker.compose.project']!=='freescout-ui-local')throw Error('Wrong app');
 const networks=Object.keys(c.NetworkSettings.Networks);
 if(networks.length!==1||networks[0]!=='freescout-ui-local_isolated')throw Error('App must use only isolated network');
 if(!JSON.parse(docker(['network','inspect',networks[0]]))[0].Internal)throw Error('External networking must be denied');
 checked=c.Id;
 const config=JSON.parse(php("echo json_encode(['url'=>config('app.url'),'prepare'=>(bool)config('inbox_navigation.prepare_enabled',false)]);"));
 if(config.url!==BASE||config.prepare){checked=null;throw Error('Unexpected app URL or preparation enabled');}
 return checked;
}
export function php(code){return docker(['exec','-i','-u','nginx','-w','/www/html',checked||guard(),'php'],`<?php require 'vendor/autoload.php';$app=require 'bootstrap/app.php';$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();\n${code}`);}
export function copy(source,target){docker(['cp',source,`${guard()}:${target}`]);}
export function backup(){
 guard(); const dir=path.join(root,'results','before-'+new Date().toISOString().replaceAll(/[:.]/g,'-'));mkdirSync(dir,{recursive:true});
 const fd=openSync(path.join(dir,'database.sql'),'wx',0o600);
 try{execFileSync('docker',['exec','freescout-ui-local-db-1','sh','-c','exec mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines --triggers freescout'],{stdio:['ignore',fd,'pipe'],timeout:120000});}finally{closeSync(fd);}
 const tf=openSync(path.join(dir,'app-data.tgz'),'wx',0o600);
 try{execFileSync('docker',['exec',guard(),'tar','czf','-','-C','/data','Modules','storage'],{stdio:['ignore',tf,'pipe'],timeout:120000});}finally{closeSync(tf);}
 const hashes={};for(const name of ['database.sql','app-data.tgz'])hashes[name]=createHash('sha256').update(readFileSync(path.join(dir,name))).digest('hex');
 writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({at:new Date().toISOString(),container:guard(),hashes},null,2));
 writeFileSync(path.join(root,'results','backup-path.txt'),dir+'\n');return dir;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){if(process.argv[2]==='backup')console.log(backup());else console.log(guard());}
