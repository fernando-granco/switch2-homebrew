// Standalone live SDK profile audit. No retained research reports are required.
// Captures actual code/metadata in this process before using the unchanged readers.
var createSwitchMotionNative=function(options){
 "use strict";
 var read=options.read64,base=options.sdkBase,profiles=options.profiles,total=0;
 function hex(v){return "0x"+v.toString(16);}
 function u32(b,i){return (b[i]+b[i+1]*256+b[i+2]*65536+b[i+3]*16777216)>>>0;}
 function s32(b,i){return u32(b,i)|0;}
 function hash(b){var h=0x811c9dc5;for(var i=0;i<b.length;i++){h^=b[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,"0");}
 if(typeof read!=="function"||typeof base!=="bigint"||base<=0n||base>0xffffffffffn||base%4096n)throw Error("Motion SDK base/read helper unavailable");
 function bytes(address,size,low,high){var rounded=Math.ceil(size/8)*8;if(!Number.isInteger(size)||size<=0||size>1024||address<low||address+BigInt(rounded)>high||total+rounded>8192)throw Error("Motion profile read outside guarded bounds/budget");var b=new Uint8Array(size);for(var i=0;i<size;i+=8){var w=read(address+BigInt(i));total+=8;if(typeof w!=="bigint"||w<0n||w>0xffffffffffffffffn)throw Error("Invalid motion profile read");for(var j=0;j<8&&i+j<size;j++)b[i+j]=Number(w>>BigInt(j*8)&255n);}return b;}
 var prefix=bytes(base,16,base,base+128n),offset=u32(prefix,4);
 if(offset<16||offset>0x10000000||offset%4)throw Error("Unsupported motion SDK module prefix");
 var at=base+BigInt(offset),header=bytes(at,32,at,at+32n);if(u32(header,0)!==0x30444f4d)throw Error("Motion SDK MOD0 signature mismatch");
 var bss=at+BigInt(s32(header,8)),end=at+BigInt(s32(header,12));if(bss<at||end<bss||end>base+0x20000000n)throw Error("Motion SDK extent is invalid");
 var context={name:"sdk",base:hex(base),headerOffset:offset,declaredEnd:hex(end),completed:true,errors:[],source:"fresh live MOD0/profile probe; no symbol inventory",symbolInventory:false};
 function capture(profile,schema){
  var proof={schema:schema,sdkBase:hex(base),declaredEnd:hex(end),blocks:[],indirectTargets:[],errors:[],source:"fresh live pinned-code profile probe",symbolInventory:false};
  profile.blocks.forEach(function(p){var address=base+BigInt(p.relativeOffset),b=bytes(address,p.bytes,base,at);if(hash(b)!==p.fnv1a)throw Error("Motion code profile does not match this SDK");var h="";for(var i=0;i<b.length;i++)h+=b[i].toString(16).padStart(2,"0");proof.blocks.push({role:p.role,label:"verified profile / "+p.role,address:hex(address),relativeOffset:p.relativeOffset,size:p.bytes,prefixHex:h,branches:[]});});return proof;
 }
 var readerProof=capture(profiles.reader,"civswitch-motion-code/1"),reader=createCivMotionReader({sdkBase:base,read64:read,audit:readerProof,inventory:{modules:[context],source:context.source},profile:profiles.reader});
 return {reader:reader,info:function(){return {profileReadBytes:total,boundsSource:context.source,declaredEnd:context.declaredEnd};},makeActivation:function(helpers){
  var proof=capture(profiles.activation,"civswitch-motion-activation-code/1"),start=proof.blocks.filter(function(b){return b.role==="start";})[0],code=new Uint8Array(start.size);
  for(var i=0;i<code.length;i++)code[i]=parseInt(start.prefixHex.slice(i*2,i*2+2),16);
  [[20,"validator"],[40,"service"],[48,"resourceId"]].forEach(function(pair){
   var ins=u32(code,pair[0]);if(((ins&0xfc000000)>>>0)!==0x94000000)throw Error("Motion Start linkage is not a direct call");var imm=ins&0x03ffffff;if(imm&0x02000000)imm-=0x04000000;var stub=BigInt(start.address)+BigInt(pair[0])+BigInt(imm*4),b=bytes(stub,16,base,at),a=u32(b,0),l=u32(b,4),d=u32(b,8);
   if(((a&0x9f00001f)>>>0)!==0x90000010||((l&0xffc003ff)>>>0)!==0xf9400211||((d&0xffc003ff)>>>0)!==0x91000210||u32(b,12)!==0xd61f0220)throw Error("Unsupported motion linkage stub");
   var pageImm=((a>>>5)&0x7ffff)*4+((a>>>29)&3);if(pageImm&0x100000)pageImm-=0x200000;var load=((l>>>10)&4095)*8;if(load!==((d>>>10)&4095))throw Error("Motion linkage offset mismatch");var slot=(stub&~4095n)+BigInt(pageImm)*4096n+BigInt(load);if(slot%8n)throw Error("Unaligned motion linkage slot");var ptrBytes=bytes(slot,8,base,end),target=0n;for(var k=7;k>=0;k--)target=target<<8n|BigInt(ptrBytes[k]);
   var expected=proof.blocks.filter(function(b){return b.role===pair[1];})[0];if(!expected||target!==BigInt(expected.address))throw Error("Motion linkage target differs from verified profile");
   start.branches.push({offset:pair[0],kind:"BL",target:hex(stub)});proof.indirectTargets.push({stub:hex(stub),slot:hex(slot),target:hex(target),captured:true});
  });
  return createCivMotionActivation({sdkBase:base,read64:read,write64:helpers.write64,malloc:helpers.malloc,free:helpers.free,call_rop:helpers.call_rop,audit:proof,profile:profiles.activation,streams:reader.streams,note:helpers.note});
 }};
};
