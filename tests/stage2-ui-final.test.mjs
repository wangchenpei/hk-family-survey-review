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
 async list(options,cursor){t.pages.push(cursor);const all=t.clients.filter(c=>!!c.deleted===!!options.deleted);const offset=cursor||0;return {clients:structuredClone(all.slice(offset,offset+50)),hasMore:all.length>offset+50,cursor:offset+50}},
 async save(c,source){t.calls.push({id:c.answers.customerId,source,deleted:!!c.deleted});if(t.fail.includes(c.answers.customerId))throw Error('合成网络失败');const saved={...c,id:c.id||'saved-'+c.answers.customerId,uid:c.uid||'saved-'+c.answers.customerId,source,updatedAt:{seconds:1}};const index=t.clients.findIndex(item=>item.id===saved.id);if(index>=0)t.clients[index]=structuredClone(saved);return saved},
 async logout(){},async login(){},async resetPassword(){}
 }};`;
test('固定来源保持既有去重键，员工之间独立',async()=>{
 const expected=createHash('sha256').update(JSON.stringify(['synthetic','腾讯问卷28150274','SYN-1'])).digest('hex');
 assert.equal(await customerKey('synthetic','腾讯问卷28150274','SYN-1'),expected);
 assert.notEqual(await customerKey('other','腾讯问卷28150274','SYN-1'),expected);
});
test('客户库简化、批量软删除、只读详情与分页验收',{timeout:120000},async()=>{
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
  await page.waitForFunction(()=>document.getElementById('cloudStatus')?.textContent.includes('第1页，共0条'));
  assert.equal(await page.locator('#source').count(),0);
  let chooserEvents=0;page.on('filechooser',()=>chooserEvents++);
  await page.locator('#importNew').click();assert.equal(chooserEvents,0,'进入导入页面不得自动弹出文件选择器');
  const chooserOpened=page.waitForEvent('filechooser');await page.locator('#file').click();await chooserOpened;assert.equal(chooserEvents,1,'用户点击CSV控件应打开文件选择器');
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
  await page.evaluate(async()=>{const {clientUI}=await import('/app.mjs');const c=clientUI.get()[0];testStore.clients=[...Array.from({length:51},(_,i)=>({...structuredClone(c),uid:'cloud-'+i,id:'cloud-'+i,ownerUid:'synthetic',source:'腾讯问卷28150274',answerId:'PAGE-'+i,rawAnswers:c.rawAnswers||{},ruleVersion:c.result.version,basic:{name:'合成客户',phone:'',notes:'合成备注'},notes:'合成备注',createdAt:{seconds:1,nanoseconds:0},updatedAt:{seconds:2,nanoseconds:0},updatedBy:'synthetic',revision:1,warnings:[],deleted:false,answers:{...c.answers,customerId:'PAGE-'+i},result:{...c.result,level:i===0||i===50?'A':'B'}})),{...structuredClone(c),uid:'trash-only',id:'trash-only',deleted:true,answers:{...c.answers,customerId:'TRASH-ONLY'}}]});
  page.once('dialog',d=>d.accept());await page.locator('#library').click();
  await page.waitForFunction(()=>document.querySelectorAll('#clients tr').length===50);
  for(const id of ['#level','#focus','#sort'])assert.equal(await page.locator(id).evaluate(el=>el.parentElement.hidden),true,`${id}应从客户库移除`);
  assert.equal(await page.locator('#prevPage').isDisabled(),true);assert.equal(await page.locator('#nextPage').isDisabled(),false);
  assert.equal(await page.evaluate(()=>document.querySelector('#clients').closest('section').querySelector('.table-wrap').compareDocumentPosition(document.getElementById('pagingControls'))&Node.DOCUMENT_POSITION_FOLLOWING?true:false),true,'客户库分页应位于表格之后');
  assert.equal(await page.locator('#csv').textContent(),'导出客户汇总表（CSV）');assert.match(await page.locator('#exportScope').textContent(),/仅包含当前页客户/);
  await page.locator('#csv').click();
  let csv=await page.evaluate(()=>window.exports.at(-1).text());assert(csv.includes('PAGE-0'));assert(csv.includes('PAGE-49'));assert(!csv.includes('PAGE-50'));
  await page.locator('#clients input[type=checkbox]').first().check();assert.match(await page.locator('#selectedCount').textContent(),/已选 1 位/);
  await page.locator('#nextPage').click();await page.waitForFunction(()=>document.getElementById('cloudStatus')?.textContent.includes('第2页，共1条'));assert.match(await page.locator('#selectedCount').textContent(),/已选 0 位/);assert.equal(await page.locator('#clients input[type=checkbox]:checked').count(),0);
  assert.match(await page.locator('#clients').textContent(),/PAGE-50/);assert.equal(await page.locator('#prevPage').isDisabled(),false);assert.equal(await page.locator('#nextPage').isDisabled(),true);
  await page.locator('#zip').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('ZIP生成完成'));
  const zip=Buffer.from(await page.evaluate(async()=>Array.from(new Uint8Array(await window.exports.at(-1).arrayBuffer()))));
  const names=[];let offset=0;while(zip.readUInt32LE(offset)===0x04034b50){const size=zip.readUInt32LE(offset+18),length=zip.readUInt16LE(offset+26),extra=zip.readUInt16LE(offset+28);names.push(zip.subarray(offset+30,offset+30+length).toString());offset+=30+length+extra+size;}
  assert.equal(names.filter(n=>n.endsWith('.pdf')).length,1);assert(names.includes('summary.csv'));
  assert.deepEqual(await page.evaluate(()=>testStore.pages),[null,null,50]);
  assert.equal(await page.locator('#csv').textContent(),'导出客户汇总表（CSV）');assert.equal(await page.locator('#zip').textContent(),'批量下载客户分析报告（PDF）');
  assert.equal(await page.locator('#backup').isVisible(),false);await page.locator('#moreActions summary').click();
  page.once('dialog',dialog=>dialog.accept());const backupPromise=page.waitForFunction(()=>window.exports.length>=3);await page.locator('#backup').click();await backupPromise;
  const backup=JSON.parse(await page.evaluate(()=>window.exports.at(-1).text()));assert.equal(backup.format,'HSA-customers-v1');assert.equal(backup.customers.length,51);assert(!backup.customers.some(c=>c.id==='trash-only'));assert(backup.customers.some(c=>c.id==='cloud-50'));
  for(const key of ['id','uid','ownerUid','source','answerId','rawAnswers','answers','result','ruleVersion','basic','notes','createdAt','updatedAt','updatedBy','revision','deleted'])assert(key in backup.customers[0],`备份缺少字段 ${key}`);
  await mkdir(new URL('../.tools/ui-review/',import.meta.url),{recursive:true});
  const shot=async name=>page.screenshot({path:new URL('../.tools/ui-review/'+name+'.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
  await page.locator('#moreActions summary').click();await shot('library');assert.equal(await page.locator('#cloudToolbar').count(),0);assert.equal(await page.locator('#moreActions').locator('xpath=..').getAttribute('class'),'exportActions');assert.equal(await page.locator('#staffNav').count(),0);assert.equal(await page.getByText('作者 Alpha Wang').count(),0);
  await page.locator('#prevPage').click();await page.waitForFunction(()=>document.querySelectorAll('#clients tr').length===50);
  await page.evaluate(()=>{testStore.calls=[]});
  assert.equal(await page.locator('#deleteSelected').isDisabled(),true);await page.locator('#selectPage').check();assert.equal(await page.locator('#clients input[type=checkbox]:checked').count(),50);await page.locator('#selectPage').uncheck();assert.equal(await page.locator('#clients input[type=checkbox]:checked').count(),0);
  await page.locator('#clients input[type=checkbox]').nth(0).check();await page.locator('#clients input[type=checkbox]').nth(1).check();assert.equal(await page.locator('#selectedCount').textContent(),'已选 2 位客户（仅当前页）');
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#deleteSelected').click();assert.equal(await page.locator('#clients tr').count(),50);assert.equal(await page.evaluate(()=>testStore.calls.length),0);
  await page.evaluate(()=>{testStore.calls=[];testStore.fail=['PAGE-1']});let batchConfirm;page.once('dialog',async dialog=>{batchConfirm=dialog.message();await dialog.accept()});await page.locator('#deleteSelected').click();assert.match(batchConfirm,/2 位客户/);await page.waitForFunction(()=>document.getElementById('cloudStatus')?.textContent.includes('成功删除 1 位，失败 1 位'));
  assert.equal(await page.locator('#clients tr').count(),49);assert.match(await page.locator('#clients').textContent(),/PAGE-1/);assert.doesNotMatch(await page.locator('#clients').textContent(),/PAGE-0/);assert.equal(await page.locator('#clients input[type=checkbox]:checked').count(),1);
  await page.evaluate(()=>testStore.fail=[]);page.once('dialog',dialog=>dialog.accept());await page.locator('#deleteSelected').click();await page.waitForFunction(()=>document.getElementById('cloudStatus')?.textContent.includes('成功删除 1 位，失败 0 位'));
  assert.equal(await page.evaluate(()=>testStore.clients.filter(c=>c.deleted).length),3);
  await page.locator('#trash').click();await page.waitForFunction(()=>document.querySelectorAll('#clients tr').length===3);assert.equal(await page.locator('#cloudToolbar').count(),0);assert.equal(await page.locator('#clients button').filter({hasText:'恢复'}).count(),3);assert.equal(await page.locator('#restoreSelected').isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.querySelector('#clients').closest('section').querySelector('.table-wrap').compareDocumentPosition(document.getElementById('pagingControls'))&Node.DOCUMENT_POSITION_FOLLOWING?true:false),true,'回收站分页应位于表格之后');
  await page.locator('#selectPage').check();assert.equal(await page.locator('#clients input[type=checkbox]:checked').count(),3);await page.locator('#selectPage').uncheck();assert.equal(await page.locator('#clients input[type=checkbox]:checked').count(),0);
  await page.getByRole('button',{name:'查看',exact:true}).first().click();await shot('detail');
  for(const label of ['保存本客户','编辑客户','移入回收站','使用最新规则重新评分','恢复客户'])assert.equal(await page.locator('#detail').getByRole('button',{name:new RegExp(label)}).count(),0,`${label}不应出现在详情`);
  assert.equal(await page.locator('#detail .drawerClose').count(),1);await page.locator('.drawerClose').click();
  await page.locator('#clients input[type=checkbox]').nth(0).check();await page.locator('#clients input[type=checkbox]').nth(1).check();assert.equal(await page.locator('#restoreSelected').isDisabled(),false);await page.evaluate(()=>{testStore.calls=[]});
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#restoreSelected').click();assert.equal(await page.locator('#clients tr').count(),3);assert.equal(await page.evaluate(()=>testStore.calls.length),0);
  await page.evaluate(()=>{testStore.calls=[];testStore.fail=['PAGE-1']});let restoreConfirm;page.once('dialog',async dialog=>{restoreConfirm=dialog.message();await dialog.accept()});await page.locator('#restoreSelected').click();assert.match(restoreConfirm,/2 位客户/);await page.waitForFunction(()=>document.getElementById('cloudStatus')?.textContent.includes('成功恢复 1 位，失败 1 位'));
  assert.equal(await page.locator('#clients tr').count(),2);assert.match(await page.locator('#clients').textContent(),/PAGE-1/);assert.equal(await page.locator('#clients input[type=checkbox]:checked').count(),1);
  await page.evaluate(()=>testStore.fail=[]);page.once('dialog',dialog=>dialog.accept());await page.locator('#restoreSelected').click();await page.waitForFunction(()=>document.getElementById('cloudStatus')?.textContent.includes('成功恢复 1 位，失败 0 位'));assert.equal(await page.locator('#clients tr').count(),1);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:/恢复客户/}).click();await page.waitForFunction(()=>document.querySelectorAll('#clients tr').length===0);assert.equal(await page.evaluate(()=>testStore.clients.filter(c=>c.deleted).length),0);
  await page.locator('#library').click();await page.waitForFunction(()=>document.querySelectorAll('#clients tr').length===50);assert.equal(await page.locator('#nextPage').isDisabled(),false);
  await page.locator('#nextPage').click();await page.waitForTimeout(150);assert.equal(await page.locator('#clients tr').count(),2,'下一页数据未加载：'+await page.locator('#cloudStatus').textContent());page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'删除客户 PAGE-50'}).click();await page.waitForFunction(()=>document.querySelectorAll('#clients tr').length===1);assert.match(await page.locator('#clients').textContent(),/TRASH-ONLY/);
  await page.locator('#trash').click();await page.waitForFunction(()=>document.querySelectorAll('#clients tr').length===1);page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'恢复客户 PAGE-50'}).click();await page.waitForFunction(()=>document.querySelectorAll('#clients tr').length===0);
  await page.locator('#importNew').click();await page.locator('#file').setInputFiles(payload);await page.waitForFunction(()=>document.querySelectorAll('#clients tr').length===10);await shot('import');
  const adminPage=await browser.newPage();adminPage.on('pageerror',err=>errors.push(err.message));await adminPage.goto('http://127.0.0.1:'+server.address().port+'/?role=ADMIN');await adminPage.waitForFunction(()=>document.getElementById('cloudStatus')?.textContent.includes('第1页，共0条'));assert.equal(await adminPage.locator('#staffNav').count(),0);assert.equal(await adminPage.locator('#sidebar button').count(),3);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
});
