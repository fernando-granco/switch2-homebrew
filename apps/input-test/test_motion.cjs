"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const ctx={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,"motion.js"),"utf8"),ctx);
function fixture(mode){let opens=0,starts=0,stops=0,n=0,active=false;const state={started:false,stopped:false,attempted:false,stopAttempted:false,allocationFreed:true,errors:[]},source={key:"8:handheld",nativeId:32,kind:"handheld",stats:{advances:0}};
 const m=ctx.createSwitchMotion({helpers:{},openNative(){opens++;if(mode==="unsupported")throw Error("Unsupported SDK");return {info:()=>({profileReadBytes:2000}),reader:{stats:{},streams:[source],poll(){if(mode==="failure"&&active&&n>70)throw Error("Reader changed");n++;source.stats.advances=n-1;return [{key:source.key,snapshot:{samplingNumber:String(n),acceleration:active?[.25,.5,-.9]:[0,0,-1],angularVelocity:active?[.1,-.2,.3]:[0,0,0],angle:[0,0,0],direction:[1,0,0,0,1,0,0,0,1]}}];}},makeActivation(){return {state,start(){starts++;active=true;state.started=true;state.attempted=true;state.allocationFreed=false;},skip(why){state.skipped=why;},close(){if(state.started&&!state.stopped){stops++;active=false;state.stopped=true;state.stopAttempted=true;state.stopResult="0x00000000";state.allocationFreed=true;}}};}};}});
 return {m,get opens(){return opens;},get starts(){return starts;},get stops(){return stops;},get polls(){return n;}};
}
{
 const f=fixture();assert.equal(f.opens,0);f.m.open(0);for(let i=0;i<75;i++)f.m.tick(i*33,true);assert.equal(f.starts,1);const polls=f.polls;f.m.tick(10000,false);assert.equal(f.polls,polls);assert.equal(f.stops,0);
 for(let i=0;i<1000;i++)f.m.tick(11000+i*33,true);let r=f.m.report();assert.equal(r.streams[0].retainedSamples.length,120);assert.equal(r.streams[0].evicted,r.streams[0].snapshots-120);assert.equal(r.streams[0].ranges.angularVelocity.max[2],.3);
 f.m.reset();assert.equal(f.m.report().streams[0].snapshots,0);assert.equal(f.starts,1);f.m.tick(50000,true);f.m.close();f.m.close();r=f.m.report();assert.equal(f.stops,1);assert.equal(r.nativeCleanup,true);assert.equal(r.activation.stopped,true);assert.equal(r.resetCount,1);
}
{const f=fixture("unsupported");f.m.open(0);f.m.tick(33,true);f.m.close();assert.equal(f.m.view(33).status,"unavailable");assert.equal(f.starts,0);assert.equal(f.m.report().nativeCleanup,true);}
{const f=fixture("failure");f.m.open(0);for(let i=0;i<100;i++)f.m.tick(i*33,true);assert.equal(f.m.view(3300).status,"unavailable");assert.equal(f.starts,1);assert.equal(f.stops,1);f.m.close();assert.equal(f.stops,1);}
{const f=fixture();f.m.open(0);f.m.tick(33,true);f.m.close();assert.equal(f.starts,0);assert.equal(f.stops,0);assert.equal(f.m.report().nativeCleanup,true);}
{const f=fixture();f.m.open(0);f.m.tick(10000,true);assert.equal(f.starts,0);for(let i=1;i<62;i++)f.m.tick(10000+i*33,true);assert.equal(f.starts,1,"Slow SDK preflight must not consume the observed baseline interval");f.m.close();}
console.log("PASS: lazy motion initialization, baseline/one Start, background pause with retained ownership, bounded ranges/samples, reset without restarting sensor, failure/normal/early/idempotent Stop cleanup");
