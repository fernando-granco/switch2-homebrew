// Timber Tilt model: level parsing, guide path and fixed-step ball physics.
// Pure JavaScript; no DOM, native or console access. Units are board cells.
var TimberPhysics=(function(){
    "use strict";
    var BALL_R=0.42,HOLE_R=0.55,GOAL_R=0.5,CHECK_R=0.8,ACCEL=14,FRICTION=0.75,MAX_SPEED=13,BOUNCE=0.35,STEP=1/240;
    // Surfaces: 0 bare wood, 1 green felt (slow), 2 varnish (slick). Pegs are round brass posts.
    var PEG_R=0.3,PEG_BOUNCE=0.8,ACORN_R=0.62,SURFACE_FRICTION=[FRICTION,3.2,0.16];
    // Wall contact: impacts faster than IMPACT_V bounce and lose IMPACT_SCRUB of their sliding speed once;
    // slower contact is a slide with light friction per 1/240 s step (0.9995^240 = about 0.89 per second).
    var IMPACT_V=0.6,IMPACT_SCRUB=0.12,WALL_ROLL=0.9995;
    function clamp(v,a,b){return v<a?a:v>b?b:v;}
    function parse(def){
        var grid=def.grid,h=grid.length,w=grid[0].length,walls=[],holes=[],checkpoints=[],pegs=[],acorns=[],surface=[],start=null,goal=null;
        for(var r=0;r<h;r++){
            if(grid[r].length!==w)throw Error(def.id+": ragged row "+r);
            walls.push([]);surface.push([]);
            for(var c=0;c<w;c++){
                var ch=grid[r][c],edge=r===0||c===0||r===h-1||c===w-1;
                if(edge&&ch!=="#")throw Error(def.id+": open border at "+c+","+r);
                walls[r].push(ch==="#");surface[r].push(ch==="f"?1:ch==="v"?2:0);
                var p={x:c+0.5,y:r+0.5,c:c,r:r};
                if(ch==="o")holes.push(p);else if(ch==="S")start=p;else if(ch==="G")goal=p;
                else if(ch>="1"&&ch<="9"){p.n=Number(ch);checkpoints.push(p);}
                else if(ch==="p")pegs.push(p);else if(ch==="a")acorns.push(p);
                else if(ch!=="#"&&ch!=="."&&ch!=="f"&&ch!=="v")throw Error(def.id+": bad cell "+ch);
            }
        }
        if(!start||!goal)throw Error(def.id+": start/goal missing");
        checkpoints.sort(function(a,b){return a.n-b.n;});
        checkpoints.forEach(function(p,i){if(p.n!==i+1)throw Error(def.id+": checkpoint numbering gap");});
        var level={id:def.id,name:def.name,hint:def.hint||"",theme:def.theme||"pine",par:def.par||null,w:w,h:h,walls:walls,surface:surface,holes:holes,pegs:pegs,acorns:acorns,goal:goal,start:start,checkpoints:checkpoints};
        level.holeAt=holeIndex(level);level.pegAt={};pegs.forEach(function(p){level.pegAt[p.c+","+p.r]=true;});level.path=guide(level);return level;
    }
    function holeIndex(level){var m={};level.holes.forEach(function(p){m[p.c+","+p.r]=true;});return m;}
    function isWall(level,c,r){return c<0||r<0||c>=level.w||r>=level.h||level.walls[r][c];}
    // Cheapest cell route S -> 1 -> ... -> G, avoiding holes and preferring centre lines.
    function route(level,from,to){
        var w=level.w,h=level.h,cost=new Float64Array(w*h).fill(Infinity),prev=new Int32Array(w*h).fill(-1),done=new Uint8Array(w*h),open=[from.r*w+from.c];
        cost[open[0]]=0;
        function penalty(c,r){var p=1;for(var dr=-1;dr<=1;dr++)for(var dc=-1;dc<=1;dc++){if(level.holeAt[(c+dc)+","+(r+dr)])p+=2.5;if(isWall(level,c+dc,r+dr)||level.pegAt[(c+dc)+","+(r+dr)])p+=0.35;}if(level.surface[r][c]===1)p+=0.6;return p;}
        while(open.length){
            var best=0;for(var i=1;i<open.length;i++)if(cost[open[i]]<cost[open[best]])best=i;
            var cur=open.splice(best,1)[0];if(done[cur])continue;done[cur]=1;if(cur===to.r*w+to.c)break;
            var cc=cur%w,cr=(cur-cc)/w;
            [[1,0],[-1,0],[0,1],[0,-1]].forEach(function(d){var nc=cc+d[0],nr=cr+d[1],n=nr*w+nc;if(isWall(level,nc,nr)||level.holeAt[nc+","+nr]||level.pegAt[nc+","+nr]||done[n])return;var v=cost[cur]+penalty(nc,nr);if(v<cost[n]){cost[n]=v;prev[n]=cur;open.push(n);}});
        }
        var end=to.r*w+to.c;if(!done[end])return null;
        var cells=[];for(var k=end;k!==-1;k=prev[k])cells.push({x:k%w+0.5,y:Math.floor(k/w)+0.5});return cells.reverse();
    }
    function guide(level){
        var stops=[level.start].concat(level.checkpoints,[level.goal]),cells=[];
        for(var i=0;i+1<stops.length;i++){var part=route(level,stops[i],stops[i+1]);if(!part)throw Error(level.id+": no route to stop "+(i+1));cells=cells.concat(i?part.slice(1):part);}
        var line=[cells[0]];
        for(var j=1;j<cells.length-1;j++){var a=line[line.length-1],b=cells[j],n=cells[j+1];var cross=(b.x-a.x)*(n.y-b.y)-(b.y-a.y)*(n.x-b.x),dot=(b.x-a.x)*(n.x-b.x)+(b.y-a.y)*(n.y-b.y);if(cross!==0||dot<=0)line.push(b);}
        line.push(cells[cells.length-1]);
        return {cells:cells,line:line};
    }
    function create(level){return {level:level,x:level.start.x,y:level.start.y,vx:0,vy:0,mode:"ready",timer:0.7,fall:0,elapsed:0,falls:0,checkpoint:0,respawn:{x:level.start.x,y:level.start.y},bumps:0,pegHits:0,maxSpeed:0,events:[],
        acorns:level.acorns.map(function(){return false;}),acornCount:0,hit:null};}
    function noteHit(s,kind,nx,ny,v){if(!s.hit||v>s.hit.v)s.hit={kind:kind,nx:nx,ny:ny,v:v};}
    function respawn(s){s.x=s.respawn.x;s.y=s.respawn.y;s.vx=0;s.vy=0;s.mode="ready";s.timer=0.8;}
    function collide(s){
        var level=s.level,hit=false;
        for(var r=Math.floor(s.y-BALL_R);r<=Math.floor(s.y+BALL_R);r++)for(var c=Math.floor(s.x-BALL_R);c<=Math.floor(s.x+BALL_R);c++){
            if(!isWall(level,c,r))continue;
            var px=clamp(s.x,c,c+1),py=clamp(s.y,r,r+1),dx=s.x-px,dy=s.y-py,d2=dx*dx+dy*dy;
            if(d2>=BALL_R*BALL_R)continue;
            var d=Math.sqrt(d2),nx,ny;
            if(d<1e-6){var ex=s.x-(c+0.5),ey=s.y-(r+0.5);if(Math.abs(ex)>Math.abs(ey)){nx=ex<0?-1:1;ny=0;}else{nx=0;ny=ey<0?-1:1;}d=0;}
            else{nx=dx/d;ny=dy/d;}
            s.x+=nx*(BALL_R-d);s.y+=ny*(BALL_R-d);
            var vn=s.vx*nx+s.vy*ny;
            if(vn<0){
                if(vn<-2){hit=true;noteHit(s,"wall",nx,ny,-vn);}
                if(vn<-IMPACT_V){
                    // Real impact: bounce, and scrub some sliding speed once.
                    s.vx-=(1+BOUNCE)*vn*nx;s.vy-=(1+BOUNCE)*vn*ny;
                    var vt=s.vx*-ny+s.vy*nx;s.vx-=vt*IMPACT_SCRUB*-ny;s.vy-=vt*IMPACT_SCRUB*nx;
                }else{
                    // Resting/sliding contact (runs every 1/240 s): cancel only the push into the
                    // wall and apply light rolling friction, so the ball keeps rolling along it.
                    s.vx-=vn*nx;s.vy-=vn*ny;s.vx*=WALL_ROLL;s.vy*=WALL_ROLL;
                }
            }
        }
        if(hit)s.bumps++;
        return hit;
    }
    function pegs(s){
        var list=s.level.pegs,hit=false,reach=BALL_R+PEG_R;
        for(var i=0;i<list.length;i++){
            var p=list[i],dx=s.x-p.x,dy=s.y-p.y;if(Math.abs(dx)>=reach||Math.abs(dy)>=reach)continue;
            var d=Math.sqrt(dx*dx+dy*dy);if(d>=reach)continue;
            var nx=d>1e-6?dx/d:1,ny=d>1e-6?dy/d:0;s.x=p.x+nx*reach;s.y=p.y+ny*reach;
            var vn=s.vx*nx+s.vy*ny;if(vn<0){s.vx-=(1+PEG_BOUNCE)*vn*nx;s.vy-=(1+PEG_BOUNCE)*vn*ny;if(vn<-1.2){hit=true;noteHit(s,"peg",nx,ny,-vn);}}
        }
        if(hit)s.pegHits++;
        return hit;
    }
    function surfaceAt(level,x,y){var c=Math.floor(x),r=Math.floor(y);return r>=0&&c>=0&&r<level.h&&c<level.w?level.surface[r][c]:0;}
    function pit(s,p,radius,pull,dt){
        var dx=p.x-s.x,dy=p.y-s.y,d=Math.sqrt(dx*dx+dy*dy);
        if(d<radius)return true;
        if(d<radius+pull&&d>1e-6){var f=(radius+pull-d)*30*dt/d;s.vx+=dx*f;s.vy+=dy*f;}
        return false;
    }
    // tilt: {x,y} in [-1,1]; positive x rolls right, positive y rolls toward the bottom of the screen.
    function step(s,tilt,dt){
        s.events.length=0;s.hit=null;dt=clamp(dt,0,0.1);
        if(s.mode==="won")return s;
        if(s.mode==="ready"){s.timer-=dt;if(s.timer<=0)s.mode="rolling";return s;}
        if(s.mode==="falling"){s.fall+=dt/0.6;if(s.fall>=1){s.fall=0;respawn(s);s.events.push("respawn");}return s;}
        s.elapsed+=dt;
        var tx=clamp(tilt&&tilt.x||0,-1,1),ty=clamp(tilt&&tilt.y||0,-1,1),level=s.level;
        for(var t=0;t<dt-1e-9;t+=STEP){
            var h=Math.min(STEP,dt-t);
            s.vx+=tx*ACCEL*h;s.vy+=ty*ACCEL*h;
            var damp=Math.max(0,1-SURFACE_FRICTION[surfaceAt(level,s.x,s.y)]*h);s.vx*=damp;s.vy*=damp;
            var sp=Math.sqrt(s.vx*s.vx+s.vy*s.vy);if(sp>MAX_SPEED){s.vx*=MAX_SPEED/sp;s.vy*=MAX_SPEED/sp;sp=MAX_SPEED;}
            if(sp>s.maxSpeed)s.maxSpeed=sp;
            s.x+=s.vx*h;s.y+=s.vy*h;
            if(collide(s)&&s.events.indexOf("bump")<0)s.events.push("bump");
            if(level.pegs.length&&pegs(s)&&s.events.indexOf("peg")<0)s.events.push("peg");
            for(var a=0;a<level.acorns.length;a++)if(!s.acorns[a]&&Math.abs(level.acorns[a].x-s.x)<ACORN_R&&Math.abs(level.acorns[a].y-s.y)<ACORN_R){s.acorns[a]=true;s.acornCount++;s.events.push("acorn");}
            if(pit(s,level.goal,GOAL_R,0.35,h)){s.mode="won";s.x=level.goal.x;s.y=level.goal.y;s.vx=s.vy=0;s.events.push("won");return s;}
            for(var i=0;i<level.holes.length;i++)if(pit(s,level.holes[i],HOLE_R,0.2,h)){s.mode="falling";s.fall=0;s.falls++;s.hole=level.holes[i];s.vx=s.vy=0;s.events.push("fall");return s;}
            for(var k=s.checkpoint;k<level.checkpoints.length;k++){var cp=level.checkpoints[k];if(Math.abs(cp.x-s.x)<CHECK_R&&Math.abs(cp.y-s.y)<CHECK_R){s.checkpoint=k+1;s.respawn={x:cp.x,y:cp.y};s.events.push("checkpoint");}}
        }
        return s;
    }
    return {BALL_R:BALL_R,HOLE_R:HOLE_R,GOAL_R:GOAL_R,PEG_R:PEG_R,clamp:clamp,surfaceAt:surfaceAt,parse:parse,create:create,step:step,respawn:respawn,isWall:isWall};
})();
if(typeof module!=="undefined")module.exports=TimberPhysics;
