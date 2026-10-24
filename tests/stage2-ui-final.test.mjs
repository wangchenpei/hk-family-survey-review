// UI-only synthetic test. The local HTTP server replaces the cloud adapter;
// no Firebase connection, real account or customer data is used.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fields} from '../local-tool/bundled.mjs';
import {exportCSV} from '../local-tool/csv.mjs';
import {customerKey} from '../local-tool/customer-model.mjs';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../local-tool/',import.meta.url);
const mock=`export async function createCloudStore(){
 const t=window.testStore={calls:[],fail:[],clients:[],pages:[]};
 return {watch(cb){cb({uid:'synthetic',role:new URLSearchParams(location.search).get('role')||'EMPLOYEE',displayName:'合成员工'})},
 async employees(){return {items:[],hasMore:false}},
 async list(options,cursor){t.pages.push(cursor);const offset=cursor||0;return {clients:structuredClone(t.clients.slice(offset,offset+50)),hasMore:t.clients.length>offset+50,cursor:offset+50}},
 async save(c,source){t.calls.push({id:c.answers.customerId,source});if(t.fail.includes(c.answers.customerId))throw Error('合成网络失败');return {...c,id:'saved-'+c.answers.customerId,uid:'saved-'+c.answers.customerId,source,updatedAt:{seconds:1}}},
 async logout(){},async login(){},async resetPassword(){}
 }};`;
test('固定来源保持既有去重键，员工之间独立',async()=>{
 const expected=createHash('sha256').update(JSON.stringify(['synthetic','腾讯问卷28150274','SYN-1'])).digest('hex');
 assert.equal(await customerKey('synthetic','腾讯问卷28150274','SYN-1'),expected);
 assert.notEqual(await customerKey('other','腾讯问卷28150274','SYN-1'),expected);
});
test('六项UI修正：保存保护、重复导入、日期、范围及分页导出',{timeout:120000},async()=>{
 const server=http.createServer(async(req,res)=>{try{
   const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
   if(!/^[a-z0-9.-]+$/.test(name))throw Error();
   const body=name==='cloud-store.mjs'?mock:name==='firebase-config.mjs'?'export const firebaseConfig={projectId:"synthetic"};':await readFile(new URL(name,root));
   res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css':'text/javascript'});res.end(body);
 }catch{res.writeHead(404);res.end()}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage();const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.addInitScript(()=>{window.exports=[];URL.createObjectURL=blob=>{window.exports.push(blob);return 'blob:test'};HTMLAnchorElement.prototype.click=function(){};});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>document.getElementById('cloudStatus')?.textContent.includes('本页0条'));
  assert.equal(await page.locator('#source').count(),0);
  await page.locator('#importNew').click();
  const rows=Array.from({length:10},(_,i)=>fields.map(f=>f.id==='customerId'?'SYN-'+i:f.id==='submittedAt'?'20-Oct-2026 10:20:30':f.type==='text'?'合成资料':'A.合成选项'));
  const payload={name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from(exportCSV(fields.map(f=>f.label),rows))};
  await page.locator('#file').setInputFiles(payload);
  await page.waitForFunction(()=>document.querySelectorAll('#clients tr').length===10);
  assert.match(await page.locator('#clients tr').first().locator('td').nth(2).textContent(),/20-Oct-2026/);
  for(let i=0;i<3;i++)await page.locator('#clients input').nth(i).check();
  await page.locator('#saveSelected').click();
  await page.waitForFunction(()=>document.getElementById('cloudStatus')?.textContent.includes('仍有 7 份'));
  const before=await page.locator('#clients').textContent();
  for(const selector of ['#library','#clear','#importNew']){
   let message;page.once('dialog',async dialog=>{message=dialog.message();await dialog.dismiss()});
   await page.locator(selector).click();assert.match(message,/7 份/);assert.equal(await page.locator('#clients').textContent(),before);
  }
  // Selected records remain selected when filtering hides them.
  await page.evaluate(async()=>{const {clientUI}=await import('/app.mjs');clientUI.get().forEach((c,i)=>c.result.level=i<3?'A':'B');clientUI.render();testStore.calls=[]});
  await page.locator('#level').selectOption('B');
  await page.locator('#saveSelected').click();
  await page.waitForFunction(()=>!document.getElementById('saveSelected').disabled);
  assert.equal(await page.evaluate(()=>testStore.calls.length),3);
  await page.evaluate(()=>{testStore.calls=[];testStore.fail=['SYN-9']});
  await page.locator('#saveAll').click();
  await page.waitForFunction(()=>document.getElementById('cloudStatus')?.textContent.includes('失败 1 份'));
  assert.equal(await page.evaluate(()=>testStore.calls.length),10);
  assert.match(await page.locator('#cloudStatus').textContent(),/仍有 1 份/);
  await page.evaluate(()=>testStore.fail=[]);await page.locator('#retry').click();
  await page.waitForFunction(()=>document.getElementById('cloudStatus')?.textContent.includes('仍有 0 份'));
  assert(await page.evaluate(()=>testStore.calls.every(c=>c.source==='腾讯问卷28150274')));
  await page.locator('#level').selectOption('');
  await page.locator('#importNew').click();assert.equal(await page.locator('#file').inputValue(),'');
  await page.locator('#file').setInputFiles(payload);await page.waitForFunction(()=>document.querySelectorAll('#clients tr').length===10);
  assert.match(await page.locator('#cloudStatus').textContent(),/10 份答卷未保存/);
  // Capture valid scored objects for a 51-record paginated library fixture.
  await page.evaluate(async()=>{const {clientUI}=await import('/app.mjs');const c=clientUI.get()[0];testStore.clients=Array.from({length:51},(_,i)=>({...structuredClone(c),uid:'cloud-'+i,id:'cloud-'+i,answers:{...c.answers,customerId:'PAGE-'+i},result:{...c.result,level:i===0||i===50?'A':'B'}}))});
  page.once('dialog',d=>d.accept());await page.locator('#library').click();
  await page.waitForFunction(()=>document.querySelectorAll('#clients tr').length===50);
  await page.locator('#level').selectOption('A');assert.equal(await page.locator('#clients tr').count(),1);
  assert.match(await page.locator('#csv').textContent(),/本页筛选/);
  await page.locator('#csv').click();
  let csv=await page.evaluate(()=>window.exports.at(-1).text());assert(csv.includes('PAGE-0'));assert(!csv.includes('PAGE-50'));
  await page.locator('#zip').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('ZIP生成完成'));
  const zip=Buffer.from(await page.evaluate(async()=>Array.from(new Uint8Array(await window.exports.at(-1).arrayBuffer()))));
  const names=[];let offset=0;while(zip.readUInt32LE(offset)===0x04034b50){const size=zip.readUInt32LE(offset+18),length=zip.readUInt16LE(offset+26),extra=zip.readUInt16LE(offset+28);names.push(zip.subarray(offset+30,offset+30+length).toString());offset+=30+length+extra+size;}
  assert.equal(names.filter(n=>n.endsWith('.pdf')).length,1);assert(names.includes('summary.csv'));
  await page.locator('#nextPage').click();await page.waitForFunction(()=>document.getElementById('cloudStatus')?.textContent.includes('本页1条'));
  assert.match(await page.locator('#clients').textContent(),/PAGE-50/);
  assert.deepEqual(await page.evaluate(()=>testStore.pages),[null,null,50]);
  await mkdir(new URL('../.tools/ui-review/',import.meta.url),{recursive:true});
  const shot=async name=>page.screenshot({path:new URL('../.tools/ui-review/'+name+'.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
  await shot('library');
  assert.equal(await page.locator('#staffNav').count(),0);assert.equal(await page.getByText('作者 Alpha Wang').count(),0);
  await page.getByRole('button',{name:'详情',exact:true}).first().click();await shot('detail');await page.locator('.drawerClose').click();assert.equal(await page.locator('#clients tr').count(),1);
  await page.locator('#importNew').click();await page.locator('#file').setInputFiles(payload);await page.waitForFunction(()=>document.querySelectorAll('#clients tr').length===10);await shot('import');
  const adminPage=await browser.newPage();adminPage.on('pageerror',err=>errors.push(err.message));await adminPage.goto('http://127.0.0.1:'+server.address().port+'/?role=ADMIN');await adminPage.waitForFunction(()=>document.getElementById('cloudStatus')?.textContent.includes('本页0条'));assert.equal(await adminPage.locator('#staffNav').count(),0);assert.equal(await adminPage.locator('#sidebar button').count(),3);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
});
