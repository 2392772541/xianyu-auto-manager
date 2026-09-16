import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {zipSync,strToU8} from 'fflate';
export function parseLinks(text) {
 const urls=text.match(/https?:\/\/[^\s<>"“”]+/g)||[];
 const out=[];
 for(let raw of urls){raw=raw.replace(/[。，,；;！!）)]+$/,'');const u=new URL(raw);
 if(u.protocol!=='https:'||!(u.hostname==='goofish.com'||u.hostname==='www.goofish.com')||u.pathname!=='/item'||!/^\d{6,20}$/.test(u.searchParams.get('id')||'')) throw Error('请使用闲鱼网页版商品长链接（https://www.goofish.com/item?id=...），首版暂不支持短链或口令');
 const id=u.searchParams.get('id');if(!out.some(x=>x.id===id))out.push({id,url:`https://www.goofish.com/item?id=${id}`});}
 if(!out.length)throw Error('没有识别到商品链接');if(out.length>20)throw Error('一次最多20个商品');return out;
}
export function imageUrl(raw){const u=new URL(raw);if(u.protocol!=='https:'||!(u.hostname==='img.alicdn.com'||u.hostname==='gw.alicdn.com')||u.username||u.password||u.port)throw Error('不支持的图片来源');return u.href;}
export const safeName=s=>s.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,45).replace(/[. ]+$/,'')||'商品';
export async function archiveProduct(product,root,progress,requestImage){
 if(!product.description||!product.images.length)throw Error('正文或图集为空，无法归档');
 const dir=path.join(root,`${product.id}-${safeName(product.title)}`,new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(2).toString('hex'));
 await fs.mkdir(path.join(dir,'图片'),{recursive:true});const files={},images=[],failed=[],seen=new Map();
 for(let i=0;i<product.images.length;i++){
  let last;for(let attempt=0;attempt<3;attempt++){try{
   const url=imageUrl(product.images[i]);const {body,type}=await requestImage(url);
   if(!type?.startsWith('image/')||body.length>30*1024*1024)throw Error('图片格式或大小无效');
   const meta=await sharp(body,{limitInputPixels:60000000}).metadata();await sharp(body,{limitInputPixels:60000000}).raw().toBuffer();
   const hash=crypto.createHash('sha256').update(body).digest('hex');let name=seen.get(hash);
   if(!name){const ext={jpeg:'jpg',png:'png',webp:'webp',gif:'gif',avif:'avif'}[meta.format];if(!ext)throw Error('不支持的图片格式');name=`图片/${String(i+1).padStart(2,'0')}.${ext}`;seen.set(hash,name);files[name]=new Uint8Array(body);await fs.writeFile(path.join(dir,name),body);}
   images.push({position:i+1,url,file:name,width:meta.width,height:meta.height,sha256:hash});last=null;break;
  }catch(e){last=e;if(attempt<2)await new Promise(r=>setTimeout(r,500*2**attempt));}}
  if(last)failed.push({position:i+1,url:product.images[i],error:last.message});progress(`图片 ${i+1}/${product.images.length}`);
 }
 const complete=!failed.length&&product.expanded&&product.expected===images.length;
 const report={...product,url:`https://www.goofish.com/item?id=${product.id}`,capturedAt:new Date().toISOString(),images,failed,complete,uniqueImages:seen.size};
 files['文案.txt']=strToU8(product.description);files['商品信息.json']=strToU8(JSON.stringify(report,null,2));
 for(const n of ['文案.txt','商品信息.json'])await fs.writeFile(path.join(dir,n),files[n]);
 await fs.writeFile(dir+'.zip',zipSync(files));return {dir,complete,images,failed,description:product.description,title:product.title};
}
