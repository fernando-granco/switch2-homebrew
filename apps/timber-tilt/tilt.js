// Motion-to-board tilt mapping. Raw axes/units are not assumed: a short wizard learns
// the "roll right" and "roll down" directions from the player's own tilts.
var createTimberTilt=function(){
    "use strict";
    var SENS=[{name:"LOW",span:0.45},{name:"MEDIUM",span:0.33},{name:"HIGH",span:0.24}];
    var g=null,lastId=null,samples=0,ref=null,dirX=null,dirY=null,sens=1,recenters=0,win=[],streak=[],wizard=null,result=null;
    function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
    function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
    function len(a){return Math.sqrt(dot(a,a));}
    function scale(a,k){return [a[0]*k,a[1]*k,a[2]*k];}
    function norm(a){var l=len(a);return l>1e-9?scale(a,1/l):null;}
    function mean(list){var m=[0,0,0];list.forEach(function(v){m[0]+=v[0];m[1]+=v[1];m[2]+=v[2];});return scale(m,1/list.length);}
    function round(a){return a?a.map(function(v){return Math.round(v*1e4)/1e4;}):null;}
    function finite(a){return Array.isArray(a)&&a.length===3&&a.every(function(v){return typeof v==="number"&&isFinite(v);});}
    function setStep(step){wizard.step=step;wizard.since=wizard.now;win=[];streak=[];}
    function wizardSample(v){
        var w=wizard;
        if(w.step==="hold"){
            win.push(v);if(win.length>24)win.shift();
            var m=mean(win),still=win.every(function(p){return Math.abs(p[0]-m[0])<0.05&&Math.abs(p[1]-m[1])<0.05&&Math.abs(p[2]-m[2])<0.05;});
            if(!still)win=[v];
            w.progress=win.length/24;
            if(win.length>=24){w.ref=m;setStep("right");}
        }else if(w.step==="right"||w.step==="top"){
            var d=sub(v,w.ref);
            if(w.step==="top")d=sub(d,scale(w.dirX,dot(d,w.dirX)));
            var mag=len(d);w.progress=Math.min(1,mag/0.2);
            if(mag>0.2){streak.push(d);if(streak.length>=6){var dir=norm(mean(streak));
                if(w.step==="right"){w.dirX=dir;w.rightPeak=mag;setStep("level1");}
                else{w.dirY=scale(dir,-1);w.topPeak=mag;setStep("level2");}}}
            else streak=[];
        }else if(w.step==="level1"||w.step==="level2"){
            var back=len(sub(v,w.ref));w.progress=Math.max(0,1-back/0.2);
            if(back<0.08){streak.push(v);if(streak.length>=8){
                if(w.step==="level1")setStep("top");
                else{ref=w.ref;dirX=w.dirX;dirY=w.dirY;result={ref:round(ref),dirX:round(dirX),dirY:round(dirY),rightPeak:Math.round(w.rightPeak*1e4)/1e4,topPeak:Math.round(w.topPeak*1e4)/1e4,orthogonality:Math.round(dot(dirX,dirY)*1e4)/1e4,durationMs:w.now-w.began};setStep("done");}
            }}else streak=[];
        }
    }
    return {
        // Feed every motion view; only new sample numbers are filtered in.
        feed:function(acc,id,ms){if(!finite(acc)||id===lastId)return false;lastId=id;samples++;g=g?[g[0]+(acc[0]-g[0])*0.45,g[1]+(acc[1]-g[1])*0.45,g[2]+(acc[2]-g[2])*0.45]:acc.slice();if(wizard&&wizard.step!=="done"){wizard.now=ms;wizardSample(g);}return true;},
        startWizard:function(ms){wizard={step:"hold",progress:0,began:ms,since:ms,now:ms,ref:null,dirX:null,dirY:null};win=[];streak=[];},
        cancelWizard:function(){wizard=null;},
        wizard:function(ms){if(!wizard)return null;return {step:wizard.step,progress:wizard.progress,stepMs:ms-wizard.since,preview:wizard.ref&&g?sub(g,wizard.ref):null};},
        calibrated:function(){return !!dirX;},
        recenter:function(){if(!g||!dirX)return false;ref=g.slice();recenters++;return true;},
        cycleSensitivity:function(){sens=(sens+1)%SENS.length;return SENS[sens].name;},
        sensitivity:function(){return SENS[sens].name;},
        // Board tilt in [-1,1]; +x rolls right, +y rolls toward the bottom of the screen.
        tilt:function(){
            if(!g||!dirX)return {x:0,y:0};
            var d=sub(g,ref),span=SENS[sens].span,x=dot(d,dirX)/span,y=dot(d,dirY)/span,m=Math.sqrt(x*x+y*y);
            if(m<0.05)return {x:0,y:0};
            var k=Math.min(1,(m-0.05)/0.95)/m;return {x:x*k,y:y*k};
        },
        raw:function(){return g?round(g):null;},
        report:function(){return {calibrated:!!dirX,calibration:result,sensitivity:SENS[sens].name,recenters:recenters,filteredSamples:samples,currentRef:round(ref)};}
    };
};
if(typeof module!=="undefined")module.exports=createTimberTilt;
