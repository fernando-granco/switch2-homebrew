(async function(){
 "use strict";
 var cfg=window.__switchInputTestConfig||{},start=Date.now(),maxSeconds=cfg.maxSeconds||600,canvas,input,view,model=createSwitchInputModel(),timer,deadline,heartbeat,resolveDone,closed=false,lastFrame=null;
 var state={preview:!!cfg.preview,page:"controls",returnPage:"controls",info:false,infoIndex:0,menu:false,modal:null,selected:0,touchStatus:"waiting"},nativeReader=null,nativeFailed=false,pending=null,chordAt=null,chordLatched=false,repeatAt=0,motionWarning=false;
 var report={schema:"switch-input-test/1",version:"1.1.0",ui:"large-flat",textRenderer:"solid-filled-outlines",touchLabelMode:"stable one-based display labels; raw native IDs preserved",reason:null,errors:[],warnings:[],durationMs:0,pages:{controls:true,touch:false,motion:false,info:false},cleanup:{timers:false,input:false,overlay:false,motion:false,rumble:false}};
 function probe(fn){try{var v=fn();return v==null?null:v;}catch(_){return null;}}
 function value(v,n){return v==null?null:String(v).slice(0,n||220);}
 var info=report.environment={version:"1.1.0",preview:!!cfg.preview,createdAtUTC:new Date().toISOString(),targetHost:cfg.targetHost||null,declaredPlatform:cfg.platform||null,
  viewport:{width:probe(function(){return window.innerWidth;}),height:probe(function(){return window.innerHeight;})},screen:{width:probe(function(){return screen.width;}),height:probe(function(){return screen.height;})},pixelRatio:probe(function(){return window.devicePixelRatio;}),
  platform:value(probe(function(){return navigator.platform;})),language:value(probe(function(){return navigator.language;})),userAgent:value(probe(function(){return navigator.userAgent;})),
  sdkBase:probe(function(){return typeof sdk_base==="bigint"?"0x"+sdk_base.toString(16):null;}),gameBase:probe(function(){return typeof main_base==="bigint"?"0x"+main_base.toString(16):null;}),hardwareModel:null,firmware:null,gameVersion:null,controllerIdentity:null};
 function warn(message){if(report.warnings.length<10)report.warnings.push(value(message,180));}
 var motion=createSwitchMotion({openNative:function(){return createSwitchMotionNative({read64:read64,sdkBase:sdk_base,profiles:window.__switchMotionProfiles});},helpers:{write64:typeof write64==="function"?write64:null,malloc:typeof malloc==="function"?malloc:null,free:typeof free==="function"?free:null,call_rop:typeof call_rop==="function"?call_rop:null,note:function(s){try{var p=log("INPUT_MOTION "+s);if(p&&p.catch)p.catch(function(){});}catch(_){}}}});
 var rumble=createSwitchRumble({openNative:function(){return createSwitchRumbleNative({sdkBase:sdk_base,read64:read64,profile:window.__switchRumbleProfile,openReader:function(){return createSwitchMotionNative({read64:read64,sdkBase:sdk_base,profiles:window.__switchMotionProfiles});},helpers:{write64:typeof write64==="function"?write64:null,malloc:typeof malloc==="function"?malloc:null,free:typeof free==="function"?free:null,call_rop:typeof call_rop==="function"?call_rop:null}});}});
 function page(name){rumble.cancel(Date.now()-start);pending=null;if(name==="info"&&state.page!=="info")state.infoIndex=0;state.page=name;state.info=name==="info";report.pages[name]=true;if(name==="motion")motion.open(Date.now()-start);}
 function close(reason){if(closed)return;closed=true;report.reason=reason;if(resolveDone)resolveDone();}
 function act(action,source){
  if(action==="controls"||action==="touch"||action==="motion"){page(action);state.menu=false;return;}
  if(action==="info"){if(!state.info){state.returnPage=state.page;page("info");}state.menu=false;return;}
  if(action==="info-next"||action==="info-prev"){rumble.cancel(Date.now()-start);pending=null;state.infoIndex=(state.infoIndex+(action==="info-next"?1:2))%3;return;}
  if(action&&action.indexOf("rumble-")===0){pending={kind:action,id:source.id,button:source.button};return;}
  if(action==="reset"||action==="exit"){rumble.cancel(Date.now()-start);state.menu=false;state.modal=action;state.selected=0;pending=null;return;}
  if(action==="cancel"){state.modal=null;pending=null;return;}
  if(action==="confirm"&&state.modal){state.selected=1;pending={kind:state.modal,id:source.id,button:source.button};return;}
  if(action&&action.indexOf("menu-")===0){var n=Number(action.slice(5));state.menu=false;if(n===1)page("touch");else if(n===2)page("motion");else if(n===3){state.returnPage=state.page;page("info");}else if(n===4||n===5){state.modal=n===4?"reset":"exit";state.selected=0;}}
 }
 function tick(){if(closed)return;try{
  var now=Date.now(),ms=now-start;
  if(nativeReader&&!nativeFailed){try{input.pollTouch();}catch(e){nativeFailed=true;state.touchStatus="reader error";info.touchDetail=value(e&&e.message||e,180);warn("Native touch disabled: "+info.touchDetail);}}
  var frame=input.drain();lastFrame=frame;var data=model.update(frame,ms);
  if(nativeReader&&!nativeFailed)state.touchStatus=cfg.preview?"simulated":data.touch.available?"verified / live":"verified / waiting";
  if(frame.buttons.Plus&&frame.buttons.Minus){if(chordAt===null)chordAt=now;if(!chordLatched&&now-chordAt>=1000){rumble.cancel(ms);pending=null;state.menu=true;state.modal=null;state.selected=0;pending=null;chordLatched=true;}}
  else{chordAt=null;chordLatched=false;}
  if(state.menu||state.modal){
   var dir=frame.pressed.indexOf("Down")>=0||frame.pressed.indexOf("Right")>=0?1:frame.pressed.indexOf("Up")>=0||frame.pressed.indexOf("Left")>=0?-1:0;
   if(!dir&&now>=repeatAt&&Math.abs(frame.sticks.left.y)>.6)dir=frame.sticks.left.y<0?1:-1;
   if(dir){var count=state.modal?2:6;state.selected=(state.selected+dir+count)%count;repeatAt=now+220;}
   if(frame.pressed.indexOf("B")>=0){state.menu=false;state.modal=null;pending=null;}
   else if(frame.pressed.indexOf("A")>=0)act(state.modal?(state.selected?"confirm":"cancel"):"menu-"+state.selected,{button:"A"});
  }else if(state.page==="info"&&(frame.pressed.indexOf("Right")>=0||frame.pressed.indexOf("Left")>=0)){rumble.cancel(ms);pending=null;state.infoIndex=(state.infoIndex+(frame.pressed.indexOf("Right")>=0?1:2))%3;}
  else if(state.page!=="controls"&&frame.pressed.indexOf("B")>=0)page(state.info?state.returnPage:"controls");
  else if(state.page==="motion"){["L","R","A"].some(function(b){if(frame.pressed.indexOf(b)>=0){act("rumble-"+(b==="L"?"left":b==="R"?"right":"both"),{button:b});return true;}return false;});}
  if(data.touch.available)data.touch.contacts.forEach(function(p){if(frame.touch.startedIds.indexOf(p.id)>=0)act(view.hit(p,state),{id:p.id});});
  if(pending&&((pending.button&&frame.released.indexOf(pending.button)>=0)||(pending.id!=null&&(frame.touch.endedIds||[]).indexOf(pending.id)>=0))){
   var kind=pending.kind;pending=null;if(kind.indexOf("rumble-")===0){if(state.page==="motion"&&!state.modal&&!state.menu)rumble.start(kind.slice(7),ms);}else if(kind==="exit")close("user exit");else{model.reset(frame,ms);motion.reset();rumble.reset(ms);state.modal=null;state.menu=false;data=model.snapshot();}
  }
  var motionMs=Date.now()-start;if(!closed)motion.tick(motionMs,state.page==="motion");state.motion=motion.view(motionMs);if(state.motion.status==="unavailable"&&!motionWarning){warn("Motion unavailable: "+state.motion.message);motionWarning=true;}
  if(!closed)rumble.tick(Date.now()-start);state.rumble=rumble.view();view.draw(data,state,info);
 }catch(e){report.errors.push(value(e&&e.message||e,180));close("runtime error");}}
 try{
  try{nativeReader=createCivVerifiedNativeTouch(read64,sdk_base);state.touchStatus=cfg.preview?"simulated":"verified / waiting";}
  catch(e){state.touchStatus="unavailable";info.touchDetail=value(e&&e.message||e,180);warn("Independent touch unavailable: "+info.touchDetail);}
  input=createCivInputAdapter(engine,{nativeTouchReader:nativeReader});
  canvas=document.createElement("canvas");canvas.width=1280;canvas.height=720;Object.assign(canvas.style,{position:"fixed",left:"0",top:"0",width:"100%",height:"100%",zIndex:"2147483010",pointerEvents:"none",backgroundColor:"#fff8e9"});document.body.appendChild(canvas);
  var context=canvas.getContext("2d");if(!context)throw Error("Canvas 2D unavailable");view=createSwitchInputView(context);input.attach();tick();
  if(!closed)await new Promise(function(resolve){resolveDone=resolve;timer=setInterval(tick,33);deadline=setTimeout(function(){close("session time limit");},maxSeconds*1000);heartbeat=setInterval(function(){var d=model.snapshot();try{var p=log("SWITCH_INPUT_TEST alive cycles="+d.buttonCycles+"/16 contacts="+d.touch.contacts.length+" events="+d.rawEvents);if(p&&p.catch)p.catch(function(){});}catch(_){}},15000);});
 }catch(e){report.errors.push(value(e&&e.message||e,180));report.reason="startup error";}
 finally{
  clearInterval(timer);clearInterval(heartbeat);clearTimeout(deadline);report.cleanup.timers=true;
  rumble.close(Date.now()-start);report.rumble=rumble.report();report.cleanup.rumble=report.rumble.nativeCleanup;
  motion.close();report.motion=motion.report();report.cleanup.motion=report.motion.nativeCleanup;if(report.motion.activation)report.motion.activation.errors.forEach(function(s){report.errors.push("Motion: "+value(s,180));});
  report.observations=model.snapshot();report.touchStatus=state.touchStatus;report.inputRoute="InputAction";report.touchCoordinateSpace={width:1280,height:720};report.touchTargets=model.targets;report.touchTargetRadius=44;
  if(lastFrame)report.actionCounts=lastFrame.actionCounts;report.limits={recentEvents:64,independentTouch:"verified SDK profile only",motionSamplesPerStream:120,motionUnits:"raw, not calibrated",motionSource:"native handheld route; physical source not queried",unmappedButtons:["HOME","Capture","C"],unqueried:["firmware","hardware model","controller identity","connection state"]};
  if(nativeReader&&nativeReader.stats)report.nativeReaderStats=JSON.parse(JSON.stringify(nativeReader.stats));
  if(input){try{input.detach();report.cleanup.input=true;}catch(e){report.errors.push("Detach: "+value(e&&e.message||e,140));}}
  if(canvas&&canvas.parentNode){canvas.parentNode.removeChild(canvas);report.cleanup.overlay=true;}report.durationMs=Date.now()-start;
 }
 window.__switchInputTestLastReport=report;
 await sendCivInputProReport(report);
})();
