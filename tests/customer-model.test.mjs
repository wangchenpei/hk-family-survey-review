import {test} from 'node:test';
import assert from 'node:assert/strict';
import {customerKey,toRecord,editCustomer,scoreRaw,saveSequential,saveBounded,questionFields} from '../local-tool/customer-model.mjs';
const raw=Object.fromEntries(questionFields.map(k=>[k,'A.合成答案']));
raw.customerId='SYNTH-001';raw.name='合成客户';raw.phone='';
function client(){return {uid:'synthetic',rawAnswers:{...raw},...scoreRaw(raw),warnings:[]}}
test('同一员工来源编号得到相同标识，不同员工来源隔离',async()=>{
  assert.equal(await customerKey('one','survey','1'),await customerKey('one','survey','1'));
  assert.notEqual(await customerKey('one','survey','1'),await customerKey('two','survey','1'));
  assert.notEqual(await customerKey('one','survey','1'),await customerKey('one','other','1'));
  await assert.rejects(customerKey('one','','1'));
});
test('基本资料修改保留历史评分快照，答案修改重算',()=>{
  const c=client();c.result={...c.result,version:'historical'};
  const basics=editCustomer(c,{name:'合成改名',phone:''},'备注');assert.deepEqual(basics.result,c.result);
  const changed=editCustomer(c,{cost:'B.只考虑学费'},'');assert.equal(changed.result.version,'HSA-v1.0.0');
  assert.equal(changed.result.dimensions.S[0].items.find(i=>i.label==='Q15').points,5);
  assert.deepEqual(editCustomer(c,{},'',{rescore:true}).result,scoreRaw(raw).result);
});
test('记录保留完整答案评分与可选资料',()=>{
  const record=toRecord(client(),'owner','survey');assert.equal(record.ownerUid,'owner');assert.equal(record.basic.phone,'');
  assert.equal(record.ruleVersion,record.result.version);assert.deepEqual(record.rawAnswers,raw);assert.equal(record.deleted,false);
});
test('批量部分失败保留结果，仅重试失败客户',async()=>{
  const list=[client(),client(),client()];let calls=0;
  const results=await saveSequential(list,async()=>{if(++calls===2)throw Error('network');return {saved:true}});
  assert.deepEqual(results.map(r=>r.ok),[true,false,true]);assert.equal(list[1].rawAnswers.customerId,'SYNTH-001');
  const retry=await saveSequential(results.filter(r=>!r.ok).map(r=>r.client),async()=>true);assert.equal(retry.length,1);assert.equal(retry[0].ok,true);
});
test('批量保存并发最多为3，保留逐条结果并支持失败重试',async()=>{
  const list=Array.from({length:8},client);let active=0,maxActive=0,calls=0;
  const results=await saveBounded(list,async item=>{
    active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,3));active--;calls++;
    if(item===list[2])throw Error('network');return item.rawAnswers.customerId;
  });
  assert.equal(maxActive,3);assert.equal(calls,8);assert.deepEqual(results.map(result=>result.ok),[true,true,false,true,true,true,true,true]);
  const retried=await saveBounded(results.filter(result=>!result.ok).map(result=>result.client),async()=>({saved:true}));
  assert.equal(retried.length,1);assert.equal(retried[0].ok,true);
});
