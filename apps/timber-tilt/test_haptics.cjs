// Offline rumble wrapper checks with a mock pulse session (same surface as the accepted helper).
"use strict";
const assert=require("node:assert/strict"),createTimberHaptics=require("./haptics.js");
function rig(opts){
    opts=opts||{};const log={opens:0,closes:0,starts:[],stops:0,notes:[],deferred:[]};
    const cfg={note:s=>log.notes.push(s),openNative:()=>{
        log.opens++;if(opts.throwOpen)throw Error("Initial pulse test requires the verified single handheld route");
        if(opts.slowMs){const until=Date.now()+opts.slowMs;while(Date.now()<until){}}
        const state={prepared:false,calls:[],errors:[],devices:[],zeroed:true,allocationFreed:true};let closed=false;
        const call=r=>{state.calls.push({role:r,result:"0x0"});if(state.calls.length>40)throw Error("Native call budget exceeded");};
        const session={state,
            prepare(){call("permitted");if(opts.disabled)return false;state.allocationFreed=false;call("builder");for(let i=0;i<2;i++){["initialize","send","mounted","info"].forEach(call);state.devices.push({handle:i?"0x12004":"0x2004",mounted:true,type:1,position:i+1});}state.prepared=true;return true;},
            start(ix){assert(!closed&&state.prepared);ix.forEach(()=>call("send"));state.zeroed=false;log.starts.push(ix.join("+"));},
            stop(){state.devices.forEach(()=>call("send"));state.zeroed=true;log.stops++;},
            close(){if(closed)return;closed=true;if(state.prepared)session.stop();state.allocationFreed=true;log.closes++;}};
        return {session,check(){if(opts.changeAt&&log.starts.length>=opts.changeAt)throw Error("Simulated changed controller");},info:{}};
    }};
    if(opts.defer){cfg.defer=fn=>log.deferred.push(fn);cfg.now=()=>log.clock||0;}
    return {h:createTimberHaptics(cfg),log};
}
function run(h,from,to){for(let t=from;t<=to;t+=33)h.tick(t);}
// Win pattern: three pulses on both sides inside one transaction, zeroed, then freed after the idle window.
let {h,log}=rig();assert(h.play("won",0));assert.deepEqual(log.starts,["0+1"]);assert(h.busy(10));
run(h,0,900);assert.deepEqual(log.starts,["0+1","0+1","0+1"]);assert.equal(log.closes,0,"kept open while idle");assert(!h.busy(1000));
run(h,900,2600);assert.equal(log.opens,1);assert.equal(log.closes,1);
let r=h.report();assert.equal(r.nativeCleanup,true);assert(r.attempts[0].calls<=38&&r.attempts[0].zeroed&&r.attempts[0].freed&&r.attempts[0].reason==="idle",JSON.stringify(r.attempts[0]));
// Patterns close together reuse one transaction (no second setup) until the budget runs low.
({h,log}=rig());h.play("checkpoint",0);run(h,0,300);h.play("bump",400,{side:0,strength:5});run(h,400,700);h.play("acorn",800);run(h,800,1200);
assert.equal(log.opens,1,"reused");assert.deepEqual(log.starts,["0+1","0","0+1","0+1"]);r=h.report();assert.equal(r.patterns.reused,2);assert.equal(r.attempts[0].kinds,"checkpoint>bump>acorn");
for(let i=0;i<8;i++){h.play("bump",1300+i*300,{side:1,strength:4});run(h,1300+i*300,1300+i*300+260);}
assert(log.opens>=2,"budget forces a fresh transaction");assert(h.report().attempts.every(a=>a.reason!=="error"));h.close(5000);assert.equal(log.opens,log.closes);
// Wall bumps pick a side and scale with impact; rate limited.
({h,log}=rig());h.play("bump",0,{side:0,strength:6});assert.deepEqual(log.starts,["0"]);h.play("bump",100,{side:1,strength:6});run(h,0,400);
assert.equal(h.report().dropped.rate,1);h.play("bump",500,{side:1,strength:2});assert.deepEqual(log.starts,["0","1"]);run(h,500,800);assert.equal(log.opens,1);
// Higher priority (fall) takes over a running bump inside the same transaction; lower priority is dropped.
({h,log}=rig());h.play("bump",0,{side:2,strength:5});h.play("fall",33);assert.equal(log.opens,1);h.play("peg",66);assert.equal(h.report().dropped.busy+h.report().dropped.rate,1);
run(h,33,400);assert(h.report().attempts[0].kinds==="bump>fall");
// Deferred setup: nothing native happens inside play(); the queued task opens it later.
({h,log}=rig({defer:true}));assert(h.play("fall",0));assert.equal(log.opens,0);assert.equal(log.deferred.length,1);
assert(h.play("won",5));assert.equal(log.deferred.length,1,"one task per frame");h.play("bump",6,{side:0,strength:9});
log.clock=20;log.deferred.shift()();assert.equal(log.opens,1);assert.deepEqual(log.starts,["0+1"]);assert.equal(h.report().attempts[0].kind,"won","highest priority wins the queue");
assert(h.report().patterns.deferred>=1);h.stop(40,"menu");assert.equal(log.closes,1);
h.play("fall",100);h.close(110);log.deferred.forEach(f=>f());assert.equal(log.opens,1,"no open after exit");
// LIGHT drops taps, OFF drops everything; cycling turns modes.
({h,log}=rig());assert.equal(h.cycle(0),"LIGHT");assert(!h.play("bump",0,{side:0,strength:9}));assert(h.play("checkpoint",10));run(h,10,200);
assert.equal(h.cycle(300),"OFF");assert.equal(log.closes,1,"OFF frees the idle transaction");assert(!h.play("won",310));assert.equal(h.cycle(320),"FULL");assert.equal(log.opens,1);
// Disabled system vibration: one probe, then no further native opens.
({h,log}=rig({disabled:true}));assert(!h.play("fall",0)||true);assert(!h.play("won",500));assert.equal(log.opens,1);assert.equal(log.closes,1);assert(/off/.test(h.status()));assert.equal(h.report().nativeCleanup,true);
// Unsupported route: unavailable, no retry until the player changes the mode.
({h,log}=rig({throwOpen:true}));h.play("fall",0);assert(!h.play("fall",400));assert.equal(log.opens,1);assert(!h.available());h.cycle(500);h.cycle(510);h.cycle(520);assert(h.available());
// Controller change mid-pattern stops and frees.
({h,log}=rig({changeAt:2}));h.play("won",0);run(h,0,900);assert.equal(log.closes,1);assert(!h.available());assert(h.report().attempts[0].error);assert.equal(h.report().nativeCleanup,true);
// Exit while pulsing zeroes and frees.
({h,log}=rig());h.play("fall",0);h.close(50);assert.equal(log.closes,1);assert(!h.play("won",60));assert.equal(h.report().attempts[0].reason,"app exit");
// Slow native setup switches FULL to LIGHT automatically; timing is split into proof and prepare.
({h,log}=rig({slowMs:75}));for(let i=0;i<3;i++){h.play("fall",i*3000);run(h,i*3000,i*3000+2000);}assert.equal(h.mode(),"LIGHT");r=h.report();assert(r.autoLight&&r.timing.avgProofMs>=70&&r.timing.avgPrepareMs!==null);
// Attempt list stays bounded.
({h,log}=rig());for(let i=0;i<40;i++){h.play("checkpoint",i*2000);run(h,i*2000,i*2000+1900);}r=h.report();assert.equal(r.attempts.length,16);assert.equal(r.evicted,24);assert.equal(r.totalAttempts,40);
console.log("PASS: patterns, idle keep-alive reuse within budget, deferred setup with priority queue, side/strength bumps, rate limit, priority takeover, LIGHT/OFF, disabled, unsupported, controller change, exit cleanup, auto LIGHT + timing split, bounded attempts");
