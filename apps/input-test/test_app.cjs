"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const read=p=>fs.readFileSync(path.join(__dirname,p),"utf8");let ms=0,id=0,listener,report;const timers=new Map(),nodes=[],drawn=[];
const ctx=new Proxy({fillText(s){drawn.push(String(s));}}, {get(t,k){if(["createImageData","getImageData","putImageData","drawImage"].includes(k))throw Error("Unneeded Canvas API "+k);return t[k]||function(){};}});
const body={appendChild(n){n.parentNode=this;nodes.push(n);},removeChild(n){nodes.splice(nodes.indexOf(n),1);n.parentNode=null;}};
const sandbox=vm.createContext({Date:class extends Date{static now(){return ms;}},console,innerWidth:1280,innerHeight:720,document:{body,createElement(){return {style:{},getContext(){return ctx;}};}},
 engine:{on(_,fn){listener=fn;},off(_,fn){assert.equal(fn,listener);listener=null;}},createCivVerifiedNativeTouch(){throw Error("Mock unsupported SDK");},read64(){throw Error("No native calls");},sdk_base:0n,
 log(){return Promise.resolve();},sendCivInputProReport(r){report=r;},setInterval(fn,delay){timers.set(++id,{fn,delay});return id;},setTimeout(fn,delay){timers.set(++id,{fn,delay});return id;},clearInterval(i){timers.delete(i);},clearTimeout(i){timers.delete(i);}});sandbox.window=sandbox;
vm.runInContext(read("vendor/civswitch-input.js")+"\n"+read("rumble.js")+"\n"+read("motion.js")+"\n"+read("model.js")+"\n"+read("solid-mono.js")+"\n"+read("solid-text.js")+"\n"+read("view.js"),sandbox);
const nativeText=sandbox.createSolidMonoText;sandbox.createSolidMonoText=function(ctx){const draw=nativeText(ctx);return function(s,...args){drawn.push(String(s));return draw(s,...args);};};
// Override after the library has defined the verified native constructor.
sandbox.createCivVerifiedNativeTouch=()=>{throw Error("Mock unsupported SDK");};
function tick(dt=33){ms+=dt;[...timers.values()].find(t=>t.delay===33).fn();}
function press(name){listener(name,0,0,0);tick();listener(name,1,0,0);tick();}
(async()=>{const pending=vm.runInContext(read("app.js"),sandbox);let ended=false;pending.then(()=>ended=true);await new Promise(setImmediate);assert.equal(ended,false);
 const actions=["accept","cancel","shell-action-1","shell-action-2","nav-up","nav-down","nav-left","nav-right","nav-previous","nav-next","nav-shell-previous","nav-shell-next","shell-action-5","sys-menu","shell-action-4","shell-action-3"];
 actions.forEach(press);
 listener("shell-action-5",0,0,0);listener("sys-menu",0,0,0);tick();tick(1001);listener("shell-action-5",1,0,0);listener("sys-menu",1,0,0);tick();
 for(let i=0;i<3;i++)press("nav-down");press("accept");press("nav-right");press("nav-right");press("nav-left");assert(drawn.includes("The basics"));assert(drawn.includes("Under the hood"));assert(drawn.includes("Motion + runtime"));press("cancel");
 listener("shell-action-5",0,0,0);listener("sys-menu",0,0,0);tick();tick(1001);listener("shell-action-5",1,0,0);listener("sys-menu",1,0,0);tick();
 for(let i=0;i<5;i++)press("nav-down");press("accept");press("nav-right");
 listener("accept",0,0,0);tick();await new Promise(setImmediate);assert.equal(ended,false,"Confirm waits for the physical release");listener("accept",1,0,0);tick();await pending;
 assert.equal(report.reason,"user exit");assert.equal(report.observations.buttonCycles,16);assert.equal(report.touchStatus,"unavailable");assert.equal(report.observations.touch.maxContacts,0);assert.equal(report.errors.length,0);assert(report.warnings.length);assert.equal(timers.size,0);assert.equal(listener,null);assert.equal(nodes.length,0);assert(Object.values(report.cleanup).every(Boolean));
 console.log("PASS: controller-only fallback on unsupported SDK, all buttons, pending promise, controller menu and exit-on-release, cleanup; no native calls or unneeded Canvas APIs");
})().catch(e=>{console.error(e);process.exitCode=1;});
