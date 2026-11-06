// Offline headless Chromium check of the real game code with simulated loader input/motion/rumble.
// Never opens a console connection. Screenshots are DESKTOP SIMULATION, not hardware evidence.
"use strict";
const { chromium }=require(process.env.PLAYWRIGHT_MODULE||"playwright");
const path=require("node:path"),fs=require("node:fs"),assert=require("node:assert/strict"),{pathToFileURL}=require("node:url");
(async()=>{
    const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
    try{
        const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on("pageerror",e=>errors.push(e.message));
        await page.addInitScript(()=>{document.createElementNS=function(){throw Error("No SVG");};for(const n of ["createImageData","putImageData","getImageData","drawImage","createLinearGradient","createRadialGradient","createPattern","fillText","strokeText"])CanvasRenderingContext2D.prototype[n]=function(){throw Error("No "+n+" in this game");};});
        const shots=path.join(__dirname,"screenshots");fs.mkdirSync(shots,{recursive:true});
        const P=f=>page.evaluate(f),wait=ms=>page.waitForTimeout(ms);
        const key=async(k,hold)=>{await page.keyboard.down(k);await wait(hold||70);await page.keyboard.up(k);await wait(90);};
        const device=(roll,pitch)=>page.evaluate(([r,p])=>{window.__timberPreview.device={roll:r,pitch:p};},[roll,pitch]);
        const tap=(x,y)=>page.mouse.click(x,y,{delay:90});
        await page.goto(pathToFileURL(path.join(__dirname,"preview.html")).href);
        await page.waitForFunction(()=>engine.count()===1);
        await page.waitForFunction(()=>window.__timberPreview.motion.starts===1,null,{timeout:5000});
        await wait(300);await page.screenshot({path:path.join(shots,"title.png")});
        // PLAY with live, uncalibrated motion opens the calibration wizard first.
        await key("KeyZ");await wait(200);await page.screenshot({path:path.join(shots,"calibrate.png")});
        await wait(1300);await device(0.4,0);await wait(600);await device(0,0);await wait(700);await device(0,-0.4);await wait(600);await device(0,0);
        await page.waitForFunction(()=>window.__timberPreview.state&&window.__timberPreview.state.level.id==="first",null,{timeout:5000});
        assert(await P(()=>window.__timberPreview.rumble.starts.length>=1),"calibration done pulse");
        await wait(1000);
        // Motion: right side down rolls right; top edge away rolls up.
        let s0=await P(()=>({x:window.__timberPreview.state.x,y:window.__timberPreview.state.y}));
        await device(0.18,0);await wait(700);await device(0,0);
        let t=await P(()=>window.__timberPreview.state);assert(t.x>s0.x+0.5,"motion right did not roll right: "+JSON.stringify([s0,t.x]));
        await device(0,0.2);await wait(600);let tilt=await P(()=>window.__timberPreview.tilt);assert(tilt.y>0.3,"tilting bottom down should roll down: "+JSON.stringify(tilt));await device(0,0);
        await device(0,-0.2);await wait(300);tilt=await P(()=>window.__timberPreview.tilt);assert(tilt.y<-0.3,"top away should roll up");await device(0,0);await wait(300);
        // Stick and touch-drag tilt.
        await P(()=>window.__timberPreview.emit("nav-move",2,1,0));await wait(200);tilt=await P(()=>window.__timberPreview.tilt);assert(tilt.x>0.9,"stick right");
        await P(()=>window.__timberPreview.emit("nav-move",1,0,0));await wait(150);
        await P(()=>window.__timberPreview.setContacts([{id:41,x:700,y:400}]));await wait(120);
        await P(()=>window.__timberPreview.setContacts([{id:41,x:700,y:520}]));await wait(200);tilt=await P(()=>window.__timberPreview.tilt);assert(tilt.y>0.6,"touch drag down "+JSON.stringify(tilt));
        await page.screenshot({path:path.join(shots,"play-touch.png")});
        await P(()=>window.__timberPreview.setContacts([]));await wait(150);await P(()=>window.__timberPreview.setContacts(null));await wait(400);
        // Wall bump on the right side of the ball pulses the RIGHT motor only.
        await P(()=>{const r=window.__timberPreview.rumble;r.starts.length=0;const s=window.__timberPreview.state;s.mode="rolling";s.x=12.9;s.y=5.5;s.vx=7;s.vy=0;});
        await page.waitForFunction(()=>window.__timberPreview.rumble.starts.length>0,null,{timeout:3000});
        assert.deepEqual(await P(()=>window.__timberPreview.rumble.starts[0].devices),[1],"right wall -> right motor");await wait(400);
        // Acorn pickup.
        await P(()=>{const s=window.__timberPreview.state,a=s.level.acorns[0];s.mode="rolling";s.x=a.x-0.3;s.y=a.y;s.vx=0.5;s.vy=0;});await wait(300);
        assert.equal(await P(()=>window.__timberPreview.state.acornCount),1,"acorn collected");
        // Fall into a hole, respawn; then roll into the goal.
        await wait(500);await P(()=>{window.__timberPreview.rumble.starts.length=0;const s=window.__timberPreview.state,h=s.level.holes[0];s.mode="rolling";s.x=h.x-0.7;s.y=h.y;s.vx=3;s.vy=0;});await wait(200);
        t=await P(()=>window.__timberPreview.state);assert(t.falls>=1,"expected a fall");assert(await P(()=>window.__timberPreview.rumble.starts.some(x=>x.devices.length===2)),"fall pulse on both sides");await wait(1600);
        await P(()=>{const s=window.__timberPreview.state,g=s.level.goal;s.mode="rolling";s.x=g.x;s.y=g.y+1.2;s.vx=0;s.vy=-3;});
        await page.waitForFunction(()=>window.__timberPreview.state.mode==="won");await wait(900);
        await page.screenshot({path:path.join(shots,"clear.png")});
        // Clear screen -> BOARDS (touch) -> chapter switch with R, tab touch, then board 1-5 by touch.
        await tap(640,452+2*58+24);await wait(200);await page.screenshot({path:path.join(shots,"boards.png")});
        await key("Digit2");await wait(100);await page.screenshot({path:path.join(shots,"boards-oak.png")});
        await tap(170+3*240+110,146+23);await wait(150);await page.screenshot({path:path.join(shots,"boards-walnut.png")});
        await tap(170+110,146+23);await wait(150);
        await tap(170+322+148,210+168+75);await page.waitForFunction(()=>window.__timberPreview.state.level.id==="bridges");await wait(1100);
        await P(()=>window.__timberPreview.emit("nav-move",2,0.6,0.3));await wait(500);await P(()=>window.__timberPreview.emit("nav-move",1,0,0));
        await key("KeyC");await page.screenshot({path:path.join(shots,"play-bridges.png")});await key("KeyC");
        // Y recenters; L restarts; pause by Plus, sensitivity + rumble cycle, resume with B.
        await device(0.05,0.05);await wait(300);await key("KeyV");await device(0.05,0.05);
        await key("Digit1");await wait(120);t=await P(()=>window.__timberPreview.state);assert.equal(t.mode,"ready");assert.equal(t.elapsed,0);
        await key("KeyP");await wait(150);await page.screenshot({path:path.join(shots,"pause.png")});
        await key("ArrowDown");await key("ArrowDown");await key("KeyZ");await key("ArrowDown");await key("KeyZ");await key("KeyX");await wait(100);
        // Pause via the touch button, then EXIT TO LOADER by touch.
        await tap(1128+70,8+20);await wait(150);
        await tap(640,166+7*54+23);
        await page.waitForFunction(()=>window.__timberPreview.report,null,{timeout:5000});
        const report=await P(()=>window.__timberPreview.report);
        assert.equal(report.schema,"timber-tilt/1");assert.equal(report.version,"0.2.2");assert.equal(report.reason,"menu exit");assert.deepEqual(report.errors,[]);
        assert(report.boardsCleared>=1&&report.boards.first.clears===1&&report.boards.first.bestMs>0&&report.boards.first.stars>=1&&report.boards.first.acorns===1);
        assert(report.falls>=1&&report.acorns>=1&&report.tilt.calibrated&&report.tilt.calibration.rightPeak>0.2&&report.tilt.recenters>=1);
        assert(report.controls.motionFrames>0&&report.controls.stickFrames>0&&report.controls.touchFrames>0);
        assert.equal(report.tilt.sensitivity,"HIGH");assert.equal(report.canvasAlpha,true);assert(report.perf.ticks>100&&report.perf.avgTickMs>=0&&report.perf.byView.play.ticks>0);
        assert.equal(report.rumble.mode,"LIGHT");assert.equal(report.rumble.nativeCleanup,true);assert(report.rumble.totalAttempts>=4&&report.rumble.events.won===1&&report.rumble.events.fall>=1);
        assert(report.rumble.attempts.every(a=>a.zeroed&&a.freed&&!a.error),"rumble attempts "+JSON.stringify(report.rumble.attempts));
        assert(Object.values(report.cleanup).every(Boolean),"cleanup "+JSON.stringify(report.cleanup));
        const rs=await P(()=>window.__timberPreview.rumble);assert.equal(rs.opens,rs.closes,"every rumble transaction closed");
        assert.equal(await P(()=>window.__timberPreview.motion.stops),1);
        assert.equal(await P(()=>engine.count()),0);assert.equal(await page.locator("canvas").count(),0);assert.deepEqual(errors,[]);
        fs.writeFileSync(path.join(shots,"desktop-session.json"),JSON.stringify({note:"DESKTOP SIMULATION - not console evidence",report},null,2)+"\n");
        // Unsupported motion + rumble route, no-alpha canvas: game still plays with stick/touch.
        const page2=await browser.newPage({viewport:{width:1280,height:720}}),errors2=[];page2.on("pageerror",e=>errors2.push(e.message));
        await page2.addInitScript(()=>{window.__forceUnsupported=true;for(const k of ["fillStyle","strokeStyle"]){const d=Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype,k);Object.defineProperty(CanvasRenderingContext2D.prototype,k,{get:d.get,set(v){if(/rgba/i.test(String(v)))return;d.set.call(this,v);},configurable:true});}});
        await page2.goto(pathToFileURL(path.join(__dirname,"preview.html")).href);await page2.evaluate(()=>{window.__timberPreview.rumble.unsupported=true;});
        await page2.waitForFunction(()=>engine.count()===1);
        await page2.screenshot({path:path.join(shots,"title-no-motion.png")});
        await page2.keyboard.press("KeyZ");await page2.waitForFunction(()=>window.__timberPreview.state&&window.__timberPreview.state.level.id==="first");
        await page2.waitForTimeout(1000);await page2.evaluate(()=>window.__timberPreview.emit("nav-move",2,0,-1));await page2.waitForTimeout(400);
        assert(await page2.evaluate(()=>window.__timberPreview.state.y>window.__timberPreview.state.level.start.y+0.3),"stick-only play");
        await page2.evaluate(()=>{const s=window.__timberPreview.state,h=s.level.holes[0];s.mode="rolling";s.x=h.x-0.7;s.y=h.y;s.vx=3;s.vy=0;});await page2.waitForTimeout(300);
        await page2.screenshot({path:path.join(shots,"play-no-alpha.png")});await page2.keyboard.press("KeyP");await page2.waitForTimeout(120);await page2.mouse.click(640,166+7*54+23,{delay:90});
        await page2.waitForFunction(()=>window.__timberPreview.report);const r2=await page2.evaluate(()=>window.__timberPreview.report);
        assert.deepEqual(r2.errors,[]);assert.equal(r2.canvasAlpha,false);assert(r2.warnings.some(w=>/Motion unavailable/.test(w)));assert(/handheld route/.test(r2.rumble.unavailable),"rumble unavailable reason");
        assert(r2.cleanup.motion&&r2.cleanup.overlay&&r2.cleanup.input&&r2.cleanup.rumble);assert.deepEqual(errors2,[]);
        console.log("PASS: title, motion baseline/start, calibration + pulse, motion/stick/touch tilt, right-wall right-motor bump, acorn, fall pulse, goal/clear, chapters/tabs, touch boards, info, recenter, restart, pause/sensitivity/rumble mode, touch exit, report, cleanup/Stop; unsupported motion+rumble + no-alpha fallback");
    }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
