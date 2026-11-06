// Offline model checks: level validity, guide routes and an autopilot that must finish every board.
"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const ctx={module:undefined};vm.createContext(ctx);
for(const f of ["levels.js","physics.js"])vm.runInContext(fs.readFileSync(path.join(__dirname,f),"utf8"),ctx,{filename:f});
const P=ctx.TimberPhysics,defs=ctx.TIMBER_LEVELS;
assert(defs.length>=20,"need at least 20 boards, have "+defs.length);
const autopilotShared=require("./tools/autopilot.cjs");

function autopilot(level,limit){return autopilotShared(P,level,limit);}

const summary=[];
defs.forEach(def=>{
    const level=P.parse(def);
    assert(level.path.cells.length>20,def.id+" route is trivially short");
    // Guide cells are 4-connected, never walls or holes.
    level.path.cells.forEach((c,k)=>{
        assert(!P.isWall(level,Math.floor(c.x),Math.floor(c.y)),def.id+" route crosses wall");
        assert(!level.holeAt[Math.floor(c.x)+","+Math.floor(c.y)],def.id+" route crosses hole");
        if(k)assert.equal(Math.abs(c.x-level.path.cells[k-1].x)+Math.abs(c.y-level.path.cells[k-1].y),1);
    });
    // Starting position is clear of walls and holes.
    level.holes.forEach(h=>assert(Math.hypot(h.x-level.start.x,h.y-level.start.y)>1.2,def.id+" start beside hole"));
    assert.equal(level.acorns.length,3,def.id+" needs three acorns");assert(level.par>=10,def.id+" par");assert(["pine","oak","cherry","walnut"].indexOf(level.theme)>=0,def.id+" theme");
    // Every acorn sits on a floor cell the ball can rest on without being pulled into a hole.
    level.acorns.forEach(a=>level.holes.forEach(h=>assert(Math.hypot(h.x-a.x,h.y-a.y)>=1.55,def.id+" acorn beside hole")));
    const run=autopilot(level,240);
    assert.equal(run.s.mode,"won",def.id+" autopilot did not finish (mode "+run.s.mode+", falls "+run.s.falls+", at "+run.s.x.toFixed(2)+","+run.s.y.toFixed(2)+")");
    assert.equal(run.s.falls,0,def.id+" autopilot fell");
    assert.equal(run.s.checkpoint,level.checkpoints.length,def.id+" missed checkpoints");
    summary.push(def.id+": "+level.w+"x"+level.h+", "+level.holes.length+" holes, route "+level.path.cells.length+" cells, autopilot "+run.t.toFixed(1)+" s, closest hole "+run.minHole.toFixed(2));
});

// Physics behaviour.
const open=P.parse({id:"t",grid:["##########","#S.......#","#........#","#.......G#","##########"]});
let s=P.create(open);for(let k=0;k<6;k++)P.step(s,{x:1,y:0},0.1);assert.equal(s.mode,"ready");P.step(s,{x:1,y:0},0.1);P.step(s,{x:1,y:0},0.1);assert.equal(s.mode,"rolling");assert.equal(s.x,open.start.x,"ball moved during ready");
for(let k=0;k<60;k++)P.step(s,{x:1,y:0},1/30);
assert(s.x<=open.w-1-P.BALL_R+1e-6,"ball passed through right wall");assert(s.bumps>=1,"wall bump not counted");
s=P.create(open);s.mode="rolling";for(let k=0;k<200;k++)P.step(s,{x:0,y:0},1/30);assert.equal(s.x,open.start.x);
s=P.create(open);s.mode="rolling";s.vx=40;P.step(s,{x:0,y:0},1/30);assert(s.maxSpeed<=13+1e-9,"speed cap");
const pit=P.parse({id:"p",grid:["#######","#S.o.G#","#.....#","#######"]});
s=P.create(pit);s.mode="rolling";for(let k=0;k<90&&s.mode==="rolling";k++)P.step(s,{x:0.6,y:0},1/30);
assert.equal(s.mode,"falling");assert.equal(s.falls,1);for(let k=0;k<30;k++)P.step(s,{x:0,y:0},1/30);assert.equal(s.mode,"ready");assert.equal(s.x,pit.start.x);
const cp=P.parse({id:"c",grid:["########","#S.1..G#","########"]});
s=P.create(cp);s.mode="rolling";for(let k=0;k<120&&s.mode==="rolling";k++)P.step(s,{x:0.5,y:0},1/30);assert.equal(s.mode,"won");assert.equal(s.checkpoint,1);
assert.throws(()=>P.parse({id:"x",grid:["####","#S.G","####"]}),/open border/);
assert.throws(()=>P.parse({id:"y",grid:["#####","#S#G#","#####"]}),/no route/);
// Pegs bounce, felt slows, varnish keeps speed, acorns collect, hits carry a direction.
const pg=P.parse({id:"g",grid:["##########","#S..p...G#","#........#","##########"]});
s=P.create(pg);s.mode="rolling";let pegHit=false;for(let k=0;k<60&&!pegHit;k++){P.step(s,{x:0.8,y:0},1/30);pegHit=s.events.indexOf("peg")>=0;}
assert(pegHit&&s.hit.kind==="peg"&&s.hit.nx<0&&s.vx<0.5,"peg bounce "+JSON.stringify(s.hit));
function coast(ch){const l=P.parse({id:"s"+ch,grid:["##############","#S"+ch.repeat(10)+"G#","#............#","##############"]}),st=P.create(l);st.mode="rolling";st.vx=6;for(let k=0;k<15;k++)P.step(st,{x:0,y:0},1/30);return st.vx;}
const vWood=coast("."),vFelt=coast("f"),vVarnish=coast("v");assert(vFelt<vWood*0.5&&vVarnish>vWood*1.15,"surfaces "+[vWood,vFelt,vVarnish]);
const ac=P.parse({id:"a",grid:["#########","#S.a...G#","#.......#","#########"]});
s=P.create(ac);s.mode="rolling";for(let k=0;k<90&&s.mode==="rolling";k++)P.step(s,{x:0.5,y:0},1/30);assert.equal(s.acornCount,1);assert(s.acorns[0]);
s=P.create(open);s.mode="rolling";let wallHit=null;for(let k=0;k<90&&!wallHit;k++){P.step(s,{x:1,y:0},1/30);if(s.hit)wallHit=s.hit;}assert(wallHit&&wallHit.kind==="wall"&&wallHit.nx<0,"right wall hit points left");
// Rolling along a wall while tilted into it keeps close to open-floor speed (v0.2.0 lost ~80%).
const lane=P.parse({id:"lane",grid:["######################","#S...................#","#...................G#","######################"]});
function slide(ty){const st=P.create(lane);st.mode="rolling";st.y=1.43;for(let k=0;k<60;k++)P.step(st,{x:0.5,y:ty},1/30);return st;}
const vFree=slide(0).vx,pressed=slide(-0.5);assert(pressed.vx>vFree*0.85,"wall slide too slow: "+pressed.vx.toFixed(2)+" vs "+vFree.toFixed(2));assert(Math.abs(pressed.vy)<0.05&&pressed.y>=1.42-1e-6,"stays against the wall");
// A real impact still bounces back and is counted.
s=P.create(open);s.mode="rolling";s.x=7;s.vx=6;for(let k=0;k<12;k++)P.step(s,{x:0,y:0},1/30);assert(s.vx<-1&&s.bumps===1,"impact bounce "+s.vx);
console.log(summary.join("\n"));
console.log("PASS: "+defs.length+" boards valid and autopilot-completable with 3 safe acorns and par; walls, pegs, felt, varnish, acorns, hits, wall slide, friction, speed cap, pits, respawn, checkpoints, goal");
