import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const read=name=>readFile(join(root,name),'utf8');

test('Pages artifact ships the application shell expected by cloud-ui',async()=>{
  const html=await read('index.html');
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
  const dynamicallyCreated=new Set('accountBar accountName loginPanel loginForm email password login resetPassword authStatus logout cloudToolbar navigationSource library importNew trash moreActions backup pagingControls prevPage pageStatus nextPage saveControls selectAll saveSelected saveAll retry cloudStatus restoreSelected'.split(' '));
  for(const id of ['account','workspace','clients','deleteSelected','libraryActions','csv','zip','exportScope'])
    assert(ids.has(id),`Pages index.html is missing #${id}`);
  for(const file of ['app.mjs','cloud-ui.mjs']){
    const source=await read(file);
    for(const [,id] of source.matchAll(/\$\(["']([A-Za-z0-9_-]+)["']\)/g))
      assert(ids.has(id)||dynamicallyCreated.has(id),`${file} accesses #${id}, which the Pages shell does not provide`);
  }
  assert.match(html,/<script\s+defer\s+src="\.\/bootstrap\.js"|<script\s+defer\s+src="bootstrap\.js"/);
  assert.match(html,/class="exportActions"/);
});

test('Pages artifact contains every path-relative JavaScript module import',async()=>{
  const names=new Set(await readdir(root));
  const modules=[...names].filter(name=>/\.(?:mjs|js)$/.test(name));
  for(const name of modules){
    const source=await read(name);
    const imports=[...source.matchAll(/(?:from\s*|import\s*\()\s*['"](\.\/[^'"]+)['"]/g)].map(match=>match[1]);
    for(const specifier of imports){
      const target=resolve(root,dirname(name),specifier);
      assert(target.startsWith(root+ '\\')||target.startsWith(root+'/'),`${name} import escapes Pages artifact: ${specifier}`);
      assert(names.has(specifier.slice(2)),`${name} imports missing Pages asset ${specifier}`);
    }
  }
  assert(names.has('cloud-ui.mjs'));
  assert(names.has('customer-model.mjs'));
});
