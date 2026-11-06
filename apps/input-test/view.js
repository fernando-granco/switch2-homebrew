// Large, flat, playful Canvas UI. Only opaque rectangles, circles and text.
var createSwitchInputView=function(ctx){
 "use strict";
 var drawText=createSolidMonoText(ctx),labels=Object.create(null);
 var c={paper:"#fff8e9",white:"#ffffff",ink:"#19333f",muted:"#49616b",coral:"#eb523f",teal:"#00b6a7",yellow:"#ffd541",blue:"#4364e8",line:"#c4d0ce"};
 var tabs=[{action:"controls",label:"Buttons",x:24,y:96,w:296,h:64,color:c.coral},{action:"touch",label:"Touch",x:336,y:96,w:296,h:64,color:c.blue},{action:"motion",label:"Motion",x:648,y:96,w:296,h:64,color:c.teal},{action:"info",label:"Info",x:960,y:96,w:296,h:64,color:c.yellow}];
 var tools=[{action:"reset",label:"Reset",x:964,y:20,w:132,h:56},{action:"exit",label:"Exit",x:1112,y:20,w:144,h:56}];
 var confirm=[{action:"cancel",x:284,y:430,w:328,h:80},{action:"confirm",x:668,y:430,w:328,h:80}],menu=["Back to test","Touch screen","Motion sensors","Runtime info","Reset observations","Exit to loader"];
 var infoTools=[{action:"info-prev",label:"Previous",x:24,y:608,w:208,h:56},{action:"info-next",label:"Next",x:1048,y:608,w:208,h:56}];
 var rumbleTools=[{action:"rumble-left",label:"Left [L]",x:24,y:560,w:400,h:80},{action:"rumble-right",label:"Right [R]",x:440,y:560,w:400,h:80},{action:"rumble-both",label:"Both [A]",x:856,y:560,w:400,h:80}];
 var buttons=[{n:"L",x:52,y:218,w:112,h:52},{n:"ZL",x:182,y:218,w:112,h:52},{n:"R",x:984,y:218,w:112,h:52},{n:"ZR",x:1114,y:218,w:112,h:52},{n:"Minus",label:"-",x:366,y:200,w:100,h:64},{n:"Plus",label:"+",x:814,y:200,w:100,h:64},
 {n:"Up",x:174,y:462,r:28},{n:"Left",x:106,y:530,r:28},{n:"Right",x:242,y:530,r:28},{n:"Down",x:174,y:598,r:28},
 {n:"X",x:1106,y:326,r:29},{n:"Y",x:1042,y:390,r:29},{n:"A",x:1170,y:390,r:29},{n:"B",x:1106,y:454,r:29}];
 function rect(x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(x,y,w,h);}
 function panel(x,y,w,h,color){rect(x,y,w,h,c.ink);rect(x+4,y+4,w-8,h-8,color||c.white);}
 // Letter outlines use a single opaque fill, bypassing native text shading.
 function text(s,x,y,size,color,align){drawText(s,x,y,size,color||c.ink,align||"left");}
 function circle(x,y,r,color){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}
 function ring(x,y,r,fill){circle(x,y,r,c.ink);circle(x,y,r-4,fill);}
 function short(v,n){return v==null?"Not available":String(v).slice(0,n||32);}
 function box(b,label,selected,color){panel(b.x,b.y,b.w,b.h,selected?(color||c.coral):c.white);text(label,b.x+b.w/2,b.y+b.h/2+9,26,c.ink,"center");}
 function arrow(name,x,y,color){var a={Up:0,Right:Math.PI/2,Down:Math.PI,Left:-Math.PI/2}[name],points=[[0,-11],[-11,9],[11,9]];ctx.beginPath();points.forEach(function(p,i){var xx=x+p[0]*Math.cos(a)-p[1]*Math.sin(a),yy=y+p[0]*Math.sin(a)+p[1]*Math.cos(a);if(i)ctx.lineTo(xx,yy);else ctx.moveTo(xx,yy);});ctx.closePath();ctx.fillStyle=color;ctx.fill();}
 function chip(b,s){var done=s.presses&&s.releases,fill=s.held?c.coral:done?c.ink:c.white,color=s.held||done?c.white:c.ink;if(b.r){ring(b.x,b.y,b.r,fill);if(["Up","Down","Left","Right"].indexOf(b.n)>=0)arrow(b.n,b.x,b.y,color);else text(b.n,b.x,b.y+11,34,color,"center");}else{panel(b.x,b.y,b.w,b.h,fill);text(b.label||b.n,b.x+b.w/2,b.y+b.h/2+11,32,color,"center");}}
 function stick(s,b,x,y,label){ring(x,y,56,c.white);[[0,-70,s.up],[0,70,s.down],[-70,0,s.left],[70,0,s.right]].forEach(function(p){circle(x+p[0],y+p[1],6,p[2]?c.ink:c.white);});var dx=x+Math.max(-1,Math.min(1,s.x))*28,dy=y-Math.max(-1,Math.min(1,s.y))*28;circle(dx,dy,25,b.held?c.coral:c.ink);text(label,dx,dy+10,28,c.white,"center");}
 function stickCard(x,name,s,b){panel(x,430,264,234,c.white);text(name,x+18,468,24);text("X "+s.x.toFixed(2),x+18,510,28);text("Y "+s.y.toFixed(2),x+18,550,28);text(b.presses&&b.releases?"CLICK OK":"CLICK TO TEST",x+18,592,22,b.presses&&b.releases?c.muted:c.ink);text(s.up&&s.down&&s.left&&s.right&&s.center?"AXES OK":"MOVE ALL WAYS",x+18,632,22,c.muted);}
 function controls(d){
  panel(24,200,300,464,c.teal);panel(956,200,300,464,c.yellow);
  buttons.forEach(function(b){chip(b,d.buttons[b.n]);});stick(d.sticks.left,d.buttons.LStick,174,350,"L");stick(d.sticks.right,d.buttons.RStick,1106,576,"R");
  text(d.buttonCycles===16?"All buttons checked!":"Press every button",640,238,26,c.ink,"center");text(d.buttonCycles+" / 16",640,340,76,d.buttonCycles===16?"#007f75":c.ink,"center");text("BUTTONS CHECKED",640,376,24,c.muted,"center");
  for(var i=0;i<16;i++)rect(372+i*34,394,29,14,i<d.buttonCycles?c.teal:c.line);
  stickCard(356,"LEFT STICK",d.sticks.left,d.buttons.LStick);stickCard(660,"RIGHT STICK",d.sticks.right,d.buttons.RStick);
 }
 function touch(d){
  text("Touch. Drag. Play.",24,214,28);text(d.touch.contacts.length+" FINGERS",1256,214,32,c.blue,"right");panel(24,244,1232,420,c.white);text("Tap all five circles. Try ten fingers!",48,282,24,c.muted);
  createSwitchInputView.targets.forEach(function(p,i){ring(p.x,p.y,38,d.touch.targets[i]?c.ink:c.yellow);text(d.touch.targets[i]?"OK":String(i+1),p.x,p.y+10,28,d.touch.targets[i]?c.white:c.ink,"center");});
  if(!d.touch.available){panel(284,390,712,112,c.paper);text("Touch is unavailable on this setup",640,457,28,c.ink,"center");}
 }
 function vector(x,title,values,scale){panel(x,200,604,280,c.white);text(title,x+22,239,28);var colors=[c.coral,"#008b80",c.blue];["X","Y","Z"].forEach(function(axis,i){var y=252+i*70;rect(x+24,y,42,42,colors[i]);text(axis,x+45,y+31,28,c.white,"center");text(values?values[i].toFixed(3):"--",x+580,y+34,42,c.ink,"right");rect(x+24,y+54,556,12,c.line);var mid=x+302;rect(mid-2,y+50,4,20,c.ink);if(values){var width=Math.min(1,Math.abs(values[i])/scale)*278;rect(values[i]<0?mid-width:mid,y+54,Math.max(2,width),12,colors[i]);}});}
 function motion(state){var m=state.motion||{status:"not opened",streams:[]},p=m.streams[0]&&m.streams[0].latest,r=state.rumble||{status:"Ready",message:"Pick a side. Feel a short pulse."};vector(24,"Accelerometer",p&&p.acceleration,2);vector(652,"Gyroscope",p&&p.angularVelocity,1);text(m.status==="unavailable"?"Motion unavailable. Rumble can still be tested.":m.status==="starting"?"Hold still for a moment...":"Tilt and turn! Watch the numbers change.",24,512,24,c.muted);text("Rumble",24,546,28);text(r.message,1256,546,22,c.muted,"right");rumbleTools.forEach(function(b){box(b,b.label,r.active&&b.action==="rumble-"+r.activeKind,b.action==="rumble-both"?c.coral:c.teal);});text("Short pulses. L / R / A test rumble. B stops and goes back.",24,674,22,c.muted);}
 function infoCard(x,y,label,value,size){panel(x,y,604,104,c.white);text(label,x+20,y+32,22,c.muted);text(short(value,33),x+20,y+77,size||28);}
 function info(info,state){var index=state.infoIndex||0,m=state.motion||{status:"not opened",streams:[]},p=m.streams[0]&&m.streams[0].latest;text(["The basics","Under the hood","Motion + runtime"][index],24,209,28);text((index+1)+" / 3",1256,209,28,c.muted,"right");
  var rows=index===0?[["App version",info.version],["Screen",info.viewport.width+" x "+info.viewport.height],["Touch",state.touchStatus],["Motion",m.status],["Console model","Not queried"],["Firmware","Not queried"]]:[["SDK base",info.sdkBase],["Game base",info.gameBase],["Target",info.targetHost||"Manual payload"],["Input route","InputAction"],["Platform",info.platform],["Language",info.language]];
  if(index<2)rows.forEach(function(row,i){infoCard(i%2?652:24,232+Math.floor(i/2)*120,row[0],row[1]);});
  else if(index===2){infoCard(24,232,"Last angle (raw)",p?p.angle.map(function(v){return v.toFixed(2);}).join(" / "):"-- / -- / --",26);infoCard(652,232,"Motion snapshots",String(m.snapshots||0),34);panel(24,352,1232,160,c.white);text("User agent",44,385,22,c.muted);var ua=String(info.userAgent||"Not available");for(var i=0;i<3;i++)if(ua.slice(i*84,(i+1)*84))text(ua.slice(i*84,(i+1)*84),44,420+i*30,22);text("HOME, Capture and C are outside this test.",24,558,22,c.muted);}
  infoTools.forEach(function(b){box(b,b.label,false);});
 }
 return {hit:function(p,state){var list=state.modal?confirm:state.menu?menu.map(function(_,i){return {action:"menu-"+i,x:340,y:240+i*72,w:600,h:56};}):tools.concat(tabs).concat(state.page==="info"?infoTools:state.page==="motion"?rumbleTools:[]);for(var i=0;i<list.length;i++){var b=list[i];if(p.x>=b.x&&p.x<b.x+b.w&&p.y>=b.y&&p.y<b.y+b.h)return b.action;}return null;},draw:function(d,state,infoData){
  rect(0,0,1280,720,c.paper);text("Switch Input Test",84,56,32);text(state.preview?"DESKTOP PREVIEW":"PRESS. TAP. TILT.",440,52,22,c.muted);tools.forEach(function(b){box(b,b.label,false);});tabs.forEach(function(b){box(b,b.label,b.action===(state.page||"controls"),b.color);});
  if(state.page==="touch")touch(d);else if(state.page==="motion")motion(state);else if(state.page==="info")info(infoData,state);else controls(d);
  if(state.page==="controls"){rect(24,686,16,16,c.coral);text("HELD",52,704,22);rect(150,686,16,16,c.ink);text("CHECKED",178,704,22);text("Held "+Object.keys(d.buttons).filter(function(k){return d.buttons[k].held;}).length+" / peak "+d.maxHeld,640,704,22,c.muted,"center");}
  else if(state.page==="touch"){text("Peak "+d.touch.maxContacts,24,704,22);text("Separate lift: "+(d.touch.independentLift?"CHECKED":"try it"),640,704,22,c.muted,"center");}
  else if(state.page==="motion")text("Raw values, not calibrated",24,704,22,c.muted);
  else text("Runtime details",24,704,22,c.muted);
  text("Hold + and -: menu",1256,704,22,c.ink,"right");
  if(state.menu){rect(0,176,1280,498,c.paper);text("Pick a test",640,215,34,c.ink,"center");menu.forEach(function(label,i){box({x:340,y:240+i*72,w:600,h:56},label,state.selected===i,c.yellow);});}
  if(state.modal){rect(0,176,1280,498,c.paper);panel(240,240,800,300,c.white);text(state.modal==="exit"?"All done?":"Fresh start?",640,306,40,c.ink,"center");text(state.modal==="exit"?"Save your report and return to the loader.":"Clear the scores and keep playing.",640,365,24,c.muted,"center");confirm.forEach(function(b,i){box(b,i?(state.modal==="exit"?"Save + exit":"Reset"):"Keep testing",state.selected===i,c.coral);});}
  var active=Object.create(null),used=[];d.touch.contacts.forEach(function(p){active[String(p.id)]=true;});Object.keys(labels).forEach(function(id){if(!active[id])delete labels[id];else used[labels[id]]=true;});d.touch.contacts.forEach(function(p){var id=String(p.id);if(!labels[id]){var n=1;while(used[n])n++;labels[id]=n;used[n]=true;}});
  var colors=[c.blue,c.coral,"#008b80","#8b43ba","#cd5e13","#2b703c","#a52a62","#196eaa","#766008","#5350ac"];
  d.touch.contacts.forEach(function(p){var label=labels[String(p.id)],color=colors[(label-1)%colors.length];circle(p.x,p.y,34,c.white);circle(p.x,p.y,30,color);text(label,p.x,p.y+10,28,c.white,"center");});
 }};
};
createSwitchInputView.targets=[{x:96,y:344},{x:1184,y:344},{x:640,y:462},{x:96,y:592},{x:1184,y:592}];
