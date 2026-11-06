// MIT. Counts observations; drawing/touching a button never simulates a press.
var createSwitchInputModel=function(){
 "use strict";
 var names=["A","B","X","Y","Up","Down","Left","Right","L","R","ZL","ZR","Minus","Plus","LStick","RStick"];
 var data,resets=0,active=[];
 function fresh(){var b={};names.forEach(function(n){b[n]={held:false,presses:0,releases:0,pressedAt:null};});return {buttons:b,sticks:{left:stick(),right:stick()},touch:{available:false,contacts:[],maxContacts:0,starts:0,ends:0,independentLift:false,targets:[false,false,false,false,false]},events:[],eventEvictions:0,maxHeld:0,buttonCycles:0,buttonsSeen:0,rawEvents:0,transitionEvictions:0,lastRaw:null,resets:resets};}
 function stick(){return {x:0,y:0,minX:0,maxX:0,minY:0,maxY:0,moved:false,center:false,up:false,down:false,left:false,right:false};}
 function event(ms,text){if(data.events.length>=64){data.events.shift();data.eventEvictions++;}data.events.push({ms:ms,text:text});}
 function counts(){var seen=0,complete=0;names.forEach(function(n){var b=data.buttons[n];if(b.presses)seen++;if(b.presses&&b.releases)complete++;});data.buttonsSeen=seen;data.buttonCycles=complete;}
 data=fresh();
 var targets=[{x:96,y:344},{x:1184,y:344},{x:640,y:462},{x:96,y:592},{x:1184,y:592}];
 return {names:names,targets:targets,update:function(frame,ms){
  (frame.transitions||[]).forEach(function(t){var b=data.buttons[t.button];if(!b)return;b.held=t.down;if(t.down){b.presses++;b.pressedAt=t.ms;event(ms,t.button+" down");}else{b.releases++;b.pressedAt=null;event(ms,t.button+" up");}var held=names.filter(function(n){return data.buttons[n].held;}).length;data.maxHeld=Math.max(data.maxHeld,held);});
  names.forEach(function(n){data.buttons[n].held=!!frame.buttons[n];});
  ["left","right"].forEach(function(name){var raw=frame.sticks[name],s=data.sticks[name];s.x=raw.x;s.y=raw.y;if(raw.updatedAtMs==null)return;
   s.minX=Math.min(s.minX,raw.x);s.maxX=Math.max(s.maxX,raw.x);s.minY=Math.min(s.minY,raw.y);s.maxY=Math.max(s.maxY,raw.y);
   if(Math.abs(raw.x)>.25||Math.abs(raw.y)>.25)s.moved=true;
   if(s.moved&&Math.abs(raw.x)<.12&&Math.abs(raw.y)<.12)s.center=true;
   if(raw.x<-.7)s.left=true;if(raw.x>.7)s.right=true;if(raw.y>.7)s.up=true;if(raw.y<-.7)s.down=true;
  });
  var touch=data.touch;touch.available=Array.isArray(frame.independentTouchContacts);
  if(touch.available){var points=frame.independentTouchContacts;touch.contacts=points.map(function(p){return {id:p.id,x:p.x,y:p.y};});touch.maxContacts=Math.max(touch.maxContacts,points.length);
   (frame.touchTransitions||[]).forEach(function(t){if(t.ended.length&&t.activeIds.some(function(id){return active.indexOf(id)>=0;})&&t.ended.some(function(id){return active.indexOf(id)>=0;}))touch.independentLift=true;
    t.started.forEach(function(id){touch.starts++;event(ms,"Touch "+id+" down");});t.ended.forEach(function(id){touch.ends++;event(ms,"Touch "+id+" up");});active=t.activeIds.slice();
   });active=points.map(function(p){return p.id;});
   points.forEach(function(p){targets.forEach(function(t,i){var dx=p.x-t.x,dy=p.y-t.y;if(dx*dx+dy*dy<=44*44)touch.targets[i]=true;});});
  }else{touch.contacts=[];active=[];}
  data.rawEvents=frame.eventCount;data.transitionEvictions=frame.evictedTransitions+frame.touchTransitionEvictions;data.lastRaw=frame.lastEvent;counts();return data;
 },reset:function(frame,ms){resets++;data=fresh();active=[];names.forEach(function(n){data.buttons[n].held=!!(frame&&frame.buttons[n]);});event(ms,"Coverage reset");return data;},snapshot:function(){return JSON.parse(JSON.stringify(data));}};
};
