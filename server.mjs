import http from 'node:http';
import {readFile,writeFile,mkdir,readdir,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomBytes,randomUUID,createCipheriv,createDecipheriv,scryptSync,timingSafeEqual} from 'node:crypto';
import {validate,score} from './public/questions.mjs';
export async function createApp(options={}){
const env={...process.env,...options.env};const production=env.NODE_ENV==='production';
const enabled=env.COLLECTION_ENABLED==='true';const key=env.DATA_KEY?Buffer.from(env.DATA_KEY,'hex'):null;
if(enabled&&(!key||key.length!==32||!/^[a-f0-9]{64}$/i.test(env.DATA_KEY)||!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<16||!env.OPERATOR||!env.PRIVACY_EMAIL||!env.RECIPIENTS||!env.RETENTION_DAYS||!env.DATA_REGION))throw Error('真实收集需完整配置运营信息、32字节密钥及至少16位后台密码');
if(production&&enabled&&(!env.PUBLIC_ORIGIN?.startsWith('https://')||!env.ADMIN_ORIGIN?.startsWith('https://')))throw Error('生产部署须指定HTTPS来源');
const root=fileURLToPath(new URL('./public/',import.meta.url));const dir=options.dataDir||env.DATA_DIR||path.resolve('data');const sessions=new Map(),limits=new Map();const salt=randomBytes(16),hash=scryptSync(env.ADMIN_PASSWORD||randomBytes(32).toString('hex'),salt,32);
const allowed=new Set([env.PUBLIC_ORIGIN||'http://localhost:4173',env.ADMIN_ORIGIN||'http://localhost:4173']);
function encrypt(l){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(JSON.stringify(l)),c.final()]);return JSON.stringify({iv:iv.toString('hex'),tag:c.getAuthTag().toString('hex'),data:data.toString('hex')})}
function decrypt(s){const e=JSON.parse(s),c=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'hex'));c.setAuthTag(Buffer.from(e.tag,'hex'));return JSON.parse(Buffer.concat([c.update(Buffer.from(e.data,'hex')),c.final()]).toString())}
async function records(){await mkdir(dir,{recursive:true});const out=[];for(const f of await readdir(dir)){if(!/^[a-f0-9-]{36}\.enc$/.test(f))continue;const l=decrypt(await readFile(path.join(dir,f),'utf8'));if(Date.now()-Date.parse(l.createdAt)>Number(env.RETENTION_DAYS||90)*86400000){await unlink(path.join(dir,f));continue}out.push(l)}return out.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
function rate(req,type,max){const now=Date.now(),id=type+':'+req.socket.remoteAddress;let v=limits.get(id);if(!v||v.until<now)v={n:0,until:now+600000};v.n++;limits.set(id,v);if(limits.size>10000)for(const [k,v]of limits)if(v.until<now)limits.delete(k);if(v.n>max)throw Object.assign(Error('操作过于频繁，请稍后重试'),{status:429})}
async function body(req){let str='';for await(const part of req){str+=part;if(Buffer.byteLength(str)>16384)throw Object.assign(Error('请求过大'),{status:413})}try{return JSON.parse(str)}catch{throw Object.assign(Error('无效请求'),{status:400})}}
const server=http.createServer(async(req,res)=>{const origin=req.headers.origin;res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value))};
try{const url=new URL(req.url,'http://local');if(url.pathname.startsWith('/api/')){
if(origin&&!allowed.has(origin))return json(403,{error:'来源未授权'});if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS')}
if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}
if(url.pathname==='/api/health')return json(200,{ok:true,collection:enabled});
if(!enabled)return json(503,{error:'预览版尚未开放真实数据收集'});
if(url.pathname==='/api/leads'&&req.method==='POST'){rate(req,'submit',10);const b=await body(req);if(b.consent!==true||b.share!==true||b.privacyVersion!=='v1-review')return json(400,{error:'缺少有效授权'});let answers;try{answers=validate(b.answers||{})}catch(e){return json(400,{error:e.message})}const id=randomUUID(),l={id,answers,score:score(answers),createdAt:new Date().toISOString(),consent:true,share:true,marketing:b.marketing===true,privacyVersion:b.privacyVersion};await mkdir(dir,{recursive:true});await writeFile(path.join(dir,id+'.enc'),encrypt(l),{flag:'wx',mode:0o600});return json(201,{id})}
if(url.pathname==='/api/admin/login'&&req.method==='POST'){rate(req,'login',5);const b=await body(req),p=typeof b.password==='string'&&b.password.length<=256?b.password:'';if(!timingSafeEqual(scryptSync(p,salt,32),hash))return json(401,{error:'登录失败'});for(const[t,s]of sessions)if(s<Date.now())sessions.delete(t);const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+3600000);return json(200,{token})}
const token=(req.headers.authorization||'').replace(/^Bearer /,'');if(!sessions.has(token)||sessions.get(token)<Date.now())return json(401,{error:'请登录'});
if(url.pathname==='/api/admin/logout'&&req.method==='POST'){sessions.delete(token);return json(200,{ok:true})}
if(url.pathname==='/api/admin/leads'&&req.method==='GET')return json(200,await records());
if(/^\/api\/admin\/leads\/[a-f0-9-]{36}$/.test(url.pathname)&&req.method==='DELETE'){try{await unlink(path.join(dir,url.pathname.split('/').at(-1)+'.enc'))}catch(e){if(e.code!=='ENOENT')throw e}return json(200,{ok:true})}return json(404,{error:'未找到接口'});
}
let name=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!['index.html','admin.html','style.css','app.mjs','admin.mjs','questions.mjs','config.js'].includes(name)){res.writeHead(404);return res.end('Not found')}
let content=await readFile(path.join(root,name));if(name==='config.js')content=Buffer.from('window.SURVEY_CONFIG = '+JSON.stringify({apiBase:env.API_BASE||'',preview:!enabled})+';');
if(name==='index.html'&&enabled){const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));content=Buffer.from(content.toString().replace('预览版 · 题库和隐私条款待确认，请勿填写真实个人资料。','本问卷仅用于您授权的咨询服务。').replace(/<p id="privacy">.*?<\/p>/,`<p id="privacy">运营主体：${esc(env.OPERATOR)}。接收团队：${esc(env.RECIPIENTS)}。存储地域：${esc(env.DATA_REGION)}。保存期限：${esc(env.RETENTION_DAYS)}天，届满清理。用于本次升学及身份咨询；查阅、更正、撤回授权或删除请联系 ${esc(env.PRIVACY_EMAIL)}。不提供证件或孩子姓名。营销需另行自愿授权。评分不代表录取或身份申请资格。</p>`).replaceAll('联合项目 · 待运营方确认',esc(env.OPERATOR)).replace('（必选；团队名单待确认）','（必选；团队名单见隐私告知）'))}
res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css':'text/javascript'});res.end(content);
}catch(e){json(e.status||500,{error:e.status?e.message:'服务暂不可用，请稍后重试'})}});
if(enabled){await records();const cleanup=setInterval(()=>records().catch(()=>console.error('Retention cleanup failed')),3600000);cleanup.unref();server.on('close',()=>clearInterval(cleanup));}
return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const server=await createApp();server.listen(Number(process.env.PORT||4173),process.env.HOST||'127.0.0.1',()=>console.log('Local: http://localhost:'+(process.env.PORT||4173)));}
