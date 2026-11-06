// Session motion observations. Initialization is lazy, on the first Motion visit.
var createSwitchMotion=function(options){
 "use strict";
 var opened=false,native=null,reader=null,activation=null,failed=false,startedAt=null,decided=false,baseline=0,defaults=true,lastPoll=-100000,closed=false;
 var data={status:"not opened",message:"Open Motion to test the sensors",streams:[],resetCount:0,snapshots:0,profile:null,activation:null};
 function error(e){return String(e&&e.message||e).slice(0,180);}
 function cleanupNative(){if(activation){activation.close();data.activation=activation.state;}}
 function stopFailure(e){failed=true;data.status="unavailable";data.message=error(e);cleanupNative();}
 function fresh(){return {acceleration:{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},angularVelocity:{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},angle:{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}};}
 return {open:function(ms){if(opened||closed)return;opened=true;startedAt=null;data.status="starting";data.message="Hold still briefly, then tilt and rotate";
  try{native=options.openNative();reader=native.reader;data.profile=native.info();data.streams=reader.streams.map(function(s){return {key:s.key,nativeId:s.nativeId,kind:s.kind,source:s,latest:null,lastAt:null,snapshots:0,ranges:fresh(),first:[],last:[],evicted:0};});
   if(!data.streams.length){data.status="unavailable";data.message="No supported motion route is available";failed=true;return;}
   try{activation=native.makeActivation(options.helpers);data.activation=activation.state;}catch(e){data.status="read only";data.message="Sensor start unavailable: "+error(e);decided=true;}
  }catch(e){stopFailure(e);}
 },tick:function(ms,visible){if(!opened||closed||failed||!reader)return;if(!visible&&decided)return;if(ms-lastPoll<32)return;lastPoll=ms;if(startedAt===null)startedAt=ms;
  try{reader.poll().forEach(function(f){var s=data.streams.filter(function(s){return s.key===f.key;})[0];if(!s)return;var p=Object.assign({ms:ms},f.snapshot);s.latest=p;s.lastAt=ms;s.snapshots++;data.snapshots++;
   ["acceleration","angularVelocity","angle"].forEach(function(g){p[g].forEach(function(v,i){s.ranges[g].min[i]=Math.min(s.ranges[g].min[i],v);s.ranges[g].max[i]=Math.max(s.ranges[g].max[i],v);});});
   if(s.first.length<60)s.first.push(p);else{if(s.last.length===60){s.last.shift();s.evicted++;}s.last.push(p);}
   if(!decided){baseline++;if(p.acceleration[0]!==0||p.acceleration[1]!==0||p.acceleration[2]!==-1||p.angularVelocity.some(function(v){return v!==0;})||p.angle.some(function(v){return v!==0;}))defaults=false;}
  });
  if(activation&&!decided&&ms-startedAt>=2000){decided=true;data.baseline={freshSnapshots:baseline,defaultValued:defaults};if(baseline<3)activation.skip("Insufficient fresh baseline");else if(!defaults)activation.skip("Existing nondefault motion data");else activation.start();}
  if(decided){var freshStream=data.streams.some(function(s){return s.latest&&ms-s.lastAt<2000&&s.source.stats.advances>0;});data.status=freshStream?"live":"waiting";if(activation)data.message=activation.state.started?"Motion is enabled for this session":activation.state.skipped||"Waiting for motion samples";}
  if(native)data.profile=native.info();
  }catch(e){stopFailure(e);}
 },reset:function(){data.resetCount++;data.snapshots=0;data.streams.forEach(function(s){s.snapshots=0;s.ranges=fresh();s.first=[];s.last=[];s.evicted=0;});},
 view:function(ms){return {status:data.status,message:data.message,snapshots:data.snapshots,activation:data.activation,streams:data.streams.map(function(s){return {key:s.key,nativeId:s.nativeId,kind:s.kind,latest:s.latest,ageMs:s.lastAt===null?null:ms-s.lastAt,snapshots:s.snapshots,stats:s.source.stats,ranges:s.snapshots?s.ranges:null};})};},
 close:function(){if(closed)return;closed=true;cleanupNative();},
 report:function(){var a=activation&&activation.state;return {opened:opened,status:data.status,message:data.message,resetCount:data.resetCount,profile:data.profile,activation:a,baseline:data.baseline||null,readerStats:reader?reader.stats:null,nativeCleanup:!a||a.allocationFreed&&(!a.started||a.stopped)&&(!a.stopAttempted||a.stopResult==="0x00000000"),streams:data.streams.map(function(s){return {key:s.key,nativeId:s.nativeId,kind:s.kind,latest:s.latest,snapshots:s.snapshots,ranges:s.snapshots?s.ranges:null,stats:s.source.stats,retainedSamples:s.first.concat(s.last),evicted:s.evicted};})};}
 };
};
