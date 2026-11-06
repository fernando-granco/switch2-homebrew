// Bounded native Npad handheld Start/Stop transaction, explicit --enable only.
var createCivMotionActivation=function(options){
 "use strict";
 var base=options.sdkBase,read=options.read64,write=options.write64,allocate=options.malloc,release=options.free,call=options.call_rop,audit=options.audit,profile=options.profile,streams=options.streams;
 if(typeof base!=="bigint"||typeof read!=="function"||typeof write!=="function"||typeof allocate!=="function"||typeof release!=="function"||typeof call!=="function")throw Error("Existing native bridge/read/write/allocator helpers required");
 if(!audit||audit.schema!=="civswitch-motion-activation-code/1"||audit.errors.length||audit.sdkBase!=="0x"+base.toString(16)||!profile||profile.schema!=="civswitch-motion-activation-profile/1")throw Error("Current successful activation-code audit/profile required");
 if(!streams||streams.length!==1||streams[0].nativeId!==32||streams[0].kind!=="handheld"||streams[0].styleBits!==2)throw Error("First activation test supports only the audited single Npad handheld route");
 var blocks={},pointer=null,needStop=false,closed=false,handle=0x00022004n;
 var state={requested:true,attempted:false,started:false,stopped:false,skipped:null,handle:"0x00022004",startResult:null,stopAttempted:false,stopResult:null,allocationFreed:true,errors:[]};
 function note(s){if(options.note)try{options.note(s);}catch(_){}}
 function hash(b){var h=0x811c9dc5;for(var i=0;i<b.length;i++){h^=b[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,"0");}
 function u32(b,i){return (b[i]+b[i+1]*256+b[i+2]*65536+b[i+3]*16777216)>>>0;}
 function get(address,size){var b=new Uint8Array(size);for(var i=0;i<size;i+=8){var w=read(address+BigInt(i));if(typeof w!=="bigint"||w<0n||w>0xffffffffffffffffn)throw Error("Invalid native read result");for(var j=0;j<8&&i+j<size;j++)b[i+j]=Number(w>>BigInt(j*8)&255n);}return b;}
 profile.blocks.forEach(function(p){
  if(!Number.isInteger(p.bytes)||p.bytes<4||p.bytes>512)throw Error("Invalid activation fingerprint extent");
  var old=audit.blocks.filter(function(b){return b.relativeOffset===p.relativeOffset;})[0];
  if(!old||old.address!=="0x"+(base+BigInt(p.relativeOffset)).toString(16)||old.prefixHex.length<p.bytes*2)throw Error("Required activation audit block missing");
  var retained=new Uint8Array(p.bytes);for(var i=0;i<p.bytes;i++)retained[i]=parseInt(old.prefixHex.slice(i*2,i*2+2),16);
  if(hash(retained)!==p.fnv1a)throw Error("Unsupported retained activation code");var live=get(base+BigInt(p.relativeOffset),p.bytes);if(hash(live)!==p.fnv1a)throw Error("Live activation code fingerprint changed");blocks[p.role]={address:base+BigInt(p.relativeOffset),bytes:live};
 });
 ["start","stop","handleBuilder","validator","service","resourceId"].forEach(function(role){if(!blocks[role])throw Error("Missing activation fingerprint role");});
 // Validate the live linkage for the start wrapper's validator/server/resource calls.
 var start=audit.blocks.filter(function(b){return b.address==="0x"+blocks.start.address.toString(16);})[0];
 [[20,"validator"],[40,"service"],[48,"resourceId"]].forEach(function(pair){var branch=start.branches.filter(function(b){return b.offset===pair[0];})[0],edge=branch&&audit.indirectTargets.filter(function(e){return e.stub===branch.target;})[0];if(!edge||!edge.captured||edge.target!=="0x"+blocks[pair[1]].address.toString(16))throw Error("Activation linkage target is not the audited function");var slot=BigInt(edge.slot);if(slot<base||slot+8n>BigInt(audit.declaredEnd)||read(slot)!==blocks[pair[1]].address)throw Error("Live activation linkage changed");});
 // Handle builder's audited handheld branch: 0x00020003 | (32<<8), then +1.
 if(u32(blocks.start.bytes,64)!==0xb9400262||u32(blocks.start.bytes,68)!==0xf9406108||u32(blocks.stop.bytes,68)!==0xf9406508)throw Error("Start/Stop handle load or service method differs");
 function result(value){if(typeof value!=="bigint")throw Error("Unexpected native result type");return BigInt.asUintN(32,value);}
 function resultHex(v){return "0x"+v.toString(16).padStart(8,"0");}
 function cleanup(){
  if(closed)return;closed=true;
  try{if(needStop){state.stopAttempted=true;if(pointer===null||read(pointer)!==handle)throw Error("Owned handle changed; refusing invalid native Stop");note("stop handle="+state.handle);var rc=result(call(blocks.stop.address,pointer));state.stopResult=resultHex(rc);note("stop result="+state.stopResult);if(rc!==0n)throw Error("Sensor Stop returned "+state.stopResult);needStop=false;state.stopped=true;}}
  catch(e){state.errors.push(String(e&&e.message||e).slice(0,180));}
  finally{if(pointer!==null){try{release(pointer);state.allocationFreed=true;}catch(e){state.errors.push("Handle free: "+String(e&&e.message||e).slice(0,140));}pointer=null;}}
 }
 return {state:state,skip:function(reason){if(!state.attempted)state.skipped=reason;},start:function(){
  if(closed||state.attempted||state.skipped)throw Error("Activation transaction is already closed/used");
  try{
   pointer=allocate(8);if(typeof pointer!=="bigint"||pointer<0x10000n||pointer%8n||pointer+8n>0x10000000000n){pointer=null;throw Error("Native handle allocation failed");}state.allocationFreed=false;
   write(pointer,handle);if(read(pointer)!==handle)throw Error("Owned native handle readback failed");
   state.attempted=true;needStop=true;note("start handle="+state.handle);var rc=result(call(blocks.start.address,pointer));state.startResult=resultHex(rc);note("start result="+state.startResult);
   if(rc!==0n){needStop=false;throw Error("Sensor Start returned "+state.startResult);}state.started=true;
  }catch(e){state.errors.push(String(e&&e.message||e).slice(0,180));cleanup();throw e;}
 },close:cleanup};
};
