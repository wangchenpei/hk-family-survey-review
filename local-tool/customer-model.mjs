import {analyze} from './scoring.mjs';
import {fields,rules} from './bundled.mjs';
import {normalizeAnswer,answerOptionIndex} from './tencent-import.mjs';

export const questionFields=['stage','curriculum','grade','english','goal','route','move','identity','interest','education','work','renewal','schoolBudget','identityBudget','cost','decision','concern','city','school','name','phone'];
export const basicFields=['name','phone','city','school'];
export function scoreRaw(rawAnswers){
  const answers=Object.fromEntries(Object.entries(rawAnswers).map(([key,value])=>[key,normalizeAnswer(value,fields.find(f=>f.id===key)||{id:key})]));
  const indexes=Object.fromEntries(Object.entries(rawAnswers).map(([key,value])=>[key,answerOptionIndex(value)]));
  return {answers,result:analyze(answers,rules,fields,indexes,rawAnswers)};
}
export function editCustomer(client,values,notes,{rescore=false}={}){
  const rawAnswers={...client.rawAnswers,...values};
  const changed=Object.entries(values).some(([key,value])=>!basicFields.includes(key)&&value!==(client.rawAnswers?.[key]??''));
  const computed=changed||rescore?scoreRaw(rawAnswers):{answers:{...client.answers,...values},result:client.result};
  return {...client,...computed,rawAnswers,notes};
}
export async function customerKey(ownerUid,source,answerId){
  if(!source?.trim()||!answerId?.trim())throw new Error('请填写问卷来源和答卷编号后保存。');
  const bytes=new TextEncoder().encode(JSON.stringify([ownerUid,source.trim(),answerId.trim()]));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function searchTerms(id,name){
  return [...new Set([id,name].filter(Boolean).map(x=>String(x).trim().toLowerCase()))];
}
export function toRecord(client,ownerUid,source){
  const a=client.answers;
  return JSON.parse(JSON.stringify({ownerUid,source:source.trim(),answerId:String(a.customerId||'').trim(),rawAnswers:client.rawAnswers||{},answers:a,result:client.result,ruleVersion:client.result.version,basic:{name:a.name||'',phone:a.phone||a.contact||'',notes:client.notes||''},searchTerms:searchTerms(a.customerId,a.name),composite:client.result.composite,deleted:client.deleted||false,warnings:client.warnings||[]}));
}
export function fromRecord(snapshot){
  const d=snapshot.data();return {...d,id:snapshot.id,uid:snapshot.id,notes:d.basic.notes,revision:d.revision};
}
export function chineseError(error){
  const code=error?.code||'';
  if(code.includes('permission-denied'))return '没有访问权限，或员工账号已停用。请联系管理员。';
  if(code.includes('unauthenticated'))return '登录已失效，请重新登录。';
  if(/unavailable|network|deadline/.test(code))return '网络连接失败，当前结果已保留，请联网后手动重试。';
  if(code.includes('failed-precondition'))return '客户查询尚未配置完成，请联系管理员检查索引。';
  if(/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code))return '邮箱或密码不正确，请核对后重试。';
  if(code.includes('too-many-requests'))return '操作过于频繁，请稍后重试。';
  if(code.includes('resource-exhausted'))return '今日服务额度不足，请稍后重试并联系管理员。';
  if(code.includes('user-disabled'))return '账号已停用，请联系管理员。';
  if(code.startsWith('auth/')||['invalid-argument','internal','unknown','aborted'].includes(code))return '服务未能完成操作，请重试；如持续出现，请联系管理员检查配置。';
  return error?.message||'操作未完成，请重试。';
}
export async function saveSequential(list,save,onResult=()=>{}){
  const results=[];
  for(const client of list){try{const value=await save(client);results.push({client,ok:true,value});onResult(client,null,value)}catch(error){results.push({client,ok:false,error});onResult(client,error)}}
  return results;
}
