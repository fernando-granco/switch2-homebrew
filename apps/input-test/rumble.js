// One bounded transaction per user-triggered pulse; native resources never idle.
var createSwitchRumble=function(o){
 "use strict";
 var active=null,closed=false,attempts=[],count=0,evicted=0,resetCount=0,status="Ready",message="Pick a side. Feel a short pulse.",seen=[false,false],last=null,cleanup=true;
 function record(r){count++;if(attempts.length===12){attempts.splice(6,1);evicted++;}attempts.push(r);last=r;}
 function finish(why,now){if(!active)return;var a=active;active=null;try{a.native.session.close();}catch(e){a.entry.error=String(e&&e.message||e).slice(0,180);}a.entry.stoppedMs=now;a.entry.reason=why;a.entry.native=a.native.session.state;var state=a.entry.native;cleanup=cleanup&&state.zeroed&&state.allocationFreed&&state.errors.length===0;if(!cleanup||a.entry.error){status="Unavailable";message="Could not finish the pulse. See report.";}else{status=why==="completed"?"Pulse sent":"Stopped";message=why==="completed"?"Pulse sent and stopped. Try another side!":"Vibration stopped.";}}
 return {start:function(kind,now){if(closed||active||["left","right","both"].indexOf(kind)<0)return;var entry={kind:kind,startedMs:now,stoppedMs:null,reason:null,error:null,native:null},native;
  record(entry);try{native=o.openNative();entry.profile=native.info;if(!native.session.prepare()){entry.reason="disabled";entry.native=native.session.state;native.session.close();cleanup=cleanup&&entry.native.zeroed&&entry.native.allocationFreed&&entry.native.errors.length===0;status="Disabled";message="Enable Controller Vibration in Settings.";return;}
   active={native:native,entry:entry,end:now+350};status="Pulsing";message=kind==="both"?"Both sides!":kind==="left"?"Left side!":"Right side!";native.session.start(kind==="both"?[0,1]:kind==="left"?[0]:[1]);if(kind!=="right")seen[0]=true;if(kind!=="left")seen[1]=true;
  }catch(e){entry.error=String(e&&e.message||e).slice(0,180);if(active)finish("error",now);else if(native){try{native.session.close();entry.native=native.session.state;cleanup=cleanup&&entry.native.zeroed&&entry.native.allocationFreed&&entry.native.errors.length===0;}catch(_){cleanup=false;}}status="Unavailable";message="Rumble unavailable on this setup.";}},
  tick:function(now){if(!active)return;try{active.native.check();if(now>=active.end)finish("completed",now);}catch(e){active.entry.error=String(e&&e.message||e).slice(0,180);finish("connection changed",now);status="Unavailable";message="Controller setup changed. Pulse stopped.";}},
  cancel:function(now){finish("cancelled",now);},reset:function(now){finish("reset",now);attempts=[];count=0;evicted=0;last=null;seen=[false,false];resetCount++;status="Ready";message="Pick a side. Feel a short pulse.";},
  close:function(now){if(closed)return;finish("app exit",now);closed=true;},
  view:function(){return {status:status,message:message,active:!!active,activeKind:active?active.entry.kind:null,leftSent:seen[0],rightSent:seen[1]};},
  report:function(){return {status:status,attempts:attempts,totalAttempts:count,evicted:evicted,resetCount:resetCount,lastAttempt:last,nativeCleanup:cleanup,limits:{pulseMs:350,amplitude:.45,lowFrequency:160,highFrequency:320,retainedAttempts:12},physicalResult:"Operator observation required; a successful send does not measure perceived vibration"};}
 };
};
