// Offline solvability driver shared by the level generator and model test.
// Follows the guide cells with a simple PD controller; never touches a console.
"use strict";
module.exports=function autopilot(P,level,limit){
    const s=P.create(level),cells=level.path.cells;let i=0,t=0,minHole=Infinity;
    limit=limit||240;
    while(t<limit&&s.mode!=="won"){
        while(i<cells.length-1&&Math.hypot(cells[i].x-s.x,cells[i].y-s.y)<0.45)i++;
        const a=cells[i],ex=a.x-s.x,ey=a.y-s.y;
        const tilt={x:P.clamp(0.9*ex-0.42*s.vx,-1,1),y:P.clamp(0.9*ey-0.42*s.vy,-1,1)};
        P.step(s,tilt,1/30);t+=1/30;
        level.holes.forEach(h=>{minHole=Math.min(minHole,Math.hypot(h.x-s.x,h.y-s.y));});
        if(s.mode==="falling"||s.events.indexOf("fall")>=0)break;
    }
    return {s,t,minHole};
};
