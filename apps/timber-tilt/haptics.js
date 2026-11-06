// Timber Tilt rumble: short haptic patterns on top of the accepted handheld pulse helper.
// A transaction is: fresh proof + prepare -> start/stop steps -> zero-amplitude send + free.
// v0.2.1: setup (~35 ms on Switch 2) runs in its own task after the frame is drawn, and an open
// transaction stays zeroed and idle for up to KEEP_MS so a following pattern reuses it within the
// helper's call budget. Nothing stays allocated once the board is idle, paused or exited.
var createTimberHaptics=function(o){
    "use strict";
    var MODES=["FULL","LIGHT","OFF"],mode=0,active=null,pending=null,scheduled=false,closed=false,unavailable=null,cleanup=true,autoLight=false;
    var attempts=[],evicted=0,count=0,totals={},dropped={busy:0,rate:0,mode:0,unavailable:0},patterns={played:0,reused:0,deferred:0};
    var timing={opens:0,totalOpenMs:0,maxOpenMs:0,totalProofMs:0,totalPrepareMs:0},firstDevices=null,lastBumpAt=-1e9,quietUntil=0;
    // Steps: [device, ms] with device 0 = left, 1 = right, 2 = both, null = pause.
    var PATTERNS={peg:[[2,70]],acorn:[[2,55],[null,70],[2,55]],checkpoint:[[2,110]],fall:[[2,260]],won:[[2,120],[null,90],[2,120],[null,90],[2,300]],calibrated:[[2,90]]};
    var PRIORITY={bump:1,peg:1,acorn:2,checkpoint:2,calibrated:2,fall:3,won:4},LIGHT_KINDS={acorn:1,checkpoint:1,calibrated:1,fall:1,won:1};
    var CALL_BUDGET=38,KEEP_MS=1500,MIN_REUSE=5;
    function note(s){try{if(o.note)o.note(s);}catch(_){}}
    function msg(e){return String(e&&e.message||e).slice(0,160);}
    function callsNeeded(steps){var n=2;steps.forEach(function(s){if(s[0]!==null)n+=(s[0]===2?2:1)+2;});return n;}
    function used(){var st=active.native.session.state;return st.calls?st.calls.length:0;}
    function record(entry){count++;if(attempts.length===16){attempts.splice(4,1);evicted++;}attempts.push(entry);}
    function avg(total){return timing.opens?Math.round(total/timing.opens*10)/10:null;}
    function finish(reason,now){
        if(!active)return;var a=active;active=null;quietUntil=Math.max(quietUntil,a.idle?0:now+80);
        try{a.native.session.close();}catch(e){a.entry.error=a.entry.error||msg(e);}
        var st=a.native.session.state;a.entry.stoppedMs=now;a.entry.reason=reason;a.entry.calls=st.calls?st.calls.length:null;a.entry.zeroed=st.zeroed;a.entry.freed=st.allocationFreed;
        if(st.errors&&st.errors.length)a.entry.nativeErrors=st.errors.slice(0,3).map(function(s){return String(s).slice(0,140);});
        var ok=st.zeroed&&st.allocationFreed&&!(st.errors&&st.errors.length);cleanup=cleanup&&ok;
        if(!ok||a.entry.error){unavailable="Rumble stopped after an error";note("error "+(a.entry.error||"cleanup incomplete"));}
    }
    function begin(i,now){
        var a=active,s=a.native.session;
        if(a.on){s.stop();a.on=false;}
        if(i>=a.steps.length){
            // Pattern done: devices are zeroed; keep the transaction briefly for the next pattern.
            a.idle=true;a.steps=null;a.idleUntil=now+KEEP_MS;quietUntil=now+80;
            if(CALL_BUDGET-used()<MIN_REUSE)finish("budget",now);
            return;
        }
        a.idx=i;var step=a.steps[i];a.stepEnd=now+step[1];
        if(step[0]!==null){s.start(step[0]===2?[0,1]:[step[0]]);a.on=true;}
    }
    function run(list,kind,now){
        active.steps=list;active.priority=PRIORITY[kind];active.idle=false;active.entry.patterns++;patterns.played++;
        if(active.entry.kinds.length<60)active.entry.kinds+=(active.entry.kinds?">":"")+kind;
        try{begin(0,now);}catch(e){active.entry.error=msg(e);finish("error",now);}
    }
    function steps(kind,opts){
        if(kind==="bump"){var v=opts&&opts.strength||3,ms=Math.max(45,Math.min(120,Math.round(40+14*(v-2))));return [[opts&&opts.side!==undefined?opts.side:2,ms]];}
        if(kind==="peg"&&opts&&opts.side!==undefined)return [[opts.side,70]];
        return PATTERNS[kind];
    }
    function open(p,now){
        var entry={kind:p.kind,kinds:p.kind,patterns:0,startedMs:now,stoppedMs:null,reason:null,openMs:null,proofMs:null,prepareMs:null,calls:null,error:null},native=null,t0=Date.now(),t1;
        record(entry);
        try{
            native=o.openNative();t1=Date.now();
            if(!native.session.prepare()){entry.reason="disabled";try{native.session.close();}catch(_){}unavailable="System vibration is off";note("disabled by system setting");return;}
            var t2=Date.now();entry.proofMs=t1-t0;entry.prepareMs=t2-t1;entry.openMs=t2-t0;
            timing.opens++;timing.totalOpenMs+=entry.openMs;timing.totalProofMs+=entry.proofMs;timing.totalPrepareMs+=entry.prepareMs;timing.maxOpenMs=Math.max(timing.maxOpenMs,entry.openMs);
            if(!firstDevices&&native.session.state.devices){firstDevices=native.session.state.devices.map(function(d){return {handle:d.handle,mounted:d.mounted,type:d.type,position:d.position};});note("ready openMs="+entry.openMs+" proofMs="+entry.proofMs+" prepareMs="+entry.prepareMs);}
            // Slow native setup on this console: keep the rare events, drop wall/peg taps.
            if(!autoLight&&MODES[mode]==="FULL"&&timing.opens>=3&&timing.totalOpenMs/timing.opens>70){autoLight=true;mode=1;note("auto LIGHT avgOpenMs="+Math.round(timing.totalOpenMs/timing.opens));}
            entry.kinds="";active={native:native,entry:entry,steps:null,priority:0,idx:-1,stepEnd:now,on:false,idle:true,idleUntil:now+KEEP_MS};
            run(p.list,p.kind,now);
        }catch(e){
            entry.error=msg(e);
            if(active)finish("error",now);
            else if(native){try{native.session.close();var st=native.session.state;cleanup=cleanup&&st.zeroed&&st.allocationFreed;}catch(_){cleanup=false;}}
            unavailable="Rumble unavailable: "+entry.error;note("unavailable "+entry.error);
        }
    }
    function flush(now){if(closed||!pending||unavailable){pending=null;return;}var p=pending;pending=null;if(active)finish("replaced",now);open(p,now);}
    function play(kind,now,opts){
        if(closed||!PRIORITY[kind])return false;
        totals[kind]=(totals[kind]||0)+1;
        if(MODES[mode]==="OFF"||(MODES[mode]==="LIGHT"&&!LIGHT_KINDS[kind])){dropped.mode++;return false;}
        if(unavailable){dropped.unavailable++;return false;}
        if(kind==="bump"||kind==="peg"){if(now-lastBumpAt<220){dropped.rate++;return false;}lastBumpAt=now;}
        var list=steps(kind,opts),pr=PRIORITY[kind];
        if(active&&!active.idle&&pr<=active.priority){dropped.busy++;return false;}
        if(active&&used()+callsNeeded(list)<=CALL_BUDGET){if(active.idle)patterns.reused++;run(list,kind,now);return true;}
        // A new transaction is needed: set it up after this frame is drawn.
        if(pending&&pr<pending.priority){dropped.busy++;return false;}
        if(pending)dropped.busy++;
        pending={kind:kind,list:list,priority:pr};
        if(o.defer){if(!scheduled){scheduled=true;patterns.deferred++;o.defer(function(){scheduled=false;flush(o.now?o.now():now);});}}
        else flush(now);
        return true;
    }
    return {
        play:play,flush:flush,
        tick:function(now){if(!active)return;try{active.native.check();if(active.idle){if(now>=active.idleUntil)finish("idle",now);return;}while(active&&!active.idle&&now>=active.stepEnd)begin(active.idx+1,now);}catch(e){if(active){active.entry.error=msg(e);finish("error",now);}}},
        stop:function(now,why){pending=null;finish(why||"stopped",now);},
        busy:function(now){return (!!active&&!active.idle)||now<quietUntil;},
        mode:function(){return MODES[mode];},
        cycle:function(now){mode=(mode+1)%MODES.length;pending=null;if(MODES[mode]==="OFF")finish("turned off",now);else unavailable=null;return MODES[mode];},
        status:function(){return unavailable?unavailable:active&&!active.idle?"PULSING":MODES[mode]==="OFF"?"OFF":"READY";},
        available:function(){return !unavailable;},
        close:function(now){if(closed)return;pending=null;finish("app exit",now);closed=true;},
        report:function(){return {mode:MODES[mode],autoLight:autoLight,unavailable:unavailable,attempts:attempts,totalAttempts:count,evicted:evicted,events:totals,dropped:dropped,patterns:patterns,
            timing:{opens:timing.opens,avgOpenMs:avg(timing.totalOpenMs),avgProofMs:avg(timing.totalProofMs),avgPrepareMs:avg(timing.totalPrepareMs),maxOpenMs:timing.maxOpenMs},devices:firstDevices,nativeCleanup:cleanup,
            limits:{amplitude:0.45,lowFrequency:160,highFrequency:320,callBudget:CALL_BUDGET,keepAliveMs:KEEP_MS,retainedAttempts:16,bumpMinGapMs:220},physicalResult:"Operator observation required; a successful send does not measure perceived vibration"};}
    };
};
if(typeof module!=="undefined")module.exports=createTimberHaptics;
