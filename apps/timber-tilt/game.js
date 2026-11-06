// Timber Tilt: original tilt-maze sample homebrew for the CivSwitch loader.
// Keeps the loader promise pending while playing, then cleans up and resolves.
(async function(){
    "use strict";
    var VERSION="0.2.2",cfg=window.__timberTiltConfig||{},maxSeconds=Math.max(30,Math.min(3600,Number(cfg.maxSeconds)||1800));
    var start=Date.now(),W=1280,H=720,PER=6,canvas,ctx,view,input,timer,deadline,heartbeat,resolveDone,closed=false,lastFrame=null,lastTick=Date.now();
    var INK="#2b170a",CREAM="#fbeedd",RUST="#9b3f17";
    var levels=TIMBER_LEVELS.map(function(d){return TimberPhysics.parse(d);}),chapters=Math.ceil(levels.length/PER);
    var report={schema:"timber-tilt/1",version:VERSION,reason:null,errors:[],warnings:[],durationMs:0,boardsCleared:0,falls:0,bumps:0,pegHits:0,acorns:0,boards:{},
        controls:{motionFrames:0,stickFrames:0,dpadFrames:0,touchFrames:0,recenters:0,precisionFrames:0,tiltHeldFrames:0},touchMenuActivations:0,maxContacts:0,views:{},
        cleanup:{timers:false,input:false,overlay:false,motion:false,rumble:false},environment:{preview:!!cfg.preview,targetHost:cfg.targetHost||null,declaredPlatform:cfg.platform||null,
        viewport:{width:window.innerWidth,height:window.innerHeight},userAgent:String(navigator.userAgent||"").slice(0,160),firmware:null,hardwareModel:null}};
    levels.forEach(function(l){report.boards[l.id]={attempts:0,clears:0,bestMs:null,falls:0,stars:0,acorns:0,par:l.par};});
    var ui={view:"title",selected:0,toast:null,toastUntil:0,info:false,calSkipped:false,calDoneAt:null,calFrom:null,levelIndex:0,nextMove:0,demo:0,levelsFrom:"title"};
    var game=null,tiltFinger=null,nativeReader=null,nativeFailed=false,clearInfo=null;
    var tilt=createTimberTilt(),motionView={status:"not opened",message:"",streams:[]};
    var helpers={write64:typeof write64==="function"?write64:null,malloc:typeof malloc==="function"?malloc:null,free:typeof free==="function"?free:null,call_rop:typeof call_rop==="function"?call_rop:null};
    function logLine(s){try{var p=log(String(s).slice(0,300));if(p&&p.catch)p.catch(function(){});}catch(_){}}
    function openMotionNative(){return createSwitchMotionNative({read64:read64,sdkBase:sdk_base,profiles:window.__switchMotionProfiles});}
    var motion=createSwitchMotion({openNative:openMotionNative,helpers:{write64:helpers.write64,malloc:helpers.malloc,free:helpers.free,call_rop:helpers.call_rop,note:function(s){logLine("TIMBER_MOTION "+s);}}});
    // One read-only motion reader serves every rumble proof (it only polls the stream list); each
    // transaction still re-proves the code profile and creates its own pulse session.
    var rumbleReader=null;function rumbleReaderOnce(){if(!rumbleReader)rumbleReader=openMotionNative();return rumbleReader;}
    var haptics=createTimberHaptics({openNative:function(){return createSwitchRumbleNative({sdkBase:sdk_base,read64:read64,profile:window.__switchRumbleProfile,openReader:rumbleReaderOnce,helpers:helpers});},
        defer:function(fn){setTimeout(fn,0);},now:function(){return Date.now()-start;},note:function(s){logLine("TIMBER_RUMBLE "+s);}});
    function now(){return Date.now()-start;}
    function warn(s){if(report.warnings.length<12)report.warnings.push(String(s).slice(0,180));}
    function toast(s,ms){ui.toast=s;ui.toastUntil=Date.now()+(ms||1800);}
    function close(reason){if(closed)return;closed=true;report.reason=reason;if(resolveDone)resolveDone();}
    function motionLive(){return motionView.status==="live";}
    function go(name){if(name!=="play"&&name!=="clear")haptics.stop(now(),"menu");ui.view=name;ui.selected=0;ui.nextMove=Date.now()+180;tiltFinger=null;report.views[name]=(report.views[name]||0)+1;}
    function label(i){return (Math.floor(i/PER)+1)+"-"+(i%PER+1);}
    function totalStars(){var n=0;levels.forEach(function(l){n+=report.boards[l.id].stars;});return n;}
    function startBoard(i){ui.levelIndex=i;var l=levels[i];view.setLevel(l);game=TimberPhysics.create(l);report.boards[l.id].attempts++;go("play");}
    function openLevels(from){ui.levelsFrom=from;go("levels");ui.selected=ui.levelIndex;}
    function play(i){if(motionLive()&&!tilt.calibrated()&&!ui.calSkipped){calibrate("board:"+i);return;}startBoard(i);}
    function calibrate(from){ui.calFrom=from;ui.calDoneAt=null;if(motionLive())tilt.startWizard(now());go("calibrate");}
    function finishCalibration(){var from=ui.calFrom||"title";tilt.cancelWizard();if(from.indexOf("board:")===0)startBoard(Number(from.slice(6)));else if(from==="pause"){view.setLevel(levels[ui.levelIndex]);go("pause");}else go("title");}
    function recenter(){if(tilt.recenter()){report.controls.recenters++;toast("TILT RECENTERED");}else toast(motionLive()?"CALIBRATE TILT FIRST":"MOTION OFF - USE STICK OR TOUCH");}
    function rumbleLabel(){return "RUMBLE: "+haptics.mode();}
    function cycleRumble(){rumbleReader=null;var m=haptics.cycle(now());toast(m==="OFF"?"RUMBLE OFF":m==="LIGHT"?"RUMBLE LIGHT - BIG MOMENTS ONLY":"RUMBLE FULL - WALL TAPS TOO");if(m!=="OFF")haptics.play("checkpoint",now());}
    // Layouts shared by drawing and touch hit-testing.
    var L={
        title:function(i){return {x:110,y:262+i*58,w:410,h:48};},
        pause:function(i){return {x:420,y:166+i*54,w:440,h:46};},
        clear:function(i){return {x:440,y:452+i*58,w:400,h:48};},
        tab:function(i){return {x:170+i*240,y:146,w:220,h:46};},
        level:function(i){var k=i%PER;return {x:170+(k%3)*322,y:210+Math.floor(k/3)*168,w:296,h:150};},
        levelBack:{x:490,y:604,w:300,h:50},calSkip:{x:300,y:556,w:320,h:52},calBack:{x:660,y:556,w:320,h:52},howBack:{x:490,y:612,w:300,h:50},
        pauseBtn:{x:1128,y:8,w:140,h:40},recenterBtn:{x:978,y:8,w:140,h:40}
    };
    function inside(p,r){return p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h;}
    function items(){
        if(ui.view==="title")return [["PLAY",function(){play(firstOpen());}],["BOARDS",function(){openLevels("title");}],[rumbleLabel(),cycleRumble],["CALIBRATE TILT",function(){calibrate("title");}],["HOW TO PLAY",function(){go("howto");}],["EXIT TO LOADER",function(){close("menu exit");}]];
        if(ui.view==="pause")return [["RESUME",function(){go("play");}],["RECENTER TILT",function(){recenter();go("play");}],["SENSITIVITY: "+tilt.sensitivity(),function(){toast("SENSITIVITY "+tilt.cycleSensitivity());}],[rumbleLabel(),cycleRumble],["RESTART BOARD",function(){startBoard(ui.levelIndex);}],["CALIBRATE TILT",function(){calibrate("pause");}],["BOARDS",function(){openLevels("pause");}],["EXIT TO LOADER",function(){close("menu exit");}]];
        if(ui.view==="clear"){var last=ui.levelIndex===levels.length-1;return [[last?"BACK TO TITLE":"NEXT BOARD",function(){if(last)go("title");else play(ui.levelIndex+1);}],["RETRY",function(){startBoard(ui.levelIndex);}],["BOARDS",function(){openLevels("title");}]];}
        return [];
    }
    // PLAY continues at the first board not yet cleared this session.
    function firstOpen(){for(var i=0;i<levels.length;i++)if(!report.boards[levels[i].id].clears)return i;return 0;}
    function rectFor(i){return ui.view==="title"?L.title(i):ui.view==="pause"?L.pause(i):L.clear(i);}
    function direction(frame){
        var now2=Date.now(),s=frame.sticks.left,dx=0,dy=0;
        if(frame.pressed.indexOf("Down")>=0)dy=1;else if(frame.pressed.indexOf("Up")>=0)dy=-1;else if(frame.pressed.indexOf("Right")>=0)dx=1;else if(frame.pressed.indexOf("Left")>=0)dx=-1;
        else if(now2>=ui.nextMove){if(s.y<-0.6)dy=1;else if(s.y>0.6)dy=-1;else if(s.x>0.6)dx=1;else if(s.x<-0.6)dx=-1;}
        if(dx||dy)ui.nextMove=now2+230;return {dx:dx,dy:dy};
    }
    function touchStarts(frame,pts){return pts.filter(function(p){return frame.touch.startedIds.indexOf(p.id)>=0;});}
    function menu(frame,pts){
        var list=items(),d=direction(frame);if(d.dx||d.dy)ui.selected=(ui.selected+d.dx+d.dy+list.length)%list.length;
        if((frame.pressed.indexOf("B")>=0||frame.pressed.indexOf("Plus")>=0)&&ui.view==="pause"){go("play");return;}
        if(frame.pressed.indexOf("A")>=0){list[ui.selected][1]();return;}
        touchStarts(frame,pts).some(function(p){for(var i=0;i<list.length;i++)if(inside(p,rectFor(i))){ui.selected=i;report.touchMenuActivations++;list[i][1]();return true;}return false;});
    }
    function levelsInput(frame,pts){
        var d=direction(frame),sel=ui.selected,ch=Math.floor(sel/PER),k=sel%PER,col=k%3,row=Math.floor(k/3);
        if(d.dy)row=1-row;
        if(d.dx){col+=d.dx;if(col>2){col=0;ch=(ch+1)%chapters;}else if(col<0){col=2;ch=(ch+chapters-1)%chapters;}}
        if(frame.pressed.indexOf("R")>=0||frame.pressed.indexOf("ZR")>=0)ch=(ch+1)%chapters;
        if(frame.pressed.indexOf("L")>=0||frame.pressed.indexOf("ZL")>=0)ch=(ch+chapters-1)%chapters;
        ui.selected=Math.min(levels.length-1,ch*PER+row*3+col);
        var leave=function(){go(ui.levelsFrom==="pause"&&game?"pause":"title");};
        if(frame.pressed.indexOf("B")>=0){leave();return;}
        if(frame.pressed.indexOf("A")>=0){play(ui.selected);return;}
        touchStarts(frame,pts).some(function(p){
            if(inside(p,L.levelBack)){report.touchMenuActivations++;leave();return true;}
            for(var t=0;t<chapters;t++)if(inside(p,L.tab(t))){report.touchMenuActivations++;ui.selected=t*PER+(ui.selected%PER);return true;}
            var base=Math.floor(ui.selected/PER)*PER;for(var i=base;i<Math.min(levels.length,base+PER);i++)if(inside(p,L.level(i))){report.touchMenuActivations++;play(i);return true;}return false;});
    }
    function calibrateInput(frame,pts,ms){
        var w=tilt.wizard(ms),back=function(){var from=ui.calFrom||"title";tilt.cancelWizard();if(from==="pause"){view.setLevel(levels[ui.levelIndex]);go("pause");}else go("title");};
        var skip=function(){ui.calSkipped=true;toast("USING STICK / TOUCH");finishCalibration();};
        if(motionLive()&&!w&&!tilt.calibrated())tilt.startWizard(ms);
        if(w&&w.step==="done"){if(ui.calDoneAt===null){ui.calDoneAt=ms;ui.calSkipped=false;haptics.play("calibrated",ms);}if(ms-ui.calDoneAt>1300||frame.pressed.indexOf("A")>=0)finishCalibration();return;}
        if(frame.pressed.indexOf("B")>=0){back();return;}
        if(frame.pressed.indexOf("X")>=0){skip();return;}
        if(frame.pressed.indexOf("Y")>=0&&motionLive()){tilt.startWizard(ms);return;}
        touchStarts(frame,pts).some(function(p){if(inside(p,L.calSkip)){report.touchMenuActivations++;skip();return true;}if(inside(p,L.calBack)){report.touchMenuActivations++;back();return true;}return false;});
    }
    function sideOf(hit){return hit.nx>0.5?0:hit.nx<-0.5?1:2;}
    function playInput(frame,pts,dt,ms){
        var b=frame.buttons;
        if(frame.pressed.indexOf("Plus")>=0||frame.pressed.indexOf("Minus")>=0||frame.pressed.indexOf("B")>=0){go("pause");return;}
        if(frame.pressed.indexOf("Y")>=0)recenter();
        if(frame.pressed.indexOf("L")>=0){startBoard(ui.levelIndex);toast("BOARD RESTARTED");return;}
        if(frame.pressed.indexOf("X")>=0)ui.info=!ui.info;
        var starts=touchStarts(frame,pts);
        for(var i=0;i<starts.length;i++){
            if(inside(starts[i],L.pauseBtn)){report.touchMenuActivations++;go("pause");return;}
            if(inside(starts[i],L.recenterBtn)){report.touchMenuActivations++;recenter();continue;}
            if(tiltFinger===null)tiltFinger={id:starts[i].id,x:starts[i].x,y:starts[i].y,cx:starts[i].x,cy:starts[i].y};
        }
        var tx=0,ty=0,s=frame.sticks.left;
        if(tiltFinger){var f=pts.filter(function(p){return p.id===tiltFinger.id;})[0];if(!f)tiltFinger=null;else{tiltFinger.cx=f.x;tiltFinger.cy=f.y;tx+=(f.x-tiltFinger.x)/150;ty+=(f.y-tiltFinger.y)/150;report.controls.touchFrames++;}}
        if(Math.abs(s.x)>0.12||Math.abs(s.y)>0.12){tx+=s.x;ty-=s.y;report.controls.stickFrames++;}
        var dx=(b.Right?1:0)-(b.Left?1:0),dy=(b.Down?1:0)-(b.Up?1:0);if(dx||dy){tx+=dx*0.75;ty+=dy*0.75;report.controls.dpadFrames++;}
        if(motionLive()&&tilt.calibrated()){var m=tilt.tilt();if(m.x||m.y)report.controls.motionFrames++;tx+=m.x;ty+=m.y;}
        if(b.R){tx*=0.5;ty*=0.5;report.controls.precisionFrames++;}
        var mag=Math.sqrt(tx*tx+ty*ty);if(mag>1){tx/=mag;ty/=mag;}
        ui.tilt={x:tx,y:ty};
        TimberPhysics.step(game,ui.tilt,dt);
        var id=game.level.id,rec=report.boards[id];
        game.events.forEach(function(e){
            if(e==="bump"&&game.hit&&game.hit.kind==="wall")haptics.play("bump",ms,{side:sideOf(game.hit),strength:game.hit.v});
            if(e==="peg"){report.pegHits++;haptics.play("peg",ms,game.hit&&game.hit.kind==="peg"?{side:sideOf(game.hit)}:null);}
            if(e==="acorn"){report.acorns++;haptics.play("acorn",ms);toast("ACORN "+game.acornCount+"/"+game.level.acorns.length);}
            if(e==="fall"){report.falls++;rec.falls++;haptics.play("fall",ms);}
            if(e==="checkpoint"){toast("CHECKPOINT "+game.checkpoint);haptics.play("checkpoint",ms);}
            if(e==="won"){
                var t=Math.round(game.elapsed*1000),best=rec.bestMs===null||t<rec.bestMs,all=game.acornCount===game.level.acorns.length,par=game.level.par&&t<=game.level.par*1000;
                var stars=1+(all?1:0)+(par?1:0);rec.clears++;report.boardsCleared++;if(best)rec.bestMs=t;rec.stars=Math.max(rec.stars,stars);rec.acorns=Math.max(rec.acorns,game.acornCount);report.bumps+=game.bumps;
                clearInfo={ms:t,falls:game.falls,best:best,stars:stars,acorns:game.acornCount,all:all,par:par,at:Date.now()};haptics.play("won",ms);
            }
        });
        if(game.mode==="won"&&clearInfo&&Date.now()-clearInfo.at>700)go("clear");
    }
    function motionLine(){
        if(motionLive())return tilt.calibrated()?"TILT READY ("+tilt.sensitivity()+")":"MOTION ON - CALIBRATE TO TILT";
        if(motionView.status==="starting"||motionView.status==="not opened")return "MOTION STARTING - HOLD STILL";
        if(motionView.status==="waiting")return "MOTION WAITING FOR SAMPLES";
        return "MOTION OFF - STICK + TOUCH";
    }
    function stars(x,y,n,r){for(var i=0;i<3;i++)view.star(x+(i-1)*r*2.5,y,r,i<n);}
    function hud(){
        var l=game.level;ctx.fillStyle=view.col("rgba(26,15,8,0.92)","#1a0f08");ctx.fillRect(0,0,W,56);
        view.text(label(ui.levelIndex)+" "+l.name,20,36,22,CREAM);
        view.text(view.clock(game.elapsed*1000),560,40,28,CREAM,"center");
        var over=l.par&&game.elapsed>l.par;view.text("PAR "+view.clock((l.par||0)*1000).slice(0,5),648,36,16,over?"#e08a62":"#cdb088");
        for(var i=0;i<l.acorns.length;i++)view.acorn(790+i*30,30,10,game.acorns[i]);
        view.text("FALLS "+game.falls,880,36,16,CREAM);
        view.button(L.recenterBtn,"RECENTER",false,true);view.button(L.pauseBtn,"PAUSE",false,true);
        var cue=motionLive()&&tilt.calibrated()?"TILT TO ROLL  Y RECENTER  R PRECISION  L RESTART  + PAUSE":"STICK/D-PAD OR DRAG TO TILT  L RESTART  + PAUSE";
        ctx.fillStyle=view.col("rgba(26,15,8,0.8)","#1a0f08");ctx.fillRect(0,690,W,30);view.text(cue,640,712,16,"#e9cf9f","center");
        if(game.mode==="ready"&&game.timer>0.05)view.text(game.timer>0.35?"READY":"GO!",640,150,44,CREAM,"center");
        if(tiltFinger){ctx.strokeStyle=view.col("rgba(255,240,210,0.7)","#f6e2bd");ctx.lineWidth=3;ctx.beginPath();ctx.arc(tiltFinger.x,tiltFinger.y,48,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(tiltFinger.cx,tiltFinger.cy,16,0,Math.PI*2);ctx.fillStyle=view.col("rgba(255,240,210,0.8)","#f6e2bd");ctx.fill();}
        if(ui.info){var iy=480;view.panel(20,iy,420,200);var r=tilt.raw(),t=ui.tilt||{x:0,y:0},hr=haptics.report();
            view.text("TILT  X "+t.x.toFixed(2)+"  Y "+t.y.toFixed(2),38,iy+36,18,INK);view.text("ACC "+(r?r.map(function(v){return v.toFixed(2);}).join(" "):"NONE"),38,iy+66,18,INK);
            view.text("MOTION "+motionView.status,38,iy+96,18,INK);view.text("RUMBLE "+haptics.status().slice(0,24),38,iy+126,18,INK);
            view.text("RUMBLE SETUP "+(hr.timing.avgOpenMs===null?"-":hr.timing.avgOpenMs+" MS"),38,iy+156,18,INK);view.text("FRAME "+perfAvg().toFixed(1)+" MS AVG",38,iy+186,18,INK);}
    }
    function drawMenuPanel(title,sub){view.panel(80,112,470,560);view.text(title,315,184,40,RUST,"center");view.text(sub,315,222,18,INK,"center");}
    function draw(ms){
        var v=ui.view;
        if(v==="title"||v==="howto"){var demo=levels[0],cells=demo.path.cells,u=(ui.demo+=0.033*3)%(cells.length-1),k=Math.floor(u),f=u-k,a=cells[k],b=cells[k+1];view.setLevel(demo);view.board({x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,mode:"rolling",checkpoint:0,acorns:[]},{tilt:{x:(b.x-a.x)*0.6,y:(b.y-a.y)*0.6}});}
        else if(v==="levels"||v==="calibrate"){view.setLevel(levels[v==="levels"?ui.selected:ui.levelIndex]);view.board(null,{path:v==="levels"});}
        else{view.setLevel(game.level);view.board(game,{tilt:ui.tilt||{x:0,y:0}});}
        if(v==="title"){
            drawMenuPanel("TIMBER TILT","ROLL THE STEEL BALL HOME");
            items().forEach(function(it,i){view.button(L.title(i),it[0],i===ui.selected);});
            view.star(250,618,11,true);view.text(totalStars()+"/"+levels.length*3+" STARS",270,626,18,INK);
            view.text(motionLine(),315,656,12,INK,"center");
        }else if(v==="howto"){
            view.panel(160,70,960,630);view.text("HOW TO PLAY",640,124,34,RUST,"center");
            var y=166;["Tilt the board to roll the ball along the dotted line into the brass cup under the blue flag.","Holes swallow the ball. Brass checkpoint tacks set where you restart after a fall.",
             "Green felt slows the ball. Shiny varnish is slick. Brass pegs bounce it away.","Stars: one for the cup, one for all three acorns, one for beating the par time.",
             "Tilt the console after calibrating, or use the stick, D-pad, or drag on the board.","Y re-levels tilt. R holds precision. L restarts. Plus, Minus or B pauses. X shows info.",
             "Rumble: FULL taps on walls and pegs, LIGHT only for acorns, checkpoints, falls and the cup."].forEach(function(s){y=view.wrap(s,200,y,18,INK,880,28)+12;});
            view.button(L.howBack,"BACK",true);
        }else if(v==="levels"){
            var ch=Math.floor(ui.selected/PER);view.panel(130,76,1020,618);view.text("CHOOSE A BOARD",640,124,30,RUST,"center");
            view.text("L / R",1100,124,14,INK,"right");
            for(var t=0;t<chapters;t++){var tr=L.tab(t),th=view.themes[levels[t*PER].theme],sel=t===ch;ctx.fillStyle=sel?"rgb("+th.wall.join(",")+")":"#e5cca4";ctx.fillRect(tr.x,tr.y,tr.w,tr.h);if(sel)view.frameRect(tr.x,tr.y,tr.w,tr.h,"#2b170a",3);
                var cs=0;for(var q=t*PER;q<Math.min(levels.length,t*PER+PER);q++)cs+=report.boards[levels[q].id].stars;view.text((t+1)+" "+th.name,tr.x+14,tr.y+31,18,sel?CREAM:INK);view.text(cs+"*",tr.x+tr.w-12,tr.y+31,18,sel?CREAM:INK,"right");}
            for(var i=ch*PER;i<Math.min(levels.length,ch*PER+PER);i++){var l=levels[i],r=L.level(i),rec=report.boards[l.id],s2=i===ui.selected,ink=s2?"#fff4e2":INK;
                ctx.fillStyle=s2?RUST:"#e5cca4";ctx.fillRect(r.x,r.y,r.w,r.h);
                view.text(label(i),r.x+16,r.y+36,24,ink);view.text(l.name.length>16?l.name.slice(0,16):l.name,r.x+r.w-14,r.y+34,16,ink,"right");
                stars(r.x+70,r.y+72,rec.stars,13);
                for(var a=0;a<l.acorns.length;a++)view.acorn(r.x+190+a*28,r.y+72,9,a<rec.acorns);
                view.text(rec.bestMs===null?"PAR "+view.clock(l.par*1000).slice(0,5):"BEST "+view.clock(rec.bestMs),r.x+r.w/2,r.y+118,18,ink,"center");
                view.text(l.holes.length+" HOLES"+(l.pegs.length?"  "+l.pegs.length+" PEGS":""),r.x+r.w/2,r.y+140,12,ink,"center");}
            view.wrap(levels[ui.selected].hint,170,568,16,INK,940,22);
            view.button(L.levelBack,"BACK",false);
        }else if(v==="calibrate")drawCalibration(ms);
        else{hud();
            if(v==="pause"){view.dim(0,56,W,634,"rgba(20,10,4,0.45)");view.panel(390,92,500,592);view.text("PAUSED",640,144,32,RUST,"center");items().forEach(function(it,i){view.button(L.pause(i),it[0],i===ui.selected,true);});view.text(motionLine(),640,664,12,INK,"center");}
            if(v==="clear"){view.dim(0,56,W,634,"rgba(20,10,4,0.4)");view.panel(390,120,500,540);var last=ui.levelIndex===levels.length-1,c=clearInfo;
                view.text(last?"ALL BOARDS DONE!":"BOARD CLEARED!",640,176,30,RUST,"center");stars(640,226,c.stars,24);
                view.text("TIME "+view.clock(c.ms)+(c.best?"  NEW BEST":""),640,292,22,INK,"center");
                view.text((c.par?"BEAT ":"MISSED ")+"PAR "+view.clock(game.level.par*1000).slice(0,5),640,328,18,c.par?"#3d7a3a":RUST,"center");
                view.text("ACORNS "+c.acorns+"/"+game.level.acorns.length+"   FALLS "+c.falls,640,362,18,INK,"center");
                view.text("BEST "+view.clock(report.boards[game.level.id].bestMs)+"   STARS "+totalStars()+"/"+levels.length*3,640,396,18,INK,"center");
                items().forEach(function(it,i){view.button(L.clear(i),it[0],i===ui.selected);});}
        }
        if(ui.toast&&Date.now()<ui.toastUntil){var tw=Math.max(400,view.font.width(ui.toast,18)+48),ty=v==="play"||v==="calibrate"?620:64;ctx.fillStyle=view.col("rgba(26,15,8,0.9)","#1a0f08");ctx.fillRect(640-tw/2,ty,tw,46);view.text(ui.toast,640,ty+30,18,"#ffe7b8","center");}
    }
    function drawCalibration(ms){
        view.dim(0,0,W,H,"rgba(20,10,4,0.45)");view.panel(240,90,800,560);view.text("CALIBRATE TILT",640,146,32,RUST,"center");
        var w=tilt.wizard(ms),msg,sub="";
        if(!motionLive()){msg=motionView.status==="starting"||motionView.status==="not opened"?"Motion is starting. Keep the console still for a moment.":"Motion is not available: "+String(motionView.message||motionView.status);sub="You can still play with the stick, D-pad or touch.";}
        else if(!w)msg="Starting...";
        else{msg={hold:"Hold the console the way you will play, and keep it still.",right:"Now tilt the RIGHT side DOWN.",level1:"Good. Level it out again.",top:"Now tilt the TOP edge DOWN, away from you.",level2:"Level it out once more.",done:"Tilt is calibrated!"}[w.step];
            if((w.step==="right"||w.step==="top")&&w.stepMs>9000)sub="No tilt seen yet? Tilt further, or SKIP to use the stick.";
            if(w.step==="done")sub="Y or RECENTER in game re-levels it any time.";}
        view.wrap(msg,290,206,24,INK,700,36);if(sub)view.wrap(sub,290,292,16,RUST,700,24);
        // Bubble level: shows live tilt after calibration, or raw change during the wizard.
        var cx=640,cy=420,R=92;ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.fillStyle="#d9bf93";ctx.fill();ctx.strokeStyle="#6b3d1d";ctx.lineWidth=3;ctx.beginPath();ctx.arc(cx,cy,R*0.3,0,Math.PI*2);ctx.stroke();
        var p=tilt.calibrated()&&(!w||w.step==="done")?tilt.tilt():w&&w.preview?{x:w.preview[0]/0.35,y:w.preview[1]/0.35}:{x:0,y:0},m=Math.sqrt(p.x*p.x+p.y*p.y);if(m>1){p.x/=m;p.y/=m;}
        ctx.beginPath();ctx.arc(cx+p.x*(R-18),cy+p.y*(R-18),16,0,Math.PI*2);ctx.fillStyle="#8f9aa5";ctx.fill();
        if(w){var steps=["hold","right","level1","top","level2","done"],k=steps.indexOf(w.step);for(var i=0;i<5;i++){ctx.fillStyle=i<k?"#3d7a3a":i===k?"#c9662f":"#cdb088";ctx.fillRect(420+i*90,526,80,12);}
            if(k<5){ctx.fillStyle="#9b3f17";ctx.fillRect(420+k*90,526,80*Math.max(0,Math.min(1,w.progress)),12);}}
        view.button(L.calSkip,"SKIP - USE STICK (X)",false,true);view.button(L.calBack,"BACK (B)",false,true);
    }
    var perf={ticks:0,totalMs:0,maxMs:0,slow:0,window:[],views:{}};
    function perfAvg(){return perf.window.length?perf.window.reduce(function(a,b){return a+b;},0)/perf.window.length:0;}
    function tick(){
        if(closed)return;
        var t0=Date.now(),v0=ui.view;
        try{
            var nowMs=Date.now(),ms=nowMs-start,dt=Math.min(0.1,(nowMs-lastTick)/1000);lastTick=nowMs;
            if(nativeReader&&!nativeFailed){try{input.pollTouch();}catch(e){nativeFailed=true;warn("Native touch disabled: "+(e&&e.message||e));}}
            var frame=input.drain();lastFrame=frame;
            var pts=(frame.independentTouchContacts||[]).map(function(p){return {id:p.id,x:p.x*W/(window.innerWidth||W),y:p.y*H/(window.innerHeight||H)};});
            report.maxContacts=Math.max(report.maxContacts,pts.length);
            haptics.tick(ms);
            motion.tick(ms,true);motionView=motion.view(ms);
            // Vibration shakes the accelerometer: hold the last tilt while a pattern plays.
            var st=motionView.streams&&motionView.streams[0];
            if(st&&st.latest&&st.ageMs!==null&&st.ageMs<500){if(haptics.busy(ms)&&tilt.calibrated()&&ui.view==="play")report.controls.tiltHeldFrames++;else tilt.feed(st.latest.acceleration,st.latest.samplingNumber,ms);}
            if(motionView.status==="unavailable"&&!ui.motionWarned){ui.motionWarned=true;warn("Motion unavailable: "+motionView.message);}
            var v=ui.view;
            if(v==="play")playInput(frame,pts,dt,ms);
            else if(v==="title"||v==="pause"||v==="clear")menu(frame,pts);
            else if(v==="levels")levelsInput(frame,pts);
            else if(v==="calibrate")calibrateInput(frame,pts,ms);
            else if(v==="howto"){if(frame.pressed.indexOf("B")>=0||frame.pressed.indexOf("A")>=0||touchStarts(frame,pts).some(function(p){return inside(p,L.howBack);}))go("title");}
            if(!closed)draw(ms);
        }catch(e){report.errors.push(String(e&&e.stack||e).slice(0,240));close("runtime error");}
        var spent=Date.now()-t0;perf.ticks++;perf.totalMs+=spent;if(spent>perf.maxMs)perf.maxMs=spent;if(spent>33)perf.slow++;perf.window.push(spent);if(perf.window.length>60)perf.window.shift();
        var pv=perf.views[v0]||(perf.views[v0]={ticks:0,totalMs:0,maxMs:0});pv.ticks++;pv.totalMs+=spent;if(spent>pv.maxMs)pv.maxMs=spent;
    }
    try{
        try{nativeReader=createCivVerifiedNativeTouch(read64,sdk_base);}catch(e){warn("Independent touch unavailable: "+(e&&e.message||e));}
        input=createCivInputAdapter(engine,{nativeTouchReader:nativeReader});
        canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;
        Object.assign(canvas.style,{position:"fixed",left:"0",top:"0",width:"100%",height:"100%",zIndex:"2147483010",pointerEvents:"none",backgroundColor:"#2b1b10"});
        document.body.appendChild(canvas);ctx=canvas.getContext("2d");if(!ctx)throw Error("Canvas 2D unavailable");
        view=createTimberView(ctx);input.attach();
        motion.open(0);go("title");tick();
        if(!closed)await new Promise(function(resolve){resolveDone=resolve;timer=setInterval(tick,33);deadline=setTimeout(function(){close("session time limit");},maxSeconds*1000);
            heartbeat=setInterval(function(){logLine("TIMBER_TILT alive view="+ui.view+" board="+label(ui.levelIndex)+" clears="+report.boardsCleared+" stars="+totalStars()+" motion="+motionView.status+" calibrated="+(tilt.calibrated()?1:0)+" rumble="+haptics.mode()+"/"+(haptics.available()?"ok":"off")+" frameMs="+perfAvg().toFixed(1));},15000);});
    }catch(e){report.errors.push(String(e&&e.stack||e).slice(0,240));report.reason=report.reason||"startup error";}
    finally{
        clearInterval(timer);clearInterval(heartbeat);clearTimeout(deadline);report.cleanup.timers=true;
        try{haptics.close(now());report.rumble=haptics.report();report.cleanup.rumble=report.rumble.nativeCleanup;}catch(e){report.errors.push("Rumble cleanup: "+String(e&&e.message||e).slice(0,160));}
        try{motion.close();report.motion=motion.report();report.cleanup.motion=report.motion.nativeCleanup;if(report.motion.activation)report.motion.activation.errors.forEach(function(s){report.errors.push("Motion: "+String(s).slice(0,180));});}
        catch(e){report.errors.push("Motion cleanup: "+String(e&&e.message||e).slice(0,160));}
        report.tilt=tilt.report();report.canvasAlpha=view?view.alphaOK:null;report.starsTotal=totalStars();
        var byView={};Object.keys(perf.views).forEach(function(k){var p=perf.views[k];byView[k]={ticks:p.ticks,avgMs:Math.round(p.totalMs/p.ticks*10)/10,maxMs:p.maxMs};});
        report.perf={ticks:perf.ticks,avgTickMs:perf.ticks?Math.round(perf.totalMs/perf.ticks*10)/10:null,maxTickMs:perf.maxMs,ticksOver33ms:perf.slow,intervalMs:33,byView:byView};report.calibrationSkipped=ui.calSkipped;
        if(lastFrame)report.actionCounts=lastFrame.actionCounts;if(nativeReader&&nativeReader.stats)report.nativeTouchStats=JSON.parse(JSON.stringify(nativeReader.stats));
        if(input){try{input.detach();report.cleanup.input=true;}catch(e){report.errors.push("Detach: "+String(e&&e.message||e).slice(0,140));}}
        if(canvas&&canvas.parentNode){canvas.parentNode.removeChild(canvas);report.cleanup.overlay=true;}
        report.durationMs=Date.now()-start;report.limits={motionUnits:"raw, player-calibrated directions only",motionSource:"native handheld route; physical source not queried",rumbleRoute:"handheld ID32/style2 only; docked/other controllers refuse",unqueried:["firmware","hardware model","controller identity"]};
    }
    window.__timberTiltLastReport=report;
    await sendCivInputProReport(report);
})();
