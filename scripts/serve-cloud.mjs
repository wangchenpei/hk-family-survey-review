import http from 'node:http';
import {readFile} from 'node:fs/promises';
const files=new Set(['index.html','bootstrap.js','app.mjs','csv.mjs','tencent-import.mjs','bundled.mjs','scoring.mjs','export.mjs','style.css','firebase-config.mjs','customer-model.mjs','cloud-store.mjs','cloud-ui.mjs']);
const base=new URL('../local-tool/',import.meta.url);
http.createServer(async(req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(req.method!=='GET'||!files.has(file)){res.writeHead(404);res.end();return}
  try{const bytes=await readFile(new URL(file,base));res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes)}catch{res.writeHead(404);res.end()}
}).listen(4181,'127.0.0.1',()=>console.log('Local cloud UI: http://127.0.0.1:4181/'));
