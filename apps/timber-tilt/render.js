// Timber Tilt Canvas renderer: perspective wooden board drawn with plain paths/arcs/fillRect.
// No images, gradients, pixel access, SVG or system fonts (lettering comes from font.js).
var createTimberView=function(ctx){
    "use strict";
    var W=1280,H=720,WALL_H=0.72,SLAB=0.9,D=44,VIEW=0.42,MAX_TILT=0.1;
    var font=createTimberFont(ctx);
    var level=null,runs=[],rows=[],grain=[],patches=[],dashes=[],rowPegs=[],rowAcorns=[],F=1,CX=640,CY=390,ca=1,sa=0,cb=1,sb=0,cc=Math.cos(VIEW),sc=Math.sin(VIEW),hw=0,hh=0;
    // Translucent colors are unverified on the console canvas: probe once and fall back to solid tones.
    var alphaOK=(function(){try{ctx.fillStyle="#123456";ctx.fillStyle="rgba(1,2,3,0.5)";var v=String(ctx.fillStyle).replace(/\s/g,"").toLowerCase();return v!=="#123456"&&v.indexOf("0.5")>=0;}catch(_){return false;}})();
    function col(rgba,solid){return alphaOK?rgba:solid;}
    var light=(function(){var v=[-0.35,-0.55,1],l=Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);return [v[0]/l,v[1]/l,v[2]/l];})();
    // One wood species per chapter.
    var THEMES={
        pine:{name:"PINE",floor:[228,192,136],wall:[184,128,70],frame:[126,80,42],slab:[92,58,30],bg:["#2a1d12","#302215"],grain:[176,124,66],inlay:"#9c6a36"},
        oak:{name:"OAK",floor:[204,158,98],wall:[146,96,50],frame:[98,62,30],slab:[70,42,20],bg:["#231a10","#2a2014"],grain:[160,112,60],inlay:"#5e3a1a"},
        cherry:{name:"CHERRY",floor:[214,142,102],wall:[158,78,48],frame:[110,46,28],slab:[76,30,18],bg:["#26120d","#2d1711"],grain:[178,102,68],inlay:"#e3c08a"},
        walnut:{name:"WALNUT",floor:[156,110,74],wall:[98,64,40],frame:[64,40,24],slab:[42,26,16],bg:["#140f0b","#1a140f"],grain:[124,84,54],inlay:"#d9b45a"}
    };
    var theme=THEMES.pine;
    function rgb(c,k){k=k||1;return "rgb("+Math.round(Math.min(255,c[0]*k))+","+Math.round(Math.min(255,c[1]*k))+","+Math.round(Math.min(255,c[2]*k))+")";}
    function setTilt(tx,ty){var a=tx*MAX_TILT,b=ty*MAX_TILT;ca=Math.cos(a);sa=Math.sin(a);cb=Math.cos(b);sb=Math.sin(b);}
    // Board cell coordinates (c,r,z) -> rotated camera frame.
    function rot(X,Y,Z){var x1=X*ca+Z*sa,z1=-X*sa+Z*ca,y2=Y*cb+z1*sb,z2=-Y*sb+z1*cb;return [x1,y2*cc-z2*sc,z2*cc+y2*sc];}
    function proj(c,r,z){var p=rot(c-hw,r-hh,z),d=D-p[2];return [CX+F*p[0]/d,CY+F*p[1]/d,d];}
    function visible(n,c,r,z){var m=rot(n[0],n[1],n[2]),p=rot(c-hw,r-hh,z);return m[0]*(0-p[0])+m[1]*(0-p[1])+m[2]*(D-p[2])>0;}
    function shadeK(n){var m=rot(n[0],n[1],n[2]);return 0.58+0.42*Math.max(0,m[0]*light[0]+m[1]*light[1]+m[2]*light[2]);}
    function shade(c,n){return rgb(c,shadeK(n));}
    function poly(points,color){ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);for(var i=1;i<points.length;i++)ctx.lineTo(points[i][0],points[i][1]);ctx.closePath();ctx.fillStyle=color;ctx.fill();}
    function quad(a,b,c2,d,color){poly([proj(a[0],a[1],a[2]),proj(b[0],b[1],b[2]),proj(c2[0],c2[1],c2[2]),proj(d[0],d[1],d[2])],color);}
    function flat(c0,r0,c1,r1,z,color){quad([c0,r0,z],[c1,r0,z],[c1,r1,z],[c0,r1,z],color);}
    function disc(x,y,z,radius,color,n){var pts=[];n=n||14;for(var i=0;i<n;i++){var t=i/n*Math.PI*2;pts.push(proj(x+Math.cos(t)*radius,y+Math.sin(t)*radius,z));}poly(pts,color);}
    function isWall(c,r){return c<0||r<0||c>=level.w||r>=level.h||level.walls[r][c];}
    function border(c,r){return c===0||r===0||c===level.w-1||r===level.h-1;}
    function setLevel(l){
        if(l===level)return;level=l;theme=THEMES[l.theme]||THEMES.pine;hw=l.w/2;hh=l.h/2;runs=[];rows=[];grain=[];patches=[];dashes=[];rowPegs=[];rowAcorns=[];
        for(var r=0;r<l.h;r++){
            rows.push([]);rowPegs.push([]);rowAcorns.push([]);
            for(var c=0;c<l.w;c++){
                if(!l.walls[r][c])continue;
                var b=border(c,r),c1=c;while(c1+1<l.w&&l.walls[r][c1+1]&&border(c1+1,r)===b&&!(b&&r>0&&r<l.h-1))c1++;
                var run={c0:c,c1:c1,r:r,frame:b,south:[],north:[]};
                ["south","north"].forEach(function(side){var dr=side==="south"?1:-1,start=null;for(var k=c;k<=c1+1;k++){var open=k<=c1&&!isWall(k,r+dr);if(open&&start===null)start=k;if(!open&&start!==null){run[side].push([start,k]);start=null;}}});
                run.west=!isWall(c-1,r);run.east=!isWall(c1+1,r);
                runs.push(run);rows[r].push(run);c=c1;
            }
            for(var k=0;k<l.w;k++){var t=l.surface[r][k];if(!t)continue;var k1=k;while(k1+1<l.w&&l.surface[r][k1+1]===t)k1++;patches.push({c0:k,c1:k1+1,r:r,type:t});k=k1;}
        }
        l.pegs.forEach(function(p){rowPegs[p.r].push(p);});
        l.acorns.forEach(function(p,i){rowAcorns[p.r].push({p:p,i:i});});
        for(var g=0;g*0.62<l.h;g++){var line=[];for(var x=0;x<=l.w+0.01;x+=1.25)line.push([x,g*0.62+0.2*Math.sin(x*0.5+g*1.7)+0.08*Math.sin(x*1.7+g*0.6)]);grain.push(line);}
        // Dotted guide: short dashes along the route polyline.
        // Dash k covers [k*period, k*period+on] of the route length, split at corners.
        var on=0.38,period=0.72,line2=l.path.line,segs=[],total=0;
        for(var i=0;i+1<line2.length;i++){var a=line2[i],b2=line2[i+1],len=Math.hypot(b2.x-a.x,b2.y-a.y);if(len>0){segs.push({a:a,b:b2,s:total,len:len});total+=len;}}
        function at(seg,d){var u=Math.max(0,Math.min(1,(d-seg.s)/seg.len));return [seg.a.x+(seg.b.x-seg.a.x)*u,seg.a.y+(seg.b.y-seg.a.y)*u];}
        for(var k=0;k*period<total&&k<4000;k++){var d0=k*period,d1=Math.min(total,d0+on);segs.forEach(function(sg){if(sg.s+sg.len<=d0||sg.s>=d1)return;var p0=at(sg,Math.max(d0,sg.s)),p1=at(sg,Math.min(d1,sg.s+sg.len));dashes.push([p0[0],p0[1],p1[0],p1[1]]);});}
        // Fit the untilted board, frame and slab inside the play area below the HUD.
        setTilt(0,0);F=1;CX=0;CY=0;var u0b=1e9,u1b=-1e9,v0=1e9,v1=-1e9;
        [[0,0],[l.w,0],[0,l.h],[l.w,l.h]].forEach(function(p){[-SLAB,WALL_H].forEach(function(z){var q=proj(p[0],p[1],z);u0b=Math.min(u0b,q[0]);u1b=Math.max(u1b,q[0]);v0=Math.min(v0,q[1]);v1=Math.max(v1,q[1]);});});
        F=Math.min(1190/(u1b-u0b),628/(v1-v0));CX=640-F*(u0b+u1b)/2;CY=392-F*(v0+v1)/2;
    }
    function text(s,x,y,size,color,align){return font.draw(s,x,y,size,color,align);}
    function holeSet(list,radius,colors){
        list.forEach(function(p){disc(p.x,p.y,0,radius+0.1,colors[0]);});
        list.forEach(function(p){disc(p.x,p.y,0,radius,colors[1]);});
        list.forEach(function(p){disc(p.x,p.y+0.12,0,radius*0.78,colors[2]);});
    }
    function ball(x,y,z,scaleK,dark){
        var R=TimberPhysics.BALL_R*scaleK,p=proj(x,y,z+R),s=F*R/p[2];if(s<0.6)return;
        ctx.beginPath();ctx.arc(p[0],p[1],s,0,Math.PI*2);ctx.fillStyle="#4f5861";ctx.fill();
        ctx.beginPath();ctx.arc(p[0]-s*0.1,p[1]-s*0.1,s*0.86,0,Math.PI*2);ctx.fillStyle="#8f9aa5";ctx.fill();
        ctx.beginPath();ctx.arc(p[0]-s*0.22,p[1]-s*0.24,s*0.55,0,Math.PI*2);ctx.fillStyle="#b9c3cc";ctx.fill();
        ctx.beginPath();ctx.arc(p[0]-s*0.36,p[1]-s*0.4,s*0.24,0,Math.PI*2);ctx.fillStyle="#eef4f8";ctx.fill();
        if(dark>0&&(alphaOK||dark>0.5)){ctx.beginPath();ctx.arc(p[0],p[1],s*1.02,0,Math.PI*2);ctx.fillStyle=col("rgba(20,10,4,"+Math.min(0.92,dark).toFixed(3)+")","#140a04");ctx.fill();}
    }
    // Round brass post: dark base, side band, bright cap.
    function peg(p){
        var R=TimberPhysics.PEG_R,Hp=0.5,b0=proj(p.x-R,p.y,0),b1=proj(p.x+R,p.y,0),t0=proj(p.x-R,p.y,Hp),t1=proj(p.x+R,p.y,Hp);
        disc(p.x+0.1,p.y+0.14,0,R*1.05,col("rgba(40,20,6,0.35)",rgb(theme.floor,0.78)),12);
        disc(p.x,p.y,0,R,"#6e5216",12);poly([b0,b1,t1,t0],"#9a7426");
        disc(p.x,p.y,Hp,R,"#d8b04a",12);disc(p.x-0.08,p.y-0.08,Hp,R*0.45,"#f4dc8c",8);
    }
    function acorn(p){
        var b=proj(p.x,p.y,0.2),s=F*0.2/b[2];
        disc(p.x+0.08,p.y+0.1,0,0.24,col("rgba(40,20,6,0.3)",rgb(theme.floor,0.8)),10);
        ctx.beginPath();ctx.arc(b[0],b[1]+s*0.25,s*1.0,0,Math.PI*2);ctx.fillStyle="#b5732f";ctx.fill();
        ctx.beginPath();ctx.arc(b[0]-s*0.3,b[1]+s*0.05,s*0.32,0,Math.PI*2);ctx.fillStyle="#d89a52";ctx.fill();
        ctx.fillStyle="#5a3a1c";ctx.beginPath();ctx.arc(b[0],b[1]-s*0.35,s*1.08,Math.PI,Math.PI*2);ctx.closePath();ctx.fill();
        ctx.fillRect(Math.round(b[0]-s*0.12),Math.round(b[1]-s*1.75),Math.max(2,Math.round(s*0.26)),Math.round(s*0.5));
    }
    function flag(g){
        var base=proj(g.x,g.y,0),top=proj(g.x,g.y,1.7),tip=proj(g.x+0.95,g.y,1.42),low=proj(g.x,g.y,1.12);
        ctx.strokeStyle="#3a2414";ctx.lineWidth=Math.max(2,F*0.06/D);ctx.beginPath();ctx.moveTo(base[0],base[1]);ctx.lineTo(top[0],top[1]);ctx.stroke();
        poly([top,tip,low],"#2f6a8a");poly([top,proj(g.x+0.5,g.y,1.56),proj(g.x+0.5,g.y,1.28),low],"#3f86ad");
    }
    function drawRun(run){
        var top=run.frame?theme.frame:theme.wall,r=run.r,x0=run.c0,x1=run.c1+1;
        if(run.west&&visible([-1,0,0],x0,r+0.5,WALL_H/2))quad([x0,r,0],[x0,r+1,0],[x0,r+1,WALL_H],[x0,r,WALL_H],shade(top,[-1,0,0]));
        if(run.east&&visible([1,0,0],x1,r+0.5,WALL_H/2))quad([x1,r,0],[x1,r+1,0],[x1,r+1,WALL_H],[x1,r,WALL_H],shade(top,[1,0,0]));
        if(visible([0,-1,0],(x0+x1)/2,r,WALL_H/2))run.north.forEach(function(s){quad([s[0],r,0],[s[1],r,0],[s[1],r,WALL_H],[s[0],r,WALL_H],shade(top,[0,-1,0]));});
        if(visible([0,1,0],(x0+x1)/2,r+1,WALL_H/2))run.south.forEach(function(s){quad([s[0],r+1,0],[s[1],r+1,0],[s[1],r+1,WALL_H],[s[0],r+1,WALL_H],shade(top,[0,1,0]));});
        flat(x0,r,x1,r+1,WALL_H,shade(top,[0,0,1]));
        // Inlaid strip along the top of interior fences (a marquetry line).
        if(!run.frame&&x1-x0>=2)flat(x0+0.2,r+0.42,x1-0.2,r+0.58,WALL_H,theme.inlay);
    }
    function corners(){
        var w=level.w,h=level.h,k=shadeK([0,0,1]);
        [[0,0],[w-1,0],[0,h-1],[w-1,h-1]].forEach(function(p){flat(p[0]+0.08,p[1]+0.08,p[0]+0.92,p[1]+0.92,WALL_H,rgb([216,176,74],k));disc(p[0]+0.5,p[1]+0.5,WALL_H,0.14,"#7a5a1e",8);});
    }
    // state: physics state (or null for an empty demo board); opts: {tilt:{x,y}, path:true}
    function board(state,opts){
        opts=opts||{};var t=opts.tilt||{x:0,y:0};setTilt(t.x,t.y);
        ctx.fillStyle=theme.bg[0];ctx.fillRect(0,0,W,H);
        ctx.fillStyle=theme.bg[1];for(var i=0;i<9;i++)ctx.fillRect(0,i*80+40,W,40);
        var l=level,w=l.w,h=l.h;
        // Slab sides and outer frame faces (visible ones only).
        [[[0,-1,0],[0,0],[w,0]],[[0,1,0],[w,h],[0,h]],[[-1,0,0],[0,h],[0,0]],[[1,0,0],[w,0],[w,h]]].forEach(function(f){var n=f[0],a=f[1],b=f[2];if(visible(n,(a[0]+b[0])/2,(a[1]+b[1])/2,0))quad([a[0],a[1],-SLAB],[b[0],b[1],-SLAB],[b[0],b[1],WALL_H],[a[0],a[1],WALL_H],shade(theme.slab,n));});
        var fk=shadeK([0,0,1]);flat(0,0,w,h,0,rgb(theme.floor,fk));
        ctx.strokeStyle=col("rgba("+theme.grain.join(",")+",0.45)",rgb(theme.grain.map(function(v,j){return (v+theme.floor[j]*1.4)/2.4;}),fk));ctx.lineWidth=2;
        grain.forEach(function(line){ctx.beginPath();line.forEach(function(p,k){var q=proj(p[0],p[1],0);if(k)ctx.lineTo(q[0],q[1]);else ctx.moveTo(q[0],q[1]);});ctx.stroke();});
        // Felt pads and varnish strips.
        patches.forEach(function(p){
            if(p.type===1){flat(p.c0,p.r,p.c1,p.r+1,0,rgb([58,112,72],fk));flat(p.c0+0.1,p.r+0.42,p.c1-0.1,p.r+0.5,0,rgb([46,94,60],fk));}
            else{flat(p.c0,p.r,p.c1,p.r+1,0,rgb(theme.floor,fk*1.13));for(var x=p.c0+0.3;x<p.c1-0.2;x+=2)quad([x,p.r+0.85,0],[x+0.45,p.r+0.15,0],[x+0.7,p.r+0.15,0],[x+0.25,p.r+0.85,0],rgb(theme.floor,fk*1.28));}
        });
        runs.forEach(function(run){if(run.frame)return;quad([run.c0+0.2,run.r+0.26,0],[run.c1+1.2,run.r+0.26,0],[run.c1+1.2,run.r+1.26,0],[run.c0+0.2,run.r+1.26,0],col("rgba(70,36,12,0.2)",rgb(theme.floor,fk*0.88)));});
        holeSet(l.holes,TimberPhysics.HOLE_R,[rgb(theme.frame,1.05),"#170c05","#070302"]);
        holeSet([l.goal],TimberPhysics.GOAL_R,["#d8b04a","#2a1a0c","#120904"]);
        if(opts.path!==false){
            ctx.strokeStyle=col("rgba(46,26,12,0.8)",rgb(theme.frame,0.62));ctx.lineWidth=Math.max(3,F*0.12/D);ctx.beginPath();
            dashes.forEach(function(d){var a=proj(d[0],d[1],0),b=proj(d[2],d[3],0);ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);});ctx.stroke();
            disc(l.start.x,l.start.y,0,0.32,rgb(theme.frame,0.9),12);disc(l.start.x,l.start.y,0,0.2,rgb(theme.floor,fk),10);
            l.checkpoints.forEach(function(p,k){var reached=state&&state.checkpoint>k;disc(p.x,p.y,0,0.42,"#6e5216",14);disc(p.x,p.y,0,0.34,reached?"#5c9a48":"#d8b04a",14);var q=proj(p.x,p.y,0);text(p.n,q[0],q[1]+7,18,reached?"#fbeedd":"#2b170a","center");});
        }
        var sinking=state&&(state.mode==="falling"||state.mode==="won");
        if(sinking){var hole=state.mode==="won"?l.goal:state.hole,k=state.mode==="won"?1:state.fall;ball(state.x+(hole.x-state.x)*k,state.y+(hole.y-state.y)*k,-0.5*k,1-0.45*k,state.mode==="won"?0.35:k*0.9);}
        else if(state)disc(state.x+0.16,state.y+0.22,0,TimberPhysics.BALL_R*1.02,col("rgba(40,20,6,0.33)",rgb(theme.floor,fk*0.8)),14);
        var ballRow=state&&!sinking?Math.floor(state.y):-1,goalRow=Math.floor(l.goal.y);
        for(var r=0;r<h;r++){
            rows[r].slice().sort(function(a,b){return Math.abs(b.c0+b.c1+1-w)-Math.abs(a.c0+a.c1+1-w);}).forEach(drawRun);
            if(r===0)corners();
            rowAcorns[r].forEach(function(a){if(!state||!state.acorns||!state.acorns[a.i])acorn(a.p);});
            rowPegs[r].forEach(peg);
            if(r===goalRow)flag(l.goal);
            if(r===ballRow)ball(state.x,state.y,0,1,state.mode==="ready"?0.18*Math.max(0,Math.min(1,state.timer)):0);
        }
    }
    function frameRect(x,y,w,h,color,lw){ctx.fillStyle=color;ctx.fillRect(x,y,w,lw);ctx.fillRect(x,y+h-lw,w,lw);ctx.fillRect(x,y,lw,h);ctx.fillRect(x+w-lw,y,lw,h);}
    function panel(x,y,w,h,color){ctx.fillStyle=col("rgba(10,5,2,0.4)","#1c1008");ctx.fillRect(x+8,y+10,w,h);ctx.fillStyle=color||"#f3e4c8";ctx.fillRect(x,y,w,h);frameRect(x,y,w,h,"#6b3d1d",4);
        [[x+10,y+10],[x+w-18,y+10],[x+10,y+h-18],[x+w-18,y+h-18]].forEach(function(p){ctx.fillStyle="#b98a3a";ctx.fillRect(p[0],p[1],8,8);});}
    function button(r,label,selected,small){ctx.fillStyle=selected?"#9b3f17":"#e5cca4";ctx.fillRect(r.x,r.y,r.w,r.h);ctx.fillStyle=selected?"#7a2f10":"#cdb088";ctx.fillRect(r.x,r.y+r.h-6,r.w,6);text(label,r.x+r.w/2,r.y+r.h/2+(small?5:7),small?18:22,selected?"#fff4e2":"#2b170a","center");}
    function wrap(s,x,y,size,color,width,lineH){var words=String(s).split(" "),line="",per=Math.max(4,Math.floor((width+font.scale(size))/(6*font.scale(size))));words.forEach(function(wd){if((line+" "+wd).trim().length>per){text(line,x,y,size,color);y+=lineH;line=wd;}else line=(line+" "+wd).trim();});if(line)text(line,x,y,size,color);return y+lineH;}
    function clock(ms){var s=Math.max(0,ms)/1000,m=Math.floor(s/60),r=s-m*60;return (m<10?"0":"")+m+":"+(r<10?"0":"")+r.toFixed(1);}
    function star(x,y,r,filled){var pts=[];for(var i=0;i<10;i++){var a=-Math.PI/2+i*Math.PI/5,rr=i%2?r*0.45:r;pts.push([x+Math.cos(a)*rr,y+Math.sin(a)*rr]);}poly(pts,filled?"#6e5216":"#8a6a50");var inner=pts.map(function(p){return [x+(p[0]-x)*0.68,y+(p[1]-y)*0.68];});poly(inner,filled?"#e8c25a":"#cdb088");}
    function acornIcon(x,y,r,filled){ctx.beginPath();ctx.arc(x,y+r*0.25,r,0,Math.PI*2);ctx.fillStyle=filled?"#b5732f":"#cdb088";ctx.fill();ctx.fillStyle=filled?"#5a3a1c":"#a88a68";ctx.beginPath();ctx.arc(x,y-r*0.3,r*1.1,Math.PI,Math.PI*2);ctx.closePath();ctx.fill();ctx.fillRect(Math.round(x-r*0.12),Math.round(y-r*1.7),Math.max(2,Math.round(r*0.25)),Math.round(r*0.5));}
    return {W:W,H:H,alphaOK:alphaOK,col:col,font:font,themes:THEMES,theme:function(){return theme;},dim:function(x,y,w,h,rgba){if(alphaOK){ctx.fillStyle=rgba;ctx.fillRect(x,y,w,h);}},setLevel:setLevel,board:board,text:text,panel:panel,button:button,wrap:wrap,clock:clock,star:star,acorn:acornIcon,frameRect:frameRect,
        fit:function(){return {F:F,CX:CX,CY:CY};},project:function(c,r,z){return proj(c,r,z||0);}};
};
if(typeof module!=="undefined")module.exports=createTimberView;
