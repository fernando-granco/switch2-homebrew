// Read-only SixAxis ring reader, derived from the accepted SDK getter audit.
var createCivMotionReader=function(options){
 "use strict";
 var read64=options.read64,base=options.sdkBase,audit=options.audit,inventory=options.inventory,profile=options.profile;
 var stats={polls:0,bytesRead:0,retries:0,inconsistent:0},perPoll=0,blocks={},controllerStates=[],descriptors=[];
 function hex(n){return "0x"+n.toString(16);}
 function fail(message){throw Error(message);}
 if(typeof base!=="bigint"||typeof read64!=="function"||!audit||audit.schema!=="civswitch-motion-code/1"||audit.errors.length||audit.sdkBase!==hex(base))fail("Current successful motion code audit required");
 var sdk=inventory&&inventory.modules.filter(function(m){return m.name==="sdk";})[0];
 if(!sdk||sdk.base!==audit.sdkBase||!sdk.completed||sdk.errors.length||!profile||profile.schema!=="civswitch-motion-reader-profile/1")fail("Current SDK inventory and reader profile required");
 var high=BigInt(sdk.declaredEnd);if(high<=base||high>base+0x20000000n)fail("Invalid declared SDK extent");
 function word(address){if(typeof address!=="bigint"||address<0x10000n||address+8n>0x10000000000n)fail("Implausible read address");if(stats.bytesRead+8>8388608||perPoll+8>4096)fail("Motion read budget exhausted");stats.bytesRead+=8;perPoll+=8;var v=read64(address);if(typeof v!=="bigint"||v<0n||v>0xffffffffffffffffn)fail("Invalid read64 result");return v;}
 function imagePointer(p,size,aligned){if(typeof p!=="bigint"||p<base||p+BigInt(size)>high||aligned&&p%8n)fail("Accessor pointer outside declared SDK data");return p;}
 function bytes(address,size){var b=new Uint8Array(size);for(var i=0;i<size;i+=8){var v=word(address+BigInt(i));for(var j=0;j<8&&i+j<size;j++)b[i+j]=Number(v>>BigInt(j*8)&255n);}return b;}
 function u32(b,i){return (b[i]+b[i+1]*256+b[i+2]*65536+b[i+3]*16777216)>>>0;}
 function hash(b){var h=0x811c9dc5;for(var i=0;i<b.length;i++){h^=b[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,"0");}
 profile.blocks.forEach(function(p){
  if(!Number.isInteger(p.bytes)||p.bytes<4||p.bytes>1024)fail("Invalid fingerprint length");
  var old=audit.blocks.filter(function(b){return b.relativeOffset===p.relativeOffset;})[0],offset=BigInt(p.relativeOffset);
  if(!old||offset<0n||offset+BigInt(Math.ceil(p.bytes/8)*8)>BigInt(sdk.headerOffset)||old.address!==hex(base+offset))fail("Audited code block missing or inconsistent");
  var retained=new Uint8Array(p.bytes);if(old.prefixHex.length<p.bytes*2)fail("Audited code prefix incomplete");
  for(var i=0;i<p.bytes;i++)retained[i]=parseInt(old.prefixHex.slice(i*2,i*2+2),16);
  if(hash(retained)!==p.fnv1a)fail("Audited SDK fingerprint unsupported");var live=bytes(base+offset,p.bytes);if(hash(live)!==p.fnv1a)fail("Live SDK fingerprint changed");blocks[p.role]={bytes:live,address:base+offset};
 });
 ["generic","left","right","style","accessor","lookup"].forEach(function(r){if(!blocks[r])fail("Reader fingerprint role missing");});
 function mov(role,offset,reg){var w=u32(blocks[role].bytes,offset);if(((w&0xff80001f)>>>0)!==(0x52800000|reg)||((w>>>21)&3)!==0)fail("Unexpected audited MOVZ field");return (w>>>5)&65535;}
 var offsets={fullKey:mov("generic",0x88,8),handheld:mov("generic",0x90,8),dualLeft:mov("left",0x74,11),dualRight:mov("right",0x74,11),joyLeft:mov("generic",0x54,9),joyRight:mov("generic",0x50,8)};
 if(mov("generic",0xc0,11)!==96||mov("generic",0xcc,13)!==104||mov("left",0x94,13)!==104||mov("right",0x94,13)!==104)fail("Unsupported native motion stride");
 function slot(adrpAt,ldrAt,reg){
  var b=blocks.accessor,w=u32(b.bytes,adrpAt),l=u32(b.bytes,ldrAt);
  if(((w&0x9f00001f)>>>0)!==((0x90000000|reg)>>>0)||((l&0xffc003ff)>>>0)!==((0xf9400000|(reg<<5)|reg)>>>0))fail("Unexpected accessor address-load shape");
  var imm=((w>>>5)&0x7ffff)*4+((w>>>29)&3);if(imm&0x100000)imm-=0x200000;
  return imagePointer(((b.address+BigInt(adrpAt))&~4095n)+BigInt(imm)*4096n+BigInt((l>>>10)&4095)*8n,8,true);
 }
 var guardSlot=slot(12,20,19),objectSlot=slot(16,28,20),guard=imagePointer(word(guardSlot),8,false),object=imagePointer(word(objectSlot),112,true);
 if(!(word(guard)&1n)||!(word(object)&1n))fail("Npad accessor is not initialized; no initialization attempted");
 // Audited accessor returns object+8; audited lookup reads [accessor+24+index*8].
 var table=object+32n;
 function plausibleState(p){if(p<0x10000n||p%8n||p+0x4200n>0x10000000000n)fail("Npad state pointer is null or implausible");return p;}
 function kinds(style){if(style&1)return ["fullKey"];if(style&2)return ["handheld"];if(style&4)return ["dualLeft","dualRight"];if(style&8)return ["joyLeft"];if(style&16)return ["joyRight"];return [];}
 for(var i=0;i<10;i++){
  var p=word(table+BigInt(i*8));if(p===0n){controllerStates.push({slot:i,pointer:p,style:0});continue;}plausibleState(p);
  var style=Number(word(p)&0xffffffffn);controllerStates.push({slot:i,pointer:p,style:style});
  kinds(style).forEach(function(kind){var key=i+":"+kind;descriptors.push({key:key,slot:i,nativeId:i<8?i:i===8?32:16,kind:kind,styleBits:style,pointer:p,ring:p+BigInt(offsets[kind]),lastSample:null,stats:{snapshots:0,advances:0,duplicates:0,empty:0,inconsistent:0}});});
 }
 function stableSnapshot(d){
  for(var attempt=0;attempt<3;attempt++){
   var tail=word(d.ring+16n),count=word(d.ring+24n);if(tail>16n||count>17n)fail("Unexpected SixAxis ring header");if(count===0n){d.stats.empty++;return null;}
   var entry=d.ring+32n+tail*104n,before=word(entry),b=bytes(entry+8n,96),after=word(entry),tailAfter=word(d.ring+16n);
   if(before!==after||tail!==tailAfter){stats.retries++;continue;}
   var view=new DataView(b.buffer),delta=BigInt(u32(b,0))|BigInt(u32(b,4))<<32n,sample=BigInt(u32(b,8))|BigInt(u32(b,12))<<32n;
   if(d.lastSample!==null&&sample<d.lastSample)fail("Motion sampling number decreased");if(sample===d.lastSample){d.stats.duplicates++;return null;}
   var acceleration=[],angularVelocity=[],angle=[],direction=[];
   function floats(out,at,n){for(var k=0;k<n;k++){var f=view.getFloat32(at+k*4,true);if(!Number.isFinite(f)||Math.abs(f)>1000000)fail("Implausible stable motion field");out.push(f);}}
   floats(acceleration,16,3);floats(angularVelocity,28,3);floats(angle,40,3);floats(direction,52,9);
   if(d.lastSample!==null)d.stats.advances++;d.lastSample=sample;d.stats.snapshots++;
   return {samplingNumber:sample.toString(),deltaTime:delta.toString(),guard:before.toString(),acceleration:acceleration,angularVelocity:angularVelocity,angle:angle,direction:direction,attributes:view.getUint32(88,true),reserved:view.getUint32(92,true)};
  }stats.inconsistent++;d.stats.inconsistent++;return null;
 }
 return {info:{profile:profile.revision,sdkBase:hex(base),guardSlot:hex(guardSlot),objectSlot:hex(objectSlot),accessorObject:hex(object),table:hex(table),ringOffsets:offsets,units:"raw SDK values; axes/scales/source require hardware validation",activationAttempted:false},stats:stats,
  streams:descriptors.map(function(d){return {key:d.key,slot:d.slot,nativeId:d.nativeId,kind:d.kind,styleBits:d.styleBits,stats:d.stats};}),
  poll:function(){perPoll=0;stats.polls++;
   if(word(guardSlot)!==guard||word(objectSlot)!==object||!(word(guard)&1n)||!(word(object)&1n))fail("Npad accessor changed or became unavailable");
   controllerStates.forEach(function(c){var p=word(table+BigInt(c.slot*8));if(p!==c.pointer)fail("Controller state pointer changed; restart discovery");if(p!==0n&&Number(word(p)&0xffffffffn)!==c.style)fail("Controller style changed; keep this probe setup unchanged");});
   var out=[];descriptors.forEach(function(d){var snapshot=stableSnapshot(d);if(snapshot)out.push({key:d.key,snapshot:snapshot});});return out;
  }
 };
};
