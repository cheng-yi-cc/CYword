import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root=process.cwd(),dir=path.join(root,'.work/cet4/pilot-data');
const raw=fs.readFileSync(path.join(dir,'catalog.json'),'utf8');
const catalog=JSON.parse(raw);
if(catalog.book.code!=='cet4'||catalog.stats.wordCount!==100)throw Error('Build the 100-word CET4 trial first');
catalog.dataVersion=`cet4-trial-${crypto.createHash('sha256').update(raw).digest('hex').slice(0,12)}`;
const words=Object.fromEntries(Object.keys(catalog.words).map(id=>[id,JSON.parse(fs.readFileSync(path.join(dir,'words',`${id}.json`),'utf8'))]));
const server=await createServer({configFile:false,root,plugins:[react(),{
  name:'cet4-local-trial',
  transformIndexHtml(){return [{tag:'script',injectTo:'head-prepend',children:`
    const TRIAL_KEY='cyword-cet4-trial-progress-v1';
    const get=async(url,options)=>{const r=await fetch(url,options);if(!r.ok)throw Error('试验数据读取失败');return r.json();};
    window.cyword={
      readCatalog:()=>get('/__cet4/catalog'),
      readWords:request=>get('/__cet4/words',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)}),
      readProgress:async()=>JSON.parse(localStorage.getItem(TRIAL_KEY)||'null'),
      writeProgress:async progress=>{localStorage.setItem(TRIAL_KEY,JSON.stringify(progress));return true;},
      readSession:async()=>({token:'local-editorial-trial',user:{id:'local-editor',email:'本地试验，无需登录',createdAt:0,lastLoginAt:0,loginCount:1}}),
      clearSession:async()=>true
    };
  `},{tag:'div',injectTo:'body-prepend',attrs:{style:'position:fixed;right:18px;bottom:12px;z-index:1000;background:#fff8e8;border:1px solid #c5a768;border-radius:6px;padding:8px 12px;font:12px Microsoft YaHei;color:#684b20;'},children:'四级 100 词试验集 · 含 70 词待复核初稿'}];},
  configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
    if(!req.url?.startsWith('/__cet4/'))return next();
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
    const fail=(status,msg)=>{res.statusCode=status;res.end(JSON.stringify({error:msg}));};
    if(req.method==='GET'&&req.url==='/__cet4/catalog'){res.end(JSON.stringify(catalog));return;}
    if(req.method!=='POST'||req.url!=='/__cet4/words'){fail(404,'Unknown trial endpoint');return;}
    try{
      let body='';for await(const chunk of req){body+=chunk;if(body.length>100000)throw Error('Request too large');}
      const request=JSON.parse(body);
      if(request.dataVersion!==catalog.dataVersion){fail(409,'Trial data changed; reload the page');return;}
      if(!Array.isArray(request.wordIds)||request.wordIds.length>100||request.wordIds.some(id=>typeof id!=='string'||!Object.hasOwn(words,id))){fail(400,'Unknown trial word');return;}
      const chosen=Object.fromEntries([...new Set(request.wordIds)].map(id=>[id,words[id]]));
      res.end(JSON.stringify({dataVersion:catalog.dataVersion,wordCount:Object.keys(chosen).length,words:chosen}));
    }catch{fail(400,'Invalid trial request');}
  });}
}],server:{host:'127.0.0.1',port:5189,strictPort:true},base:'./'});
await server.listen();console.log('100-word CET4 editorial trial: http://127.0.0.1:5189/');
