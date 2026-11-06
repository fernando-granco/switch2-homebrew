// Fresh bounded rumble proof for the unchanged verified pulse helper.
// Profiles contain hashes/offsets; no research capture is required at runtime.
var createSwitchRumbleNative=function(o){
 "use strict";
 var base=o.sdkBase,read=o.read64,profile=o.profile,native=o.openReader(),total=0;
 function hex(v){return "0x"+v.toString(16);}
 function u32(b,i){return (b[i]+b[i+1]*256+b[i+2]*65536+b[i+3]*16777216)>>>0;}
 function hash(b){var h=0x811c9dc5;for(var i=0;i<b.length;i++){h^=b[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,"0");}
 var high=BigInt(native.info().declaredEnd);
 function bytes(address,size,limit){var rounded=Math.ceil(size/8)*8;if(!Number.isInteger(size)||size<1||size>1024||address<base||address+BigInt(rounded)>limit||total+rounded>8192)throw Error("Rumble profile read outside guarded bounds/budget");var b=new Uint8Array(size);for(var i=0;i<size;i+=8){var w=read(address+BigInt(i));total+=8;if(typeof w!=="bigint"||w<0n||w>0xffffffffffffffffn)throw Error("Invalid rumble profile read");for(var j=0;j<8&&i+j<size;j++)b[i+j]=Number(w>>BigInt(j*8)&255n);}return b;}
 var prefix=bytes(base,16,base+128n),offset=u32(prefix,4);if(offset<16||offset>0x10000000||offset%4)throw Error("Invalid rumble SDK code extent");var codeEnd=base+BigInt(offset);
 var proof={schema:"civswitch-rumble-code/1",sdkBase:hex(base),declaredEnd:hex(high),errors:[],blocks:[],indirectTargets:[],source:"fresh live pinned-code probe; no symbol inventory",symbolInventory:false};
 if(!profile||profile.schema!=="civswitch-rumble-profile/1")throw Error("Rumble compatibility profile missing");
 profile.blocks.forEach(function(p){var address=base+BigInt(p.relativeOffset),b=bytes(address,p.bytes,codeEnd);if(hash(b)!==p.fnv1a)throw Error("Rumble code profile does not match this SDK");var s="";for(var i=0;i<b.length;i++)s+=b[i].toString(16).padStart(2,"0");proof.blocks.push({address:hex(address),relativeOffset:p.relativeOffset,role:p.role,size:p.bytes,prefixHex:s,branches:[]});});
 var send=proof.blocks.filter(function(b){return b.role==="send";})[0],resource=proof.blocks.filter(function(b){return b.role==="resourceId";})[0];if(!send||!resource)throw Error("Rumble linkage profile incomplete");
 var code=bytes(BigInt(send.address)+32n,8,codeEnd),ins=u32(code,4);if(((ins&0xfc000000)>>>0)!==0x94000000)throw Error("Unexpected rumble resource call");var imm=ins&0x03ffffff;if(imm&0x02000000)imm-=0x04000000;
 var stub=BigInt(send.address)+36n+BigInt(imm*4),b=bytes(stub,16,codeEnd),a=u32(b,0),l=u32(b,4),d=u32(b,8);
 if(((a&0x9f00001f)>>>0)!==0x90000010||((l&0xffc003ff)>>>0)!==0xf9400211||((d&0xffc003ff)>>>0)!==0x91000210||u32(b,12)!==0xd61f0220)throw Error("Unsupported rumble linkage stub");
 var pageImm=((a>>>5)&0x7ffff)*4+((a>>>29)&3);if(pageImm&0x100000)pageImm-=0x200000;var load=((l>>>10)&4095)*8;if(load!==((d>>>10)&4095))throw Error("Rumble linkage offsets differ");
 var slot=(stub&~4095n)+BigInt(pageImm)*4096n+BigInt(load);if(slot%8n)throw Error("Unaligned rumble linkage slot");var ptr=bytes(slot,8,high),target=0n;for(var k=7;k>=0;k--)target=target<<8n|BigInt(ptr[k]);if(target!==BigInt(resource.address))throw Error("Rumble resource linkage changed");
 send.branches.push({offset:36,kind:"BL",target:hex(stub)});proof.indirectTargets.push({stub:hex(stub),slot:hex(slot),target:hex(target),captured:true});
 native.reader.poll();
 var session=createCivRumblePulse({sdkBase:base,read64:read,write64:o.helpers.write64,call_rop:o.helpers.call_rop,malloc:o.helpers.malloc,free:o.helpers.free,audit:proof,profile:profile,streams:native.reader.streams});
 return {session:session,check:function(){native.reader.poll();},info:{source:proof.source,profileReadBytes:total,route:"handheld ID32/style2"}};
};
