// The upstream loader's native log buffer is 2048 bytes. Each message below
// is ASCII and less than 1500 bytes including its newline and terminator.
var sendCivInputProReport = async function (report) {
    "use strict";
    var json = JSON.stringify(report).replace(/[^\x20-\x7e]/g, function (char) {
        return "\\u" + ("0000" + char.charCodeAt(0).toString(16)).slice(-4);
    });
    var hash = 2166136261;
    for (var i = 0; i < json.length; i++) {
        hash ^= json.charCodeAt(i);
        hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
    }
    var size = 1400, chunks = Math.ceil(json.length / size);
    await log("CIV_INPUT_PRO_REPORT_BEGIN:" + JSON.stringify({ chars: json.length, chunks: chunks, fnv1a: ("00000000" + hash.toString(16)).slice(-8) }));
    for (var index = 0; index < chunks; index++) await log("CIV_INPUT_PRO_CHUNK:" + index + ":" + json.slice(index * size, (index + 1) * size));
    await log("CIV_INPUT_PRO_REPORT_END:" + chunks);
};

window.__switchInputTestConfig={"maxSeconds":600,"preview":false};
// Local verified-build input bundle. No app, timers or native calls start automatically.
// Derived from accepted SDK code audit, not an address scan or native call.
var createCivNativeContacts = function (options) {
    "use strict";
    var base = options.sdkBase, read = options.read64, audit = options.audit, inventory = options.inventory;
    var name = "_ZN2nn3hid6detail19GetTouchScreenStateILm1EEENS_6ResultEPNS0_16TouchScreenStateIXT_EEE";
    if (typeof base !== "bigint" || typeof read !== "function" || !audit || audit.sdkBase !== "0x" + base.toString(16)) throw Error("Current code audit/SDK base required");
    var sdk = inventory && inventory.modules.filter(function (m) { return m.name === "sdk"; })[0];
    if (!sdk || sdk.base !== audit.sdkBase) throw Error("Current symbol inventory required");
    var block = audit.blocks.filter(function (b) { return b.label === name; })[0];
    if (!block || block.prefixHex.length < 0x8c * 2) throw Error("Audited detail reader code missing");
    var bytes = [];
    for (var i = 0; i < block.prefixHex.length; i += 2) bytes.push(parseInt(block.prefixHex.slice(i, i+2), 16));
    function u32(at) { return (bytes[at] + bytes[at+1]*256 + bytes[at+2]*65536 + bytes[at+3]*16777216) >>> 0; }
    var adrp = u32(0x80), add = u32(0x84), ldar = u32(0x88);
    if (((adrp & 0x9f00001f) >>> 0) !== 0x90000008 || ((add & 0xffc003ff) >>> 0) !== 0x91000108 || ldar !== 0xc8dffd08)
        throw Error("Audited pointer-load instruction pattern differs");
    var pc = base + BigInt(block.relativeOffset) + 0x80n;
    var expected0 = BigInt(adrp) | (BigInt(add) << 32n);
    if (read(pc) !== expected0 || (read(pc+8n) & 0xffffffffn) !== BigInt(ldar)) throw Error("Live reader instructions differ from retained audit");
    var imm = ((adrp >>> 5) & 0x7ffff) * 4 + ((adrp >>> 29) & 3);
    if (imm & 0x100000) imm -= 0x200000;
    var slot = (pc & ~4095n) + BigInt(imm)*4096n + BigInt((add >>> 10) & 4095);
    if (slot < base || slot + 8n > BigInt(sdk.declaredEnd)) throw Error("Derived pointer slot outside SDK extent");
    var ring = read(slot);
    if (typeof ring !== "bigint" || ring < 0x10000n || ring + 0x2c38n > 0x10000000000n || ring % 8n) throw Error("Touch ring pointer is null or implausible; no initialization attempted");
    var previous = Object.create(null), lastSampling = null;
    var stats = { polls: 0, empty: 0, duplicate: 0, inconsistent: 0, retries: 0 };
    function frame() {
        stats.polls++;
        if (read(slot) !== ring) throw Error("Touch ring pointer changed; stopping");
        for (var attempt = 0; attempt < 3; attempt++) {
            var tail = read(ring+16n), available = read(ring+24n);
            if (tail > 16n || available > 17n) throw Error("Unexpected native touch ring header");
            if (available === 0n) { stats.empty++; return null; }
            var entry = ring + 32n + tail*664n;
            var guard = read(entry), sample = read(entry+8n), countWord = read(entry+16n);
            var count = Number(countWord & 0xffffffffn), rows = [], invalid = count > 16;
            if (!invalid) for (var i = 0; i < count; i++) {
                var at = entry + 24n + BigInt(i*40);
                var delta = read(at), attrId = read(at+8n), xy = read(at+16n), diameter = read(at+24n), rotation = read(at+32n);
                rows.push({ id: Number(attrId >> 32n), attributes: Number(attrId & 0xffffffffn),
                    x: Number(xy & 0xffffffffn), y: Number(xy >> 32n),
                    diameterX: Number(diameter & 0xffffffffn), diameterY: Number(diameter >> 32n),
                    rotation: Number(rotation & 0xffffffffn), deltaTime: delta.toString() });
            }
            // The outer write-consistency counter and inner sample number are
            // independent. The audited SDK compares outer-before/outer-after;
            // it never requires outer === inner (observed outer was 2*inner).
            var guardAfter = read(entry), tailAfter = read(ring+16n);
            if (guard !== guardAfter || tail !== tailAfter) {
                stats.retries++; stats.lastInconsistent = { guardBefore: guard.toString(), guardAfter: guardAfter.toString(),
                    sample: sample.toString(), tailBefore: tail.toString(), tailAfter: tailAfter.toString() }; continue;
            }
            if (invalid) throw Error("Stable native contact count exceeds 16");
            if (lastSampling !== null && sample < lastSampling) throw Error("Native sampling number decreased");
            if (sample === lastSampling) { stats.duplicate++; return null; }
            var next = Object.create(null), active = [], started = [], moved = [], ended = [];
            var seen = Object.create(null);
            rows.forEach(function (point) {
                if (seen[point.id]) throw Error("Duplicate native finger ID in stable frame");
                seen[point.id] = true;
                if (point.x > 65535 || point.y > 65535) throw Error("Implausible native touch coordinates");
                if (point.attributes & 2) return; // Public HID End attribute; preserve raw row below.
                next[point.id] = point; active.push(point);
                if (!previous[point.id]) started.push(point.id);
                else if (previous[point.id].x !== point.x || previous[point.id].y !== point.y) moved.push(point.id);
            });
            Object.keys(previous).forEach(function (id) { if (!next[id]) ended.push(Number(id)); });
            previous = next; lastSampling = sample;
            return { samplingNumber: sample.toString(), consistencyCounter: guard.toString(), rawCount: count, rawContacts: rows,
                contacts: active, started: started, moved: moved, ended: ended };
        }
        stats.inconsistent++; return null;
    }
    return { poll: frame, stats: stats, slotRelative: "0x" + (slot-base).toString(16), ringAddress: "0x" + ring.toString(16) };
};

// Local Shell action associations; see README for hardware evidence and limits.
var createCivInputAdapter = function (bus, options) {
    "use strict";
    options = options || {};
    var clock = options.now || Date.now;
    var nativeTouch = options.nativeTouchReader || null;
    if (nativeTouch && typeof nativeTouch.poll !== "function") throw Error("nativeTouchReader.poll required");
    var mapping = {
        accept: "A", cancel: "B", "shell-action-1": "X", "shell-action-2": "Y",
        "shell-action-4": "LStick", "shell-action-3": "RStick", "shell-action-5": "Minus", "sys-menu": "Plus",
        "nav-up": "Up", "nav-down": "Down", "nav-left": "Left", "nav-right": "Right",
        "nav-previous": "L", "nav-next": "R", "nav-shell-previous": "ZL", "nav-shell-next": "ZR"
    };
    var buttons = {}, sticks = { left: { x: 0, y: 0, active: false }, right: { x: 0, y: 0, active: false } };
    var touch = { down: false, x: null, y: null, positionAtMs: null, contactModel: "aggregate-game-gesture" };
    var touchTransitions = [], touchTransitionEvictions = 0;
    if (nativeTouch) {
        touch.contactModel = "native-finger-ids"; touch.valid = false; touch.contacts = [];
        touch.startedIds = []; touch.movedIds = []; touch.endedIds = [];
    }
    var pressed = [], released = [], transitions = [], evictedTransitions = 0;
    var attached = false, total = 0, counts = {}, errors = [], lastEvent = null;
    Object.keys(mapping).forEach(function (key) { buttons[mapping[key]] = false; });
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    function valid(v) { return typeof v === "number" && isFinite(v); }
    function transition(button, down, ms) {
        if (buttons[button] === down) return;
        buttons[button] = down;
        var edges = down ? pressed : released;
        if (edges.indexOf(button) < 0) edges.push(button);
        if (transitions.length >= 128) { transitions.shift(); evictedTransitions++; }
        transitions.push({ button: button, down: down, ms: ms });
    }
    function onAction(name, status, x, y) {
        if (!attached) return;
        try {
            if (typeof name !== "string" || name.length > 100 || !valid(status)) return;
            var ms = clock(); total++;
            if (Object.prototype.hasOwnProperty.call(counts, name)) counts[name]++;
            else if (Object.keys(counts).length < 128) counts[name] = 1;
            lastEvent = { name: name, status: status, x: valid(x) ? x : null, y: valid(y) ? y : null, ms: ms };
            var button = Object.prototype.hasOwnProperty.call(mapping, name) ? mapping[name] : null;
            if (button && (status === 0 || status === 1)) transition(button, status === 0, ms);
            var stick = name === "nav-move" ? sticks.left : name === "scroll-pan" ? sticks.right : null;
            if (stick) {
                if (status === 1) { stick.x = 0; stick.y = 0; stick.active = false; }
                else if ((status === 0 || status === 2 || status === 3) && valid(x) && valid(y)) {
                    stick.x = x; stick.y = y; stick.active = true;
                }
                stick.updatedAtMs = ms;
            }
            if (!nativeTouch && (name === "touch-touch" || name === "touch-tap" ||
                (name === "touch-pan" && (status === 0 || status === 2 || status === 4)))) {
                if (valid(x) && valid(y)) { touch.x = x; touch.y = y; touch.positionAtMs = ms; }
                if (name !== "touch-tap") touch.down = true;
            }
            if (!nativeTouch && (name === "touch-complete" || (name === "touch-pan" && status === 1))) touch.down = false;
        } catch (e) { if (errors.length < 10) errors.push(String(e && e.message || e).slice(0, 120)); }
    }
    function snapshot() {
        return copy({ attached: attached, source: nativeTouch ? "InputAction+native-touch-ring" : "InputAction", buttons: buttons, sticks: sticks, touch: touch,
            pressed: pressed, released: released, transitions: transitions, evictedTransitions: evictedTransitions,
            eventCount: total, actionCounts: counts, lastEvent: lastEvent, errors: errors,
            connectionState: null, independentTouchContacts: nativeTouch && touch.valid ? touch.contacts : null,
            touchTransitions: touchTransitions, touchTransitionEvictions: touchTransitionEvictions });
    }
    function pollTouch() {
        if (!attached) throw Error("Attach adapter before polling native touch");
        if (!nativeTouch) return null;
        var frame;
        try { frame = nativeTouch.poll(); }
        catch (e) {
            touch.valid = false;
            if (errors.length < 10) errors.push("native touch: " + String(e && e.message || e).slice(0, 100));
            throw e;
        }
        if (!frame) return null; // No new consistent frame: do not manufacture a release.
        touch.valid = true; touch.contacts = copy(frame.contacts); touch.down = frame.contacts.length > 0;
        touch.samplingNumber = frame.samplingNumber; touch.updatedAtMs = clock();
        // Legacy x/y mirrors the first active row; independent consumers use contacts.
        if (frame.contacts.length) { touch.x = frame.contacts[0].x; touch.y = frame.contacts[0].y; touch.positionAtMs = touch.updatedAtMs; }
        [["started", "startedIds"], ["moved", "movedIds"], ["ended", "endedIds"]].forEach(function (pair) {
            frame[pair[0]].forEach(function (id) { if (touch[pair[1]].indexOf(id) < 0) touch[pair[1]].push(id); });
        });
        if (frame.started.length || frame.ended.length) {
            if (touchTransitions.length >= 128) { touchTransitions.shift(); touchTransitionEvictions++; }
            touchTransitions.push({ ms: touch.updatedAtMs, started: copy(frame.started), ended: copy(frame.ended), activeIds: frame.contacts.map(function (p) { return p.id; }) });
        }
        return copy(frame);
    }
    return {
        attach: function () {
            if (attached) return;
            if (!bus || typeof bus.on !== "function" || typeof bus.off !== "function") throw Error("engine.on/off required");
            attached = true;
            try { bus.on("InputAction", onAction); } catch (e) { attached = false; throw e; }
        },
        snapshot: snapshot,
        pollTouch: pollTouch,
        drain: function () {
            var result = snapshot(); pressed = []; released = []; transitions = []; touchTransitions = [];
            if (nativeTouch) { touch.startedIds = []; touch.movedIds = []; touch.endedIds = []; }
            return result;
        },
        detach: function () {
            if (!attached) return;
            bus.off("InputAction", onAction); attached = false;
            // This reset is lifecycle cleanup, not a synthesized physical release event.
            Object.keys(buttons).forEach(function (name) { buttons[name] = false; });
            sticks.left = { x: 0, y: 0, active: false }; sticks.right = { x: 0, y: 0, active: false };
            touch.down = false;
            if (nativeTouch) { touch.valid = false; touch.contacts = []; touch.startedIds = []; touch.movedIds = []; touch.endedIds = []; touchTransitions = []; }
        }
    };
};



window.__switchTouchProfile={"schema":"switch-input-touch-profile/1","declaredEndRelative":"0xc15f68","prefix":{"bytes":128,"fnv1a":"bce9207d"},"block":{"label":"_ZN2nn3hid6detail19GetTouchScreenStateILm1EEENS_6ResultEPNS0_16TouchScreenStateIXT_EEE","relativeOffset":"0x4b2980","bytes":360,"fnv1a":"f473c928"}};
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

window.__switchMotionProfiles={"reader":{"schema":"civswitch-motion-reader-profile/1","revision":"audited-sixaxis-v1","sourceAuditSHA256":"7c1b0be6577be30c9eecb948da0212f149a6fd7bc1f596c76a4a0c1950784726","qualification":"Locally audited Switch 1 SDK only; verify retained and live code fingerprints; motion data unvalidated","blocks":[{"role":"generic","relativeOffset":"0x4af3c0","bytes":460,"fnv1a":"24561a0e"},{"role":"left","relativeOffset":"0x4af740","bytes":432,"fnv1a":"3fbdca5e"},{"role":"right","relativeOffset":"0x4af590","bytes":432,"fnv1a":"4e3ca99e"},{"role":"style","relativeOffset":"0x4ad520","bytes":108,"fnv1a":"f213a308"},{"role":"accessor","relativeOffset":"0x4ad3d0","bytes":60,"fnv1a":"d907340e"},{"role":"lookup","relativeOffset":"0x4aca3c","bytes":36,"fnv1a":"c8c5eb56"}]},"activation":{"schema":"civswitch-motion-activation-profile/1","revision":"npad-handheld-start-v1","sourceAuditSHA256":"9252ea236e65bd829d8b174efac3bf2ad9c238cddab49d341bf6c8372e549902","qualification":"Temporary Npad handheld native start/stop only; hardware activation unvalidated","blocks":[{"role":"start","relativeOffset":"0x4b1890","bytes":128,"fnv1a":"21ff4932"},{"role":"stop","relativeOffset":"0x4b1910","bytes":128,"fnv1a":"19a1c25e"},{"role":"handleBuilder","relativeOffset":"0x4bfbc0","bytes":368,"fnv1a":"dc9c16f8"},{"role":"validator","relativeOffset":"0x4bfb80","bytes":60,"fnv1a":"93eacf28"},{"role":"service","relativeOffset":"0x4cfa30","bytes":512,"fnv1a":"880a1228"},{"role":"resourceId","relativeOffset":"0x4bf970","bytes":4,"fnv1a":"8df3490a"}]}};
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

window.__switchRumbleProfile={"schema":"civswitch-rumble-profile/1","revision":"handheld-pulse-v1","sourceAuditSHA256":"897aadcb52e9502e92a525272aafd980522ef1ea221c63b4854f491264fd5057","blocks":[{"role":"builder","relativeOffset":"0x4bfef0","bytes":500,"fnv1a":"7d551722"},{"role":"initialize","relativeOffset":"0x4b6c40","bytes":272,"fnv1a":"4260944d"},{"role":"send","relativeOffset":"0x4b6de0","bytes":80,"fnv1a":"d1007bfd"},{"role":"permitted","relativeOffset":"0x4b6b90","bytes":52,"fnv1a":"2d334248"},{"role":"mounted","relativeOffset":"0x4b6f90","bytes":80,"fnv1a":"f2edd5ce"},{"role":"info","relativeOffset":"0x4b6d70","bytes":104,"fnv1a":"e7ed4322"},{"role":"serviceEnsure","relativeOffset":"0x4b6ae0","bytes":176,"fnv1a":"5836f00a"},{"role":"resourceId","relativeOffset":"0x4bf970","bytes":16,"fnv1a":"cafd5aea"}]};
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

// One bounded transaction per user-triggered pulse; native resources never idle.
var createSwitchRumble=function(o){
 "use strict";
 var active=null,closed=false,attempts=[],count=0,evicted=0,resetCount=0,status="Ready",message="Pick a side. Feel a short pulse.",seen=[false,false],last=null,cleanup=true;
 function record(r){count++;if(attempts.length===12){attempts.splice(6,1);evicted++;}attempts.push(r);last=r;}
 function finish(why,now){if(!active)return;var a=active;active=null;try{a.native.session.close();}catch(e){a.entry.error=String(e&&e.message||e).slice(0,180);}a.entry.stoppedMs=now;a.entry.reason=why;a.entry.native=a.native.session.state;var state=a.entry.native;cleanup=cleanup&&state.zeroed&&state.allocationFreed&&state.errors.length===0;if(!cleanup||a.entry.error){status="Unavailable";message="Could not finish the pulse. See report.";}else{status=why==="completed"?"Pulse sent":"Stopped";message=why==="completed"?"Pulse sent and stopped. Try another side!":"Vibration stopped.";}}
 return {start:function(kind,now){if(closed||active||["left","right","both"].indexOf(kind)<0)return;var entry={kind:kind,startedMs:now,stoppedMs:null,reason:null,error:null,native:null},native;
  record(entry);try{native=o.openNative();entry.profile=native.info;if(!native.session.prepare()){entry.reason="disabled";entry.native=native.session.state;native.session.close();cleanup=cleanup&&entry.native.zeroed&&entry.native.allocationFreed&&entry.native.errors.length===0;status="Disabled";message="Enable Controller Vibration in Settings.";return;}
   active={native:native,entry:entry,end:now+350};status="Pulsing";message=kind==="both"?"Both sides!":kind==="left"?"Left side!":"Right side!";native.session.start(kind==="both"?[0,1]:kind==="left"?[0]:[1]);if(kind!=="right")seen[0]=true;if(kind!=="left")seen[1]=true;
  }catch(e){entry.error=String(e&&e.message||e).slice(0,180);if(active)finish("error",now);else if(native){try{native.session.close();entry.native=native.session.state;cleanup=cleanup&&entry.native.zeroed&&entry.native.allocationFreed&&entry.native.errors.length===0;}catch(_){cleanup=false;}}status="Unavailable";message="Rumble unavailable on this setup.";}},
  tick:function(now){if(!active)return;try{active.native.check();if(now>=active.end)finish("completed",now);}catch(e){active.entry.error=String(e&&e.message||e).slice(0,180);finish("connection changed",now);status="Unavailable";message="Controller setup changed. Pulse stopped.";}},
  cancel:function(now){finish("cancelled",now);},reset:function(now){finish("reset",now);attempts=[];count=0;evicted=0;last=null;seen=[false,false];resetCount++;status="Ready";message="Pick a side. Feel a short pulse.";},
  close:function(now){if(closed)return;finish("app exit",now);closed=true;},
  view:function(){return {status:status,message:message,active:!!active,activeKind:active?active.entry.kind:null,leftSent:seen[0],rightSent:seen[1]};},
  report:function(){return {status:status,attempts:attempts,totalAttempts:count,evicted:evicted,resetCount:resetCount,lastAttempt:last,nativeCleanup:cleanup,limits:{pulseMs:350,amplitude:.45,lowFrequency:160,highFrequency:320,retainedAttempts:12},physicalResult:"Operator observation required; a successful send does not measure perceived vibration"};}
 };
};

// MIT. Counts observations; drawing/touching a button never simulates a press.
var createSwitchInputModel=function(){
 "use strict";
 var names=["A","B","X","Y","Up","Down","Left","Right","L","R","ZL","ZR","Minus","Plus","LStick","RStick"];
 var data,resets=0,active=[];
 function fresh(){var b={};names.forEach(function(n){b[n]={held:false,presses:0,releases:0,pressedAt:null};});return {buttons:b,sticks:{left:stick(),right:stick()},touch:{available:false,contacts:[],maxContacts:0,starts:0,ends:0,independentLift:false,targets:[false,false,false,false,false]},events:[],eventEvictions:0,maxHeld:0,buttonCycles:0,buttonsSeen:0,rawEvents:0,transitionEvictions:0,lastRaw:null,resets:resets};}
 function stick(){return {x:0,y:0,minX:0,maxX:0,minY:0,maxY:0,moved:false,center:false,up:false,down:false,left:false,right:false};}
 function event(ms,text){if(data.events.length>=64){data.events.shift();data.eventEvictions++;}data.events.push({ms:ms,text:text});}
 function counts(){var seen=0,complete=0;names.forEach(function(n){var b=data.buttons[n];if(b.presses)seen++;if(b.presses&&b.releases)complete++;});data.buttonsSeen=seen;data.buttonCycles=complete;}
 data=fresh();
 var targets=[{x:96,y:344},{x:1184,y:344},{x:640,y:462},{x:96,y:592},{x:1184,y:592}];
 return {names:names,targets:targets,update:function(frame,ms){
  (frame.transitions||[]).forEach(function(t){var b=data.buttons[t.button];if(!b)return;b.held=t.down;if(t.down){b.presses++;b.pressedAt=t.ms;event(ms,t.button+" down");}else{b.releases++;b.pressedAt=null;event(ms,t.button+" up");}var held=names.filter(function(n){return data.buttons[n].held;}).length;data.maxHeld=Math.max(data.maxHeld,held);});
  names.forEach(function(n){data.buttons[n].held=!!frame.buttons[n];});
  ["left","right"].forEach(function(name){var raw=frame.sticks[name],s=data.sticks[name];s.x=raw.x;s.y=raw.y;if(raw.updatedAtMs==null)return;
   s.minX=Math.min(s.minX,raw.x);s.maxX=Math.max(s.maxX,raw.x);s.minY=Math.min(s.minY,raw.y);s.maxY=Math.max(s.maxY,raw.y);
   if(Math.abs(raw.x)>.25||Math.abs(raw.y)>.25)s.moved=true;
   if(s.moved&&Math.abs(raw.x)<.12&&Math.abs(raw.y)<.12)s.center=true;
   if(raw.x<-.7)s.left=true;if(raw.x>.7)s.right=true;if(raw.y>.7)s.up=true;if(raw.y<-.7)s.down=true;
  });
  var touch=data.touch;touch.available=Array.isArray(frame.independentTouchContacts);
  if(touch.available){var points=frame.independentTouchContacts;touch.contacts=points.map(function(p){return {id:p.id,x:p.x,y:p.y};});touch.maxContacts=Math.max(touch.maxContacts,points.length);
   (frame.touchTransitions||[]).forEach(function(t){if(t.ended.length&&t.activeIds.some(function(id){return active.indexOf(id)>=0;})&&t.ended.some(function(id){return active.indexOf(id)>=0;}))touch.independentLift=true;
    t.started.forEach(function(id){touch.starts++;event(ms,"Touch "+id+" down");});t.ended.forEach(function(id){touch.ends++;event(ms,"Touch "+id+" up");});active=t.activeIds.slice();
   });active=points.map(function(p){return p.id;});
   points.forEach(function(p){targets.forEach(function(t,i){var dx=p.x-t.x,dy=p.y-t.y;if(dx*dx+dy*dy<=44*44)touch.targets[i]=true;});});
  }else{touch.contacts=[];active=[];}
  data.rawEvents=frame.eventCount;data.transitionEvictions=frame.evictedTransitions+frame.touchTransitionEvictions;data.lastRaw=frame.lastEvent;counts();return data;
 },reset:function(frame,ms){resets++;data=fresh();active=[];names.forEach(function(n){data.buttons[n].held=!!(frame&&frame.buttons[n]);});event(ms,"Coverage reset");return data;},snapshot:function(){return JSON.parse(JSON.stringify(data));}};
};

// Solid Mono outline data. See licenses/Solid-Mono.txt.
var switchSolidMono={"name":"Solid Mono","source":"DejaVu Sans Mono Bold","sourceSha256":"3a3c502eeff669a231549e80df9f7c49de109bafe303170409e905d0b31a38fe","license":"licenses/Solid-Mono.txt","units":2048,"advance":1233,"glyphs":{" ":[],"!":[[[483,283],[750,283],[750,0],[483,0]],[[483,1493],[750,1493],[750,838],[717,481],[518,481],[483,838]]],"\"":[[[999,1493],[999,938],[743,938],[743,1493]],[[487,1493],[487,938],[231,938],[231,1493]]],"#":[[[707,1470],[612,1096],[815,1096],[909,1470],[1133,1470],[1036,1096],[1229,1096],[1229,881],[983,881],[909,588],[1114,588],[1114,373],[856,373],[762,0],[541,0],[635,373],[430,373],[336,0],[115,0],[209,373],[2,373],[2,588],[262,588],[336,881],[117,881],[117,1096],[391,1096],[485,1470]],[[762,881],[557,881],[483,588],[688,588]]],"$":[[[694,528],[694,226],[750,243],[792,274],[818,319],[827,375],[818,431],[792,476],[751,509]],[[553,817],[553,1100],[499,1086],[460,1058],[436,1019],[428,967],[436,915],[460,872],[499,839]],[[694,-301],[553,-301],[552,0],[463,8],[370,26],[273,54],[172,92],[172,354],[273,300],[372,260],[465,235],[553,226],[553,555],[461,578],[381,608],[314,645],[260,690],[218,741],[188,800],[170,867],[164,942],[170,1021],[190,1092],[221,1154],[266,1208],[322,1252],[389,1285],[466,1308],[553,1319],[553,1556],[694,1556],[695,1319],[842,1301],[999,1262],[999,1006],[934,1042],[861,1070],[781,1090],[694,1100],[694,793],[786,773],[867,744],[935,706],[992,658],[1035,602],[1067,538],[1086,465],[1092,383],[1085,305],[1065,234],[1031,170],[984,114],[925,68],[857,33],[781,10],[695,0]]],"%":[[[33,1112],[39,1176],[56,1236],[85,1290],[126,1339],[175,1380],[229,1409],[288,1426],[352,1432],[416,1426],[475,1409],[529,1379],[578,1338],[619,1289],[649,1235],[666,1176],[672,1112],[666,1048],[649,989],[619,935],[578,886],[529,845],[475,816],[416,799],[352,793],[288,799],[229,816],[175,845],[126,886],[85,934],[56,988],[39,1048]],[[352,1249],[299,1239],[255,1210],[225,1165],[215,1112],[225,1059],[255,1014],[299,985],[352,975],[405,985],[450,1014],[479,1059],[489,1112],[479,1165],[449,1209],[405,1239]],[[86,561],[1128,979],[1169,883],[121,465]],[[580,319],[586,383],[603,443],[632,497],[672,546],[721,587],[775,616],[835,633],[899,639],[963,633],[1022,616],[1076,586],[1125,546],[1166,496],[1196,442],[1213,383],[1219,319],[1213,255],[1196,197],[1166,143],[1125,94],[1076,53],[1022,23],[963,6],[899,0],[835,6],[775,23],[721,52],[672,92],[632,141],[603,195],[586,255]],[[897,457],[845,447],[802,417],[772,372],[762,319],[772,266],[801,222],[844,192],[897,182],[951,192],[996,222],[1026,266],[1036,319],[1026,372],[995,416],[950,447]]],"&":[[[870,72],[793,28],[710,-4],[625,-23],[539,-29],[432,-21],[336,4],[251,45],[176,102],[115,172],[72,252],[46,342],[37,442],[41,513],[55,580],[77,645],[108,706],[147,764],[195,817],[252,867],[317,913],[274,988],[243,1058],[225,1122],[219,1184],[226,1260],[246,1327],[280,1385],[328,1433],[389,1471],[461,1498],[546,1515],[643,1520],[786,1509],[924,1477],[924,1221],[860,1253],[794,1276],[729,1289],[664,1294],[594,1287],[543,1266],[512,1232],[502,1184],[510,1141],[532,1085],[572,1012],[631,920],[944,440],[976,527],[987,633],[985,692],[979,745],[1214,745],[1214,694],[1206,558],[1180,440],[1136,338],[1073,246],[1235,0],[918,0]],[[440,731],[382,684],[340,628],[315,566],[307,496],[312,437],[327,384],[351,335],[386,290],[427,254],[473,228],[523,212],[578,207],[636,214],[693,232],[701,236],[748,262]]],"'":[[[743,1493],[743,938],[487,938],[487,1493]]],"(":[[[924,1554],[862,1435],[809,1319],[764,1204],[728,1091],[700,979],[680,867],[668,755],[664,643],[668,532],[680,420],[700,308],[728,196],[764,82],[809,-34],[862,-151],[924,-270],[696,-270],[622,-155],[558,-41],[504,73],[460,186],[426,298],[402,412],[388,527],[383,643],[388,759],[402,873],[427,987],[460,1100],[504,1213],[558,1327],[622,1440],[696,1554]]],")":[[[309,1554],[537,1554],[611,1440],[675,1327],[729,1213],[772,1100],[806,987],[831,873],[845,759],[850,643],[845,527],[831,412],[807,298],[773,186],[729,73],[676,-41],[611,-155],[537,-270],[309,-270],[371,-151],[424,-34],[469,82],[505,196],[533,308],[553,420],[565,532],[569,643],[565,755],[553,867],[533,979],[505,1091],[469,1204],[424,1319],[371,1435]]],"*":[[[1108,1217],[778,1044],[1108,870],[1032,729],[700,913],[700,569],[528,569],[528,913],[197,729],[121,870],[453,1044],[121,1217],[197,1358],[528,1176],[528,1520],[700,1520],[700,1176],[1032,1358]]],"+":[[[735,1192],[735,762],[1165,762],[1165,524],[735,524],[735,92],[498,92],[498,524],[66,524],[66,762],[498,762],[498,1192]]],",":[[[461,367],[774,367],[774,96],[578,-287],[362,-287],[461,96]]],"-":[[[301,735],[932,735],[932,444],[301,444]]],".":[[[449,367],[782,367],[782,0],[449,0]]],"/":[[[899,1493],[1120,1493],[334,-190],[113,-190]]],"0":[[[492,745],[501,794],[528,834],[568,861],[616,870],[665,861],[705,834],[732,794],[741,745],[732,697],[705,657],[665,630],[616,621],[568,630],[528,656],[501,696]],[[616,1270],[568,1262],[528,1239],[494,1200],[467,1145],[446,1073],[432,982],[423,873],[420,745],[423,617],[432,508],[446,418],[467,346],[494,291],[528,252],[568,229],[616,221],[664,229],[705,252],[739,291],[766,346],[787,418],[801,508],[810,617],[813,745],[810,873],[801,982],[787,1073],[766,1145],[739,1200],[705,1239],[664,1262]],[[123,745],[125,839],[131,927],[140,1009],[154,1084],[171,1154],[192,1218],[217,1275],[246,1326],[279,1372],[315,1411],[356,1444],[400,1472],[448,1493],[500,1508],[556,1517],[616,1520],[676,1517],[732,1508],[784,1493],[833,1472],[877,1445],[918,1411],[954,1372],[987,1327],[1016,1276],[1041,1218],[1062,1155],[1079,1085],[1093,1009],[1102,927],[1108,839],[1110,745],[1108,651],[1102,563],[1093,481],[1079,406],[1062,336],[1041,273],[1016,215],[987,164],[954,119],[918,80],[877,46],[833,19],[784,-2],[732,-17],[676,-26],[616,-29],[556,-26],[500,-17],[448,-2],[400,19],[356,47],[315,80],[279,119],[246,164],[217,216],[192,273],[171,337],[154,406],[140,482],[131,564],[125,651]]],"1":[[[188,260],[518,260],[518,1229],[211,1153],[211,1419],[520,1493],[805,1493],[805,260],[1135,260],[1135,0],[188,0]]],"2":[[[434,260],[1063,260],[1063,0],[115,0],[115,252],[275,422],[343,494],[404,559],[457,616],[504,667],[544,710],[576,745],[602,774],[621,795],[686,876],[729,948],[754,1014],[762,1079],[758,1126],[747,1168],[728,1203],[702,1234],[668,1257],[628,1274],[582,1285],[530,1288],[446,1280],[352,1256],[252,1218],[147,1165],[147,1440],[253,1474],[356,1500],[457,1515],[553,1520],[665,1513],[765,1492],[851,1458],[926,1410],[985,1349],[1027,1279],[1053,1198],[1061,1108],[1054,1023],[1032,943],[991,862],[930,772],[892,727],[831,662],[746,574],[639,466],[578,405],[523,350],[475,302]]],"3":[[[549,668],[391,668],[391,928],[549,928],[601,931],[647,939],[686,952],[720,972],[746,995],[765,1024],[776,1057],[780,1094],[776,1133],[765,1168],[746,1198],[720,1224],[686,1244],[647,1258],[601,1267],[549,1270],[462,1265],[369,1249],[271,1223],[170,1188],[170,1456],[272,1483],[373,1504],[471,1516],[565,1520],[676,1514],[775,1494],[860,1462],[933,1417],[991,1361],[1032,1294],[1057,1219],[1065,1133],[1060,1070],[1046,1012],[1022,961],[989,916],[947,877],[897,846],[838,822],[772,805],[847,787],[913,759],[969,723],[1016,678],[1053,624],[1079,562],[1095,493],[1100,416],[1091,314],[1065,225],[1022,148],[961,85],[884,35],[790,0],[682,-22],[557,-29],[445,-24],[334,-10],[227,13],[125,45],[125,319],[223,278],[328,248],[440,229],[557,223],[614,226],[664,237],[709,254],[747,278],[778,309],[800,344],[813,383],[817,428],[813,482],[800,530],[778,571],[747,606],[708,633],[662,652],[609,664]]],"4":[[[694,1165],[317,575],[694,575]],[[668,1493],[977,1493],[977,575],[1141,575],[1141,322],[977,322],[977,0],[694,0],[694,322],[102,322],[102,608]]],"5":[[[193,1493],[1004,1493],[1004,1233],[432,1233],[432,956],[509,976],[596,983],[702,974],[797,948],[882,904],[956,843],[1016,768],[1060,682],[1085,586],[1094,479],[1085,368],[1057,269],[1010,182],[944,108],[863,48],[768,5],[659,-20],[537,-29],[440,-25],[343,-13],[244,7],[143,35],[143,301],[227,265],[314,240],[401,224],[489,219],[562,223],[626,236],[681,256],[726,286],[761,323],[787,367],[802,419],[807,479],[802,535],[787,584],[762,628],[726,666],[683,697],[633,719],[576,733],[512,737],[433,732],[354,718],[274,693],[193,659]]],"6":[[[643,748],[598,744],[558,731],[525,709],[496,678],[474,640],[459,593],[449,539],[446,477],[449,415],[459,361],[474,315],[496,276],[525,246],[558,224],[598,211],[643,207],[688,211],[728,224],[762,246],[790,276],[813,315],[829,361],[839,415],[842,477],[839,539],[829,593],[813,639],[790,678],[762,709],[728,730],[688,744]],[[1030,1458],[1030,1190],[953,1229],[878,1258],[807,1274],[739,1280],[664,1273],[598,1253],[542,1220],[496,1172],[459,1112],[432,1039],[415,954],[408,855],[462,912],[528,952],[608,977],[700,985],[795,977],[879,953],[951,913],[1012,858],[1060,787],[1094,703],[1115,606],[1122,496],[1114,378],[1091,273],[1053,183],[998,107],[930,47],[850,4],[757,-22],[651,-31],[524,-20],[415,15],[326,72],[254,152],[226,201],[200,258],[179,321],[162,391],[148,469],[139,553],[133,645],[131,743],[133,837],[140,925],[152,1007],[169,1082],[190,1152],[216,1216],[247,1273],[282,1324],[322,1370],[367,1409],[416,1442],[471,1470],[530,1491],[593,1506],[662,1515],[735,1518],[806,1514],[880,1503],[954,1484]]],"7":[[[135,1493],[1079,1493],[1079,1284],[573,0],[272,0],[758,1233],[135,1233]]],"8":[[[616,666],[569,662],[526,650],[489,631],[456,604],[429,570],[410,531],[399,487],[395,438],[399,389],[410,345],[429,306],[456,272],[489,244],[526,225],[569,213],[616,209],[663,213],[706,225],[743,245],[776,273],[803,307],[823,346],[834,390],[838,438],[834,487],[823,531],[804,570],[777,604],[744,631],[706,650],[664,662]],[[397,791],[344,813],[298,841],[258,875],[225,914],[199,958],[181,1006],[170,1060],[166,1118],[174,1206],[196,1284],[234,1353],[287,1412],[353,1459],[430,1493],[517,1513],[616,1520],[715,1513],[803,1493],[880,1459],[946,1412],[999,1353],[1037,1284],[1059,1206],[1067,1118],[1063,1060],[1052,1007],[1034,959],[1009,914],[977,875],[938,842],[892,814],[840,791],[899,768],[950,738],[996,700],[1034,655],[1065,604],[1086,547],[1100,486],[1104,420],[1096,319],[1072,230],[1033,153],[977,88],[907,37],[823,0],[726,-22],[616,-29],[506,-22],[410,0],[326,37],[256,88],[200,153],[161,230],[137,319],[129,420],[133,486],[147,548],[169,604],[200,656],[239,701],[285,739],[337,769]],[[428,1094],[431,1052],[441,1015],[456,983],[478,954],[506,932],[538,916],[575,906],[616,903],[658,906],[695,916],[727,932],[754,954],[777,983],[792,1015],[802,1052],[805,1094],[802,1135],[792,1172],[777,1204],[754,1232],[727,1254],[695,1269],[658,1279],[616,1282],[575,1279],[539,1269],[507,1253],[479,1231],[457,1203],[441,1171],[431,1135]]],"9":[[[203,20],[203,289],[280,249],[354,221],[426,204],[494,199],[569,206],[634,226],[690,259],[736,306],[773,365],[800,438],[818,525],[825,624],[772,567],[705,526],[625,502],[532,494],[437,502],[354,526],[282,566],[221,622],[173,692],[138,776],[118,873],[111,983],[119,1101],[142,1205],[180,1294],[234,1370],[302,1430],[382,1473],[476,1498],[582,1507],[709,1496],[818,1461],[907,1404],[978,1324],[1007,1275],[1033,1219],[1054,1156],[1071,1086],[1085,1009],[1094,924],[1100,833],[1102,735],[1100,641],[1093,554],[1081,472],[1064,396],[1043,327],[1017,263],[986,206],[951,154],[911,109],[866,70],[817,37],[762,9],[703,-12],[640,-27],[571,-36],[498,-39],[427,-35],[354,-24],[279,-6]],[[590,741],[635,745],[674,758],[707,780],[736,810],[758,849],[773,896],[783,950],[786,1012],[783,1074],[773,1128],[758,1174],[736,1212],[707,1243],[674,1265],[635,1278],[590,1282],[545,1278],[505,1265],[471,1243],[442,1212],[420,1174],[404,1128],[394,1074],[391,1012],[394,950],[404,896],[420,850],[442,811],[471,780],[505,758],[545,745]]],":":[[[449,1063],[782,1063],[782,698],[449,698]],[[449,367],[782,367],[782,0],[449,0]]],";":[[[449,367],[782,367],[782,96],[586,-287],[371,-287],[449,96]],[[449,1063],[782,1063],[782,698],[449,698]]],"<":[[[1145,926],[350,641],[1145,358],[1145,109],[88,524],[88,760],[1145,1176]]],"=":[[[88,532],[1145,532],[1145,295],[88,295]],[[88,987],[1145,987],[1145,752],[88,752]]],">":[[[88,926],[88,1176],[1145,760],[1145,524],[88,109],[88,358],[883,641]]],"?":[[[440,283],[707,283],[707,0],[440,0]],[[707,401],[440,401],[440,555],[448,647],[471,724],[490,760],[514,796],[545,834],[582,872],[672,961],[725,1017],[758,1062],[774,1103],[780,1145],[768,1204],[734,1246],[676,1272],[596,1280],[510,1271],[420,1244],[328,1200],[233,1139],[233,1407],[332,1456],[432,1492],[532,1513],[633,1520],[729,1514],[813,1496],[887,1467],[950,1426],[1000,1375],[1036,1314],[1058,1245],[1065,1167],[1056,1094],[1031,1026],[1010,991],[982,953],[946,912],[903,868],[815,782],[784,750],[759,722],[741,696],[728,674],[714,627],[709,571],[708,550],[707,524]]],"@":[[[973,545],[970,598],[960,646],[944,687],[922,722],[894,750],[862,770],[824,782],[782,786],[740,782],[703,770],[670,750],[642,722],[620,687],[605,646],[595,598],[592,545],[595,491],[605,444],[620,402],[642,367],[670,339],[703,319],[740,307],[782,303],[824,307],[862,319],[894,339],[922,367],[944,402],[960,444],[970,491]],[[1159,135],[963,135],[963,217],[922,171],[874,140],[817,121],[750,115],[672,122],[602,144],[540,181],[486,233],[442,297],[410,370],[391,453],[385,545],[391,637],[410,719],[441,792],[485,856],[539,907],[601,944],[672,966],[750,973],[817,967],[875,948],[924,918],[963,877],[963,918],[958,982],[944,1038],[921,1087],[888,1128],[847,1160],[798,1184],[741,1197],[676,1202],[577,1191],[487,1156],[407,1099],[336,1019],[279,921],[238,808],[213,683],[205,543],[214,397],[243,267],[290,153],[357,54],[439,-25],[534,-82],[642,-116],[762,-127],[841,-121],[917,-104],[990,-74],[1061,-33],[1153,-209],[1068,-257],[976,-292],[878,-312],[772,-319],[687,-315],[606,-304],[529,-286],[458,-261],[390,-228],[327,-188],[268,-141],[214,-86],[165,-25],[123,41],[87,112],[58,188],[35,269],[19,355],[9,447],[6,543],[18,727],[53,891],[111,1037],[193,1162],[242,1217],[294,1264],[350,1304],[410,1337],[474,1362],[542,1380],[613,1391],[688,1395],[791,1387],[883,1362],[964,1321],[1032,1264],[1088,1192],[1127,1108],[1151,1013],[1159,905]]],"A":[[[616,1223],[477,612],[756,612]],[[436,1493],[797,1493],[1200,0],[905,0],[813,369],[418,369],[328,0],[33,0]]],"B":[[[410,678],[410,236],[606,236],[671,239],[726,248],[770,263],[804,284],[828,312],[846,350],[856,396],[860,451],[856,507],[845,555],[827,594],[801,625],[767,648],[723,665],[669,675],[606,678]],[[410,1260],[410,913],[606,913],[658,916],[702,923],[738,936],[766,953],[786,976],[801,1006],[810,1042],[813,1085],[810,1128],[801,1164],[786,1195],[764,1218],[736,1237],[701,1250],[657,1257],[606,1260]],[[125,1495],[606,1495],[723,1489],[824,1471],[910,1442],[980,1400],[1035,1347],[1075,1283],[1098,1206],[1106,1118],[1101,1050],[1088,990],[1064,937],[1032,893],[991,857],[941,829],[882,810],[815,799],[895,785],[965,762],[1024,728],[1072,684],[1110,630],[1137,566],[1154,493],[1159,410],[1151,309],[1126,224],[1086,153],[1029,97],[954,55],[858,24],[742,6],[606,0],[125,0]]],"C":[[[1081,43],[1009,12],[934,-11],[855,-24],[772,-29],[699,-26],[630,-17],[566,-1],[506,21],[450,49],[399,83],[353,123],[311,170],[241,281],[192,413],[162,568],[152,745],[162,922],[192,1078],[241,1210],[311,1321],[353,1368],[399,1408],[450,1442],[506,1470],[566,1492],[630,1508],[699,1517],[772,1520],[855,1516],[935,1502],[1010,1480],[1081,1448],[1081,1120],[1006,1181],[934,1222],[861,1247],[786,1255],[710,1247],[644,1223],[588,1183],[542,1126],[505,1054],[480,967],[464,864],[459,745],[464,627],[480,524],[505,436],[542,364],[588,308],[644,268],[710,244],[786,236],[861,244],[934,268],[1006,310],[1081,371]]],"D":[[[432,1227],[432,266],[512,266],[593,273],[661,293],[717,328],[760,376],[792,440],[816,523],[829,626],[834,748],[829,869],[816,971],[792,1054],[760,1118],[717,1166],[661,1200],[593,1220],[512,1227]],[[137,1493],[453,1493],[541,1490],[623,1482],[699,1468],[768,1449],[830,1425],[887,1395],[937,1359],[980,1318],[1018,1271],[1050,1217],[1078,1156],[1101,1089],[1118,1014],[1131,932],[1138,844],[1141,748],[1138,652],[1131,563],[1118,481],[1101,406],[1078,338],[1050,277],[1018,223],[980,176],[937,134],[887,99],[830,69],[768,44],[699,25],[623,11],[541,3],[453,0],[137,0]]],"E":[[[1098,0],[168,0],[168,1493],[1098,1493],[1098,1233],[463,1233],[463,911],[1038,911],[1038,651],[463,651],[463,260],[1098,260]]],"F":[[[1112,1233],[477,1233],[477,911],[1055,911],[1055,651],[477,651],[477,0],[182,0],[182,1493],[1112,1493]]],"G":[[[872,270],[872,555],[670,555],[670,803],[1130,803],[1130,119],[1041,55],[942,8],[836,-20],[723,-29],[653,-26],[586,-16],[524,-1],[466,21],[412,50],[362,84],[317,125],[275,172],[206,284],[156,416],[127,570],[117,745],[127,922],[157,1078],[207,1210],[276,1321],[319,1368],[365,1408],[416,1442],[471,1470],[531,1492],[595,1508],[664,1517],[737,1520],[826,1514],[914,1494],[998,1463],[1077,1421],[1077,1094],[1010,1164],[934,1214],[850,1245],[758,1255],[679,1247],[611,1223],[554,1184],[507,1128],[471,1057],[445,969],[429,865],[424,745],[429,628],[444,526],[469,438],[504,366],[549,309],[602,268],[665,244],[737,236],[817,244],[848,255]]],"H":[[[137,1493],[432,1493],[432,924],[801,924],[801,1493],[1096,1493],[1096,0],[801,0],[801,664],[432,664],[432,0],[137,0]]],"I":[[[172,1233],[172,1493],[1061,1493],[1061,1233],[764,1233],[764,260],[1061,260],[1061,0],[172,0],[172,260],[469,260],[469,1233]]],"J":[[[109,74],[109,416],[198,338],[292,282],[390,248],[489,236],[543,240],[590,250],[628,269],[659,294],[683,327],[700,369],[710,420],[713,479],[713,1233],[352,1233],[352,1493],[1008,1493],[1008,479],[1001,352],[979,245],[944,157],[894,88],[827,37],[742,0],[638,-22],[516,-29],[419,-22],[318,-3],[214,29]]],"K":[[[117,1493],[412,1493],[412,903],[874,1493],[1208,1493],[737,905],[1225,0],[897,0],[543,672],[412,506],[412,0],[117,0]]],"L":[[[225,0],[225,1493],[520,1493],[520,260],[1151,260],[1151,0]]],"M":[[[86,1493],[438,1493],[616,838],[793,1493],[1147,1493],[1147,0],[893,0],[893,1196],[735,543],[500,543],[340,1196],[340,0],[86,0]]],"N":[[[119,1493],[436,1493],[852,408],[852,1493],[1112,1493],[1112,0],[797,0],[379,1085],[379,0],[119,0]]],"O":[[[616,1255],[563,1247],[518,1225],[481,1187],[451,1134],[428,1065],[412,977],[402,870],[399,745],[402,620],[412,514],[428,426],[451,356],[481,304],[518,266],[563,244],[616,236],[669,244],[714,266],[752,304],[782,356],[805,426],[821,514],[831,620],[834,745],[831,870],[821,977],[805,1065],[782,1134],[752,1187],[714,1225],[669,1247]],[[92,745],[100,925],[125,1081],[167,1214],[224,1324],[260,1370],[299,1410],[342,1443],[389,1471],[440,1492],[494,1508],[553,1517],[616,1520],[679,1517],[738,1508],[793,1492],[844,1471],[891,1443],[934,1410],[973,1370],[1008,1324],[1066,1214],[1108,1081],[1133,925],[1141,745],[1133,566],[1108,410],[1066,277],[1008,167],[973,121],[934,81],[891,48],[844,20],[793,-1],[738,-17],[679,-26],[616,-29],[553,-26],[494,-17],[440,-1],[389,20],[342,48],[299,81],[260,121],[224,167],[167,277],[125,410],[100,566]]],"P":[[[457,1245],[457,807],[578,807],[645,810],[701,819],[747,835],[782,856],[807,885],[825,923],[836,970],[840,1026],[836,1082],[825,1129],[807,1167],[782,1196],[747,1217],[701,1233],[645,1242],[578,1245]],[[162,1493],[567,1493],[711,1486],[833,1466],[933,1431],[1012,1383],[1071,1319],[1113,1239],[1139,1141],[1147,1026],[1139,911],[1113,813],[1071,733],[1012,669],[933,621],[833,586],[711,566],[567,559],[457,559],[457,0],[162,0]]],"Q":[[[656,-23],[632,-28],[614,-29],[552,-26],[493,-17],[439,-1],[388,20],[341,48],[299,81],[260,121],[224,167],[167,277],[125,410],[100,566],[92,745],[100,925],[125,1081],[167,1214],[224,1324],[260,1370],[299,1410],[342,1443],[389,1471],[440,1492],[494,1508],[553,1517],[616,1520],[679,1517],[738,1508],[793,1492],[844,1471],[891,1443],[934,1410],[973,1370],[1008,1324],[1066,1214],[1108,1081],[1133,925],[1141,745],[1137,619],[1125,503],[1106,399],[1078,304],[1043,222],[1001,152],[951,95],[895,51],[1081,-131],[879,-281]],[[616,1255],[563,1247],[518,1225],[481,1187],[451,1134],[428,1065],[412,977],[402,870],[399,745],[402,620],[412,514],[428,426],[451,356],[481,304],[518,266],[563,244],[616,236],[669,244],[714,266],[752,304],[782,356],[805,426],[821,514],[831,620],[834,745],[831,870],[821,977],[805,1065],[782,1134],[752,1187],[714,1225],[669,1247]]],"R":[[[807,705],[848,690],[884,664],[901,643],[920,616],[940,580],[963,537],[1233,0],[909,0],[729,377],[708,421],[667,495],[622,548],[574,579],[522,590],[428,590],[428,0],[133,0],[133,1493],[559,1493],[693,1487],[806,1468],[900,1436],[972,1391],[1027,1332],[1067,1257],[1090,1166],[1098,1059],[1093,986],[1079,921],[1056,863],[1023,814],[981,773],[932,741],[873,719]],[[428,1245],[428,838],[567,838],[623,841],[671,850],[710,865],[740,886],[763,913],[780,948],[790,991],[793,1042],[790,1093],[780,1136],[764,1171],[741,1198],[711,1219],[672,1233],[624,1242],[567,1245]]],"S":[[[510,655],[408,698],[323,742],[256,787],[208,834],[173,884],[149,943],[134,1010],[129,1085],[137,1181],[162,1266],[202,1341],[259,1404],[330,1455],[413,1491],[509,1513],[616,1520],[719,1514],[822,1496],[924,1467],[1026,1427],[1026,1139],[930,1198],[833,1241],[736,1267],[639,1276],[589,1273],[544,1265],[507,1252],[475,1233],[450,1209],[432,1181],[422,1148],[418,1110],[428,1053],[460,1008],[486,987],[524,965],[573,942],[633,918],[760,870],[844,834],[916,793],[977,747],[1025,695],[1062,637],[1089,572],[1105,499],[1110,420],[1102,314],[1077,223],[1035,145],[976,82],[901,34],[809,-1],[699,-22],[573,-29],[462,-22],[350,-2],[241,30],[135,76],[135,381],[251,308],[364,256],[473,225],[582,215],[633,218],[679,227],[718,243],[751,264],[777,292],[796,324],[807,361],[811,403],[801,466],[771,520],[722,566],[655,600]]],"T":[[[764,0],[469,0],[469,1235],[90,1235],[90,1493],[1143,1493],[1143,1235],[764,1235]]],"U":[[[106,551],[106,1493],[401,1493],[401,477],[405,424],[415,377],[433,336],[458,302],[489,274],[526,254],[568,242],[616,238],[664,242],[706,254],[743,274],[774,302],[799,336],[817,377],[827,424],[831,477],[831,1493],[1126,1493],[1126,551],[1118,409],[1096,288],[1058,188],[1005,109],[935,49],[847,6],[741,-20],[616,-29],[492,-20],[385,6],[297,49],[228,109],[174,188],[136,288],[114,409]]],"V":[[[616,246],[879,1493],[1176,1493],[821,0],[412,0],[57,1493],[354,1493]]],"W":[[[0,1493],[258,1493],[365,397],[494,1106],[739,1106],[889,397],[973,1493],[1233,1493],[1061,0],[786,0],[616,784],[457,0],[184,0]]],"X":[[[1206,0],[901,0],[616,494],[332,0],[27,0],[465,758],[39,1493],[344,1493],[616,1018],[889,1493],[1194,1493],[770,758]]],"Y":[[[8,1493],[326,1493],[616,893],[907,1493],[1225,1493],[764,588],[764,0],[469,0],[469,588]]],"Z":[[[137,1493],[1147,1493],[1147,1249],[455,260],[1161,260],[1161,0],[115,0],[115,244],[786,1233],[137,1233]]],"[":[[[422,1556],[930,1556],[930,1366],[688,1366],[688,-80],[930,-80],[930,-270],[422,-270]]],"\\":[[[334,1493],[1120,-190],[897,-190],[111,1493]]],"]":[[[811,1556],[811,-270],[303,-270],[303,-80],[545,-80],[545,1366],[303,1366],[303,1556]]],"^":[[[739,1493],[1176,936],[934,936],[616,1237],[299,936],[57,936],[494,1493]]],"_":[[[1233,-293],[1233,-483],[0,-483],[0,-293]]],"`":[[[481,1638],[764,1262],[567,1262],[199,1638]]],"a":[[[700,526],[624,523],[561,516],[510,502],[471,484],[443,459],[422,427],[410,387],[406,340],[417,272],[451,219],[504,185],[573,174],[628,179],[676,196],[718,223],[753,262],[781,310],[801,366],[813,432],[817,506],[817,526]],[[1108,639],[1108,0],[817,0],[817,125],[756,60],[681,11],[594,-19],[498,-29],[408,-23],[328,-4],[259,28],[200,72],[154,128],[121,193],[101,268],[94,354],[102,446],[126,524],[165,590],[221,644],[293,684],[383,714],[490,731],[614,737],[817,737],[817,786],[814,819],[804,848],[788,873],[766,894],[737,909],[702,921],[661,928],[614,930],[511,923],[410,904],[310,869],[205,819],[205,1069],[303,1104],[402,1128],[505,1142],[614,1147],[740,1140],[846,1119],[932,1085],[998,1036],[1046,970],[1080,881],[1101,771]]],"b":[[[850,557],[847,634],[836,702],[820,761],[796,811],[766,851],[732,880],[692,897],[647,903],[602,897],[562,880],[527,851],[497,811],[473,761],[456,702],[445,634],[442,557],[445,480],[456,412],[473,353],[497,303],[527,263],[562,234],[602,217],[647,211],[692,217],[732,234],[766,263],[796,303],[820,353],[836,412],[847,480]],[[442,961],[500,1042],[568,1100],[644,1135],[729,1147],[823,1138],[905,1109],[976,1062],[1036,995],[1083,911],[1116,810],[1136,693],[1143,559],[1136,427],[1116,310],[1083,210],[1037,125],[979,58],[910,10],[830,-19],[739,-29],[690,-26],[644,-17],[602,-1],[563,20],[495,81],[442,166],[442,0],[150,0],[150,1556],[442,1556]]],"c":[[[1061,57],[984,19],[902,-8],[814,-24],[719,-29],[597,-19],[488,10],[394,59],[314,127],[250,212],[204,313],[177,428],[168,559],[177,690],[205,806],[251,907],[315,992],[396,1061],[490,1110],[598,1139],[721,1149],[809,1144],[894,1128],[978,1101],[1061,1063],[1061,795],[994,844],[920,880],[843,902],[762,909],[695,903],[636,886],[585,858],[542,818],[508,768],[484,708],[470,638],[465,559],[470,480],[484,410],[508,351],[542,301],[585,262],[636,234],[695,217],[762,211],[844,218],[921,240],[993,275],[1061,326]]],"d":[[[791,961],[791,1556],[1083,1556],[1083,0],[791,0],[791,166],[737,81],[670,20],[631,-1],[588,-17],[543,-26],[494,-29],[403,-19],[324,10],[254,58],[196,125],[150,210],[116,310],[97,427],[90,559],[97,693],[117,810],[150,911],[198,995],[257,1062],[328,1109],[410,1138],[504,1147],[589,1135],[666,1100],[733,1042]],[[383,557],[386,480],[396,412],[413,353],[437,303],[467,263],[501,234],[541,217],[586,211],[631,217],[671,234],[706,263],[736,303],[760,353],[777,412],[788,480],[791,557],[788,634],[777,702],[760,761],[736,811],[706,851],[671,880],[631,897],[586,903],[541,897],[501,880],[467,851],[437,811],[413,761],[396,702],[386,634]]],"e":[[[1102,55],[999,18],[894,-8],[785,-24],[670,-29],[538,-20],[422,9],[323,56],[240,122],[176,205],[129,305],[101,422],[92,555],[101,685],[128,800],[172,901],[235,988],[313,1058],[404,1107],[508,1137],[625,1147],[743,1138],[846,1110],[936,1064],[1012,1000],[1072,918],[1115,822],[1140,710],[1149,584],[1149,465],[390,465],[395,403],[410,350],[434,305],[468,268],[511,240],[564,219],[626,207],[698,203],[798,210],[897,232],[997,270],[1102,324]],[[854,685],[850,739],[838,787],[820,827],[794,860],[762,887],[723,905],[678,916],[625,920],[577,916],[534,905],[497,885],[464,858],[437,825],[416,784],[402,737],[393,684]]],"f":[[[739,1218],[739,1120],[1083,1120],[1083,895],[739,895],[739,0],[446,0],[446,895],[174,895],[174,1120],[446,1120],[446,1198],[451,1291],[467,1369],[493,1431],[530,1478],[581,1512],[650,1536],[737,1551],[842,1556],[1083,1556],[1083,1331],[854,1331],[799,1325],[764,1307],[746,1273]]],"g":[[[803,578],[799,649],[789,713],[771,770],[746,818],[715,858],[680,886],[640,903],[596,909],[552,903],[513,886],[478,858],[448,819],[423,770],[405,714],[395,650],[391,578],[395,506],[405,442],[423,385],[448,336],[478,297],[513,268],[552,252],[596,246],[640,252],[680,269],[715,297],[746,336],[771,386],[789,442],[799,506]],[[1096,84],[1088,-41],[1066,-148],[1028,-235],[974,-304],[904,-357],[815,-394],[707,-417],[580,-424],[488,-421],[398,-410],[307,-393],[215,-369],[215,-100],[299,-140],[384,-168],[471,-184],[561,-190],[619,-186],[669,-175],[710,-157],[744,-132],[770,-98],[788,-57],[799,-7],[803,51],[803,172],[753,102],[689,53],[610,24],[516,14],[425,23],[344,52],[272,98],[211,164],[162,246],[126,341],[105,449],[98,571],[105,697],[126,810],[162,908],[211,993],[272,1061],[343,1110],[424,1139],[514,1149],[605,1138],[685,1104],[752,1050],[803,977],[803,1120],[1096,1120]]],"h":[[[1071,727],[1071,0],[780,0],[780,682],[778,738],[771,786],[761,825],[746,855],[726,878],[700,894],[669,904],[633,907],[595,903],[562,889],[533,867],[508,836],[488,798],[474,752],[466,700],[463,641],[463,0],[172,0],[172,1556],[463,1556],[463,952],[505,1034],[569,1096],[608,1118],[652,1134],[699,1144],[750,1147],[825,1140],[890,1121],[945,1088],[990,1042],[1025,982],[1051,910],[1066,825]]],"i":[[[221,1120],[801,1120],[801,225],[1165,225],[1165,0],[143,0],[143,225],[508,225],[508,895],[221,895]],[[508,1665],[801,1665],[801,1323],[508,1323]]],"j":[[[850,43],[844,-74],[827,-173],[799,-254],[760,-316],[707,-364],[639,-397],[557,-417],[459,-424],[143,-424],[143,-199],[377,-199],[422,-196],[461,-185],[492,-168],[516,-144],[534,-112],[547,-70],[554,-18],[557,43],[557,895],[260,895],[260,1120],[850,1120]],[[850,1323],[557,1323],[557,1665],[850,1665]]],"k":[[[174,1556],[467,1556],[467,739],[819,1120],[1174,1120],[750,702],[1198,0],[874,0],[567,524],[467,428],[467,0],[174,0]]],"l":[[[387,467],[387,1331],[90,1331],[90,1556],[680,1556],[680,467],[683,406],[690,354],[703,312],[721,280],[745,256],[776,239],[815,228],[860,225],[1094,225],[1094,0],[778,0],[681,7],[598,27],[531,61],[478,108],[438,171],[410,252],[393,350]]],"m":[[[690,1008],[728,1070],[774,1113],[831,1138],[899,1147],[966,1141],[1022,1122],[1066,1091],[1100,1047],[1113,1019],[1124,984],[1133,942],[1141,893],[1147,838],[1152,776],[1154,707],[1155,631],[1155,0],[915,0],[915,719],[914,776],[910,823],[904,860],[896,886],[869,918],[827,928],[784,917],[757,885],[748,858],[742,822],[738,776],[737,719],[737,0],[500,0],[500,719],[499,776],[495,822],[489,858],[480,885],[452,917],[410,928],[368,918],[341,886],[333,860],[327,823],[323,776],[322,719],[322,0],[82,0],[82,1120],[295,1120],[295,1004],[328,1063],[375,1108],[433,1137],[498,1147],[563,1137],[622,1106],[667,1062]]],"n":[[[1071,727],[1071,0],[780,0],[780,682],[778,739],[771,787],[761,826],[746,856],[726,879],[700,896],[669,906],[633,909],[596,905],[562,891],[533,869],[508,838],[489,799],[474,753],[466,701],[463,641],[463,0],[172,0],[172,1120],[463,1120],[463,952],[505,1034],[569,1096],[608,1118],[652,1134],[699,1144],[750,1147],[825,1140],[890,1121],[945,1088],[990,1042],[1025,982],[1051,910],[1066,825]]],"o":[[[616,909],[566,903],[522,886],[484,857],[451,816],[425,766],[406,706],[395,637],[391,559],[395,481],[406,412],[425,352],[451,302],[484,261],[522,232],[566,215],[616,209],[666,215],[710,232],[749,261],[782,302],[808,352],[827,412],[838,481],[842,559],[838,637],[827,706],[808,766],[782,816],[749,857],[710,886],[666,903]],[[98,559],[107,687],[133,802],[177,902],[238,988],[315,1058],[403,1107],[504,1137],[616,1147],[729,1137],[830,1107],[918,1058],[994,988],[1056,902],[1100,802],[1126,687],[1135,559],[1126,431],[1100,316],[1056,216],[994,130],[918,60],[830,11],[729,-19],[616,-29],[504,-19],[403,11],[315,60],[238,130],[177,216],[133,316],[107,431]]],"p":[[[442,158],[442,-426],[150,-426],[150,1120],[442,1120],[442,952],[495,1037],[563,1098],[602,1119],[644,1135],[690,1144],[739,1147],[830,1137],[910,1108],[979,1060],[1037,993],[1083,908],[1116,808],[1136,691],[1143,559],[1136,425],[1116,308],[1083,207],[1036,123],[976,56],[905,9],[823,-20],[729,-29],[644,-17],[568,18],[500,76]],[[850,561],[847,638],[836,706],[820,765],[796,815],[766,855],[732,884],[692,901],[647,907],[602,901],[562,884],[527,855],[497,815],[473,765],[456,706],[445,638],[442,561],[445,484],[456,416],[473,357],[497,307],[527,267],[562,238],[602,221],[647,215],[692,221],[732,238],[766,267],[796,307],[820,357],[836,416],[847,484]]],"q":[[[383,561],[386,484],[396,416],[413,357],[437,307],[467,267],[501,238],[541,221],[586,215],[631,221],[671,238],[706,267],[736,307],[760,357],[777,416],[788,484],[791,561],[788,638],[777,706],[760,765],[736,815],[706,855],[671,884],[631,901],[586,907],[541,901],[501,884],[467,855],[437,815],[413,765],[396,706],[386,638]],[[791,158],[733,76],[666,18],[589,-17],[504,-29],[410,-20],[328,9],[257,56],[198,123],[150,207],[117,308],[97,425],[90,559],[97,691],[116,808],[150,908],[196,993],[254,1060],[324,1108],[403,1137],[494,1147],[543,1144],[588,1135],[631,1119],[670,1098],[737,1037],[791,952],[791,1120],[1083,1120],[1083,-426],[791,-426]]],"r":[[[1151,811],[1099,850],[1038,877],[971,894],[897,899],[810,891],[734,866],[673,827],[627,772],[607,730],[594,680],[589,650],[586,612],[585,568],[584,516],[584,0],[291,0],[291,1120],[584,1120],[584,946],[638,1031],[716,1094],[762,1117],[812,1134],[866,1144],[924,1147],[983,1143],[1042,1132],[1098,1115],[1151,1090]]],"s":[[[991,1085],[991,829],[908,875],[822,908],[735,927],[647,934],[561,927],[499,906],[477,890],[462,870],[452,847],[449,821],[452,801],[462,783],[479,765],[502,748],[533,733],[569,718],[613,704],[663,691],[674,688],[758,668],[833,646],[897,618],[950,585],[992,546],[1025,500],[1048,446],[1062,385],[1067,317],[1060,236],[1039,166],[1003,106],[954,58],[890,20],[811,-7],[719,-24],[612,-29],[510,-25],[405,-12],[298,10],[190,41],[190,297],[288,248],[388,213],[486,191],[582,184],[630,186],[672,192],[708,201],[738,214],[761,231],[778,251],[788,274],[791,301],[782,350],[754,387],[728,402],[690,418],[639,434],[575,451],[494,469],[416,491],[349,518],[293,550],[249,588],[215,632],[191,683],[177,740],[172,805],[179,882],[201,949],[238,1008],[289,1057],[353,1096],[430,1124],[518,1141],[618,1147],[713,1143],[808,1132],[901,1112]]],"t":[[[690,1438],[690,1120],[1073,1120],[1073,895],[690,895],[690,365],[699,301],[726,258],[748,243],[775,233],[809,227],[848,225],[1073,225],[1073,0],[827,0],[711,5],[616,20],[541,45],[486,80],[447,129],[419,195],[403,279],[397,379],[397,895],[111,895],[111,1120],[397,1120],[397,1438]]],"u":[[[160,391],[160,1120],[453,1120],[453,436],[455,380],[462,332],[472,293],[487,263],[507,240],[532,224],[563,214],[600,211],[637,215],[670,228],[699,250],[724,281],[743,320],[757,365],[765,418],[768,477],[768,1120],[1061,1120],[1061,0],[768,0],[768,166],[726,84],[662,22],[623,0],[580,-16],[534,-26],[483,-29],[408,-22],[343,-2],[287,31],[242,77],[206,136],[180,208],[165,293]]],"v":[[[1153,1120],[797,0],[436,0],[80,1120],[377,1120],[616,246],[856,1120]]],"w":[[[0,1120],[244,1120],[377,262],[498,827],[735,827],[854,262],[989,1120],[1233,1120],[1030,0],[752,0],[616,582],[481,0],[203,0]]],"x":[[[1145,1120],[768,584],[1178,0],[836,0],[616,377],[397,0],[55,0],[469,584],[88,1120],[430,1120],[616,786],[803,1120]]],"y":[[[711,-121],[680,-195],[646,-258],[609,-310],[570,-352],[526,-383],[478,-406],[426,-419],[369,-424],[127,-424],[127,-201],[246,-201],[324,-193],[378,-170],[399,-150],[420,-120],[442,-79],[463,-29],[485,31],[59,1120],[367,1120],[623,393],[868,1120],[1176,1120]]],"z":[[[186,1120],[1081,1120],[1081,891],[492,219],[1081,219],[1081,0],[162,0],[162,229],[752,901],[186,901]]],"{":[[[1053,-143],[1053,-334],[903,-334],[789,-329],[695,-316],[622,-292],[570,-260],[533,-214],[506,-149],[490,-66],[485,35],[485,250],[482,320],[472,378],[455,424],[432,458],[399,484],[356,502],[303,512],[238,516],[176,516],[176,707],[238,707],[303,711],[356,721],[399,739],[432,764],[455,798],[472,845],[482,903],[485,973],[485,1188],[490,1289],[506,1372],[533,1437],[570,1482],[622,1515],[695,1538],[789,1551],[903,1556],[1053,1556],[1053,1366],[930,1366],[882,1363],[843,1356],[813,1342],[791,1324],[776,1297],[765,1257],[758,1204],[756,1139],[756,930],[753,854],[744,790],[728,738],[707,698],[678,668],[639,643],[590,624],[532,612],[590,599],[639,579],[678,554],[707,523],[728,483],[744,431],[753,367],[756,291],[756,86],[758,20],[765,-33],[776,-73],[791,-100],[813,-119],[843,-132],[882,-140],[930,-143]]],"|":[[[729,1565],[729,-483],[502,-483],[502,1565]]],"}":[[[180,-143],[301,-143],[349,-140],[388,-132],[419,-119],[441,-100],[457,-72],[468,-32],[475,21],[477,86],[477,291],[480,367],[489,431],[505,483],[526,523],[555,554],[594,579],[642,599],[700,612],[642,624],[593,643],[555,668],[526,698],[504,738],[489,790],[480,854],[477,930],[477,1139],[475,1203],[468,1256],[457,1295],[442,1323],[419,1342],[389,1355],[349,1363],[301,1366],[180,1366],[180,1556],[330,1556],[444,1551],[537,1538],[609,1515],[662,1482],[698,1437],[724,1372],[740,1289],[745,1188],[745,973],[748,903],[759,845],[776,799],[800,764],[832,739],[876,721],[930,711],[995,707],[1057,707],[1057,516],[995,516],[930,512],[876,502],[832,483],[800,458],[776,423],[759,377],[748,319],[745,250],[745,35],[740,-66],[724,-149],[698,-214],[662,-260],[609,-292],[537,-316],[444,-329],[330,-334],[180,-334]]],"~":[[[1145,811],[1145,578],[1071,526],[998,490],[925,470],[848,463],[802,466],[752,476],[700,492],[645,514],[612,528],[541,556],[484,574],[381,586],[305,579],[232,557],[161,520],[88,465],[88,694],[165,746],[239,782],[314,802],[395,809],[498,798],[554,782],[622,756],[655,741],[712,717],[765,700],[816,689],[864,686],[934,694],[1003,716],[1073,755]]]}};

// Flat letters drawn with the same filled-path brush as the rest of the UI.
// No fillText, installed font, text texture, alpha, gradient or image API.
var createSolidMonoText=function(ctx){
 "use strict";
 var font=switchSolidMono,cache=Object.create(null),keys=[];
 function compile(s,size){var key=size+":"+s;if(cache[key])return cache[key];var paths=[],scale=size/font.units,advance=size*font.advance/font.units;
  for(var i=0;i<s.length;i++){var glyph=font.glyphs[s[i]]||font.glyphs["?"];glyph.forEach(function(contour){var p=[];for(var j=0;j<contour.length;j++)p.push([i*advance+contour[j][0]*scale,-contour[j][1]*scale]);paths.push(p);});}
  var run={paths:paths,width:s.length*advance};if(keys.length>=256){for(var n=0;n<64;n++)delete cache[keys.shift()];}keys.push(key);cache[key]=run;return run;
 }
 return function(s,x,y,size,color,align){s=String(s);var run=compile(s,size),left=x-(align==="center"?run.width/2:align==="right"?run.width:0);ctx.fillStyle=color||"#19333f";ctx.beginPath();run.paths.forEach(function(p){ctx.moveTo(left+p[0][0],y+p[0][1]);for(var i=1;i<p.length;i++)ctx.lineTo(left+p[i][0],y+p[i][1]);ctx.closePath();});ctx.fill();};
};

// Large, flat, playful Canvas UI. Only opaque rectangles, circles and text.
var createSwitchInputView=function(ctx){
 "use strict";
 var drawText=createSolidMonoText(ctx),labels=Object.create(null);
 var c={paper:"#fff8e9",white:"#ffffff",ink:"#19333f",muted:"#49616b",coral:"#eb523f",teal:"#00b6a7",yellow:"#ffd541",blue:"#4364e8",line:"#c4d0ce"};
 var tabs=[{action:"controls",label:"Buttons",x:24,y:96,w:296,h:64,color:c.coral},{action:"touch",label:"Touch",x:336,y:96,w:296,h:64,color:c.blue},{action:"motion",label:"Motion",x:648,y:96,w:296,h:64,color:c.teal},{action:"info",label:"Info",x:960,y:96,w:296,h:64,color:c.yellow}];
 var tools=[{action:"reset",label:"Reset",x:964,y:20,w:132,h:56},{action:"exit",label:"Exit",x:1112,y:20,w:144,h:56}];
 var confirm=[{action:"cancel",x:284,y:430,w:328,h:80},{action:"confirm",x:668,y:430,w:328,h:80}],menu=["Back to test","Touch screen","Motion sensors","Runtime info","Reset observations","Exit to loader"];
 var infoTools=[{action:"info-prev",label:"Previous",x:24,y:608,w:208,h:56},{action:"info-next",label:"Next",x:1048,y:608,w:208,h:56}];
 var rumbleTools=[{action:"rumble-left",label:"Left [L]",x:24,y:560,w:400,h:80},{action:"rumble-right",label:"Right [R]",x:440,y:560,w:400,h:80},{action:"rumble-both",label:"Both [A]",x:856,y:560,w:400,h:80}];
 var buttons=[{n:"L",x:52,y:218,w:112,h:52},{n:"ZL",x:182,y:218,w:112,h:52},{n:"R",x:984,y:218,w:112,h:52},{n:"ZR",x:1114,y:218,w:112,h:52},{n:"Minus",label:"-",x:366,y:200,w:100,h:64},{n:"Plus",label:"+",x:814,y:200,w:100,h:64},
 {n:"Up",x:174,y:462,r:28},{n:"Left",x:106,y:530,r:28},{n:"Right",x:242,y:530,r:28},{n:"Down",x:174,y:598,r:28},
 {n:"X",x:1106,y:326,r:29},{n:"Y",x:1042,y:390,r:29},{n:"A",x:1170,y:390,r:29},{n:"B",x:1106,y:454,r:29}];
 function rect(x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(x,y,w,h);}
 function panel(x,y,w,h,color){rect(x,y,w,h,c.ink);rect(x+4,y+4,w-8,h-8,color||c.white);}
 // Letter outlines use a single opaque fill, bypassing native text shading.
 function text(s,x,y,size,color,align){drawText(s,x,y,size,color||c.ink,align||"left");}
 function circle(x,y,r,color){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}
 function ring(x,y,r,fill){circle(x,y,r,c.ink);circle(x,y,r-4,fill);}
 function short(v,n){return v==null?"Not available":String(v).slice(0,n||32);}
 function box(b,label,selected,color){panel(b.x,b.y,b.w,b.h,selected?(color||c.coral):c.white);text(label,b.x+b.w/2,b.y+b.h/2+9,26,c.ink,"center");}
 function arrow(name,x,y,color){var a={Up:0,Right:Math.PI/2,Down:Math.PI,Left:-Math.PI/2}[name],points=[[0,-11],[-11,9],[11,9]];ctx.beginPath();points.forEach(function(p,i){var xx=x+p[0]*Math.cos(a)-p[1]*Math.sin(a),yy=y+p[0]*Math.sin(a)+p[1]*Math.cos(a);if(i)ctx.lineTo(xx,yy);else ctx.moveTo(xx,yy);});ctx.closePath();ctx.fillStyle=color;ctx.fill();}
 function chip(b,s){var done=s.presses&&s.releases,fill=s.held?c.coral:done?c.ink:c.white,color=s.held||done?c.white:c.ink;if(b.r){ring(b.x,b.y,b.r,fill);if(["Up","Down","Left","Right"].indexOf(b.n)>=0)arrow(b.n,b.x,b.y,color);else text(b.n,b.x,b.y+11,34,color,"center");}else{panel(b.x,b.y,b.w,b.h,fill);text(b.label||b.n,b.x+b.w/2,b.y+b.h/2+11,32,color,"center");}}
 function stick(s,b,x,y,label){ring(x,y,56,c.white);[[0,-70,s.up],[0,70,s.down],[-70,0,s.left],[70,0,s.right]].forEach(function(p){circle(x+p[0],y+p[1],6,p[2]?c.ink:c.white);});var dx=x+Math.max(-1,Math.min(1,s.x))*28,dy=y-Math.max(-1,Math.min(1,s.y))*28;circle(dx,dy,25,b.held?c.coral:c.ink);text(label,dx,dy+10,28,c.white,"center");}
 function stickCard(x,name,s,b){panel(x,430,264,234,c.white);text(name,x+18,468,24);text("X "+s.x.toFixed(2),x+18,510,28);text("Y "+s.y.toFixed(2),x+18,550,28);text(b.presses&&b.releases?"CLICK OK":"CLICK TO TEST",x+18,592,22,b.presses&&b.releases?c.muted:c.ink);text(s.up&&s.down&&s.left&&s.right&&s.center?"AXES OK":"MOVE ALL WAYS",x+18,632,22,c.muted);}
 function controls(d){
  panel(24,200,300,464,c.teal);panel(956,200,300,464,c.yellow);
  buttons.forEach(function(b){chip(b,d.buttons[b.n]);});stick(d.sticks.left,d.buttons.LStick,174,350,"L");stick(d.sticks.right,d.buttons.RStick,1106,576,"R");
  text(d.buttonCycles===16?"All buttons checked!":"Press every button",640,238,26,c.ink,"center");text(d.buttonCycles+" / 16",640,340,76,d.buttonCycles===16?"#007f75":c.ink,"center");text("BUTTONS CHECKED",640,376,24,c.muted,"center");
  for(var i=0;i<16;i++)rect(372+i*34,394,29,14,i<d.buttonCycles?c.teal:c.line);
  stickCard(356,"LEFT STICK",d.sticks.left,d.buttons.LStick);stickCard(660,"RIGHT STICK",d.sticks.right,d.buttons.RStick);
 }
 function touch(d){
  text("Touch. Drag. Play.",24,214,28);text(d.touch.contacts.length+" FINGERS",1256,214,32,c.blue,"right");panel(24,244,1232,420,c.white);text("Tap all five circles. Try ten fingers!",48,282,24,c.muted);
  createSwitchInputView.targets.forEach(function(p,i){ring(p.x,p.y,38,d.touch.targets[i]?c.ink:c.yellow);text(d.touch.targets[i]?"OK":String(i+1),p.x,p.y+10,28,d.touch.targets[i]?c.white:c.ink,"center");});
  if(!d.touch.available){panel(284,390,712,112,c.paper);text("Touch is unavailable on this setup",640,457,28,c.ink,"center");}
 }
 function vector(x,title,values,scale){panel(x,200,604,280,c.white);text(title,x+22,239,28);var colors=[c.coral,"#008b80",c.blue];["X","Y","Z"].forEach(function(axis,i){var y=252+i*70;rect(x+24,y,42,42,colors[i]);text(axis,x+45,y+31,28,c.white,"center");text(values?values[i].toFixed(3):"--",x+580,y+34,42,c.ink,"right");rect(x+24,y+54,556,12,c.line);var mid=x+302;rect(mid-2,y+50,4,20,c.ink);if(values){var width=Math.min(1,Math.abs(values[i])/scale)*278;rect(values[i]<0?mid-width:mid,y+54,Math.max(2,width),12,colors[i]);}});}
 function motion(state){var m=state.motion||{status:"not opened",streams:[]},p=m.streams[0]&&m.streams[0].latest,r=state.rumble||{status:"Ready",message:"Pick a side. Feel a short pulse."};vector(24,"Accelerometer",p&&p.acceleration,2);vector(652,"Gyroscope",p&&p.angularVelocity,1);text(m.status==="unavailable"?"Motion unavailable. Rumble can still be tested.":m.status==="starting"?"Hold still for a moment...":"Tilt and turn! Watch the numbers change.",24,512,24,c.muted);text("Rumble",24,546,28);text(r.message,1256,546,22,c.muted,"right");rumbleTools.forEach(function(b){box(b,b.label,r.active&&b.action==="rumble-"+r.activeKind,b.action==="rumble-both"?c.coral:c.teal);});text("Short pulses. L / R / A test rumble. B stops and goes back.",24,674,22,c.muted);}
 function infoCard(x,y,label,value,size){panel(x,y,604,104,c.white);text(label,x+20,y+32,22,c.muted);text(short(value,33),x+20,y+77,size||28);}
 function info(info,state){var index=state.infoIndex||0,m=state.motion||{status:"not opened",streams:[]},p=m.streams[0]&&m.streams[0].latest;text(["The basics","Under the hood","Motion + runtime"][index],24,209,28);text((index+1)+" / 3",1256,209,28,c.muted,"right");
  var rows=index===0?[["App version",info.version],["Screen",info.viewport.width+" x "+info.viewport.height],["Touch",state.touchStatus],["Motion",m.status],["Console model","Not queried"],["Firmware","Not queried"]]:[["SDK base",info.sdkBase],["Game base",info.gameBase],["Target",info.targetHost||"Manual payload"],["Input route","InputAction"],["Platform",info.platform],["Language",info.language]];
  if(index<2)rows.forEach(function(row,i){infoCard(i%2?652:24,232+Math.floor(i/2)*120,row[0],row[1]);});
  else if(index===2){infoCard(24,232,"Last angle (raw)",p?p.angle.map(function(v){return v.toFixed(2);}).join(" / "):"-- / -- / --",26);infoCard(652,232,"Motion snapshots",String(m.snapshots||0),34);panel(24,352,1232,160,c.white);text("User agent",44,385,22,c.muted);var ua=String(info.userAgent||"Not available");for(var i=0;i<3;i++)if(ua.slice(i*84,(i+1)*84))text(ua.slice(i*84,(i+1)*84),44,420+i*30,22);text("HOME, Capture and C are outside this test.",24,558,22,c.muted);}
  infoTools.forEach(function(b){box(b,b.label,false);});
 }
 return {hit:function(p,state){var list=state.modal?confirm:state.menu?menu.map(function(_,i){return {action:"menu-"+i,x:340,y:240+i*72,w:600,h:56};}):tools.concat(tabs).concat(state.page==="info"?infoTools:state.page==="motion"?rumbleTools:[]);for(var i=0;i<list.length;i++){var b=list[i];if(p.x>=b.x&&p.x<b.x+b.w&&p.y>=b.y&&p.y<b.y+b.h)return b.action;}return null;},draw:function(d,state,infoData){
  rect(0,0,1280,720,c.paper);text("Switch Input Test",84,56,32);text(state.preview?"DESKTOP PREVIEW":"PRESS. TAP. TILT.",440,52,22,c.muted);tools.forEach(function(b){box(b,b.label,false);});tabs.forEach(function(b){box(b,b.label,b.action===(state.page||"controls"),b.color);});
  if(state.page==="touch")touch(d);else if(state.page==="motion")motion(state);else if(state.page==="info")info(infoData,state);else controls(d);
  if(state.page==="controls"){rect(24,686,16,16,c.coral);text("HELD",52,704,22);rect(150,686,16,16,c.ink);text("CHECKED",178,704,22);text("Held "+Object.keys(d.buttons).filter(function(k){return d.buttons[k].held;}).length+" / peak "+d.maxHeld,640,704,22,c.muted,"center");}
  else if(state.page==="touch"){text("Peak "+d.touch.maxContacts,24,704,22);text("Separate lift: "+(d.touch.independentLift?"CHECKED":"try it"),640,704,22,c.muted,"center");}
  else if(state.page==="motion")text("Raw values, not calibrated",24,704,22,c.muted);
  else text("Runtime details",24,704,22,c.muted);
  text("Hold + and -: menu",1256,704,22,c.ink,"right");
  if(state.menu){rect(0,176,1280,498,c.paper);text("Pick a test",640,215,34,c.ink,"center");menu.forEach(function(label,i){box({x:340,y:240+i*72,w:600,h:56},label,state.selected===i,c.yellow);});}
  if(state.modal){rect(0,176,1280,498,c.paper);panel(240,240,800,300,c.white);text(state.modal==="exit"?"All done?":"Fresh start?",640,306,40,c.ink,"center");text(state.modal==="exit"?"Save your report and return to the loader.":"Clear the scores and keep playing.",640,365,24,c.muted,"center");confirm.forEach(function(b,i){box(b,i?(state.modal==="exit"?"Save + exit":"Reset"):"Keep testing",state.selected===i,c.coral);});}
  var active=Object.create(null),used=[];d.touch.contacts.forEach(function(p){active[String(p.id)]=true;});Object.keys(labels).forEach(function(id){if(!active[id])delete labels[id];else used[labels[id]]=true;});d.touch.contacts.forEach(function(p){var id=String(p.id);if(!labels[id]){var n=1;while(used[n])n++;labels[id]=n;used[n]=true;}});
  var colors=[c.blue,c.coral,"#008b80","#8b43ba","#cd5e13","#2b703c","#a52a62","#196eaa","#766008","#5350ac"];
  d.touch.contacts.forEach(function(p){var label=labels[String(p.id)],color=colors[(label-1)%colors.length];circle(p.x,p.y,34,c.white);circle(p.x,p.y,30,color);text(label,p.x,p.y+10,28,c.white,"center");});
 }};
};
createSwitchInputView.targets=[{x:96,y:344},{x:1184,y:344},{x:640,y:462},{x:96,y:592},{x:1184,y:592}];

(async function(){
 "use strict";
 var cfg=window.__switchInputTestConfig||{},start=Date.now(),maxSeconds=cfg.maxSeconds||600,canvas,input,view,model=createSwitchInputModel(),timer,deadline,heartbeat,resolveDone,closed=false,lastFrame=null;
 var state={preview:!!cfg.preview,page:"controls",returnPage:"controls",info:false,infoIndex:0,menu:false,modal:null,selected:0,touchStatus:"waiting"},nativeReader=null,nativeFailed=false,pending=null,chordAt=null,chordLatched=false,repeatAt=0,motionWarning=false;
 var report={schema:"switch-input-test/1",version:"1.1.0",ui:"large-flat",textRenderer:"solid-filled-outlines",touchLabelMode:"stable one-based display labels; raw native IDs preserved",reason:null,errors:[],warnings:[],durationMs:0,pages:{controls:true,touch:false,motion:false,info:false},cleanup:{timers:false,input:false,overlay:false,motion:false,rumble:false}};
 function probe(fn){try{var v=fn();return v==null?null:v;}catch(_){return null;}}
 function value(v,n){return v==null?null:String(v).slice(0,n||220);}
 var info=report.environment={version:"1.1.0",preview:!!cfg.preview,createdAtUTC:new Date().toISOString(),targetHost:cfg.targetHost||null,declaredPlatform:cfg.platform||null,
  viewport:{width:probe(function(){return window.innerWidth;}),height:probe(function(){return window.innerHeight;})},screen:{width:probe(function(){return screen.width;}),height:probe(function(){return screen.height;})},pixelRatio:probe(function(){return window.devicePixelRatio;}),
  platform:value(probe(function(){return navigator.platform;})),language:value(probe(function(){return navigator.language;})),userAgent:value(probe(function(){return navigator.userAgent;})),
  sdkBase:probe(function(){return typeof sdk_base==="bigint"?"0x"+sdk_base.toString(16):null;}),gameBase:probe(function(){return typeof main_base==="bigint"?"0x"+main_base.toString(16):null;}),hardwareModel:null,firmware:null,gameVersion:null,controllerIdentity:null};
 function warn(message){if(report.warnings.length<10)report.warnings.push(value(message,180));}
 var motion=createSwitchMotion({openNative:function(){return createSwitchMotionNative({read64:read64,sdkBase:sdk_base,profiles:window.__switchMotionProfiles});},helpers:{write64:typeof write64==="function"?write64:null,malloc:typeof malloc==="function"?malloc:null,free:typeof free==="function"?free:null,call_rop:typeof call_rop==="function"?call_rop:null,note:function(s){try{var p=log("INPUT_MOTION "+s);if(p&&p.catch)p.catch(function(){});}catch(_){}}}});
 var rumble=createSwitchRumble({openNative:function(){return createSwitchRumbleNative({sdkBase:sdk_base,read64:read64,profile:window.__switchRumbleProfile,openReader:function(){return createSwitchMotionNative({read64:read64,sdkBase:sdk_base,profiles:window.__switchMotionProfiles});},helpers:{write64:typeof write64==="function"?write64:null,malloc:typeof malloc==="function"?malloc:null,free:typeof free==="function"?free:null,call_rop:typeof call_rop==="function"?call_rop:null}});}});
 function page(name){rumble.cancel(Date.now()-start);pending=null;if(name==="info"&&state.page!=="info")state.infoIndex=0;state.page=name;state.info=name==="info";report.pages[name]=true;if(name==="motion")motion.open(Date.now()-start);}
 function close(reason){if(closed)return;closed=true;report.reason=reason;if(resolveDone)resolveDone();}
 function act(action,source){
  if(action==="controls"||action==="touch"||action==="motion"){page(action);state.menu=false;return;}
  if(action==="info"){if(!state.info){state.returnPage=state.page;page("info");}state.menu=false;return;}
  if(action==="info-next"||action==="info-prev"){rumble.cancel(Date.now()-start);pending=null;state.infoIndex=(state.infoIndex+(action==="info-next"?1:2))%3;return;}
  if(action&&action.indexOf("rumble-")===0){pending={kind:action,id:source.id,button:source.button};return;}
  if(action==="reset"||action==="exit"){rumble.cancel(Date.now()-start);state.menu=false;state.modal=action;state.selected=0;pending=null;return;}
  if(action==="cancel"){state.modal=null;pending=null;return;}
  if(action==="confirm"&&state.modal){state.selected=1;pending={kind:state.modal,id:source.id,button:source.button};return;}
  if(action&&action.indexOf("menu-")===0){var n=Number(action.slice(5));state.menu=false;if(n===1)page("touch");else if(n===2)page("motion");else if(n===3){state.returnPage=state.page;page("info");}else if(n===4||n===5){state.modal=n===4?"reset":"exit";state.selected=0;}}
 }
 function tick(){if(closed)return;try{
  var now=Date.now(),ms=now-start;
  if(nativeReader&&!nativeFailed){try{input.pollTouch();}catch(e){nativeFailed=true;state.touchStatus="reader error";info.touchDetail=value(e&&e.message||e,180);warn("Native touch disabled: "+info.touchDetail);}}
  var frame=input.drain();lastFrame=frame;var data=model.update(frame,ms);
  if(nativeReader&&!nativeFailed)state.touchStatus=cfg.preview?"simulated":data.touch.available?"verified / live":"verified / waiting";
  if(frame.buttons.Plus&&frame.buttons.Minus){if(chordAt===null)chordAt=now;if(!chordLatched&&now-chordAt>=1000){rumble.cancel(ms);pending=null;state.menu=true;state.modal=null;state.selected=0;pending=null;chordLatched=true;}}
  else{chordAt=null;chordLatched=false;}
  if(state.menu||state.modal){
   var dir=frame.pressed.indexOf("Down")>=0||frame.pressed.indexOf("Right")>=0?1:frame.pressed.indexOf("Up")>=0||frame.pressed.indexOf("Left")>=0?-1:0;
   if(!dir&&now>=repeatAt&&Math.abs(frame.sticks.left.y)>.6)dir=frame.sticks.left.y<0?1:-1;
   if(dir){var count=state.modal?2:6;state.selected=(state.selected+dir+count)%count;repeatAt=now+220;}
   if(frame.pressed.indexOf("B")>=0){state.menu=false;state.modal=null;pending=null;}
   else if(frame.pressed.indexOf("A")>=0)act(state.modal?(state.selected?"confirm":"cancel"):"menu-"+state.selected,{button:"A"});
  }else if(state.page==="info"&&(frame.pressed.indexOf("Right")>=0||frame.pressed.indexOf("Left")>=0)){rumble.cancel(ms);pending=null;state.infoIndex=(state.infoIndex+(frame.pressed.indexOf("Right")>=0?1:2))%3;}
  else if(state.page!=="controls"&&frame.pressed.indexOf("B")>=0)page(state.info?state.returnPage:"controls");
  else if(state.page==="motion"){["L","R","A"].some(function(b){if(frame.pressed.indexOf(b)>=0){act("rumble-"+(b==="L"?"left":b==="R"?"right":"both"),{button:b});return true;}return false;});}
  if(data.touch.available)data.touch.contacts.forEach(function(p){if(frame.touch.startedIds.indexOf(p.id)>=0)act(view.hit(p,state),{id:p.id});});
  if(pending&&((pending.button&&frame.released.indexOf(pending.button)>=0)||(pending.id!=null&&(frame.touch.endedIds||[]).indexOf(pending.id)>=0))){
   var kind=pending.kind;pending=null;if(kind.indexOf("rumble-")===0){if(state.page==="motion"&&!state.modal&&!state.menu)rumble.start(kind.slice(7),ms);}else if(kind==="exit")close("user exit");else{model.reset(frame,ms);motion.reset();rumble.reset(ms);state.modal=null;state.menu=false;data=model.snapshot();}
  }
  var motionMs=Date.now()-start;if(!closed)motion.tick(motionMs,state.page==="motion");state.motion=motion.view(motionMs);if(state.motion.status==="unavailable"&&!motionWarning){warn("Motion unavailable: "+state.motion.message);motionWarning=true;}
  if(!closed)rumble.tick(Date.now()-start);state.rumble=rumble.view();view.draw(data,state,info);
 }catch(e){report.errors.push(value(e&&e.message||e,180));close("runtime error");}}
 try{
  try{nativeReader=createCivVerifiedNativeTouch(read64,sdk_base);state.touchStatus=cfg.preview?"simulated":"verified / waiting";}
  catch(e){state.touchStatus="unavailable";info.touchDetail=value(e&&e.message||e,180);warn("Independent touch unavailable: "+info.touchDetail);}
  input=createCivInputAdapter(engine,{nativeTouchReader:nativeReader});
  canvas=document.createElement("canvas");canvas.width=1280;canvas.height=720;Object.assign(canvas.style,{position:"fixed",left:"0",top:"0",width:"100%",height:"100%",zIndex:"2147483010",pointerEvents:"none",backgroundColor:"#fff8e9"});document.body.appendChild(canvas);
  var context=canvas.getContext("2d");if(!context)throw Error("Canvas 2D unavailable");view=createSwitchInputView(context);input.attach();tick();
  if(!closed)await new Promise(function(resolve){resolveDone=resolve;timer=setInterval(tick,33);deadline=setTimeout(function(){close("session time limit");},maxSeconds*1000);heartbeat=setInterval(function(){var d=model.snapshot();try{var p=log("SWITCH_INPUT_TEST alive cycles="+d.buttonCycles+"/16 contacts="+d.touch.contacts.length+" events="+d.rawEvents);if(p&&p.catch)p.catch(function(){});}catch(_){}},15000);});
 }catch(e){report.errors.push(value(e&&e.message||e,180));report.reason="startup error";}
 finally{
  clearInterval(timer);clearInterval(heartbeat);clearTimeout(deadline);report.cleanup.timers=true;
  rumble.close(Date.now()-start);report.rumble=rumble.report();report.cleanup.rumble=report.rumble.nativeCleanup;
  motion.close();report.motion=motion.report();report.cleanup.motion=report.motion.nativeCleanup;if(report.motion.activation)report.motion.activation.errors.forEach(function(s){report.errors.push("Motion: "+value(s,180));});
  report.observations=model.snapshot();report.touchStatus=state.touchStatus;report.inputRoute="InputAction";report.touchCoordinateSpace={width:1280,height:720};report.touchTargets=model.targets;report.touchTargetRadius=44;
  if(lastFrame)report.actionCounts=lastFrame.actionCounts;report.limits={recentEvents:64,independentTouch:"verified SDK profile only",motionSamplesPerStream:120,motionUnits:"raw, not calibrated",motionSource:"native handheld route; physical source not queried",unmappedButtons:["HOME","Capture","C"],unqueried:["firmware","hardware model","controller identity","connection state"]};
  if(nativeReader&&nativeReader.stats)report.nativeReaderStats=JSON.parse(JSON.stringify(nativeReader.stats));
  if(input){try{input.detach();report.cleanup.input=true;}catch(e){report.errors.push("Detach: "+value(e&&e.message||e,140));}}
  if(canvas&&canvas.parentNode){canvas.parentNode.removeChild(canvas);report.cleanup.overlay=true;}report.durationMs=Date.now()-start;
 }
 window.__switchInputTestLastReport=report;
 await sendCivInputProReport(report);
})();
