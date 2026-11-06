"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const c=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,"model.js"),"utf8"),c);const model=c.createSwitchInputModel();
let frame={buttons:{},transitions:[],sticks:{left:{x:0,y:0},right:{x:0,y:0}},independentTouchContacts:[],touchTransitions:[],eventCount:0,evictedTransitions:0,touchTransitionEvictions:0,lastEvent:null};
model.names.forEach(n=>frame.buttons[n]=false);
assert.equal(model.update(frame,0).sticks.left.center,false,"Initial neutral is not an observed return to center");
frame.transitions=Array.from(model.names,n=>({button:n,down:true,ms:1})).concat(Array.from(model.names,n=>({button:n,down:false,ms:2})));let d=model.update(frame,3);assert.equal(d.buttonCycles,16);assert.equal(d.maxHeld,16);
frame.transitions=[];for(const [x,y] of [[1,1],[-1,-1],[0,0]]){frame.sticks={left:{x,y,updatedAtMs:4},right:{x,y,updatedAtMs:4}};model.update(frame,4);}
d=model.snapshot();for(const name of ["left","right"])for(const field of ["up","down","left","right","center"])assert(d.sticks[name][field]);
frame.independentTouchContacts=[{id:7,x:96,y:344},{id:8,x:1184,y:344}];frame.touchTransitions=[{started:[7,8],ended:[],activeIds:[7,8]}];model.update(frame,5);
frame.independentTouchContacts=[{id:8,x:640,y:462}];frame.touchTransitions=[{started:[],ended:[7],activeIds:[8]}];d=model.update(frame,6);assert.equal(d.touch.maxContacts,2);assert.equal(d.touch.independentLift,true);assert.equal(d.touch.targets.filter(Boolean).length,3);
frame.independentTouchContacts=null;frame.touchTransitions=[];d=model.update(frame,7);assert.equal(d.touch.available,false);assert.equal(d.touch.ends,1,"Losing the reader must not invent a physical release");
frame.buttons.A=true;model.reset(frame,8);frame.transitions=[{button:"A",down:false,ms:9}];frame.buttons.A=false;d=model.update(frame,9);assert.equal(d.buttons.A.presses,0);assert.equal(d.buttons.A.releases,1);assert.equal(d.buttonCycles,0);
for(let i=0;i<90;i++){frame.transitions=[{button:"B",down:i%2===0,ms:10+i}];model.update(frame,10+i);}d=model.snapshot();assert.equal(d.events.length,64);assert(d.eventEvictions>0);
console.log("PASS: 16 quick press/release cycles, overlapping holds, observed stick center/directions, independent contact lift, no fake release on reader loss, reset semantics and bounded history");
