// The actual planner/client/background/session/parser stack, with only HTTP replaced.
// No university network request is possible in this fixture.
import { DiningSession } from '../extension/lib/dining-session.ts';
import { createMessageHandler } from '../extension/lib/background-bridge.ts';
import { buildDiningRequest } from '../extension/lib/transport.ts';
import { bootstrapFixture } from '../extension/demo.ts';
import { addDays, weekOf, tehranToday } from '../extension/lib/planner-model.ts';
import type { ExtensionApi } from '../extension/lib/types.ts';
import { fake } from './fake.ts';
const current = weekOf(tehranToday());
let cursor = current;
let balance = 2000000;
const reserved = new Set([`20|${addDays(current, 8)}|1|101`]);
const jalali = new Intl.DateTimeFormat('en-u-ca-persian', { year:'numeric',month:'2-digit',day:'2-digit',timeZone:'UTC' });
const jalaliDay = day => { const p=Object.fromEntries(jalali.formatToParts(new Date(day+'T12:00:00Z')).map(part=>[part.type,part.value]));return `${p.year}/${p.month}/${p.day}`; };
const token = (date, food, rest) => `rr0fp10dd${date.replaceAll('-','_')}ppp00-00dt2000_01_01ppp00-00me1dm1fo${food}ftf2000_01_01ppp00-00rest${rest}`;
function menu(rest) {
  let html = `<span id="reserveCredit">${balance}</span><div id="TopDateDiv">${Array.from({length:7},(_,i)=>jalaliDay(addDays(cursor,i))).join(' ')}</div>`;
  for (const copy of ['desktop','phone']) for (let day=0;day<6;day++) for (const food of [101,102]) {
    const date=addDays(cursor,day), key=`${rest}|${date}|1|${food}`, checked=reserved.has(key);
    const id=token(date,food,rest);
    html+=`<div class="reserveFoodFoodDiv"><input type="checkbox" class="reserveFoodCheckBox" id="${id}---${copy}" data-prechecked="${checked}" data-count="0" data-precount="${checked?1:0}" data-food-options="" data-diet-food="diet---${copy}-${day}-${food}"><div><label class="reserveFoodCheckBox" for="${id}">${food===101?'غذای نمونه اول':'غذای نمونه دوم'}<span class="reserveFoodType">${food===101?250000:350000}</span></label></div></div>`;
  }
  return html;
}
const transport = { async request(operation: string, parameters: Record<string, any> = {}) {
  buildDiningRequest(operation,parameters);
  await new Promise(resolve=>setTimeout(resolve,120));
  if(operation==='bootstrap') return {body:bootstrapFixture.replace('2,000,000',String(balance))};
  if(operation==='restaurants') return {body:'[{"id":20,"value":"رستوران نمونه اول · بخش مکمل دانشگاه · سلف دانشجویی و غذاهای متنوع با ظرفیت محدود و پیش‌پرداخت"},{"id":21,"value":"رستوران نمونه دوم"}]'};
  if(operation==='current') cursor=current;
  if(operation==='next') cursor=addDays(cursor,7);
  if(operation==='previous') cursor=addDays(cursor,-7);
  if(operation==='submit') {
    if(!new URLSearchParams(location.search).has('reject')) for(const record of parameters.records) {
      const date=record.match(/dd(\d{4})_(\d{2})_(\d{2})ppp/), food=Number(record.match(/fo(\d+)ftf/)[1]);
      const key=`${parameters.restId}|${date[1]}-${date[2]}-${date[3]}|1|${food}`;
      const desired=record.includes('tfco'), price=food===101?250000:350000;
      if(reserved.has(key)!==desired) balance+=desired?-price:price;
      if(desired) reserved.add(key); else reserved.delete(key);
    }
  }
  return {body:menu(parameters.restId)};
} };
const api: ExtensionApi = { runtime:{id:'loghmeh-test-fixture', sendMessage:null, getURL:path=>`${location.origin}/extension/${path}`,getManifest:()=>({version:'0.6.0-fixture'})},
  permissions:{contains:async()=>true,request:async()=>true},tabs:{create:async()=>{}} };
const session = new DiningSession({transport:fake(transport)});
const handler = createMessageHandler(api,session);
api.runtime.sendMessage = message=>new Promise(resolve=>handler(message,{id:api.runtime.id,url:api.runtime.getURL('planner.html')},(result: any)=>{
  if(result.ok&&message.operation==='connect') result.value.fixture=true;
  resolve(result);
}));
globalThis.browser=api;
document.title='Loghmeh · live API contract fixture';
await import('../extension/planner.mjs');
