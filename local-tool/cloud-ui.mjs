import {firebaseConfig} from './firebase-config.mjs';
import {createCloudStore} from './cloud-store.mjs';
import {editCustomer,questionFields,chineseError,saveSequential} from './customer-model.mjs';
import {fields} from './bundled.mjs';
import {clientUI} from './app.mjs';
const $=id=>document.getElementById(id);
const e=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};
const portal=$('account'),workspace=$('workspace');
let store,actor,epoch=0,busy=false,cursor=null,employeeCursor=null,mode='library';
let employees=new Map(),selected=new Set(),failed=[];
const saveStates=new Map(),IMPORT_SOURCE='腾讯问卷28150274';
const unsavedCount=()=>[...saveStates.values()].filter(state=>state!=='saved').length;
function clearImportState(){saveStates.clear();selected.clear();failed=[];$('retry').disabled=true}
function updateSaveState(client,state){saveStates.set(client,state);failed=[...saveStates].filter(([,value])=>value==='failed').map(([record])=>record)}
portal.innerHTML=`<section class="panel" id="loginPanel"><h1>员工登录</h1><form id="loginForm"><label>邮箱 <input id="email" type="email" autocomplete="username" required></label><label>密码 <input id="password" type="password" autocomplete="current-password" required></label><button id="login" type="submit">登录</button><button id="resetPassword" type="button" class="secondary">忘记密码</button></form><p id="authStatus" role="status">正在准备登录…</p></section><section class="panel" id="accountBar" hidden><strong id="accountName"></strong><button id="logout" class="secondary">退出登录</button></section>`;
const toolbar=e('section');toolbar.className='panel';toolbar.id='cloudToolbar';
toolbar.innerHTML=`<h2 id="libraryTitle">我的客户</h2><div><button id="library">客户库</button><button id="importNew">导入答卷</button><button id="trash" class="secondary">回收站</button><button id="backup" class="secondary">导出完整客户备份</button></div><div id="libraryFilters"><label>编号或姓名 <input id="search" placeholder="输入完整编号或姓名"></label><label>综合评分从 <input id="scoreMin" type="number" min="0" max="100"></label><label>到 <input id="scoreMax" type="number" min="0" max="100"></label><label>排序 <select id="cloudSort"><option value="score">综合评分从高到低</option><option value="date">最近更新优先</option></select></label><label id="ownerLabel" hidden>所属员工 <select id="owner"><option value="">全部员工</option></select></label><button id="query">查询</button><button id="nextPage" disabled>下一页</button></div><div id="saveControls" hidden><button id="selectAll">选择本页</button><button id="saveSelected">保存选中答卷</button><button id="saveAll">保存本次导入的全部答卷</button><button id="retry" disabled>重试失败记录</button></div><p id="cloudStatus" role="status" aria-live="polite"></p><div id="staffArea" hidden><button id="staffStats" class="secondary">查看员工统计</button><button id="moreStaff" class="secondary" hidden>加载更多员工</button><p>员工账号创建、停用和角色配置由授权管理员在 Firebase 控制台完成。</p><div id="statistics"></div></div>`;
workspace.prepend(toolbar);
const navigation=e('nav');navigation.id='sidebar';
const pageTitle=e('strong','客户库');pageTitle.id='pageTitle';$('accountBar').prepend(pageTitle);
for(const id of ['library','importNew','trash'])navigation.append($(id));
workspace.prepend(navigation);
const staffList=e('section');staffList.id='staffList';staffList.className='panel';staffList.hidden=true;workspace.append(staffList);
const statsFold=e('details'),statsSummary=e('summary','员工统计');statsFold.append(statsSummary);$('staffArea').before(statsFold);statsFold.append($('staffArea'));
const resultsPanel=$('clients').closest('section'),tableWrap=resultsPanel.querySelector('.table-wrap');
tableWrap.after($('saveControls'));$('saveControls').after($('cloudStatus'));
function layout(){
 const staff=mode==='staff';document.body.classList.toggle('signed-in',!!actor);
 pageTitle.textContent=staff?'员工管理':mode==='import'?'导入答卷':mode==='trash'?'回收站':'客户库';
 statsFold.hidden=actor?.role!=='ADMIN'||mode!=='library';
 staffList.hidden=!staff;toolbar.hidden=staff||mode==='import';
 for(const node of [...workspace.children])if(node!==navigation&&node!==toolbar&&node!==staffList)node.classList.toggle('staff-hidden',staff);
 for(const [id,value] of [['library','library'],['importNew','import'],['trash','trash']])$(id).classList.toggle('active',mode===value);
}
const status=text=>{$('cloudStatus').textContent=text};
const authStatus=text=>{$('authStatus').textContent=text};
const displayName=uid=>employees.get(uid)?.displayName||employees.get(uid)?.email||(actor?.uid===uid?'我':'员工');
const date=value=>value?.toDate?value.toDate().toLocaleString('zh-CN'):value?.seconds?new Date(value.seconds*1000).toLocaleString('zh-CN'):'未保存';
clientUI.compare=(a,b)=>mode==='import'?undefined:$('cloudSort').value==='date'?(b.updatedAt?.seconds||0)-(a.updatedAt?.seconds||0):b.result.composite-a.result.composite;
clientUI.authorized=()=>!!actor;
function lock(value){busy=value;for(const id of ['query','library','importNew','trash','backup','saveSelected','saveAll','retry','nextPage','logout','staffStats','moreStaff','file','clear'])$(id).disabled=value;}
function options(){const min=$('scoreMin').value,max=$('scoreMax').value;if((min!==''&&(Number(min)<0||Number(min)>100))||(max!==''&&(Number(max)<0||Number(max)>100))||(min!==''&&max!==''&&Number(min)>Number(max)))throw Error('评分范围应在0至100之间，最低分不能大于最高分。');return {search:$('search').value.trim(),min,max,sort:$('cloudSort').value,ownerUid:$('owner').value,deleted:mode==='trash'}}
async function action(fn){if(busy)return;const run=epoch;lock(true);try{await fn()}catch(error){if(run===epoch)status(chineseError(error))}finally{if(run===epoch){lock(false);$('retry').disabled=!failed.length;$('nextPage').disabled=!cursor}}}
function permitNavigate(){const count=unsavedCount();return !count||confirm(`还有 ${count} 份答卷未保存，继续会清除当前结果。是否继续？`)}
clientUI.beforeImport=()=>{if(!permitNavigate())return false;clearImportState();return true};
clientUI.beforeClear=permitNavigate;
clientUI.onClear=clearImportState;
window.addEventListener('beforeunload',event=>{if(unsavedCount()){event.preventDefault();event.returnValue=''}});
async function library(next=false){
  const run=epoch,data=await store.list(options(),next?cursor:null);if(run!==epoch)return;
  clearImportState();layout();clientUI.set(data.clients);cursor=data.hasMore?data.cursor:null;
  $('nextPage').disabled=!cursor;$('saveControls').hidden=true;$('importPanel').hidden=true;$('libraryFilters').hidden=false;$('sort').parentElement.hidden=true;
  status(`${mode==='trash'?'回收站':'客户库'}：本页${data.clients.length}条。列表下载仅包含当前页筛选结果；完整备份会逐页读取全部有权访问的客户。`);
}
async function loadEmployees(){
  const run=epoch,data=await store.employees(employeeCursor);if(run!==epoch)return;
  for(const employee of data.items){employees.set(employee.uid,employee);const opt=e('option',employee.displayName||employee.email||'员工');opt.value=employee.uid;$('owner').append(opt)}
  employeeCursor=data.hasMore?data.cursor:null;$('moreStaff').hidden=!employeeCursor;
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
function button(text,fn,kind='secondary'){const b=e('button',text);b.className=kind;b.onclick=()=>action(fn);return b}
clientUI.onRender=(list)=>{
  const rows=[...$('clients').children];
  list.forEach((client,i)=>{
    const cell=e('td'),check=e('input');check.type='checkbox';check.setAttribute('aria-label','选择客户 '+(client.answers.customerId||''));check.checked=selected.has(client);check.onchange=()=>check.checked?selected.add(client):selected.delete(client);cell.append(check);rows[i].prepend(cell);
    rows[i].children[1].textContent=(client.answers.customerId||'未提供')+(client.answers.name?' / '+client.answers.name:'');
    const state=saveStates.get(client);rows[i].children[1].append(e('small',state==='failed'?' · 保存失败，待重试':state==='unsaved'?' · 未保存':' · 已保存'));
    if(actor?.role==='ADMIN')rows[i].insertBefore(e('td',displayName(client.ownerUid||actor.uid)),rows[i].lastChild);
  });
  $('ownerHeading').hidden=actor?.role!=='ADMIN';
  $('csv').textContent=mode==='import'?'下载当前筛选汇总CSV':'下载本页筛选结果CSV';
  $('zip').textContent=mode==='import'?'批量下载客户报告（ZIP）':'批量下载本页筛选报告（ZIP）';
};
clientUI.onImport=()=>{mode='import';layout();cursor=null;clearImportState();for(const client of clientUI.get())saveStates.set(client,'unsaved');$('nextPage').disabled=true;$('saveControls').hidden=false;$('libraryFilters').hidden=true;clientUI.render();status(`分析完成，共 ${unsavedCount()} 份答卷未保存。`);};
clientUI.onDetail=client=>{
  const box=$('detail'),controls=e('div');controls.className='drawerActions';const close=e('button','×');close.className='drawerClose secondary';close.setAttribute('aria-label','关闭详情');close.onclick=()=>{box.hidden=true};box.prepend(close);
  controls.append(button('保存本客户',()=>saveList([client]),'primary'));
  controls.append(button('编辑客户',()=>{showEditor(client);return Promise.resolve()}));
  if(client.id){controls.append(button(client.deleted?'恢复客户':'移入回收站',async()=>{
    if(!confirm(client.deleted?'确认恢复这条客户？':'确认将这条客户移入回收站？'))return;
    const saved=await store.save({...client,deleted:!client.deleted},client.source);Object.assign(client,saved);status(client.deleted?'已移入回收站。':'已恢复客户。');clientUI.render();
  },client.deleted?'secondary':'danger'));controls.append(button('使用最新规则重新评分',async()=>{
    if(!confirm('将使用当前规则重算并替换该客户的评分快照，是否继续？'))return;
    const changed=editCustomer(client,{},client.notes,{rescore:true});const saved=await store.save(changed,client.source);Object.assign(client,saved);clientUI.detail(client);status('已重新评分并保存。');
  }));}
  box.insertBefore(controls,box.children[1]);if(client.updatedAt)box.append(e('p','最近更新：'+date(client.updatedAt)));
};
function showEditor(client){
  const box=$('detail'),form=e('form');form.className='customerEditor';
  form.append(e('h3','编辑客户'),e('p','只修改姓名、电话、学校、城市或备注会保留原评分。修改问卷答案后会重新评分；答案请保留原选项字母和文字。'));
  const inputs=new Map();questionFields.forEach((id,index)=>{const field=fields.find(f=>f.id===id);const label=e('label',`Q${index+1} ${field?.label||''}`),input=e('input');input.value=client.rawAnswers?.[id]??client.answers[id]??'';input.maxLength=2000;label.append(input);form.append(label);inputs.set(id,input)});
  const noteLabel=e('label','备注'),notes=e('textarea');notes.value=client.notes||'';notes.maxLength=10000;noteLabel.append(notes);form.append(noteLabel);
  const submit=e('button','应用修改并保存');submit.type='submit';const cancel=e('button','取消');cancel.type='button';cancel.onclick=()=>clientUI.detail(client);form.append(submit,cancel);
  form.onsubmit=event=>{event.preventDefault();action(async()=>{const changed=editCustomer(client,Object.fromEntries([...inputs].map(([k,input])=>[k,input.value])),notes.value);Object.assign(client,changed);updateSaveState(client,'unsaved');await saveList([client]);clientUI.detail(client)})};box.replaceChildren(form);
}
$('loginForm').onsubmit=async event=>{event.preventDefault();$('login').disabled=true;try{await store.login($('email').value.trim(),$('password').value);$('password').value=''}catch(error){authStatus(chineseError(error))}finally{$('login').disabled=false}};
$('resetPassword').onclick=async()=>{if(!$('email').value.trim()){authStatus('请先填写邮箱。');return}try{await store.resetPassword($('email').value.trim());authStatus('如该邮箱可接收重置邮件，请查收邮件并设置密码。')}catch(error){authStatus(chineseError(error))}};
$('logout').onclick=()=>{if(permitNavigate())action(async()=>{await store.logout()})};
$('query').onclick=()=>{if(permitNavigate())action(()=>library())};
$('library').onclick=()=>{if(permitNavigate()){mode='library';action(()=>library())}};
$('trash').onclick=()=>{if(permitNavigate()){mode='trash';action(()=>library())}};
$('nextPage').onclick=()=>{if(permitNavigate())action(()=>library(true))};
$('importNew').onclick=()=>{if(!permitNavigate())return;clientUI.clear();clearImportState();$('file').value='';mode='import';layout();$('sort').parentElement.hidden=false;$('importPanel').hidden=false;$('saveControls').hidden=false;$('libraryFilters').hidden=true;status('请选择腾讯问卷CSV，分析完成后保存答卷。');$('file').click()};
$('selectAll').onclick=()=>{for(const c of clientUI.filtered())selected.add(c);clientUI.render()};
$('saveSelected').onclick=()=>action(()=>saveList(clientUI.get().filter(c=>selected.has(c))));
$('saveAll').onclick=()=>action(()=>saveList(clientUI.get()));
$('retry').onclick=()=>action(()=>saveList([...failed]));
$('moreStaff').onclick=()=>action(loadEmployees);
$('staffStats').onclick=()=>action(async()=>{
  const run=epoch,table=e('table'),head=e('tr');['员工','客户数','H平均','S平均','A平均','综合平均','最近保存'].forEach(x=>head.append(e('th',x)));table.append(head);$('statistics').replaceChildren(table);
  for(const employee of employees.values()){const stats=await store.statistics(employee.uid);if(run!==epoch)return;const row=e('tr');[displayName(employee.uid),stats.count,...['H','S','A','C'].map(k=>stats[k]==null?'—':Number(stats[k]).toFixed(1)),date(stats.latest)].forEach(x=>row.append(e('td',String(x))));table.append(row)}
});
$('backup').onclick=()=>action(async()=>{
  if(!confirm('将导出全部有权访问的客户（含回收站）。文件含客户资料，请妥善保存。是否继续？'))return;
  const run=epoch,all=[];
  for(const deleted of [false,true]){let next=null;do{const page=await store.list({deleted,sort:'date'},next);if(run!==epoch)return;all.push(...page.clients);next=page.hasMore?page.cursor:null;status(`正在准备备份：已读取${all.length}条。`)}while(next)}
  clientUI.download(JSON.stringify({format:'HSA-customers-v1',exportedAt:new Date().toISOString(),customers:all},null,2),'客户完整备份_'+Date.now()+'.json','application/json');status(`已导出${all.length}条客户，包含回收站。`);
});
async function start(){
  workspace.hidden=true;
  $('login').disabled=true;$('resetPassword').disabled=true;
  if(!firebaseConfig){$('login').disabled=true;$('resetPassword').disabled=true;authStatus('账号服务尚未配置，请联系管理员。');return}
  try{store=await createCloudStore(firebaseConfig);$('login').disabled=false;$('resetPassword').disabled=false;store.watch((user,error)=>{
    const wasSignedIn=!!actor;epoch++;actor=user;clearImportState();busy=false;cursor=null;employeeCursor=null;selected.clear();failed=[];employees.clear();clientUI.clear();$('file').value='';$('statistics').replaceChildren();$('owner').replaceChildren(new Option('全部员工',''));if(user||wasSignedIn)$('password').value='';
    layout();workspace.hidden=!user;$('accountBar').hidden=!user;$('loginPanel').hidden=!!user;
    if(!user){authStatus(error?chineseError(error):'请输入获授权的员工邮箱和密码。');return}
    employees.set(user.uid,user);$('accountName').textContent=(user.displayName||user.email)+' · '+(user.role==='ADMIN'?'管理员':'员工');$('libraryTitle').textContent=user.role==='ADMIN'?'全部客户':'我的客户';$('ownerLabel').hidden=user.role!=='ADMIN';$('staffArea').hidden=user.role!=='ADMIN';mode='library';
    action(async()=>{if(user.role==='ADMIN')await loadEmployees();await library()});
  })}catch(error){authStatus('登录服务未能连接：'+chineseError(error))}
}
await start();
