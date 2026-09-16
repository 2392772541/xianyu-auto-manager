const {app,BrowserWindow,utilityProcess,dialog}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
let backend,window,quitting=false;
const smoke=process.env.FISH_SMOKE_DIR;
if(smoke)app.setPath('userData',path.join(smoke,'profile'));
if(!app.requestSingleInstanceLock())app.quit();
else {
app.on('second-instance',()=>{window?.restore();window?.focus();});
app.whenReady().then(()=>{
 const data=path.join(app.getPath('userData'),'collector');
 const output=smoke?path.join(smoke,'output'):path.join(app.getPath('documents'),'闲鱼商品素材');
 fs.mkdirSync(data,{recursive:true});
 const browserRoot=app.isPackaged?path.join(process.resourcesPath,'browser'):path.join(__dirname,'build-browser');
 const folder=fs.readdirSync(browserRoot).find(n=>/^chromium-\d+$/.test(n));
 const browser=path.join(browserRoot,folder||'', 'chrome-win64','chrome.exe');
 if(!fs.existsSync(browser))throw Error('内置采集浏览器缺失，请重新解压完整软件');
 const log=fs.createWriteStream(path.join(data,'desktop.log'),{flags:'a'});
 backend=utilityProcess.fork(path.join(__dirname,'server.mjs'),[],{env:{...process.env,FISH_PORT:'0',FISH_DATA:data,FISH_OUTPUT:output,FISH_BROWSER:browser,FISH_OPEN:'0'},stdio:'pipe'});
 backend.stdout.on('data',d=>log.write(d));backend.stderr.on('data',d=>log.write(d));
 backend.on('message',async msg=>{
  if(msg.type!=='ready')return;
  if(smoke)fs.writeFileSync(path.join(smoke,'ready.json'),JSON.stringify({url:msg.url,browser,output,execPath:process.execPath}));
  window=new BrowserWindow({width:1220,height:850,minWidth:800,minHeight:600,title:'闲鱼素材下载器',autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==msg.url)event.preventDefault();});
  await window.loadURL(msg.url);
  if(smoke){
   const timer=setInterval(async()=>{
    if(fs.existsSync(path.join(smoke,'capture'))){fs.unlinkSync(path.join(smoke,'capture'));fs.writeFileSync(path.join(smoke,'window.png'),(await window.webContents.capturePage()).toPNG());}
    if(fs.existsSync(path.join(smoke,'stop'))){clearInterval(timer);app.quit();}
   },500);
  }
 });
 backend.on('exit',code=>{if(!quitting){dialog.showErrorBox('下载服务已退出',`错误码 ${code}。日志：${path.join(data,'desktop.log')}`);app.quit();}});
}).catch(e=>{dialog.showErrorBox('启动失败',e.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{if(backend&&!quitting){event.preventDefault();quitting=true;backend.postMessage({type:'shutdown'});backend.once('exit',()=>app.quit());setTimeout(()=>{backend.kill();app.quit();},5000).unref();}});
}
