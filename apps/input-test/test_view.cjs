"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const read=n=>fs.readFileSync(path.join(__dirname,n),"utf8"),ctx={},trace=[],brushes=[];
const canvas={beginPath(){},moveTo(){},lineTo(){},closePath(){},arc(){},fillRect(){},fill(){brushes.push(this.fillStyle);},fillText(){throw Error("Native text must not be used");},strokeText(){throw Error("Native text must not be used");}};
vm.runInNewContext(read("solid-mono.js")+"\n"+read("solid-text.js")+"\n"+read("model.js")+"\n"+read("view.js"),ctx);
const create=ctx.createSolidMonoText;ctx.createSolidMonoText=function(c){const draw=create(c);return function(s,x,y,size,color,align){trace.push({text:String(s),x,y,size,color});return draw(s,x,y,size,color,align);};};
const view=ctx.createSwitchInputView(canvas),data=ctx.createSwitchInputModel().snapshot(),state={page:"touch",touchStatus:"simulated"},info={version:"1.1.0",viewport:{width:1280,height:720}};
function draw(ids){trace.length=0;data.touch.contacts=ids.map((id,i)=>({id,x:100+i*100,y:400}));view.draw(data,state,info);return trace.slice(-ids.length).map(t=>t.text);}
assert.deepEqual(draw([0,7]),["1","2"]);assert.deepEqual(draw([7]),["2"],"Lifting one finger must not renumber its survivor");assert.deepEqual(draw([7,25]),["2","1"],"New contact gets first free human label");draw([]);assert.deepEqual(draw([99]),["1"],"Each new contact group starts at 1");assert.equal(data.touch.contacts[0].id,99,"Native IDs are not modified");
assert.deepEqual(draw(Array.from({length:10},(_,i)=>i)),["1","2","3","4","5","6","7","8","9","10"]);
state.page="motion";data.touch.contacts=[];trace.length=0;view.draw(data,state,info);assert(trace.some(t=>t.text==="Rumble"));assert(trace.some(t=>t.text==="Left [L]"));assert.equal(view.hit({x:224,y:600},state),"rumble-left");assert.equal(view.hit({x:640,y:600},state),"rumble-right");assert.equal(view.hit({x:1056,y:600},state),"rumble-both");
state.page="info";assert.equal(view.hit({x:640,y:600},state),null,"Rumble is not on Info");
for(let i=0;i<3;i++){state.infoIndex=i;trace.length=0;view.draw(data,state,info);assert(trace.some(t=>t.text===(i+1)+" / 3"));assert(!trace.some(t=>t.text==="Left [L]"));}
assert(brushes.length>0&&brushes.every(c=>/^#[0-9a-f]{6}$/i.test(c)));assert(trace.every(t=>t.size>=22));
console.log("PASS: solid filled-path letters without native text, stable one-based touch labels/partial lift/raw ID preservation, ten labels, Motion rumble hit boxes and three Info pages");
