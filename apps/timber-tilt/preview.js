// Desktop simulation only. Never included in the console payload.
// Simulates the loader globals, InputAction stream, native contacts and a motion sensor
// whose raw axes deliberately differ from the board axes (the game must learn them).
var read64=function(){throw Error("Desktop preview has no native memory");},sdk_base=0n,write64=null,malloc=null,free=null,call_rop=null;
var engine=(function(){var callbacks=[];return {on:function(type,fn){callbacks.push(fn);},off:function(type,fn){callbacks=callbacks.filter(function(f){return f!==fn;});},emit:function(name,status,x,y){callbacks.slice().forEach(function(fn){fn(name,status,x||0,y||0);});},count:function(){return callbacks.length;}};})();
var log=function(){return Promise.resolve();};
window.__timberTiltConfig={maxSeconds:900,preview:true,targetHost:"desktop simulation"};
window.sendCivInputProReport=function(report){window.__timberPreview.report=report;return Promise.resolve();};
window.__timberPreview={points:null,report:null,device:{roll:0,pitch:0},motion:{starts:0,stops:0,active:false,unsupported:false},rumble:{opens:0,closes:0,starts:[],stopsSent:0,disabled:false,unsupported:false,openDelayMs:0},setContacts:function(p){this.points=p;},emit:function(n,s,x,y){engine.emit(n,s,x,y);}};
var previewPointers=new Map(),previewPrevious=[];
createCivVerifiedNativeTouch=function(){return {stats:{polls:0},poll:function(){
    var points=window.__timberPreview.points===null?Array.from(previewPointers.values()):window.__timberPreview.points;
    var ids=points.map(function(p){return p.id;}),started=ids.filter(function(id){return previewPrevious.indexOf(id)<0;}),ended=previewPrevious.filter(function(id){return ids.indexOf(id)<0;});
    previewPrevious=ids;this.stats.polls++;return {samplingNumber:String(Date.now()),contacts:points,started:started,moved:ids,ended:ended};
}};};
// Simulated handheld held fairly upright (like the real Switch 2 sample: gravity mostly on -Y).
// Device frame gravity for raise angle p (0 flat, pi/2 upright) and a roll about the player's viewing axis.
function previewAcceleration(){var d=window.__timberPreview.device,p=1.15+d.pitch,r=d.roll;return [-Math.sin(r),-Math.sin(p)*Math.cos(r),-Math.cos(p)*Math.cos(r)];}
createSwitchMotionNative=function(){
    var m=window.__timberPreview.motion;if(m.unsupported||window.__forceUnsupported)throw Error("Simulated unsupported SDK");
    var n=0,stats={polls:0,bytesRead:0},stream={key:"8:handheld",nativeId:32,kind:"handheld",styleBits:2,stats:{advances:0,snapshots:0}};
    var state={requested:true,attempted:false,started:false,stopped:false,skipped:null,stopAttempted:false,startResult:null,stopResult:null,allocationFreed:true,errors:[]};
    return {info:function(){return {source:"simulated; no native access"};},reader:{stats:stats,streams:[stream],poll:function(){stats.polls++;n++;stream.stats.snapshots++;stream.stats.advances=n-1;
        var a=m.active?previewAcceleration():[0,0,-1];return [{key:stream.key,snapshot:{samplingNumber:String(n),deltaTime:"5000000",guard:String(n*2),acceleration:a,angularVelocity:[0,0,0],angle:[0,0,0],direction:[1,0,0,0,1,0,0,0,1],attributes:1}}];}},
        makeActivation:function(){return {state:state,start:function(){m.starts++;m.active=true;state.attempted=true;state.started=true;state.startResult="0x00000000";state.allocationFreed=false;},skip:function(why){state.skipped=why;},
            close:function(){if(state.started&&!state.stopped){m.stops++;m.active=false;state.stopped=true;state.stopAttempted=true;state.stopResult="0x00000000";state.allocationFreed=true;}}};}};
};
window.addEventListener("pointerdown",function(e){previewPointers.set(e.pointerId,{id:e.pointerId,x:e.clientX*1280/window.innerWidth,y:e.clientY*720/window.innerHeight});},true);
window.addEventListener("pointermove",function(e){if(previewPointers.has(e.pointerId))previewPointers.set(e.pointerId,{id:e.pointerId,x:e.clientX*1280/window.innerWidth,y:e.clientY*720/window.innerHeight});},true);
["pointerup","pointercancel"].forEach(function(type){window.addEventListener(type,function(e){previewPointers.delete(e.pointerId);},true);});
var previewKeys=Object.create(null),previewMap={ArrowUp:"nav-up",ArrowDown:"nav-down",ArrowLeft:"nav-left",ArrowRight:"nav-right",Enter:"accept",KeyZ:"accept",Escape:"cancel",KeyX:"cancel",KeyC:"shell-action-1",KeyV:"shell-action-2",KeyP:"sys-menu",Digit1:"nav-previous",Digit2:"nav-next"};
function previewKey(e,down){
    if(e.repeat)return;previewKeys[e.code]=down;
    if(previewMap[e.code]){e.preventDefault();engine.emit(previewMap[e.code],down?0:1,0,0);}
    if(["KeyW","KeyA","KeyS","KeyD"].indexOf(e.code)>=0){e.preventDefault();var x=(previewKeys.KeyD?1:0)-(previewKeys.KeyA?1:0),y=(previewKeys.KeyW?1:0)-(previewKeys.KeyS?1:0);engine.emit("nav-move",x||y?2:1,x,y);}
    // I/J/K/L tilt the simulated console: I = top edge away/down, L = right side down.
    var d=window.__timberPreview.device;d.roll=((previewKeys.KeyL?1:0)-(previewKeys.KeyJ?1:0))*0.22;d.pitch=((previewKeys.KeyK?1:0)-(previewKeys.KeyI?1:0))*0.22;
}
window.addEventListener("keydown",function(e){previewKey(e,true);});window.addEventListener("keyup",function(e){previewKey(e,false);});
var previewStep=TimberPhysics.step;TimberPhysics.step=function(s,t,dt){window.__timberPreview.state=s;window.__timberPreview.tilt=t;return previewStep(s,t,dt);};
// Simulated rumble session with the same surface as the accepted pulse helper (prepare/start/stop/close/state).
createSwitchRumbleNative=function(){
    var r=window.__timberPreview.rumble;r.opens++;if(r.unsupported)throw Error("Initial pulse test requires the verified single handheld route");
    if(r.openDelayMs){var until=Date.now()+r.openDelayMs;while(Date.now()<until){}}
    var state={prepared:false,permitted:!r.disabled,skipped:null,devices:[],calls:[],errors:[],allocationFreed:true,zeroed:true,guardIntact:true},closed=false;
    function call(role){state.calls.push({role:role,result:"0x0"});if(state.calls.length>40)throw Error("Native call budget exceeded");}
    var session={state:state,
        prepare:function(){call("permitted");if(r.disabled){state.skipped="System vibration permission is off";return false;}state.allocationFreed=false;call("builder");[0,1].forEach(function(i){["initialize","send","mounted","info"].forEach(call);state.devices.push({index:i,handle:i?"0x12004":"0x2004",mounted:true,type:1,position:i+1,zeroed:true});});state.prepared=true;return true;},
        start:function(ix){if(closed||!state.prepared)throw Error("Pulse transaction not ready");ix.forEach(function(i){call("send");state.devices[i].zeroed=false;});state.zeroed=false;r.starts.push({at:Date.now(),devices:ix.slice()});},
        stop:function(){state.devices.forEach(function(d){call("send");d.zeroed=true;});state.zeroed=true;r.stopsSent++;},
        close:function(){if(closed)return;closed=true;if(state.prepared)session.stop();state.allocationFreed=true;r.closes++;}};
    return {session:session,check:function(){if(r.changed)throw Error("Simulated changed controller");},info:{source:"simulated; no native access"}};
};
// Screenshot helper: preview.html?first=N moves board N to the front (desktop only).
(function(){var m=/[?&]first=(\d+)/.exec(location.search);if(m){var n=Number(m[1]);if(n>0&&n<TIMBER_LEVELS.length)TIMBER_LEVELS.unshift(TIMBER_LEVELS.splice(n,1)[0]);}})();
