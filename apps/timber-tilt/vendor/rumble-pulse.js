// Guarded, bounded handheld vibration transaction. No system permission changes.
var createCivRumblePulse=function(o){
 "use strict";
 var base=o.sdkBase,read=o.read64,write=o.write64,call=o.call_rop,allocate=o.malloc,release=o.free,audit=o.audit,profile=o.profile,blocks={},pointer=null,closed=false;
 var state={prepared:false,permitted:null,skipped:null,devices:[],calls:[],errors:[],allocationFreed:true,zeroed:true,guardIntact:true};
 function hex(n){return "0x"+n.toString(16);}
 function hash(b){var h=0x811c9dc5;for(var i=0;i<b.length;i++){h^=b[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,"0");}
 function fail(s){throw Error(s);}
 if(typeof base!=="bigint"||[read,write,call,allocate,release].some(function(f){return typeof f!=="function";}))fail("Native bridge helpers unavailable");
 if(!audit||audit.schema!=="civswitch-rumble-code/1"||audit.errors.length||audit.sdkBase!==hex(base)||!profile||profile.schema!=="civswitch-rumble-profile/1")fail("Current successful rumble code audit/profile required");
 if(!o.streams||o.streams.length!==1||o.streams[0].nativeId!==32||o.streams[0].kind!=="handheld"||o.streams[0].styleBits!==2)fail("Initial pulse test requires the verified single handheld route");
 var high=BigInt(audit.declaredEnd),guard=0x524d424c45474e44n;
 function bytes(address,size){if(address<base||address+BigInt(Math.ceil(size/8)*8)>high||size>1024)fail("Code read outside SDK bounds");var out=new Uint8Array(size);for(var i=0;i<size;i+=8){var w=read(address+BigInt(i));if(typeof w!=="bigint")fail("Invalid native read");for(var j=0;j<8&&i+j<size;j++)out[i+j]=Number(w>>BigInt(j*8)&255n);}return out;}
 profile.blocks.forEach(function(p){var address=base+BigInt(p.relativeOffset),old=audit.blocks.filter(function(b){return b.address===hex(address);})[0];if(!old||!Number.isInteger(p.bytes)||p.bytes<4||p.bytes>512||old.prefixHex.length<p.bytes*2)fail("Required rumble audit block missing");var retained=new Uint8Array(p.bytes);for(var i=0;i<p.bytes;i++)retained[i]=parseInt(old.prefixHex.slice(i*2,i*2+2),16);if(hash(retained)!==p.fnv1a||hash(bytes(address,p.bytes))!==p.fnv1a)fail("Rumble SDK fingerprint changed");blocks[p.role]=address;});
 ["builder","initialize","send","permitted","mounted","info","serviceEnsure","resourceId"].forEach(function(k){if(!blocks[k])fail("Missing rumble fingerprint role");});
 // Verify the audited resource-ID PLT binding used by SendVibrationValue.
 var send=audit.blocks.filter(function(b){return b.address===hex(blocks.send);})[0],branch=send.branches.filter(function(b){return b.offset===36&&b.kind==="BL";})[0],edge=branch&&audit.indirectTargets.filter(function(e){return e.stub===branch.target;})[0];
 if(!edge||!edge.captured||edge.target!==hex(blocks.resourceId))fail("Rumble resource linkage not audited");
 var slot=BigInt(edge.slot);if(slot<base||slot+8n>high||slot%8n||read(slot)!==blocks.resourceId)fail("Rumble resource linkage changed");
 function at(n){if(pointer===null||n<0||n+8>96)fail("Private allocation unavailable");return pointer+BigInt(n);}
 function check(){if(read(at(88))!==guard){state.guardIntact=false;fail("Private buffer guard changed");}}
 function invoke(role,args){check();var rc=call.apply(null,[blocks[role]].concat(args));if(typeof rc!=="bigint")fail("Unexpected native result type");rc=BigInt.asUintN(32,rc);state.calls.push({role:role,result:hex(rc)});if(state.calls.length>40)fail("Native call budget exceeded");if(rc!==0n)fail(role+" returned "+hex(rc));check();}
 function value(offset,amp){var b=new ArrayBuffer(16),v=new DataView(b);[amp,160,amp,320].forEach(function(f,i){v.setFloat32(i*4,f,true);});for(var i=0;i<16;i+=8){var w=BigInt(v.getUint32(i,true))|(BigInt(v.getUint32(i+4,true))<<32n);write(at(offset+i),w);if(read(at(offset+i))!==w)fail("Private vibration value readback failed");}}
 function stop(){var errors=[];state.devices.forEach(function(d,i){if(!d.initializationAttempted)return;try{invoke("send",[at(16+i*8),at(48)]);d.zeroed=true;}catch(e){d.zeroed=false;errors.push(String(e&&e.message||e));}});state.zeroed=state.devices.every(function(d){return d.zeroed;});if(errors.length)fail(errors.join("; "));}
 function close(){if(closed)return;closed=true;try{if(pointer!==null)stop();}catch(e){state.errors.push(String(e&&e.message||e));}finally{if(pointer!==null){try{release(pointer);state.allocationFreed=true;}catch(e){state.errors.push("Free: "+String(e&&e.message||e));}pointer=null;}}}
 return {state:state,prepare:function(){
  if(closed||pointer!==null)fail("Pulse transaction already used");
  try{
   var p=allocate(96);if(typeof p!=="bigint"||p<0x10000n||p%8n||p+96n>0x10000000000n)fail("Private native allocation failed");pointer=p;state.allocationFreed=false;write(at(88),guard);check();value(32,.45);value(48,0);
   write(at(64),0n);invoke("permitted",[at(64)]);var permission=read(at(64));if(permission!==0n&&permission!==1n)fail("Invalid vibration permission boolean");state.permitted=permission===1n;if(!state.permitted){state.skipped="System vibration permission is off";return false;}
   write(at(0),0n);write(at(8),0n);invoke("builder",[at(0),at(8),2n,32n,2n]);var pair=read(at(0));if(read(at(8))!==2n||pair!==0x0001200400002004n)fail("Unexpected handheld vibration handles/count");
   [0x2004n,0x12004n].forEach(function(h,i){write(at(16+i*8),h);if(read(at(16+i*8))!==h)fail("Private handle readback failed");state.devices.push({index:i,handle:hex(h),initializationAttempted:false,mounted:null,type:null,position:null,zeroed:true,pulses:0});});
   state.devices.forEach(function(d,i){d.initializationAttempted=true;invoke("initialize",[at(16+i*8)]);invoke("send",[at(16+i*8),at(48)]);write(at(64),0n);invoke("mounted",[at(64),at(16+i*8)]);var mounted=read(at(64));if(mounted!==0n&&mounted!==1n)fail("Invalid mounted boolean");d.mounted=mounted===1n;if(!d.mounted)fail("Vibration device "+i+" is not mounted");write(at(72),0n);invoke("info",[at(72),at(16+i*8)]);var info=read(at(72));d.type=Number(info&0xffffffffn);d.position=Number(info>>32n);if(d.type!==1||d.position!==i+1)fail("Unexpected vibration device type/position");});
   state.prepared=true;return true;
  }catch(e){state.errors.push(String(e&&e.message||e));close();throw e;}
 },start:function(indices){if(closed||!state.prepared)fail("Pulse transaction not ready");indices.forEach(function(i){if(i!==0&&i!==1)fail("Invalid vibration device index");var d=state.devices[i];d.zeroed=false;state.zeroed=false;invoke("send",[at(16+i*8),at(32)]);d.pulses++;});},stop:stop,close:close};
};
