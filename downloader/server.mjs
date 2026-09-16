import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';
import {chromium} from 'playwright';import {parseLinks,archiveProduct} from './core.mjs';import {extractProduct} from './extract.mjs';
const base=path.dirname(fileURLToPath(import.meta.url)),root=process.env.FISH_OUTPUT||path.resolve(base,'../商品素材/下载器'),data=process.env.FISH_DATA||path.join(base,'.local');await fs.mkdir(data,{recursive:true});
let port=Number(process.env.FISH_PORT||8792),origin=`http://127.0.0.1:${port}`;let context,page,busy=false;
let jobs=await fs.readFile(path.join(data,'jobs.json'),'utf8').then(JSON.parse).catch(()=>[]);for(const j of jobs)if(['queued','running'].includes(j.state)){j.state='failed';j.message='上次运行已中断，请重试';}
let saving=Promise.resolve();const save=()=>{const snapshot=JSON.stringify(jobs,null,2);saving=saving.then(async()=>{await fs.writeFile(path.join(data,'jobs.tmp'),snapshot);await fs.rename(path.join(data,'jobs.tmp'),path.join(data,'jobs.json'));});return saving;};await save();
async function browser(){if(context)return context;context=await chromium.launchPersistentContext(path.join(data,'browser'),{...(process.env.FISH_BROWSER?{executablePath:process.env.FISH_BROWSER}:{channel:'chrome'}),headless:false,viewport:{width:1280,height:900}});context.on('close',()=>{context=null;page=null;});page=context.pages()[0]||await context.newPage();return context;}
async function collect(job){await browser();page=page&&!page.isClosed()?page:await context.newPage();job.message='读取商品页面';
 await page.goto(job.url,{waitUntil:'domcontentloaded',timeout:45000});
 try{await page.locator('span[class^="desc--"]').waitFor({timeout:18000});}catch{throw Error('未能读取商品：请在采集浏览器完成登录/验证，或确认商品未失效，然后重试');}
 const expand=page.getByText('展开',{exact:true});if(await expand.count()&&await expand.first().isVisible())await expand.first().click();
 const thumbs=page.locator('[class*="item-main-window-list-item"]');const n=await thumbs.count();
 for(let i=0;i<n;i++){await thumbs.nth(i).click();await page.waitForTimeout(180);}
 await page.locator('span[class^="desc--"]').scrollIntoViewIfNeeded();const product=await page.evaluate(extractProduct);
 if(product.id!==job.id)throw Error('商品ID不匹配');
 return archiveProduct(product,root,msg=>{job.message=msg;},async url=>{
 const response=await context.request.get(url,{timeout:30000,maxRedirects:0});if(!response.ok())throw Error(`图片请求失败 ${response.status()}`);return {body:await response.body(),type:response.headers()['content-type']};});
}
async function fromImport(job){return archiveProduct(job.sourceProduct,root,msg=>job.message=msg,async url=>{const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('图片请求失败 '+r.status);const type=r.headers.get('content-type');if(Number(r.headers.get('content-length'))>30000000)throw Error('图片过大');const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>30000000)throw Error('图片过大');chunks.push(chunk);}return {body:Buffer.concat(chunks),type};});}
async function run(){if(busy)return;busy=true;try{for(const job of jobs.filter(j=>j.state==='queued')){job.state='running';await save();try{Object.assign(job,await (job.sourceProduct?fromImport(job):collect(job)));job.state=job.complete?'done':'partial';job.message=job.complete?`完成 ${job.images.length} 张`:'部分下载或完整性待核对';}catch(e){job.state='failed';job.message=e.message;}await save();}}finally{busy=false;if(jobs.some(j=>j.state==='queued'))void run();}}
const json=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));};
const server=http.createServer(async(req,res)=>{try{
 if(req.headers.host!==`127.0.0.1:${port}`)return json(res,403,{error:'Host rejected'});
 const u=new URL(req.url,origin);
 if(req.method==='GET'&&u.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(await fs.readFile(path.join(base,'index.html')));}
 if(req.method==='GET'&&u.pathname==='/api/jobs')return json(res,200,{jobs,busy,output:root,browserOpen:!!context});
 if(req.method==='GET'&&u.pathname==='/api/bookmarklet'){const code=`(()=>{const p=(${extractProduct.toString()})();if(!p.description||!p.images.length){alert('请先打开闲鱼商品详情页');return;}location.href=${JSON.stringify(origin)}+'/#import='+encodeURIComponent(JSON.stringify(p));})()`;return json(res,200,{url:'javascript:'+encodeURIComponent(code)});}
 if(req.method==='GET'&&(u.pathname==='/zip'||u.pathname==='/image')){const j=jobs.find(j=>j.key===u.searchParams.get('job'));if(!j?.dir)throw Error('没有产物');let file;if(u.pathname==='/zip'){file=j.dir+'.zip';res.setHeader('Content-Disposition','attachment; filename="product.zip"');res.setHeader('Content-Type','application/zip');}else{const im=j.images?.[Number(u.searchParams.get('n'))];if(!im)throw Error('图片不存在');file=path.join(j.dir,im.file);res.setHeader('Content-Type',`image/${path.extname(file).slice(1)}`);}return res.end(await fs.readFile(file));}
 if(req.method!=='POST'||req.headers.origin!==origin)return json(res,403,{error:'Origin rejected'});
 let raw='';for await(const part of req){raw+=part;if(raw.length>200000)throw Error('请求过大');}const body=JSON.parse(raw||'{}');
 if(u.pathname==='/api/import'){const p=body.product;const link=parseLinks(p?.url||'')[0];if(p.id!==link.id||typeof p.description!=='string'||!p.description.trim()||p.description.length>50000||!Array.isArray(p.images)||!p.images.length||p.images.length>30||p.images.some(x=>typeof x!=='string'))throw Error('无效的商品资料');const clean={id:link.id,url:link.url,title:p.description.split('\n')[0],description:p.description,images:p.images,expected:p.expected,expanded:p.expanded===true};jobs.push({...link,key:crypto.randomUUID(),sourceProduct:clean,state:'queued',message:'导入图文，等待下载'});await save();void run();return json(res,200,{ok:true});}
 if(u.pathname==='/api/login'){if(busy)throw Error('采集中，请等待结束后操作登录');await browser();await page.goto('https://www.goofish.com/',{waitUntil:'domcontentloaded'});return json(res,200,{ok:true});}
 if(u.pathname==='/api/add'){const links=parseLinks(body.text||'');let added=0;for(const l of links){if(jobs.some(j=>j.id===l.id&&['queued','running','done'].includes(j.state)))continue;jobs.push({...l,key:crypto.randomUUID(),state:'queued',message:'排队中'});added++;}await save();void run();return json(res,200,{added});}
 if(u.pathname==='/api/retry'){const j=jobs.find(j=>j.key===body.key);if(!j||!['failed','partial'].includes(j.state))throw Error('任务不可重试');j.state='queued';j.message='重新采集，新建版本保留旧文件';await save();void run();return json(res,200,{ok:true});}
 if(u.pathname==='/api/open'){const j=jobs.find(j=>j.key===body.key);if(!j?.dir)throw Error('没有产物');spawn('explorer.exe',[j.dir],{detached:true,stdio:'ignore'}).unref();return json(res,200,{ok:true});}
 return json(res,404,{error:'Not found'});
}catch(e){json(res,400,{error:e.message});}});
server.on('error',e=>{if(e.code==='EADDRINUSE')console.log('端口已占用，请打开 '+origin);else console.error(e.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{port=server.address().port;origin=`http://127.0.0.1:${port}`;console.log(`闲鱼素材下载器 ${origin}`);process.parentPort?.postMessage({type:'ready',url:origin});if(process.env.FISH_OPEN==='1')spawn('explorer.exe',[origin],{stdio:'ignore',detached:true}).unref();});

process.parentPort?.on("message",async event=>{if(event.data?.type==="shutdown"){await context?.close();await saving;server.close(()=>process.exit(0));}});
