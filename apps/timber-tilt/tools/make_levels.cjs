// Offline level authoring helper. Writes ../levels.js; never touches a console.
// Legend: # wall, o hole, S start, G goal cup, 1-9 checkpoints, . floor,
//         p brass peg, f green felt (slow), v varnish (slick), a acorn (collectible).
// Every board is checked by the autopilot; decorated holes/pegs are removed until it clears
// the board without a fall. Par times come from the autopilot time.
"use strict";
const fs=require("node:fs"),path=require("node:path");
const P=require("../physics.js"),autopilot=require("./autopilot.cjs");
const FLOOR=".fv";
// First console playtests beat the cautious autopilot by roughly 0.3-0.7x, so par is scaled down.
const PAR_FACTOR=0.65;

function rng(seed){let s=(seed>>>0)||1;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
function blank(w,h){const g=[];for(let r=0;r<h;r++){g.push([]);for(let c=0;c<w;c++)g[r].push(r===0||c===0||r===h-1||c===w-1?"#":".");}return g;}
function rect(g,c0,r0,c1,r1,ch){for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)g[r][c]=ch||"#";}
function frame(g,c0,r0,c1,r1){rect(g,c0,r0,c1,r0);rect(g,c0,r1,c1,r1);rect(g,c0,r0,c0,r1);rect(g,c1,r0,c1,r1);}
function paint(g,list,ch){(list||[]).forEach(([c0,r0,c1,r1])=>{for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)if(FLOOR.indexOf(g[r][c])>=0)g[r][c]=ch;});}
function put(g,list,ch){list.forEach(([c,r])=>{if(FLOOR.indexOf(g[r][c])<0)throw Error("Cell "+c+","+r+" already "+g[r][c]);g[r][c]=ch;});}
function rows(g){return g.map(r=>r.join(""));}
function tryParse(g,id){try{return P.parse({id,grid:rows(g)});}catch(e){return null;}}
function find(g,test){const out=[];g.forEach((row,r)=>row.forEach((ch,c)=>{if(test(ch))out.push({c,r});}));return out;}
function cheb(a,b){return Math.max(Math.abs(a.c-b.c),Math.abs(a.r-b.r));}
function pathCells(level){return level.path.cells.map(p=>({c:Math.floor(p.x),r:Math.floor(p.y)}));}
function distTo(cell,list){let d=1e9;for(const p of list)d=Math.min(d,cheb(cell,p));return d;}
function specials(g){return {start:find(g,ch=>ch==="S"),goal:find(g,ch=>ch==="G"),cps:find(g,ch=>ch>="1"&&ch<="9")};}

function autoCheckpoints(g,id,k){
    const level=tryParse(g,id);if(!level)throw Error(id+": no route before checkpoints");
    const cells=pathCells(level),blockers=find(g,ch=>ch==="o"||ch==="p");
    for(let n=1;n<=k;n++){
        const at=Math.floor(cells.length*n/(k+1));let chosen=null;
        for(let off=0;off<12&&!chosen;off++)for(const i of [at+off,at-off]){const c=cells[i];if(c&&FLOOR.indexOf(g[c.r][c.c])>=0&&distTo(c,blockers)>1){chosen=c;break;}}
        if(!chosen)throw Error(id+": no checkpoint cell "+n);
        g[chosen.r][chosen.c]=String(n);
    }
}

function decorate(g,id,o){
    const R=rng(o.seed),kind=o.kind||"o",lo=o.ring[0],hi=o.ring[1],added=[];let level=tryParse(g,id),tries=0;
    if(!level)throw Error(id+": no route before decoration");
    while(added.length<o.n&&tries<o.n*40){
        tries++;
        const cells=pathCells(level),sp=specials(g),cand=[];
        g.forEach((row,r)=>row.forEach((ch,c)=>{
            if(FLOOR.indexOf(ch)<0)return;const cell={c,r},d=distTo(cell,cells);
            if(d<lo||d>hi||distTo(cell,sp.start)<=2||distTo(cell,sp.goal)<=1||distTo(cell,sp.cps)<=1)return;
            cand.push(cell);
        }));
        if(!cand.length)break;
        const pick=cand[Math.floor(R()*cand.length)],old=g[pick.r][pick.c];g[pick.r][pick.c]=kind;
        const next=tryParse(g,id);if(!next){g[pick.r][pick.c]=old;continue;}
        level=next;added.push([pick,old]);
    }
    for(;;){const run=autopilot(P,level,240);if(run.s.mode==="won"&&run.s.falls===0)break;const last=added.pop();if(!last)throw Error(id+": autopilot cannot clear the board");g[last[0].r][last[0].c]=last[1];level=tryParse(g,id);}
}

function reachable(g){
    const s=find(g,ch=>ch==="S")[0],seen=new Set([s.c+","+s.r]),queue=[s];
    while(queue.length){const p=queue.shift();for(const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]){const c=p.c+dc,r=p.r+dr,k=c+","+r;if(seen.has(k)||"#op".indexOf(g[r][c])>=0)continue;seen.add(k);queue.push({c,r});}}
    return seen;
}
function placeAcorns(g,id,prefer){
    const level=tryParse(g,id),cells=pathCells(level),holes=level.holes,pegs=find(g,ch=>ch==="p"),reach=reachable(g);
    [0.22,0.5,0.78].forEach(f=>{
        const base=cells[Math.floor(cells.length*f)];let chosen=null;
        for(let want=prefer;want>=0&&!chosen;want--){
            let best=null,bestScore=1e9;
            g.forEach((row,r)=>row.forEach((ch,c)=>{
                const cell={c,r};if(FLOOR.indexOf(ch)<0||!reach.has(c+","+r)||cheb(cell,base)>want+1||distTo(cell,cells)!==want||distTo(cell,pegs)<1)return;
                if(holes.some(h=>Math.hypot(h.x-(c+0.5),h.y-(r+0.5))<1.6))return;
                const score=Math.hypot(c-base.c,r-base.r);if(score<bestScore){best=cell;bestScore=score;}
            }));
            chosen=best;
        }
        if(!chosen)throw Error(id+": no acorn cell near "+f);
        g[chosen.r][chosen.c]="a";
    });
}

function finishBoard(meta,g,acornDist){
    placeAcorns(g,meta.id,acornDist);
    const level=P.parse({id:meta.id,grid:rows(g)}),run=autopilot(P,level,240);
    if(run.s.mode!=="won"||run.s.falls)throw Error(meta.id+": final board not autopilot-clearable");
    return Object.assign({},meta,{par:Math.max(10,Math.ceil(run.t*PAR_FACTOR/5)*5),grid:rows(g)});
}

function board(meta,spec){
    const g=blank(spec.w||30,spec.h||18);
    (spec.walls||[]).forEach(w=>rect(g,...w));(spec.frames||[]).forEach(f=>frame(g,...f));
    (spec.trench||[]).forEach(t=>rect(g,...t,"o"));(spec.floor||[]).forEach(f=>rect(g,...f,"."));
    paint(g,spec.varnish,"v");paint(g,spec.felt,"f");
    put(g,spec.pegs||[],"p");put(g,spec.holes||[],"o");put(g,[spec.start],"S");put(g,[spec.goal],"G");
    if(Array.isArray(spec.checkpoints))spec.checkpoints.forEach((p,i)=>put(g,[p],String(i+1)));else autoCheckpoints(g,meta.id,spec.checkpoints||1);
    (spec.decorate||[]).forEach(d=>decorate(g,meta.id,d));
    return finishBoard(meta,g,spec.acornDist===undefined?1:spec.acornDist);
}

// Seeded depth-first maze: 2-cell corridors, 1-cell walls, 9x5 rooms on a 28x16 board.
function maze(seed,cols,rows){
    const rnd=rng(seed),w=cols*3+1,h=rows*3+1,g=[];for(let r=0;r<h;r++){g.push([]);for(let c=0;c<w;c++)g[r].push("#");}
    const open=(cx,cy)=>rect(g,cx*3+1,cy*3+1,cx*3+2,cy*3+2,".");
    const seen=new Set(),stack=[[0,0]];seen.add("0,0");open(0,0);
    while(stack.length){
        const [x,y]=stack[stack.length-1],next=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>[x+dx,y+dy,dx,dy]).filter(([nx,ny])=>nx>=0&&ny>=0&&nx<cols&&ny<rows&&!seen.has(nx+","+ny));
        if(!next.length){stack.pop();continue;}
        const [nx,ny,dx,dy]=next[Math.floor(rnd()*next.length)];seen.add(nx+","+ny);open(nx,ny);
        if(dx)rect(g,Math.max(x,nx)*3,y*3+1,Math.max(x,nx)*3,y*3+2,".");else rect(g,x*3+1,Math.max(y,ny)*3,x*3+2,Math.max(y,ny)*3,".");
        stack.push([nx,ny]);
    }
    return g;
}
function mazeBoard(meta,seed,extraHoles,cps,goalRoom,opts){
    opts=opts||{};const g=maze(seed,9,5);
    const room=(cx,cy,dx,dy)=>[cx*3+1+dx,cy*3+1+dy];
    // Dead-end rooms (one opening) become pits, except start/goal/checkpoint rooms.
    const reserved=new Set(["0,0",goalRoom.join(",")].concat(cps.map(p=>p.slice(0,2).join(","))));
    const holes=[];
    for(let cy=0;cy<5;cy++)for(let cx=0;cx<9;cx++){
        if(reserved.has(cx+","+cy))continue;
        const x=cx*3+1,y=cy*3+1,exits=(g[y][x-1]==="."?1:0)+(g[y][x+2]==="."?1:0)+(g[y-1][x]==="."?1:0)+(g[y+2][x]==="."?1:0);
        if(exits===1)holes.push(room(cx,cy,(cx*7+cy)%2,(cx+cy*3)%2));
    }
    extraHoles.forEach(p=>holes.push(room(...p)));
    paint(g,opts.varnish,"v");paint(g,opts.felt,"f");
    put(g,holes,"o");put(g,[room(0,0,0,0)],"S");put(g,[room(goalRoom[0],goalRoom[1],1,1)],"G");cps.forEach((p,i)=>put(g,[room(...p)],String(i+1)));
    return finishBoard(meta,g,opts.acornDist===undefined?1:opts.acornDist);
}
// Mirror a hand spec left/right (30 wide) to reuse a shape with a new identity.
function mirror(spec){const m=x=>29-x,R=l=>(l||[]).map(([c0,r0,c1,r1])=>[m(c1),r0,m(c0),r1]),Pt=l=>(l||[]).map(([c,r])=>[m(c),r]);
    return Object.assign({},spec,{walls:R(spec.walls),varnish:R(spec.varnish),felt:R(spec.felt),holes:Pt(spec.holes),start:Pt([spec.start])[0],goal:Pt([spec.goal])[0],checkpoints:Array.isArray(spec.checkpoints)?Pt(spec.checkpoints):spec.checkpoints});}

const T=(id,name,hint,theme)=>({id,name,hint,theme});
const spiralWalls=[[1,3,2,3],[3,3,26,3],[26,3,26,14],[3,14,26,14],[3,6,3,14],[8,4,8,5],[6,6,23,6],[6,6,6,11],[6,11,23,11],[23,9,23,11],[9,9,22,9]];
function orchardPegs(){const l=[];for(let r=3,k=0;r<=15;r+=3,k++)for(let c=7+(k%2)*2;c<=23;c+=4)l.push([c,r]);return l;}
function pinballPegs(){const l=[];for(let r=3,k=0;r<=14;r+=3,k++)for(let c=4+(k%2)*2;c<=25;c+=4)l.push([c,r]);return l;}
function teeth(cols,topRows,bottomRows){return cols.map((c,i)=>i%2?[c,bottomRows[0],c,bottomRows[1]]:[c,topRows[0],c,topRows[1]]);}
function dovetail(){const l=[];[4,9,14,19,24].forEach((c,i)=>l.push(i%2?[c,6,c+2,16]:[c,1,c+2,11]));return l;}

const levels=[
 // Chapter 1: PINE - learn the board.
 board(T("first","FIRST PLANK","Tilt gently. Follow the dotted line around the fence.","pine"),{walls:[[14,1,14,11]],start:[3,3],goal:[26,3],checkpoints:1,decorate:[{seed:11,n:6,ring:[2,3]}],acornDist:1}),
 board(T("sawdust","SAWDUST SNAKE","Follow the line around the three fences.","pine"),{
  walls:[[8,1,8,13],[16,4,16,16],[23,1,23,13]],start:[2,2],goal:[26,2],checkpoints:[[12,8],[19,9]],
  holes:[[5,9],[12,13],[10,3],[20,5],[18,12],[26,10],[25,15],[3,14]]}),
 board(T("switchback","SWITCHBACK MILL","Long corridors. Ease off before each turn.","pine"),{
  walls:[[1,4,24,4],[5,8,28,8],[1,12,24,12]],start:[2,2],goal:[3,15],checkpoints:[[26,6],[2,10],[26,14]],
  holes:[[9,1],[14,3],[19,1],[20,6],[13,5],[7,7],[8,10],[14,9],[20,11],[21,14],[15,15],[9,13],[6,16]]}),
 board(T("orchard","PEG ORCHARD","Brass pegs bounce the ball. Weave between them.","pine"),{
  walls:[[1,6,4,6],[1,12,4,12],[25,6,28,6],[25,12,28,12]],pegs:orchardPegs(),start:[2,9],goal:[27,9],checkpoints:2,decorate:[{seed:4,n:8,ring:[2,3]}]}),
 board(T("bridges","PLANK BRIDGES","Cross each trench on its narrow bridge.","pine"),{
  trench:[[9,1,10,16],[19,1,20,16]],floor:[[9,4,10,5],[19,12,20,13]],start:[3,14],goal:[26,3],
  checkpoints:[[6,4],[15,12],[24,13]],holes:[[4,7],[6,11],[14,6],[12,10],[17,3],[16,15],[23,8],[26,10],[27,15]]}),
 board(T("spiral","SPIRAL BURL","Wind inward around the rings to the centre cup.","pine"),{
  walls:spiralWalls,start:[4,1],goal:[20,10],checkpoints:[[27,9],[2,9],[24,9]],
  holes:[[14,2],[27,13],[20,15],[8,16],[1,12],[12,5],[25,6],[16,13],[4,10],[15,7],[7,9]]}),
 // Chapter 2: OAK - felt, varnish and pegs.
 board(T("fairway","FELT FAIRWAY","Green felt slows the ball. Use it to brake at the turns.","oak"),{
  walls:[[1,6,21,6],[8,11,28,11]],felt:[[23,1,28,5],[1,7,6,10],[22,12,24,16]],start:[2,2],goal:[26,14],checkpoints:2,decorate:[{seed:7,n:12,ring:[1,2]}],acornDist:2}),
 mazeBoard(T("knot","KNOT GARDEN","A real maze. Dead ends are pits.","oak"),7,[[4,2,1,0],[6,1,0,1]],[[4,0,0,1],[2,4,1,0]],[8,4],{acornDist:1}),
 board(T("varnish","VARNISH RUN","Shiny varnish is slick. The ball keeps its speed.","oak"),{
  walls:[[9,1,9,12],[19,5,19,16]],varnish:[[3,4,6,11],[12,6,16,12],[22,6,26,12]],start:[3,2],goal:[24,14],checkpoints:2,decorate:[{seed:9,n:10,ring:[1,2]}],acornDist:2}),
 board(T("comb","COMB TEETH","Five teeth, over and under. Brake before each gap.","oak"),{
  walls:teeth([5,10,15,20,25],[1,12],[5,16]),start:[2,2],goal:[27,2],checkpoints:3,decorate:[{seed:10,n:12,ring:[1,2]}],acornDist:1}),
 board(T("bumpers","BRASS BUMPERS","Pegs line the lanes. Let them bounce you around.","oak"),{
  walls:[[1,6,23,6],[6,12,28,12]],start:[2,2],goal:[27,14],checkpoints:2,decorate:[{seed:12,n:14,ring:[1,1],kind:"p"},{seed:13,n:7,ring:[2,3]}],acornDist:2}),
 mazeBoard(T("oakmaze","OAK LABYRINTH","Find the way through. Felt rooms help you stop.","oak"),31,[[3,3,1,0],[5,1,0,1]],[[4,1,0,0],[6,3,1,1]],[8,4],{felt:[[10,4,14,8],[19,10,23,14]],acornDist:2}),
 // Chapter 3: CHERRY - tighter lines.
 board(T("dovetail","DOVETAIL","Zigzag through the joints. Holes hug the line.","cherry"),{
  walls:dovetail(),start:[2,2],goal:[27,4],checkpoints:3,decorate:[{seed:13,n:12,ring:[1,2]}],acornDist:2}),
 board(T("trenches","THREE TRENCHES","Three trenches, three bridges. Varnish before the middle one.","cherry"),{
  trench:[[7,1,8,16],[14,1,15,16],[21,1,22,16]],floor:[[7,13,8,14],[14,3,15,4],[21,12,22,13]],varnish:[[10,8,12,15]],start:[3,3],goal:[26,4],checkpoints:3,decorate:[{seed:14,n:8,ring:[2,3]}],acornDist:2}),
 board(T("pinball","PINBALL PARLOR","A forest of pegs over a field of holes.","cherry"),{
  pegs:pinballPegs(),start:[2,2],goal:[27,15],checkpoints:2,decorate:[{seed:15,n:12,ring:[1,2]}],acornDist:2}),
 mazeBoard(T("baize","BAIZE MAZE","Felt corridors slow you down. Keep tilting.","cherry"),77,[[2,2,1,1],[6,4,0,0]],[[3,4,0,0],[7,1,1,0]],[8,0],{felt:[[4,4,12,9],[16,7,24,13]],acornDist:2}),
 board(T("glass","GLASS FLOOR","Varnish everywhere. Small tilts only.","cherry"),{
  walls:[[10,1,10,10],[20,7,20,16]],varnish:[[1,1,28,16]],felt:[[23,1,28,4]],start:[3,14],goal:[26,3],checkpoints:2,decorate:[{seed:17,n:9,ring:[2,3]}],acornDist:1}),
 mazeBoard(T("cherryknot","CHERRY KNOT","A longer maze with extra pits.","cherry"),404,[[1,1,1,1],[4,4,1,0],[7,3,0,1],[5,2,1,1]],[[3,2,0,0],[6,4,1,1],[8,1,0,1]],[8,4],{acornDist:2}),
 // Chapter 4: WALNUT - everything together.
 board(T("narrow","NARROW GRAIN","Five thin lanes. Holes leave one safe row.","walnut"),{
  walls:[[1,4,25,4],[4,7,28,7],[1,10,25,10],[4,13,28,13]],varnish:[[6,8,22,9]],start:[2,2],goal:[27,15],checkpoints:4,decorate:[{seed:19,n:10,ring:[1,1]}],acornDist:1}),
 board(T("crosscut","CROSSCUT","Visit every corner. Four bridges, pegs on guard.","walnut"),{
  trench:[[1,8,28,9],[14,1,15,16]],floor:[[5,8,6,9],[23,8,24,9],[14,3,15,4],[14,13,15,14]],start:[3,3],goal:[26,14],checkpoints:[[26,3],[3,14]],
  decorate:[{seed:20,n:8,ring:[1,2],kind:"p"},{seed:21,n:6,ring:[2,3]}],acornDist:2}),
 board(T("varnspiral","VARNISHED SPIRAL","A mirrored spiral with slick straights.","walnut"),mirror({
  walls:spiralWalls,varnish:[[4,1,24,2],[4,15,25,16]],start:[4,1],goal:[20,10],checkpoints:[[27,9],[2,9],[24,9]],decorate:[{seed:21,n:10,ring:[1,2]}],acornDist:2})),
 board(T("forest","PEG FOREST","Pegs, felt and holes. Pick your gaps.","walnut"),{
  walls:[[10,1,10,6],[19,11,19,16]],felt:[[12,8,17,10]],start:[2,15],goal:[27,2],checkpoints:3,decorate:[{seed:22,n:30,ring:[1,3],kind:"p"},{seed:23,n:10,ring:[1,2]}],acornDist:2}),
 board(T("clockwork","CLOCKWORK RINGS","Ring by ring into the middle.","walnut"),{
  frames:[[3,3,26,14],[6,6,23,11]],floor:[[26,8,26,9],[6,8,6,9]],varnish:[[1,15,28,16]],start:[2,1],goal:[20,8],checkpoints:3,decorate:[{seed:23,n:12,ring:[1,2]}],acornDist:1}),
 mazeBoard(T("heartwood","HEARTWOOD MAZE","The final board. Recenter with Y whenever you need to.","walnut"),2026,[[2,1,1,1],[5,3,0,0],[7,2,1,0],[3,4,0,1],[6,0,1,1]],[[4,2,0,0],[7,1,1,1]],[8,0],{acornDist:2})
];

const ids=new Set();levels.forEach(l=>{if(ids.has(l.id))throw Error("Duplicate id "+l.id);ids.add(l.id);});
const out=["// Generated by tools/make_levels.cjs (original board designs). Legend: # wall, o hole, S start, G goal, 1-9 checkpoints,",
"// p peg, f felt, v varnish, a acorn. Par times come from the offline autopilot.",
"var TIMBER_LEVELS=["];
levels.forEach((l,i)=>out.push(" {id:"+JSON.stringify(l.id)+",name:"+JSON.stringify(l.name)+",hint:"+JSON.stringify(l.hint)+",theme:"+JSON.stringify(l.theme)+",par:"+l.par+",grid:[\n  "+l.grid.map(r=>JSON.stringify(r)).join(",\n  ")+"]}"+(i<levels.length-1?",":"")));
out.push("];","");
fs.writeFileSync(path.join(__dirname,"..","levels.js"),out.join("\n"));
levels.forEach((l,i)=>{console.log((i+1)+". "+l.name+" ["+l.theme+"] par "+l.par+"s");if(process.argv.includes("--print"))console.log(l.grid.join("\n"));});
