// Wizard checks with several unknown axis conventions and holding angles.
"use strict";
const assert=require("node:assert/strict"),createTimberTilt=require("./tilt.js");
// Simulated sensor: gravity in device frame for roll (right side down) and pitch (top edge down),
// then an arbitrary axis permutation/sign the game must not assume.
// Roll is about the player's viewing axis; p is the raise angle (0 flat, pi/2 upright). "Top edge away" lowers p.
function sensor(perm,signs,hold){return (roll,pitch)=>{const p=hold-pitch,v=[Math.sin(roll),-Math.sin(p)*Math.cos(roll),-Math.cos(p)*Math.cos(roll)];return perm.map((k,i)=>v[k]*signs[i]);};}
function drive(tilt,dev,frames,start){let id=start.id,ms=start.ms;for(const [roll,pitch,n] of frames)for(let i=0;i<n;i++){const noise=((id*7919)%13-6)*0.0015;const a=dev(roll,pitch).map(v=>v+noise);tilt.feed(a,id++,ms);ms+=33;}start.id=id;start.ms=ms;}
const cases=[[[0,1,2],[1,1,1],0.3],[[1,0,2],[-1,1,1],0.8],[[2,1,0],[1,-1,-1],1.15],[[0,2,1],[-1,-1,1],1.45]];
cases.forEach(([perm,signs,hold],n)=>{
    const t=createTimberTilt(),dev=sensor(perm,signs,hold),clock={id:1,ms:0};
    assert.deepEqual(t.tilt(),{x:0,y:0});
    t.startWizard(0);
    drive(t,dev,[[0,0,40]],clock);assert.equal(t.wizard(clock.ms).step,"right","case "+n+" hold");
    drive(t,dev,[[0.15,0,4]],clock);assert.equal(t.wizard(clock.ms).step,"right","small tilt must not count");
    drive(t,dev,[[0.4,0,12]],clock);assert.equal(t.wizard(clock.ms).step,"level1");
    drive(t,dev,[[0,0,15]],clock);assert.equal(t.wizard(clock.ms).step,"top");
    drive(t,dev,[[0,0.4,12]],clock);assert.equal(t.wizard(clock.ms).step,"level2");
    drive(t,dev,[[0,0,15]],clock);assert.equal(t.wizard(clock.ms).step,"done");assert(t.calibrated());
    drive(t,dev,[[0,0,10]],clock);assert.deepEqual(t.tilt(),{x:0,y:0},"level must be neutral");
    drive(t,dev,[[0.2,0,10]],clock);let v=t.tilt();assert(v.x>0.5&&Math.abs(v.y)<0.15,"right roll case "+n+" "+JSON.stringify(v));
    drive(t,dev,[[-0.2,0,10]],clock);v=t.tilt();assert(v.x<-0.5&&Math.abs(v.y)<0.15,"left roll case "+n);
    drive(t,dev,[[0,0.2,10]],clock);v=t.tilt();assert(v.y<-0.5&&Math.abs(v.x)<0.15,"top-down rolls up case "+n+" "+JSON.stringify(v));
    drive(t,dev,[[0,-0.2,10]],clock);v=t.tilt();assert(v.y>0.5,"bottom-down rolls down case "+n);
    drive(t,dev,[[0.6,0.6,10]],clock);v=t.tilt();assert(Math.hypot(v.x,v.y)<=1+1e-9,"clamped");
    // Recenter at a new resting angle makes it neutral again.
    drive(t,dev,[[0.1,0.1,12]],clock);assert(t.recenter());assert.deepEqual(t.tilt(),{x:0,y:0});
    const r=t.report();assert(r.calibrated&&Math.abs(r.calibration.orthogonality)<0.1&&r.recenters===1);
});
// Unsteady hands restart the hold window; duplicate sample ids are ignored; NaN is refused.
const t=createTimberTilt();t.startWizard(0);
for(let i=0;i<60;i++)t.feed([i%2?0.2:-0.2,0,-1],i,i*33);assert.equal(t.wizard(2000).step,"hold");
assert.equal(t.feed([0,0,-1],59,2000),false);assert.equal(t.feed([NaN,0,-1],100,2000),false);
assert.equal(t.cycleSensitivity(),"HIGH");assert.equal(t.cycleSensitivity(),"LOW");
console.log("PASS: wizard learns 4 axis conventions/holding angles, neutral/recenter, clamp, unsteady hold, duplicate/NaN refusal, sensitivity");
