import {firebaseConfig} from './firebase-config.mjs';
import {createCloudStore} from './cloud-store.mjs';
import {chineseError,saveSequential} from './customer-model.mjs';
import {clientUI} from './app.mjs';
const $=id=>document.getElementById(id);
const e=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};
const portal=$('account'),workspace=$('workspace');
let store,actor,epoch=0,busy=false,cursor=null,employeeCursor=null,mode='library',pageCursors=[null],pageIndex=0;
let employees=new Map(),selected=new Set(),failed=[];
const saveStates=new Map(),IMPORT_SOURCE='腾讯问卷28150274';
const unsavedCount=()=>[...saveStates.values()].filter(state=>state!=='saved').length;
function clearImportState(){saveStates.clear();selected.clear();failed=[];$('retry').disabled=true}
function updateSaveState(client,state){saveStates.set(client,state);failed=[...saveStates].filter(([,value])=>value==='failed').map(([record])=>record)}
portal.innerHTML=`<section class="panel" id="loginPanel"><h1>员工登录</h1><form id="loginForm"><label>邮箱 <input id="email" type="email" autocomplete="username" required></label><label>密码 <input id="password" type="password" autocomplete="current-password" required></label><button id="login" type="submit">登录</button><button id="resetPassword" type="button" class="secondary">忘记密码</button></form><p id="authStatus" role="status">正在准备登录…</p></section><section class="panel" id="accountBar" hidden><strong id="accountName"></strong><button id="logout" class="secondary">退出登录</button></section>`;
const toolbar=e('section');toolbar.className='panel';toolbar.id='cloudToolbar';
toolbar.innerHTML=`<div id="navigationSource"><button id="library">客户库</button><button id="importNew">导入答卷</button><button id="trash" class="secondary">回收站</button></div><details id="moreActions"><summary>更多操作</summary><button id="backup" class="secondary">备份全部客户数据</button></details><div id="pagingControls"><button id="prevPage" class="secondary" disabled>上一页</button><span id="pageStatus">第1页</span><button id="nextPage" class="secondary" disabled>下一页</button></div><div id="saveControls" hidden><button id="selectAll">选择本页</button><button id="saveSelected">保存选中答卷</button><button id="saveAll">保存本次导入的全部答卷</button><button id="retry" disabled>重试失败记录</button></div><p id="cloudStatus" role="status" aria-live="polite"></p>`;
workspace.prepend(toolbar);
const navigation=e('nav');navigation.id='sidebar';
const pageTitle=e('strong','客户库');pageTitle.id='pageTitle';$('accountBar').prepend(pageTitle);
for(const id of ['library','importNew','trash'])navigation.append($(id));
workspace.prepend(navigation);
const resultsPanel=$('clients').closest('section'),tableWrap=resultsPanel.querySelector('.table-wrap');
const restoreSelected=e('button','恢复选中');restoreSelected.id='restoreSelected';restoreSelected.className='secondary';$('deleteSelected').after(restoreSelected);
resultsPanel.querySelector('.exportActions').prepend($('moreActions'));
tableWrap.after($('pagingControls'));$('pagingControls').after($('saveControls'));$('saveControls').after($('cloudStatus'));
toolbar.remove();
function layout(){
 document.body.classList.toggle('signed-in',!!actor);
 pageTitle.textContent=mode==='import'?'导入答卷':mode==='trash'?'回收站':'客户库';
 $('moreActions').hidden=mode!=='library';
 $('pagingControls').hidden=mode==='import';
 for(const id of ['level','focus','sort'])$(id).parentElement.hidden=mode!=='import';
 $('libraryActions').hidden=mode==='import';
 for(const [id,value] of [['library','library'],['importNew','import'],['trash','trash']])$(id).classList.toggle('active',mode===value);
}
const status=text=>{$('cloudStatus').textContent=text};
const authStatus=text=>{$('authStatus').textContent=text};
const displayName=uid=>employees.get(uid)?.displayName||employees.get(uid)?.email||(actor?.uid===uid?'我':'员工');
const date=value=>value?.toDate?value.toDate().toLocaleString('zh-CN'):value?.seconds?new Date(value.seconds*1000).toLocaleString('zh-CN'):'未保存';
clientUI.compare=(a,b)=>mode==='import'?undefined:0;
clientUI.authorized=()=>!!actor;
function lock(value){busy=value;for(const id of ['library','importNew','trash','backup','saveSelected','saveAll','retry','restoreSelected','logout','file','clear'])$(id).disabled=value;$('prevPage').disabled=value||pageIndex===0;$('nextPage').disabled=value||!cursor;$('deleteSelected').disabled=value||mode!=='library'||selected.size===0;$('restoreSelected').disabled=value||mode!=='trash'||selected.size===0;$('selectPage').disabled=value||!clientUI.filtered().length;for(const row of $('clients').rows)for(const control of row.querySelectorAll('button,input'))control.disabled=value}
function options(){return {sort:'date',deleted:mode==='trash'}}
async function action(fn){if(busy)return;const run=epoch;lock(true);try{await fn()}catch(error){if(run===epoch)status(chineseError(error))}finally{if(run===epoch){lock(false);$('retry').disabled=!failed.length;$('nextPage').disabled=!cursor}}}
function permitNavigate(){const count=unsavedCount();return !count||confirm(`还有 ${count} 份答卷未保存，继续会清除当前结果。是否继续？`)}
clientUI.beforeImport=()=>{if(!permitNavigate())return false;clearImportState();return true};
clientUI.beforeClear=permitNavigate;
clientUI.onClear=clearImportState;
window.addEventListener('beforeunload',event=>{if(unsavedCount()){event.preventDefault();event.returnValue=''}});
async function library(targetPage=0){
  const run=epoch,targetCursor=pageCursors[targetPage]??null,data=await store.list(options(),targetCursor);if(run!==epoch)return;
  clearImportState();selected.clear();pageIndex=targetPage;cursor=data.hasMore?data.cursor:null;
  if(cursor)pageCursors[pageIndex+1]=cursor;else pageCursors=pageCursors.slice(0,pageIndex+1);
  layout();clientUI.set(data.clients);
  $('prevPage').disabled=pageIndex===0;$('nextPage').disabled=!cursor;$('pageStatus').textContent=`第${pageIndex+1}页 · ${data.clients.length}位客户`;
  $('saveControls').hidden=true;$('importPanel').hidden=true;
  status(`${mode==='trash'?'回收站':'客户库'}：第${pageIndex+1}页，共${data.clients.length}条。CSV与PDF ZIP仅包含当前页客户；完整备份会逐页读取全部有权访问的未删除客户。`);
}
async function loadEmployees(){
  const run=epoch;employeeCursor=null;
  do{const data=await store.employees(employeeCursor);if(run!==epoch)return;for(const employee of data.items)employees.set(employee.uid,employee);employeeCursor=data.hasMore?data.cursor:null}while(employeeCursor)
}
async function persist(client){
  const run=epoch;
  let saved;
  try{saved=await store.save(client,client.source||IMPORT_SOURCE)}catch(error){
    if(error.code!=='duplicate')throw error;
    if(!confirm(`答卷 ${client.answers.customerId} 已保存${error.existing.deleted?'（在回收站中）':''}。是否用本次答案和评分更新已有记录？`))throw Error('已跳过重复答卷，未覆盖。');
    saved=await store.save({...client,deleted:error.existing.deleted},client.source||IMPORT_SOURCE,{expectedRevision:error.existing.revision});
  }
  if(run!==epoch)throw Error('登录状态已变化。');
  Object.assign(client,saved);return saved;
}
async function saveList(list){
  if(!list.length)throw Error('请先选择需要保存的客户。');
  const run=epoch;
  const results=await saveSequential(list,async client=>{if(run!==epoch)throw Error('登录状态已变化。');return persist(client)},(client,error)=>{
    if(run!==epoch)return;updateSaveState(client,error?'failed':'saved');clientUI.render();status(`已处理 ${list.indexOf(client)+1}/${list.length}；${error?'本条未保存：'+chineseError(error):'本条已保存'}`);
  });
  if(run!==epoch)return;
  clientUI.render();const failures=results.filter(r=>!r.ok).length;status(`本次成功保存 ${results.length-failures} 份，失败 ${failures} 份；当前仍有 ${unsavedCount()} 份未保存。${failed.length?'失败答卷已保留，可重试。':''}`);
}
clientUI.onRender=(list)=>{
  const rows=[...$('clients').children];
  list.forEach((client,i)=>{
    const cell=e('td'),check=e('input');check.type='checkbox';check.setAttribute('aria-label','选择客户 '+(client.answers.customerId||''));check.disabled=busy;check.checked=selected.has(client);check.onchange=()=>{check.checked?selected.add(client):selected.delete(client);clientUI.render()};cell.append(check);rows[i].prepend(cell);
    rows[i].children[1].textContent=(client.answers.customerId||'未提供')+(client.answers.name?' / '+client.answers.name:'');
    const state=saveStates.get(client);rows[i].children[1].append(e('small',state==='failed'?' · 保存失败，待重试':state==='unsaved'?' · 未保存':' · 已保存'));
    if(actor?.role==='ADMIN')rows[i].insertBefore(e('td',displayName(client.ownerUid||actor.uid)),rows[i].lastChild);
    const actions=rows[i].lastElementChild,view=actions.querySelector('button');
    if(view)view.textContent='查看';
    if(mode==='library'&&client.id&&!client.deleted){
      const remove=e('button','删除');remove.className='danger';remove.setAttribute('aria-label','删除客户 '+(client.answers.customerId||client.id));
      remove.onclick=()=>action(async()=>{
        if(!confirm(`确认将客户 ${client.answers.customerId||client.id} 移入回收站？之后可在回收站恢复。`))return;
        const saved=await store.save({...client,deleted:true},client.source);Object.assign(client,saved);
        selected.delete(client);clientUI.set(clientUI.get().filter(item=>item.id!==client.id));status('客户已移入回收站，可在回收站恢复。');
      });actions.append(remove);
    }else if(mode==='trash'&&client.id&&client.deleted){
      const restore=e('button','恢复');restore.className='secondary';restore.setAttribute('aria-label','恢复客户 '+(client.answers.customerId||client.id));
      restore.onclick=()=>action(async()=>{if(!confirm(`确认恢复客户 ${client.answers.customerId||client.id}？`))return;const saved=await store.save({...client,deleted:false},client.source);Object.assign(client,saved);clientUI.set(clientUI.get().filter(item=>item.id!==client.id));status('客户已恢复。')});actions.append(restore);
    }
  });
  $('ownerHeading').hidden=actor?.role!=='ADMIN';
  const libraryMode=mode==='library';
  $('csv').textContent=libraryMode?'导出客户汇总表（CSV）':'导出本次筛选汇总（CSV）';
  $('zip').textContent=libraryMode?'批量下载客户分析报告（PDF）':'批量下载本次客户报告（ZIP）';
  $('csv').hidden=$('zip').hidden=mode==='trash';
  $('exportScope').hidden=mode==='trash';$('exportScope').textContent=libraryMode?'CSV与PDF ZIP仅包含当前页客户。':'CSV与PDF ZIP仅包含本次当前显示的答卷。';
  $('deleteSelected').hidden=!libraryMode;$('restoreSelected').hidden=mode!=='trash';$('selectedCount').textContent=`已选 ${selected.size} 位客户（仅当前页）`;$('deleteSelected').disabled=busy||!libraryMode||selected.size===0;$('restoreSelected').disabled=busy||mode!=='trash'||selected.size===0;
  const header=$('selectPage'),allSelected=list.length>0&&list.every(client=>selected.has(client)),someSelected=list.some(client=>selected.has(client));header.checked=allSelected;header.indeterminate=!allSelected&&someSelected;header.disabled=busy||!list.length;
};
clientUI.onImport=()=>{mode='import';layout();cursor=null;clearImportState();for(const client of clientUI.get())saveStates.set(client,'unsaved');$('nextPage').disabled=true;$('saveControls').hidden=false;clientUI.render();status(`分析完成，共 ${unsavedCount()} 份答卷未保存。`);};
clientUI.onDetail=client=>{
  const box=$('detail'),close=e('button','×');close.className='drawerClose secondary';close.setAttribute('aria-label','关闭详情');close.onclick=()=>{box.hidden=true};box.prepend(close);
  if(client.updatedAt)box.append(e('p','最近更新：'+date(client.updatedAt)));
};
$('loginForm').onsubmit=async event=>{event.preventDefault();$('login').disabled=true;try{await store.login($('email').value.trim(),$('password').value);$('password').value=''}catch(error){authStatus(chineseError(error))}finally{$('login').disabled=false}};
$('resetPassword').onclick=async()=>{if(!$('email').value.trim()){authStatus('请先填写邮箱。');return}try{await store.resetPassword($('email').value.trim());authStatus('如该邮箱可接收重置邮件，请查收邮件并设置密码。')}catch(error){authStatus(chineseError(error))}};
$('logout').onclick=()=>{if(permitNavigate())action(async()=>{await store.logout()})};
$('library').onclick=()=>{if(permitNavigate()){mode='library';pageCursors=[null];pageIndex=0;$('level').value=$('focus').value='';action(()=>library())}};
$('trash').onclick=()=>{if(permitNavigate()){mode='trash';pageCursors=[null];pageIndex=0;$('level').value=$('focus').value='';action(()=>library())}};
$('prevPage').onclick=()=>{if(permitNavigate()&&pageIndex>0)action(()=>library(pageIndex-1))};
$('nextPage').onclick=()=>{if(permitNavigate()&&cursor)action(()=>library(pageIndex+1))};
 $('importNew').onclick=()=>{if(!permitNavigate())return;clientUI.clear();clearImportState();$('file').value='';mode='import';layout();$('sort').parentElement.hidden=false;$('importPanel').hidden=false;$('saveControls').hidden=false;status('请点击“腾讯问卷CSV”文件选择控件，选择答卷文件后开始分析。')};
$('selectAll').onclick=()=>{for(const c of clientUI.filtered())selected.add(c);clientUI.render()};
$('selectPage').onchange=()=>{const visible=clientUI.filtered();for(const client of visible)$('selectPage').checked?selected.add(client):selected.delete(client);clientUI.render()};
$('saveSelected').onclick=()=>action(()=>saveList(clientUI.get().filter(c=>selected.has(c))));
$('saveAll').onclick=()=>action(()=>saveList(clientUI.get()));
$('retry').onclick=()=>action(()=>saveList([...failed]));
$('deleteSelected').onclick=()=>action(async()=>{
  const chosen=clientUI.get().filter(client=>selected.has(client)&&client.id&&!client.deleted);if(!chosen.length)throw Error('请先勾选当前页需要删除的客户。');
  if(!confirm(`确定将已勾选的 ${chosen.length} 位客户移入回收站？未勾选客户不会删除。`))return;
  const removed=[];let failedCount=0;
  for(const client of chosen){try{const saved=await store.save({...client,deleted:true},client.source);Object.assign(client,saved);removed.push(client);selected.delete(client)}catch{failedCount++}}
  clientUI.set(clientUI.get().filter(client=>!removed.includes(client)));status(`成功删除 ${removed.length} 位，失败 ${failedCount} 位。${failedCount?'失败客户仍留在列表中，可重新勾选后重试。':''}`)
});
$('restoreSelected').onclick=()=>action(async()=>{
  const chosen=clientUI.get().filter(client=>selected.has(client)&&client.id&&client.deleted);if(!chosen.length)throw Error('请先勾选当前页需要恢复的客户。');
  if(!confirm(`确定恢复已勾选的 ${chosen.length} 位客户？未勾选客户将保留在回收站。`))return;
  const restored=[];let failedCount=0;
  for(const client of chosen){try{const saved=await store.save({...client,deleted:false},client.source);Object.assign(client,saved);restored.push(client);selected.delete(client)}catch{failedCount++}}
  clientUI.set(clientUI.get().filter(client=>!restored.includes(client)));status(`成功恢复 ${restored.length} 位，失败 ${failedCount} 位。${failedCount?'失败客户仍留在列表中，可重新勾选后重试。':''}`)
});
$('backup').onclick=()=>action(async()=>{
  if(!confirm('将导出全部有权访问的未删除客户，不受当前筛选和分页影响；不包含回收站。文件含客户资料，请妥善保存。是否继续？'))return;
  const run=epoch,all=[];
  let next=null;do{const page=await store.list({deleted:false,sort:'date'},next);if(run!==epoch)return;all.push(...page.clients);next=page.hasMore?page.cursor:null;status(`正在准备备份：已读取${all.length}条未删除客户。`)}while(next)
  clientUI.download(JSON.stringify({format:'HSA-customers-v1',exportedAt:new Date().toISOString(),customers:all},null,2),'客户完整备份_'+Date.now()+'.json','application/json');status(`已备份${all.length}条未删除客户；不包含回收站，文件可用JSON查看。`);
});
async function start(){
  workspace.hidden=true;
  $('login').disabled=true;$('resetPassword').disabled=true;
  if(!firebaseConfig){$('login').disabled=true;$('resetPassword').disabled=true;authStatus('账号服务尚未配置，请联系管理员。');return}
  try{store=await createCloudStore(firebaseConfig);$('login').disabled=false;$('resetPassword').disabled=false;store.watch((user,error)=>{
    const wasSignedIn=!!actor;epoch++;actor=user;clearImportState();busy=false;cursor=null;employeeCursor=null;pageCursors=[null];pageIndex=0;selected.clear();failed=[];employees.clear();clientUI.clear();$('file').value='';if(user||wasSignedIn)$('password').value='';
    layout();workspace.hidden=!user;$('accountBar').hidden=!user;$('loginPanel').hidden=!!user;
    if(!user){authStatus(error?chineseError(error):'请输入获授权的员工邮箱和密码。');return}
    employees.set(user.uid,user);$('accountName').textContent=(user.displayName||user.email)+' · '+(user.role==='ADMIN'?'管理员':'员工');mode='library';
    action(async()=>{if(user.role==='ADMIN')await loadEmployees();await library()});
  })}catch(error){authStatus('登录服务未能连接：'+chineseError(error))}
}
await start();
