'use strict';
let mf=chrome.runtime.getManifest(),
vk={url:mf.host_permissions},
perm={origins:mf.optional_host_permissions},
menu=t=>chrome.contextMenus.create({id:t,title:chrome.i18n.getMessage(t),contexts:['action']}),
icon=e=>{
	chrome.action.setTitle({title:mf.short_name+': '+chrome.i18n.getMessage(['on','off','err'][e])});
	let c=new OffscreenCanvas(48,48),c2=new OffscreenCanvas(48,48),x=c.getContext('2d'),g=x.createConicGradient(0,24,24);g.addColorStop(0,'#F70000');g.addColorStop(0.12,'#FF6A00');g.addColorStop(0.25,'#FFFF00');g.addColorStop(0.37,'#00EF33');g.addColorStop(0.5,'#00F9F9');g.addColorStop(0.62,'#0038F2');g.addColorStop(0.75,'#7A00F4');g.addColorStop(0.87,'#EA00A8');g.addColorStop(1,'#F70000');
	x.fillStyle=e?g:'#07f';x.arc(24,24,24,0,Math.PI*2);x.fill();
	if(e)x.beginPath(),x.fillStyle='#222222',x.arc(24,24,21,0,Math.PI*2),x.fill();
	if(e<2)x.fillStyle='white',x.fill(new Path2D('M7.6 18.2a2.9 2.4 70 014.6-1.9c1.8 4.5 5 14.5 11.2 14.7a2.9 2.4 0 010 5c-2.8 0-9.4.3-15.8-17.8m13.9-.9a2.5 3 0 015 0v5c.2 1.4 2 1.1 7.7-6.6a2.9 2.4-60 014 3c-5.5 7.8-9 9.8-11.7 9.8q-5 0-5-6m10.8 9.9a2.9 2.4 40 014-3q1 1 1.9 2.3a2.9 2.4 50 01-4 3l-1.9-2.3'));
	else x.strokeStyle='white',x.lineWidth=4,x.stroke(new Path2D('M18 16h-8v18h8m-6-9h5m12-1h-6v12m17-12h-6v12'));
	chrome.action.setIcon({imageData:x.getImageData(0,0,48,48)})
},
send=(e,a=0,k)=>chrome.tabs.query(vk,t=>(k==1?[t[0]]:k?t.filter(t=>k==t.id):t).forEach(t=>chrome.scripting.executeScript({target:{tabId:t.id},func:(e,a)=>{switch(e){case 'mode':window.st?st.m(a):location.reload();break;case 'reload':location.reload();break;case 'ask':window.nav?nav.go(a):location.href=a;break;case 'reset':window.st?st.ss():(localStorage.clear(),sessionStorage.clear(),location.reload());break;case 'resetApp':localStorage.clear(),sessionStorage.clear(),indexedDB.deleteDatabase('st');break;case 'eye':st.eye(a);break;case 'key':st.k(a);break;}},args:[e,a],world:'MAIN'}))),
mode=(e,a)=>{
	let o={mode:e?+!a.mode:a.mode!=void 0?a.mode:1,n:mf.short_name,url:mf.homepage_url}, c=(a='',b='')=>{a=a.split('.');b=b.split('.');for(let i=0,m=Math.max(a.length,b.length);i<m;i++){let n=+a[i]||0,o=+b[i]||0;if(o>n)return 0;if(n>o)return 1}return 0};
	e?send('mode',o.mode?1:0):c(mf.version,a.v)&&(o.v=mf.version,o.C=0,send('reload'));
	icon(o.mode),chrome.storage.local.set(o),chrome.storage.sync.set(o)
},
rule=e=>chrome.permissions.contains(perm,async a=>{e&&=await chrome.permissions.request(perm);chrome.contextMenus.update('src',{title:chrome.i18n.getMessage(e^a?'srcOff':'src')});e&&chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[1,2],addRules:e^a?[{id:1,condition:{requestDomains:['vk.com','vk.ru'],resourceTypes:['main_frame']},action:{type:'modifyHeaders',responseHeaders:[{header:'content-security-policy',operation:'remove'},{header:'content-security-policy-report-only',operation:'remove'}]}},{id:2,condition:{initiatorDomains:['vk.com','vk.ru'],domainType:'thirdParty'},action:{type:'modifyHeaders',responseHeaders:[{header:'access-control-allow-origin',operation:'set',value:'*'}]}}]:(chrome.permissions.remove(perm),[])},e=>chrome.tabs.query(vk,t=>t.forEach(t=>chrome.tabs.reload(t.id))))}),
sync=e=>chrome.storage.local.get(['mode','v'],a=>a?.v?mode(e,a):chrome.storage.sync.get(null,b=>{a&&b?mode(e,b):!e&&(chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:'https://vk.com/@2style-err'})),icon(2))}));sync();
chrome.action.onClicked.addListener(()=>chrome.tabs.query(vk,e=>e[0]?e.find(e=>e.active)?sync(1):chrome.tabs.update(e[0].id,{active:true}):chrome.tabs.create({url:'https://vk.com',index:0})));
chrome.contextMenus.removeAll();menu('ask');menu('reset');menu('resetApp');menu('src');rule();
chrome.contextMenus.onClicked.addListener(async e=>{
	if(e.menuItemId=='ask')chrome.tabs.query(vk,e=>e[0]?chrome.tabs.update(e[0].id,{active:true},()=>send('ask','/write-236004526',1)):chrome.tabs.create({url:'https://vk.com/write-236004526',index:0}));
	if(e.menuItemId=='reset')send('reset');
	if(e.menuItemId=='resetApp')send('resetApp',0,1),setTimeout(e=>{chrome.storage.local.clear();chrome.storage.sync.get('plus',a=>chrome.storage.sync.clear(()=>chrome.storage.sync.set(a,()=>chrome.runtime.reload())))},100);
	if(e.menuItemId=='src')rule(1);
});
chrome.commands.onCommand.addListener((key,t)=>key=='eye'?chrome.permissions.request({permissions:['activeTab']},()=>chrome.tabs.captureVisibleTab(data=>send('eye',data,t.id))):send('key',key,1));
chrome.runtime.setUninstallURL('https://vk.ru/');
chrome.runtime.onStartup.addListener(()=>{})