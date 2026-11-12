import {defineConfig} from '@playwright/test';
const run=process.env.MAIL_ARRIVAL_UI_RUN||new Date().toISOString().replace(/[:.]/g,'-');
const output=new URL('../../results/frontend-'+run+'/',import.meta.url).pathname;
export default defineConfig({
 testDir:'.',testMatch:'inbox-refresh.spec.ts',fullyParallel:false,workers:1,timeout:90000,
 expect:{timeout:15000}, use:{actionTimeout:8000,navigationTimeout:60000,baseURL:'http://localhost:53927',viewport:{width:Number(process.env.MAIL_ARRIVAL_UI_WIDTH||1440),height:Number(process.env.MAIL_ARRIVAL_UI_WIDTH||1440)<600?844:900},headless:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
 outputDir:output,reporter:[['list'],['json',{outputFile:output+'report.json'}]]
});
