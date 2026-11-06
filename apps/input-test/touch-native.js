// Hash-only compatibility profile; captures reference bytes in the live SDK.
// The accepted contact reader and input adapter are unchanged.
var createCivVerifiedNativeTouch=function(read64,sdkBase){
 "use strict";
 var profile=window.__switchTouchProfile;
 if(typeof read64!=="function"||typeof sdkBase!=="bigint"||sdkBase<0x10000n||sdkBase>0xffffffffffn||sdkBase%4096n||!profile||profile.schema!=="switch-input-touch-profile/1")throw Error("Touch SDK helpers/profile unavailable");
 function capture(address,p){if(!Number.isInteger(p.bytes)||p.bytes<4||p.bytes>512||address<sdkBase||address+BigInt(Math.ceil(p.bytes/8)*8)>sdkBase+BigInt(profile.declaredEndRelative))throw Error("Invalid touch fingerprint extent");var h=0x811c9dc5,s="";for(var i=0;i<p.bytes;i+=8){var w=read64(address+BigInt(i));if(typeof w!=="bigint"||w<0n||w>0xffffffffffffffffn)throw Error("Invalid touch profile read");for(var j=0;j<8&&i+j<p.bytes;j++){var b=Number(w>>BigInt(j*8)&255n);h^=b;h=Math.imul(h,0x01000193)>>>0;s+=b.toString(16).padStart(2,"0");}}if(h.toString(16).padStart(8,"0")!==p.fnv1a)throw Error("Touch SDK fingerprint changed");return s;}
 capture(sdkBase,profile.prefix);var block={label:profile.block.label,relativeOffset:profile.block.relativeOffset,prefixHex:capture(sdkBase+BigInt(profile.block.relativeOffset),profile.block)},base="0x"+sdkBase.toString(16);
 return createCivNativeContacts({read64:read64,sdkBase:sdkBase,audit:{sdkBase:base,blocks:[block],source:"fresh live hash-profile proof; no symbol inventory"},inventory:{modules:[{name:"sdk",base:base,declaredEnd:"0x"+(sdkBase+BigInt(profile.declaredEndRelative)).toString(16)}],source:"fresh live hash-profile proof; no symbol inventory"}});
};
