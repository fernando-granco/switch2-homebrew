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

window.__timberTiltConfig={"maxSeconds":1800,"preview":false};
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

// Generated by tools/make_levels.cjs (original board designs). Legend: # wall, o hole, S start, G goal, 1-9 checkpoints,
// p peg, f felt, v varnish, a acorn. Par times come from the offline autopilot.
var TIMBER_LEVELS=[
 {id:"first",name:"FIRST PLANK",hint:"Tilt gently. Follow the dotted line around the fence.",theme:"pine",par:20,grid:[
  "##############################",
  "#.............#.........o....#",
  "#...........a.#..............#",
  "#..S..........#...........G..#",
  "#.............#..............#",
  "#.............#o.............#",
  "#..o..........#.............o#",
  "#.............#..............#",
  "#.............#..............#",
  "#.............#..............#",
  "#.............#..............#",
  "#.............#a.............#",
  "#..............1...........a.#",
  "#............................#",
  "#..........o................o#",
  "#............................#",
  "#............................#",
  "##############################"]},
 {id:"sawdust",name:"SAWDUST SNAKE",hint:"Follow the line around the three fences.",theme:"pine",par:30,grid:[
  "##############################",
  "#.......#..............#.....#",
  "#.S.....#.....a........#..G..#",
  "#.......#.o............#.....#",
  "#.......#.......#......#.....#",
  "#.......#.......#...o..#.....#",
  "#.......#.......#......#.....#",
  "#.......#.......#......#.....#",
  "#.......#...1...#......#.....#",
  "#....o..#.......#..2...#.....#",
  "#.......#.......#......#..o..#",
  "#.......#.......#......#.....#",
  "#.......#.......#.o....#.....#",
  "#....a..#...o...#......#.....#",
  "#..o............#............#",
  "#...............#......a.o...#",
  "#...............#............#",
  "##############################"]},
 {id:"switchback",name:"SWITCHBACK MILL",hint:"Long corridors. Ease off before each turn.",theme:"pine",par:50,grid:[
  "##############################",
  "#........o.........o.....a...#",
  "#.S..........................#",
  "#.............o..............#",
  "#########################....#",
  "#............o...............#",
  "#...................o.....1..#",
  "#......o.....................#",
  "#a...#########################",
  "#.............o..............#",
  "#.2.....o....................#",
  "#...................o........#",
  "#########################....#",
  "#........o.............a.....#",
  "#....................o....3..#",
  "#..G...........o.............#",
  "#.....o......................#",
  "##############################"]},
 {id:"orchard",name:"PEG ORCHARD",hint:"Brass pegs bounce the ball. Weave between them.",theme:"pine",par:15,grid:[
  "##############################",
  "#............................#",
  "#............................#",
  "#......p...p...p...p...p.....#",
  "#............................#",
  "#............................#",
  "#####....p...p...p...p..o#####",
  "#.....o..............o......o#",
  "#............................#",
  "#.S...ap...p..ap...p..ap...G.#",
  "#........1...........2.......#",
  "#............................#",
  "#####..o.p...po..po..p...#####",
  "#...........o................#",
  "#............................#",
  "#......p...p...p...p...p.....#",
  "#............................#",
  "##############################"]},
 {id:"bridges",name:"PLANK BRIDGES",hint:"Cross each trench on its narrow bridge.",theme:"pine",par:20,grid:[
  "##############################",
  "#........oo........oo........#",
  "#........oo........oo........#",
  "#........oo......o.oo.....G..#",
  "#.....1............oo........#",
  "#..................oo........#",
  "#......a.oo...o....oo........#",
  "#...o....oo........oo........#",
  "#........oo.....a..oo..o.....#",
  "#........oo........oo........#",
  "#........oo.o......oo.....o..#",
  "#.....o..oo........oo........#",
  "#........oo....2.......a.....#",
  "#........oo.............3....#",
  "#..S.....oo........oo........#",
  "#........oo.....o..oo......o.#",
  "#........oo........oo........#",
  "##############################"]},
 {id:"spiral",name:"SPIRAL BURL",hint:"Wind inward around the rings to the centre cup.",theme:"pine",par:55,grid:[
  "##############################",
  "#...S........................#",
  "#.............o..............#",
  "###########################..#",
  "#.......#.................#..#",
  "#.......#...o.............#..#",
  "#..#..##################.o#..#",
  "#..#..#........o..........#..#",
  "#..#..#..................a#.a#",
  "#.2#..#o.###############3.#1.#",
  "#a.#o.#.............G..#..#..#",
  "#..#..##################..#..#",
  "#o.#......................#..#",
  "#..#............o.........#o.#",
  "#..########################..#",
  "#...................o........#",
  "#.......o....................#",
  "##############################"]},
 {id:"fairway",name:"FELT FAIRWAY",hint:"Green felt slows the ball. Use it to brake at the turns.",theme:"oak",par:25,grid:[
  "##############################",
  "#.............o.o...o..ffffff#",
  "#.S....................ffffff#",
  "#......................ffffff#",
  "#...........o.........1ffffff#",
  "#..............a.......ffffff#",
  "######################.......#",
  "#ffffff.o....................#",
  "#ffffff......................#",
  "#ffffff............o.........#",
  "#ffffff........a.............#",
  "#....o.2######################",
  "#.....................fff....#",
  "#.....................fff....#",
  "#....................offf.G..#",
  "#............a.....o.offo....#",
  "#.....................fffo...#",
  "##############################"]},
 {id:"knot",name:"KNOT GARDEN",hint:"A real maze. Dead ends are pits.",theme:"oak",par:65,grid:[
  "############################",
  "#S....#o.#......a........o.#",
  "#.....#..#...1.............#",
  "####..#..#..#######..#######",
  "#.....#........#o.#........#",
  "#.....#........#..#o.......#",
  "#..##########..#..#######..#",
  "#.....#.....#.o.........#..#",
  "#.....#....a#...........#..#",
  "####..#a.#..##########..#..#",
  "#.....#..#..#.....#.....#..#",
  "#.....#..#..#.....#.o...#..#",
  "#..####..#..#..#..#######..#",
  "#.......2#.....#...........#",
  "#........#.....#..........G#",
  "############################"]},
 {id:"varnish",name:"VARNISH RUN",hint:"Shiny varnish is slick. The ball keeps its speed.",theme:"oak",par:20,grid:[
  "##############################",
  "#.....o..#...................#",
  "#..S..o..#.....o.........o...#",
  "#........#...................#",
  "#..vvvv..#.......2..o.....a..#",
  "#..vvvv..#.........#..o......#",
  "#..vvvv..#..vvvvv.o#..vvvvv..#",
  "#..vvov..#..vvvvv..#..vvvvv..#",
  "#..vvvv..#..vvvvv..#..vvvvv..#",
  "#..vvvv..#..vvavv..#..vvvvv..#",
  "#..vvav..#..vvvvv..#..vvvvv..#",
  "#..vvvv..#..vvvvv..#..vvvvv..#",
  "#........#..vvvvv..#..vvvvv..#",
  "#........1.........#.........#",
  "#..................#....G....#",
  "#....o.............#.........#",
  "#..................#...o.....#",
  "##############################"]},
 {id:"comb",name:"COMB TEETH",hint:"Five teeth, over and under. Brake before each gap.",theme:"oak",par:35,grid:[
  "##############################",
  "#....#.........#.........#...#",
  "#.S..#........o#..o......#.G.#",
  "#....#.....o...#........o#...#",
  "#....#.........#........o#...#",
  "#....#....#....#o...#....#...#",
  "#....#....#....#....#...o#...#",
  "#....#....#....#....#....#...#",
  "#....#....#....#....#..3.#...#",
  "#....#..1.#....#....#....#...#",
  "#....#....#....#...o#..o.#...#",
  "#....#....#....#....#.o..#o..#",
  "#....#.a..#....#a...#....#...#",
  "#.........#....2....#..a.....#",
  "#....o....#.........#........#",
  "#.........#.........#........#",
  "#.........#.........#........#",
  "##############################"]},
 {id:"bumpers",name:"BRASS BUMPERS",hint:"Pegs line the lanes. Let them bounce you around.",theme:"oak",par:30,grid:[
  "##############################",
  "#........p...................#",
  "#.S.....................o....#",
  "#.............p.p......p.....#",
  "#............o....a..........#",
  "#....o.....p...p........1....#",
  "########################...o.#",
  "#.....p...p........p.........#",
  "#............................#",
  "#...................p..p.....#",
  "#..o.......p.ap..............#",
  "#....2...................o...#",
  "#.....########################",
  "#............................#",
  "#..........................G.#",
  "#...................p........#",
  "#..........a.........o.......#",
  "##############################"]},
 {id:"oakmaze",name:"OAK LABYRINTH",hint:"Find the way through. Felt rooms help you stop.",theme:"oak",par:30,grid:[
  "############################",
  "#S..........#..............#",
  "#...........#..............#",
  "##########..#..##########..#",
  "#........#fff1a#........#..#",
  "#.......o#fffff#o.......#..#",
  "#..#############..####.a#..#",
  "#..#......fffof#.....#..#..#",
  "#..#......fffff#.....#.o#..#",
  "#..#..####..####..#..####..#",
  "#..#..#..#.o#.....#fffff...#",
  "#..#..#.o#..#.....#f2fff...#",
  "#..#..#..#..#..#############",
  "#........#..a......fffff...#",
  "#........#.........fffff..G#",
  "############################"]},
 {id:"dovetail",name:"DOVETAIL",hint:"Zigzag through the joints. Holes hug the line.",theme:"cherry",par:30,grid:[
  "##############################",
  "#...###.......###.......###..#",
  "#.S.###......o###.......###..#",
  "#...###......o###..o....###..#",
  "#...###.......###......o###G.#",
  "#...###.......###.......###..#",
  "#...###..###..###..###.3###..#",
  "#o..###..###o.###..###..###..#",
  "#...###..###..###..###..###..#",
  "#...###..###..###..###o.###..#",
  "#...###.1###..###..###..###..#",
  "#...###..###..###..###o.###..#",
  "#........###.......###..a....#",
  "#o......o###..2....###.......#",
  "#...o.a..###.......###.......#",
  "#........###...a...###o......#",
  "#........###.......###.......#",
  "##############################"]},
 {id:"trenches",name:"THREE TRENCHES",hint:"Three trenches, three bridges. Varnish before the middle one.",theme:"cherry",par:25,grid:[
  "##############################",
  "#......oo.....oo.....oo..o...#",
  "#......oo...a.oo.....oo.o....#",
  "#..S...oo............oo.....o#",
  "#......oo...2........oo...G..#",
  "#......oo.....oo.....oo......#",
  "#......oo.....oo.....oo......#",
  "#..o...oo.....oo.o...oo......#",
  "#......oo.vvv.oo.....ooo.....#",
  "#......oo.vvv.oo.....oo......#",
  "#.o....oo.vvv.oo.....oo.a....#",
  "#......oo.vvv.oo.....oo......#",
  "#......oo.vvv.oo...3.........#",
  "#....1....vvv.oo.............#",
  "#.o.......vvv.oo.....oo......#",
  "#....a.oo.vvv.oo.....oo......#",
  "#......oo.....oo.....oo......#",
  "##############################"]},
 {id:"pinball",name:"PINBALL PARLOR",hint:"A forest of pegs over a field of holes.",theme:"cherry",par:15,grid:[
  "##############################",
  "#............................#",
  "#.S..........................#",
  "#...p...p...p...p...p...p....#",
  "#....o.......................#",
  "#............................#",
  "#.....p...p...p...p...p......#",
  "#............................#",
  "#o...o.......................#",
  "#...p...p...p...p...p...p....#",
  "#.....a......................#",
  "#o...........................#",
  "#.....p.o.p...po..p.a.po..o..#",
  "#...1......................o.#",
  "#...............2............#",
  "#.....o..................o.G.#",
  "#......o.a...................#",
  "##############################"]},
 {id:"baize",name:"BAIZE MAZE",hint:"Felt corridors slow you down. Keep tilting.",theme:"cherry",par:45,grid:[
  "############################",
  "#S.......#...........#.....#",
  "#........#...........#....G#",
  "#######..#..#######..#..#..#",
  "#..#fffff#fff..#.....#.2#..#",
  "#.o#fffff#fff..#.....#..#.o#",
  "#..#ff#######..#..####..####",
  "#..#fffff#fff..#af#offfff..#",
  "#..#ffffo#fff..#ff#ffafff..#",
  "#..####ff#ff####ff#######..#",
  "#...o.#.....#..#ff#fffff#..#",
  "#.....#.....#.o#ff#fffff#..#",
  "#..##########..#ff#ff#ff#..#",
  "#.......a.1.....fffof#fff..#",
  "#....................#.....#",
  "############################"]},
 {id:"glass",name:"GLASS FLOOR",hint:"Varnish everywhere. Small tilts only.",theme:"cherry",par:15,grid:[
  "##############################",
  "#vvvvvvvvv#vvvvvvvvvvvvffffff#",
  "#vvvvvvvvv#vvvvvvvvvvvvfoffff#",
  "#vvvvvvvvv#vvvvvvvvvovvfofGff#",
  "#vvvvvvvvv#vvvvvvvvvvvvffffff#",
  "#vvvvvvvvv#vvvvvovvvvvvvvvvvv#",
  "#vvvvvvvvv#vvvvvvv2vvavvvvvvo#",
  "#vvvvvvvvv#vvvvvvvvv#vvvvvvvv#",
  "#vvvvvvvvv#vvvvvvvvv#vovvvvvv#",
  "#vvvvvvvvv#vvvvvvvvv#vvvvvvvv#",
  "#vvvvvvvvv#vvvvvvvvv#vvvvvvvv#",
  "#vvvvvvvvvvovvvvovvv#vvvvvvvv#",
  "#vvvvvvvvvvvvvvvovva#vvvvvvvv#",
  "#vvvvvvvvvavvvvvvvvv#vvvvvvvv#",
  "#vvSvvvvvvvvvv1vvvvv#vvvvvvvv#",
  "#vvvvvvvvvvvvvvvvvvv#vvvvvvvv#",
  "#vvvvvvvvvvvvvvvvvvv#vvvvvvvv#",
  "##############################"]},
 {id:"cherryknot",name:"CHERRY KNOT",hint:"A longer maze with extra pits.",theme:"cherry",par:40,grid:[
  "############################",
  "#S....#o.#........#o.....o.#",
  "#.....#..#........#........#",
  "####..#..#..#..#..####..####",
  "#.....#.....#..#.....#.....#",
  "#....o#.....#..#.....#...3.#",
  "#..##########..####..####..#",
  "#..#......1.#.....#..#.....#",
  "#..#.o......#.a..o#..#.....#",
  "#..####..#..####..#..#..#..#",
  "#..#.a...#.....#..#..#..#..#",
  "#..#.....#.....#..#..#o.#..#",
  "#..#..#######..#..#..#..#..#",
  "#.....#o......o...#.....#..#",
  "#.....#...........#.2a..#.G#",
  "############################"]},
 {id:"narrow",name:"NARROW GRAIN",hint:"Five thin lanes. Holes leave one safe row.",theme:"walnut",par:50,grid:[
  "##############################",
  "#....o.......oo..............#",
  "#.S..........................#",
  "#.......o............o.......#",
  "##########################1a.#",
  "#............................#",
  "#.....................o......#",
  "#..2##########################",
  "#.....vvvvvvvvvvvvvvvvv......#",
  "#.....vvvvvvvvavvvvvovv......#",
  "##########################3..#",
  "#............................#",
  "#....a..............o........#",
  "#..4##########################",
  "#....................o.o.....#",
  "#..........................G.#",
  "#............................#",
  "##############################"]},
 {id:"crosscut",name:"CROSSCUT",hint:"Visit every corner. Four bridges, pegs on guard.",theme:"walnut",par:30,grid:[
  "##############################",
  "#.............oo....a....p...#",
  "#.............oo.............#",
  "#..S......................1..#",
  "#...........................p#",
  "#.............oo.......o..o..#",
  "#......o..a...oop.....o......#",
  "#......o......oo..o..........#",
  "#oooo..oooooooooooooooo..oooo#",
  "#oooo..oooooooooooooooo..oooo#",
  "#.............oo.............#",
  "#.............oo.............#",
  "#.p......a....oo..p..........#",
  "#..................p.........#",
  "#..2......................G..#",
  "#.............oo.............#",
  "#.............oo.....pp......#",
  "##############################"]},
 {id:"varnspiral",name:"VARNISHED SPIRAL",hint:"A mirrored spiral with slick straights.",theme:"walnut",par:50,grid:[
  "##############################",
  "#....vvvvvvvvvvvvvvvvvvvvS...#",
  "#....vvvvvvvvvvvvvvvvvvvvv...#",
  "#..###########################",
  "#..#oo...............#.o.....#",
  "#o.#.................#.......#",
  "#..#..##################..#..#",
  "#a.#.o.......o..o.....o#..#..#",
  "#..#...................#..#..#",
  "#.1#.3###############..#..#2a#",
  "#..#..#a.G.............#..#..#",
  "#..#..##################..#..#",
  "#..#......................#..#",
  "#..#......................#..#",
  "#..########################..#",
  "#...vvvvvvvvvvvvvvvvvvvvvv...#",
  "#o..vvvvvvvvvovvvvvvvvvvvv...#",
  "##############################"]},
 {id:"forest",name:"PEG FOREST",hint:"Pegs, felt and holes. Pick your gaps.",theme:"walnut",par:20,grid:[
  "##############################",
  "#.........#..................#",
  "#.........#................G.#",
  "#.........#.....o.......p....#",
  "#........p#....p..p.p........#",
  "#.........#.ppa.p.....pa.....#",
  "#.......p.#.....p.o.o........#",
  "#............2.........3.....#",
  "#...........fffoff...........#",
  "#.........p.ffffpf....o....oo#",
  "#...........fffpff......p.p..#",
  "#...........p.o....#.........#",
  "#.p.ppp.o.p.p...p..#.........#",
  "#....p....app......#.........#",
  "#..............o...#.........#",
  "#.S........1....p..#.........#",
  "#.......p......p...#.........#",
  "##############################"]},
 {id:"clockwork",name:"CLOCKWORK RINGS",hint:"Ring by ring into the middle.",theme:"walnut",par:30,grid:[
  "##############################",
  "#.S...............a........o.#",
  "#...................1........#",
  "#..########################..#",
  "#o.#...oo............o.a..#..#",
  "#..#.3..................2.#..#",
  "#..#..##################..#..#",
  "#..#..#a.........oo....#..#..#",
  "#..#................G..#o....#",
  "#..#..........oo.......#.....#",
  "#..#..#..o.......o.....#..#..#",
  "#..#..##################..#..#",
  "#..#......................#..#",
  "#..#......................#..#",
  "#..########################..#",
  "#vvvvvvvvvvvvvvvvvvvvvvvvvvvv#",
  "#vvvvvvvvvvvvvvvvvvvvvvvvvvvv#",
  "##############################"]},
 {id:"heartwood",name:"HEARTWOOD MAZE",hint:"The final board. Recenter with Y whenever you need to.",theme:"walnut",par:35,grid:[
  "############################",
  "#S..........#o..........#..#",
  "#...........#.......o...#.G#",
  "##########..#######..#..#..#",
  "#..#........#.....#..#.....#",
  "#.o#....o...#.....#..#.2...#",
  "#..#..#######..#..#..#######",
  "#..#a.#......1.#..#.a#.o...#",
  "#..#..#........#..#..#.....#",
  "#..#..#..#######..#..#..#..#",
  "#..#.....#.....#o.#.....#..#",
  "#..#.....#....o#..#.....#..#",
  "#..#######..####..#######..#",
  "#..............a...........#",
  "#.........o................#",
  "############################"]}
];

// Timber Tilt model: level parsing, guide path and fixed-step ball physics.
// Pure JavaScript; no DOM, native or console access. Units are board cells.
var TimberPhysics=(function(){
    "use strict";
    var BALL_R=0.42,HOLE_R=0.55,GOAL_R=0.5,CHECK_R=0.8,ACCEL=14,FRICTION=0.75,MAX_SPEED=13,BOUNCE=0.35,STEP=1/240;
    // Surfaces: 0 bare wood, 1 green felt (slow), 2 varnish (slick). Pegs are round brass posts.
    var PEG_R=0.3,PEG_BOUNCE=0.8,ACORN_R=0.62,SURFACE_FRICTION=[FRICTION,3.2,0.16];
    // Wall contact: impacts faster than IMPACT_V bounce and lose IMPACT_SCRUB of their sliding speed once;
    // slower contact is a slide with light friction per 1/240 s step (0.9995^240 = about 0.89 per second).
    var IMPACT_V=0.6,IMPACT_SCRUB=0.12,WALL_ROLL=0.9995;
    function clamp(v,a,b){return v<a?a:v>b?b:v;}
    function parse(def){
        var grid=def.grid,h=grid.length,w=grid[0].length,walls=[],holes=[],checkpoints=[],pegs=[],acorns=[],surface=[],start=null,goal=null;
        for(var r=0;r<h;r++){
            if(grid[r].length!==w)throw Error(def.id+": ragged row "+r);
            walls.push([]);surface.push([]);
            for(var c=0;c<w;c++){
                var ch=grid[r][c],edge=r===0||c===0||r===h-1||c===w-1;
                if(edge&&ch!=="#")throw Error(def.id+": open border at "+c+","+r);
                walls[r].push(ch==="#");surface[r].push(ch==="f"?1:ch==="v"?2:0);
                var p={x:c+0.5,y:r+0.5,c:c,r:r};
                if(ch==="o")holes.push(p);else if(ch==="S")start=p;else if(ch==="G")goal=p;
                else if(ch>="1"&&ch<="9"){p.n=Number(ch);checkpoints.push(p);}
                else if(ch==="p")pegs.push(p);else if(ch==="a")acorns.push(p);
                else if(ch!=="#"&&ch!=="."&&ch!=="f"&&ch!=="v")throw Error(def.id+": bad cell "+ch);
            }
        }
        if(!start||!goal)throw Error(def.id+": start/goal missing");
        checkpoints.sort(function(a,b){return a.n-b.n;});
        checkpoints.forEach(function(p,i){if(p.n!==i+1)throw Error(def.id+": checkpoint numbering gap");});
        var level={id:def.id,name:def.name,hint:def.hint||"",theme:def.theme||"pine",par:def.par||null,w:w,h:h,walls:walls,surface:surface,holes:holes,pegs:pegs,acorns:acorns,goal:goal,start:start,checkpoints:checkpoints};
        level.holeAt=holeIndex(level);level.pegAt={};pegs.forEach(function(p){level.pegAt[p.c+","+p.r]=true;});level.path=guide(level);return level;
    }
    function holeIndex(level){var m={};level.holes.forEach(function(p){m[p.c+","+p.r]=true;});return m;}
    function isWall(level,c,r){return c<0||r<0||c>=level.w||r>=level.h||level.walls[r][c];}
    // Cheapest cell route S -> 1 -> ... -> G, avoiding holes and preferring centre lines.
    function route(level,from,to){
        var w=level.w,h=level.h,cost=new Float64Array(w*h).fill(Infinity),prev=new Int32Array(w*h).fill(-1),done=new Uint8Array(w*h),open=[from.r*w+from.c];
        cost[open[0]]=0;
        function penalty(c,r){var p=1;for(var dr=-1;dr<=1;dr++)for(var dc=-1;dc<=1;dc++){if(level.holeAt[(c+dc)+","+(r+dr)])p+=2.5;if(isWall(level,c+dc,r+dr)||level.pegAt[(c+dc)+","+(r+dr)])p+=0.35;}if(level.surface[r][c]===1)p+=0.6;return p;}
        while(open.length){
            var best=0;for(var i=1;i<open.length;i++)if(cost[open[i]]<cost[open[best]])best=i;
            var cur=open.splice(best,1)[0];if(done[cur])continue;done[cur]=1;if(cur===to.r*w+to.c)break;
            var cc=cur%w,cr=(cur-cc)/w;
            [[1,0],[-1,0],[0,1],[0,-1]].forEach(function(d){var nc=cc+d[0],nr=cr+d[1],n=nr*w+nc;if(isWall(level,nc,nr)||level.holeAt[nc+","+nr]||level.pegAt[nc+","+nr]||done[n])return;var v=cost[cur]+penalty(nc,nr);if(v<cost[n]){cost[n]=v;prev[n]=cur;open.push(n);}});
        }
        var end=to.r*w+to.c;if(!done[end])return null;
        var cells=[];for(var k=end;k!==-1;k=prev[k])cells.push({x:k%w+0.5,y:Math.floor(k/w)+0.5});return cells.reverse();
    }
    function guide(level){
        var stops=[level.start].concat(level.checkpoints,[level.goal]),cells=[];
        for(var i=0;i+1<stops.length;i++){var part=route(level,stops[i],stops[i+1]);if(!part)throw Error(level.id+": no route to stop "+(i+1));cells=cells.concat(i?part.slice(1):part);}
        var line=[cells[0]];
        for(var j=1;j<cells.length-1;j++){var a=line[line.length-1],b=cells[j],n=cells[j+1];var cross=(b.x-a.x)*(n.y-b.y)-(b.y-a.y)*(n.x-b.x),dot=(b.x-a.x)*(n.x-b.x)+(b.y-a.y)*(n.y-b.y);if(cross!==0||dot<=0)line.push(b);}
        line.push(cells[cells.length-1]);
        return {cells:cells,line:line};
    }
    function create(level){return {level:level,x:level.start.x,y:level.start.y,vx:0,vy:0,mode:"ready",timer:0.7,fall:0,elapsed:0,falls:0,checkpoint:0,respawn:{x:level.start.x,y:level.start.y},bumps:0,pegHits:0,maxSpeed:0,events:[],
        acorns:level.acorns.map(function(){return false;}),acornCount:0,hit:null};}
    function noteHit(s,kind,nx,ny,v){if(!s.hit||v>s.hit.v)s.hit={kind:kind,nx:nx,ny:ny,v:v};}
    function respawn(s){s.x=s.respawn.x;s.y=s.respawn.y;s.vx=0;s.vy=0;s.mode="ready";s.timer=0.8;}
    function collide(s){
        var level=s.level,hit=false;
        for(var r=Math.floor(s.y-BALL_R);r<=Math.floor(s.y+BALL_R);r++)for(var c=Math.floor(s.x-BALL_R);c<=Math.floor(s.x+BALL_R);c++){
            if(!isWall(level,c,r))continue;
            var px=clamp(s.x,c,c+1),py=clamp(s.y,r,r+1),dx=s.x-px,dy=s.y-py,d2=dx*dx+dy*dy;
            if(d2>=BALL_R*BALL_R)continue;
            var d=Math.sqrt(d2),nx,ny;
            if(d<1e-6){var ex=s.x-(c+0.5),ey=s.y-(r+0.5);if(Math.abs(ex)>Math.abs(ey)){nx=ex<0?-1:1;ny=0;}else{nx=0;ny=ey<0?-1:1;}d=0;}
            else{nx=dx/d;ny=dy/d;}
            s.x+=nx*(BALL_R-d);s.y+=ny*(BALL_R-d);
            var vn=s.vx*nx+s.vy*ny;
            if(vn<0){
                if(vn<-2){hit=true;noteHit(s,"wall",nx,ny,-vn);}
                if(vn<-IMPACT_V){
                    // Real impact: bounce, and scrub some sliding speed once.
                    s.vx-=(1+BOUNCE)*vn*nx;s.vy-=(1+BOUNCE)*vn*ny;
                    var vt=s.vx*-ny+s.vy*nx;s.vx-=vt*IMPACT_SCRUB*-ny;s.vy-=vt*IMPACT_SCRUB*nx;
                }else{
                    // Resting/sliding contact (runs every 1/240 s): cancel only the push into the
                    // wall and apply light rolling friction, so the ball keeps rolling along it.
                    s.vx-=vn*nx;s.vy-=vn*ny;s.vx*=WALL_ROLL;s.vy*=WALL_ROLL;
                }
            }
        }
        if(hit)s.bumps++;
        return hit;
    }
    function pegs(s){
        var list=s.level.pegs,hit=false,reach=BALL_R+PEG_R;
        for(var i=0;i<list.length;i++){
            var p=list[i],dx=s.x-p.x,dy=s.y-p.y;if(Math.abs(dx)>=reach||Math.abs(dy)>=reach)continue;
            var d=Math.sqrt(dx*dx+dy*dy);if(d>=reach)continue;
            var nx=d>1e-6?dx/d:1,ny=d>1e-6?dy/d:0;s.x=p.x+nx*reach;s.y=p.y+ny*reach;
            var vn=s.vx*nx+s.vy*ny;if(vn<0){s.vx-=(1+PEG_BOUNCE)*vn*nx;s.vy-=(1+PEG_BOUNCE)*vn*ny;if(vn<-1.2){hit=true;noteHit(s,"peg",nx,ny,-vn);}}
        }
        if(hit)s.pegHits++;
        return hit;
    }
    function surfaceAt(level,x,y){var c=Math.floor(x),r=Math.floor(y);return r>=0&&c>=0&&r<level.h&&c<level.w?level.surface[r][c]:0;}
    function pit(s,p,radius,pull,dt){
        var dx=p.x-s.x,dy=p.y-s.y,d=Math.sqrt(dx*dx+dy*dy);
        if(d<radius)return true;
        if(d<radius+pull&&d>1e-6){var f=(radius+pull-d)*30*dt/d;s.vx+=dx*f;s.vy+=dy*f;}
        return false;
    }
    // tilt: {x,y} in [-1,1]; positive x rolls right, positive y rolls toward the bottom of the screen.
    function step(s,tilt,dt){
        s.events.length=0;s.hit=null;dt=clamp(dt,0,0.1);
        if(s.mode==="won")return s;
        if(s.mode==="ready"){s.timer-=dt;if(s.timer<=0)s.mode="rolling";return s;}
        if(s.mode==="falling"){s.fall+=dt/0.6;if(s.fall>=1){s.fall=0;respawn(s);s.events.push("respawn");}return s;}
        s.elapsed+=dt;
        var tx=clamp(tilt&&tilt.x||0,-1,1),ty=clamp(tilt&&tilt.y||0,-1,1),level=s.level;
        for(var t=0;t<dt-1e-9;t+=STEP){
            var h=Math.min(STEP,dt-t);
            s.vx+=tx*ACCEL*h;s.vy+=ty*ACCEL*h;
            var damp=Math.max(0,1-SURFACE_FRICTION[surfaceAt(level,s.x,s.y)]*h);s.vx*=damp;s.vy*=damp;
            var sp=Math.sqrt(s.vx*s.vx+s.vy*s.vy);if(sp>MAX_SPEED){s.vx*=MAX_SPEED/sp;s.vy*=MAX_SPEED/sp;sp=MAX_SPEED;}
            if(sp>s.maxSpeed)s.maxSpeed=sp;
            s.x+=s.vx*h;s.y+=s.vy*h;
            if(collide(s)&&s.events.indexOf("bump")<0)s.events.push("bump");
            if(level.pegs.length&&pegs(s)&&s.events.indexOf("peg")<0)s.events.push("peg");
            for(var a=0;a<level.acorns.length;a++)if(!s.acorns[a]&&Math.abs(level.acorns[a].x-s.x)<ACORN_R&&Math.abs(level.acorns[a].y-s.y)<ACORN_R){s.acorns[a]=true;s.acornCount++;s.events.push("acorn");}
            if(pit(s,level.goal,GOAL_R,0.35,h)){s.mode="won";s.x=level.goal.x;s.y=level.goal.y;s.vx=s.vy=0;s.events.push("won");return s;}
            for(var i=0;i<level.holes.length;i++)if(pit(s,level.holes[i],HOLE_R,0.2,h)){s.mode="falling";s.fall=0;s.falls++;s.hole=level.holes[i];s.vx=s.vy=0;s.events.push("fall");return s;}
            for(var k=s.checkpoint;k<level.checkpoints.length;k++){var cp=level.checkpoints[k];if(Math.abs(cp.x-s.x)<CHECK_R&&Math.abs(cp.y-s.y)<CHECK_R){s.checkpoint=k+1;s.respawn={x:cp.x,y:cp.y};s.events.push("checkpoint");}}
        }
        return s;
    }
    return {BALL_R:BALL_R,HOLE_R:HOLE_R,GOAL_R:GOAL_R,PEG_R:PEG_R,clamp:clamp,surfaceAt:surfaceAt,parse:parse,create:create,step:step,respawn:respawn,isWall:isWall};
})();
if(typeof module!=="undefined")module.exports=TimberPhysics;

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

// Timber Tilt block lettering: a 5x7 font drawn with integer-aligned fillRect only.
// Every letter is one flat colour (no system font, anti-aliased edges or shading).
var createTimberFont=function(ctx){
    "use strict";
    var G={
        "A":".###.#...##...#######...##...##...#","B":"####.#...##...#####.#...##...#####.","C":".###.#...##....#....#....#...#.###.",
        "D":"####.#...##...##...##...##...#####.","E":"######....#....####.#....#....#####","F":"######....#....####.#....#....#....",
        "G":".###.#...##....#.####...##...#.####","H":"#...##...##...#######...##...##...#","I":".###...#....#....#....#....#...###.",
        "J":"..###...#....#....#....##..#..##...","K":"#...##..#.#.#..##...#.#..#..#.#...#","L":"#....#....#....#....#....#....#####",
        "M":"#...###.###.#.##.#.##...##...##...#","N":"#...##...###..##.#.##..###...##...#","O":".###.#...##...##...##...##...#.###.",
        "P":"####.#...##...#####.#....#....#....","Q":".###.#...##...##...##.#.##..#..##.#","R":"####.#...##...#####.#.#..#..#.#...#",
        "S":".#####....#.....###.....#....#####.","T":"#####..#....#....#....#....#....#..","U":"#...##...##...##...##...##...#.###.",
        "V":"#...##...##...##...##...#.#.#...#..","W":"#...##...##...##.#.##.#.##.#.#.#.#.","X":"#...##...#.#.#...#...#.#.#...##...#",
        "Y":"#...##...#.#.#...#....#....#....#..","Z":"#####....#...#...#...#...#....#####",
        "0":".###.#...##..###.#.###..##...#.###.","1":"..#...##....#....#....#....#...###.","2":".###.#...#....#...#...#...#...#####",
        "3":"####.....#....#.###.....#....#####.","4":"...#...##..#.#.#..#.#####...#....#.","5":"######....####.....#....##...#.###.",
        "6":"..##..#...#....####.#...##...#.###.","7":"#####....#...#...#...#....#....#...","8":".###.#...##...#.###.#...##...#.###.",
        "9":".###.#...##...#.####....#...#..##..",
        ".":"..........................##...##..",",":".....................##....#...#...",
        ":":".......##..##.........##..##.......",";":".......##..##.........##...#...#...","!":"..#....#....#....#....#.........#..","?":".###.#...#....#...#...#.........#..",
        "-":"...............#####...............","+":".......#....#..#####..#....#.......","/":"....#...#....#...#...#....#...#....",
        "'":"..#....#...#.......................","\"":".#.#..#.#..........................","(":"...#...#...#....#....#.....#.....#.",
        ")":".#.....#.....#....#....#...#...#...","%":"##..###..#...#...#...#...#..###..##","#":".#.#..#.#.#####.#.#.#####.#.#..#.#.",
        "=":"..........#####.....#####..........","<":"...#...#...#...#.....#.....#.....#.",">":".#.....#.....#.....#...#...#...#...",
        "*":".....#.#.#.###.#####.###.#.#.#.....","_":"..............................#####"," ":""
    };
    var rects={};
    // Decompose each glyph into horizontal runs, then merge identical runs on consecutive rows.
    Object.keys(G).forEach(function(k){
        var bits=G[k],open=[],out=[];
        for(var r=0;r<7;r++){
            var runs=[],c=0;
            while(c<5){if(bits.charAt(r*5+c)==="#"){var c0=c;while(c<5&&bits.charAt(r*5+c)==="#")c++;runs.push([c0,c-c0]);}else c++;}
            var next=[];
            runs.forEach(function(run){var m=null;for(var i=0;i<open.length;i++)if(open[i][0]===run[0]&&open[i][2]===run[1]){m=open[i];open.splice(i,1);break;}if(m){m[3]++;next.push(m);}else next.push([run[0],r,run[1],1]);});
            open.forEach(function(o){out.push(o);});open=next;
        }
        open.forEach(function(o){out.push(o);});rects[k]=out;
    });
    function scaleFor(size){return Math.max(2,Math.round((size||18)/10));}
    function width(s,size){var k=scaleFor(size),n=String(s).length;return n?n*6*k-k:0;}
    // y is the baseline (bottom of the capitals), as in the earlier text calls.
    function draw(s,x,y,size,color,align){
        s=String(s).toUpperCase();var k=scaleFor(size),bold=Math.floor(k/2),wd=width(s,size);
        var x0=Math.round(align==="center"?x-wd/2:align==="right"?x-wd:x),y0=Math.round(y)-7*k;
        ctx.fillStyle=color||"#fbeedd";
        for(var i=0;i<s.length;i++){var g=rects[s.charAt(i)]||rects["?"],ox=x0+i*6*k;for(var j=0;j<g.length;j++){var q=g[j];ctx.fillRect(ox+q[0]*k,y0+q[1]*k,q[2]*k+bold,q[3]*k);}}
        return wd;
    }
    return {draw:draw,width:width,scale:scaleFor,glyphs:Object.keys(G).length,has:function(ch){return Object.prototype.hasOwnProperty.call(G,String(ch).toUpperCase());}};
};
if(typeof module!=="undefined")module.exports=createTimberFont;

// Timber Tilt Canvas renderer: perspective wooden board drawn with plain paths/arcs/fillRect.
// No images, gradients, pixel access, SVG or system fonts (lettering comes from font.js).
var createTimberView=function(ctx){
    "use strict";
    var W=1280,H=720,WALL_H=0.72,SLAB=0.9,D=44,VIEW=0.42,MAX_TILT=0.1;
    var font=createTimberFont(ctx);
    var level=null,runs=[],rows=[],grain=[],patches=[],dashes=[],rowPegs=[],rowAcorns=[],F=1,CX=640,CY=390,ca=1,sa=0,cb=1,sb=0,cc=Math.cos(VIEW),sc=Math.sin(VIEW),hw=0,hh=0;
    // Translucent colors are unverified on the console canvas: probe once and fall back to solid tones.
    var alphaOK=(function(){try{ctx.fillStyle="#123456";ctx.fillStyle="rgba(1,2,3,0.5)";var v=String(ctx.fillStyle).replace(/\s/g,"").toLowerCase();return v!=="#123456"&&v.indexOf("0.5")>=0;}catch(_){return false;}})();
    function col(rgba,solid){return alphaOK?rgba:solid;}
    var light=(function(){var v=[-0.35,-0.55,1],l=Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);return [v[0]/l,v[1]/l,v[2]/l];})();
    // One wood species per chapter.
    var THEMES={
        pine:{name:"PINE",floor:[228,192,136],wall:[184,128,70],frame:[126,80,42],slab:[92,58,30],bg:["#2a1d12","#302215"],grain:[176,124,66],inlay:"#9c6a36"},
        oak:{name:"OAK",floor:[204,158,98],wall:[146,96,50],frame:[98,62,30],slab:[70,42,20],bg:["#231a10","#2a2014"],grain:[160,112,60],inlay:"#5e3a1a"},
        cherry:{name:"CHERRY",floor:[214,142,102],wall:[158,78,48],frame:[110,46,28],slab:[76,30,18],bg:["#26120d","#2d1711"],grain:[178,102,68],inlay:"#e3c08a"},
        walnut:{name:"WALNUT",floor:[156,110,74],wall:[98,64,40],frame:[64,40,24],slab:[42,26,16],bg:["#140f0b","#1a140f"],grain:[124,84,54],inlay:"#d9b45a"}
    };
    var theme=THEMES.pine;
    function rgb(c,k){k=k||1;return "rgb("+Math.round(Math.min(255,c[0]*k))+","+Math.round(Math.min(255,c[1]*k))+","+Math.round(Math.min(255,c[2]*k))+")";}
    function setTilt(tx,ty){var a=tx*MAX_TILT,b=ty*MAX_TILT;ca=Math.cos(a);sa=Math.sin(a);cb=Math.cos(b);sb=Math.sin(b);}
    // Board cell coordinates (c,r,z) -> rotated camera frame.
    function rot(X,Y,Z){var x1=X*ca+Z*sa,z1=-X*sa+Z*ca,y2=Y*cb+z1*sb,z2=-Y*sb+z1*cb;return [x1,y2*cc-z2*sc,z2*cc+y2*sc];}
    function proj(c,r,z){var p=rot(c-hw,r-hh,z),d=D-p[2];return [CX+F*p[0]/d,CY+F*p[1]/d,d];}
    function visible(n,c,r,z){var m=rot(n[0],n[1],n[2]),p=rot(c-hw,r-hh,z);return m[0]*(0-p[0])+m[1]*(0-p[1])+m[2]*(D-p[2])>0;}
    function shadeK(n){var m=rot(n[0],n[1],n[2]);return 0.58+0.42*Math.max(0,m[0]*light[0]+m[1]*light[1]+m[2]*light[2]);}
    function shade(c,n){return rgb(c,shadeK(n));}
    function poly(points,color){ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);for(var i=1;i<points.length;i++)ctx.lineTo(points[i][0],points[i][1]);ctx.closePath();ctx.fillStyle=color;ctx.fill();}
    function quad(a,b,c2,d,color){poly([proj(a[0],a[1],a[2]),proj(b[0],b[1],b[2]),proj(c2[0],c2[1],c2[2]),proj(d[0],d[1],d[2])],color);}
    function flat(c0,r0,c1,r1,z,color){quad([c0,r0,z],[c1,r0,z],[c1,r1,z],[c0,r1,z],color);}
    function disc(x,y,z,radius,color,n){var pts=[];n=n||14;for(var i=0;i<n;i++){var t=i/n*Math.PI*2;pts.push(proj(x+Math.cos(t)*radius,y+Math.sin(t)*radius,z));}poly(pts,color);}
    function isWall(c,r){return c<0||r<0||c>=level.w||r>=level.h||level.walls[r][c];}
    function border(c,r){return c===0||r===0||c===level.w-1||r===level.h-1;}
    function setLevel(l){
        if(l===level)return;level=l;theme=THEMES[l.theme]||THEMES.pine;hw=l.w/2;hh=l.h/2;runs=[];rows=[];grain=[];patches=[];dashes=[];rowPegs=[];rowAcorns=[];
        for(var r=0;r<l.h;r++){
            rows.push([]);rowPegs.push([]);rowAcorns.push([]);
            for(var c=0;c<l.w;c++){
                if(!l.walls[r][c])continue;
                var b=border(c,r),c1=c;while(c1+1<l.w&&l.walls[r][c1+1]&&border(c1+1,r)===b&&!(b&&r>0&&r<l.h-1))c1++;
                var run={c0:c,c1:c1,r:r,frame:b,south:[],north:[]};
                ["south","north"].forEach(function(side){var dr=side==="south"?1:-1,start=null;for(var k=c;k<=c1+1;k++){var open=k<=c1&&!isWall(k,r+dr);if(open&&start===null)start=k;if(!open&&start!==null){run[side].push([start,k]);start=null;}}});
                run.west=!isWall(c-1,r);run.east=!isWall(c1+1,r);
                runs.push(run);rows[r].push(run);c=c1;
            }
            for(var k=0;k<l.w;k++){var t=l.surface[r][k];if(!t)continue;var k1=k;while(k1+1<l.w&&l.surface[r][k1+1]===t)k1++;patches.push({c0:k,c1:k1+1,r:r,type:t});k=k1;}
        }
        l.pegs.forEach(function(p){rowPegs[p.r].push(p);});
        l.acorns.forEach(function(p,i){rowAcorns[p.r].push({p:p,i:i});});
        for(var g=0;g*0.62<l.h;g++){var line=[];for(var x=0;x<=l.w+0.01;x+=1.25)line.push([x,g*0.62+0.2*Math.sin(x*0.5+g*1.7)+0.08*Math.sin(x*1.7+g*0.6)]);grain.push(line);}
        // Dotted guide: short dashes along the route polyline.
        // Dash k covers [k*period, k*period+on] of the route length, split at corners.
        var on=0.38,period=0.72,line2=l.path.line,segs=[],total=0;
        for(var i=0;i+1<line2.length;i++){var a=line2[i],b2=line2[i+1],len=Math.hypot(b2.x-a.x,b2.y-a.y);if(len>0){segs.push({a:a,b:b2,s:total,len:len});total+=len;}}
        function at(seg,d){var u=Math.max(0,Math.min(1,(d-seg.s)/seg.len));return [seg.a.x+(seg.b.x-seg.a.x)*u,seg.a.y+(seg.b.y-seg.a.y)*u];}
        for(var k=0;k*period<total&&k<4000;k++){var d0=k*period,d1=Math.min(total,d0+on);segs.forEach(function(sg){if(sg.s+sg.len<=d0||sg.s>=d1)return;var p0=at(sg,Math.max(d0,sg.s)),p1=at(sg,Math.min(d1,sg.s+sg.len));dashes.push([p0[0],p0[1],p1[0],p1[1]]);});}
        // Fit the untilted board, frame and slab inside the play area below the HUD.
        setTilt(0,0);F=1;CX=0;CY=0;var u0b=1e9,u1b=-1e9,v0=1e9,v1=-1e9;
        [[0,0],[l.w,0],[0,l.h],[l.w,l.h]].forEach(function(p){[-SLAB,WALL_H].forEach(function(z){var q=proj(p[0],p[1],z);u0b=Math.min(u0b,q[0]);u1b=Math.max(u1b,q[0]);v0=Math.min(v0,q[1]);v1=Math.max(v1,q[1]);});});
        F=Math.min(1190/(u1b-u0b),628/(v1-v0));CX=640-F*(u0b+u1b)/2;CY=392-F*(v0+v1)/2;
    }
    function text(s,x,y,size,color,align){return font.draw(s,x,y,size,color,align);}
    function holeSet(list,radius,colors){
        list.forEach(function(p){disc(p.x,p.y,0,radius+0.1,colors[0]);});
        list.forEach(function(p){disc(p.x,p.y,0,radius,colors[1]);});
        list.forEach(function(p){disc(p.x,p.y+0.12,0,radius*0.78,colors[2]);});
    }
    function ball(x,y,z,scaleK,dark){
        var R=TimberPhysics.BALL_R*scaleK,p=proj(x,y,z+R),s=F*R/p[2];if(s<0.6)return;
        ctx.beginPath();ctx.arc(p[0],p[1],s,0,Math.PI*2);ctx.fillStyle="#4f5861";ctx.fill();
        ctx.beginPath();ctx.arc(p[0]-s*0.1,p[1]-s*0.1,s*0.86,0,Math.PI*2);ctx.fillStyle="#8f9aa5";ctx.fill();
        ctx.beginPath();ctx.arc(p[0]-s*0.22,p[1]-s*0.24,s*0.55,0,Math.PI*2);ctx.fillStyle="#b9c3cc";ctx.fill();
        ctx.beginPath();ctx.arc(p[0]-s*0.36,p[1]-s*0.4,s*0.24,0,Math.PI*2);ctx.fillStyle="#eef4f8";ctx.fill();
        if(dark>0&&(alphaOK||dark>0.5)){ctx.beginPath();ctx.arc(p[0],p[1],s*1.02,0,Math.PI*2);ctx.fillStyle=col("rgba(20,10,4,"+Math.min(0.92,dark).toFixed(3)+")","#140a04");ctx.fill();}
    }
    // Round brass post: dark base, side band, bright cap.
    function peg(p){
        var R=TimberPhysics.PEG_R,Hp=0.5,b0=proj(p.x-R,p.y,0),b1=proj(p.x+R,p.y,0),t0=proj(p.x-R,p.y,Hp),t1=proj(p.x+R,p.y,Hp);
        disc(p.x+0.1,p.y+0.14,0,R*1.05,col("rgba(40,20,6,0.35)",rgb(theme.floor,0.78)),12);
        disc(p.x,p.y,0,R,"#6e5216",12);poly([b0,b1,t1,t0],"#9a7426");
        disc(p.x,p.y,Hp,R,"#d8b04a",12);disc(p.x-0.08,p.y-0.08,Hp,R*0.45,"#f4dc8c",8);
    }
    function acorn(p){
        var b=proj(p.x,p.y,0.2),s=F*0.2/b[2];
        disc(p.x+0.08,p.y+0.1,0,0.24,col("rgba(40,20,6,0.3)",rgb(theme.floor,0.8)),10);
        ctx.beginPath();ctx.arc(b[0],b[1]+s*0.25,s*1.0,0,Math.PI*2);ctx.fillStyle="#b5732f";ctx.fill();
        ctx.beginPath();ctx.arc(b[0]-s*0.3,b[1]+s*0.05,s*0.32,0,Math.PI*2);ctx.fillStyle="#d89a52";ctx.fill();
        ctx.fillStyle="#5a3a1c";ctx.beginPath();ctx.arc(b[0],b[1]-s*0.35,s*1.08,Math.PI,Math.PI*2);ctx.closePath();ctx.fill();
        ctx.fillRect(Math.round(b[0]-s*0.12),Math.round(b[1]-s*1.75),Math.max(2,Math.round(s*0.26)),Math.round(s*0.5));
    }
    function flag(g){
        var base=proj(g.x,g.y,0),top=proj(g.x,g.y,1.7),tip=proj(g.x+0.95,g.y,1.42),low=proj(g.x,g.y,1.12);
        ctx.strokeStyle="#3a2414";ctx.lineWidth=Math.max(2,F*0.06/D);ctx.beginPath();ctx.moveTo(base[0],base[1]);ctx.lineTo(top[0],top[1]);ctx.stroke();
        poly([top,tip,low],"#2f6a8a");poly([top,proj(g.x+0.5,g.y,1.56),proj(g.x+0.5,g.y,1.28),low],"#3f86ad");
    }
    function drawRun(run){
        var top=run.frame?theme.frame:theme.wall,r=run.r,x0=run.c0,x1=run.c1+1;
        if(run.west&&visible([-1,0,0],x0,r+0.5,WALL_H/2))quad([x0,r,0],[x0,r+1,0],[x0,r+1,WALL_H],[x0,r,WALL_H],shade(top,[-1,0,0]));
        if(run.east&&visible([1,0,0],x1,r+0.5,WALL_H/2))quad([x1,r,0],[x1,r+1,0],[x1,r+1,WALL_H],[x1,r,WALL_H],shade(top,[1,0,0]));
        if(visible([0,-1,0],(x0+x1)/2,r,WALL_H/2))run.north.forEach(function(s){quad([s[0],r,0],[s[1],r,0],[s[1],r,WALL_H],[s[0],r,WALL_H],shade(top,[0,-1,0]));});
        if(visible([0,1,0],(x0+x1)/2,r+1,WALL_H/2))run.south.forEach(function(s){quad([s[0],r+1,0],[s[1],r+1,0],[s[1],r+1,WALL_H],[s[0],r+1,WALL_H],shade(top,[0,1,0]));});
        flat(x0,r,x1,r+1,WALL_H,shade(top,[0,0,1]));
        // Inlaid strip along the top of interior fences (a marquetry line).
        if(!run.frame&&x1-x0>=2)flat(x0+0.2,r+0.42,x1-0.2,r+0.58,WALL_H,theme.inlay);
    }
    function corners(){
        var w=level.w,h=level.h,k=shadeK([0,0,1]);
        [[0,0],[w-1,0],[0,h-1],[w-1,h-1]].forEach(function(p){flat(p[0]+0.08,p[1]+0.08,p[0]+0.92,p[1]+0.92,WALL_H,rgb([216,176,74],k));disc(p[0]+0.5,p[1]+0.5,WALL_H,0.14,"#7a5a1e",8);});
    }
    // state: physics state (or null for an empty demo board); opts: {tilt:{x,y}, path:true}
    function board(state,opts){
        opts=opts||{};var t=opts.tilt||{x:0,y:0};setTilt(t.x,t.y);
        ctx.fillStyle=theme.bg[0];ctx.fillRect(0,0,W,H);
        ctx.fillStyle=theme.bg[1];for(var i=0;i<9;i++)ctx.fillRect(0,i*80+40,W,40);
        var l=level,w=l.w,h=l.h;
        // Slab sides and outer frame faces (visible ones only).
        [[[0,-1,0],[0,0],[w,0]],[[0,1,0],[w,h],[0,h]],[[-1,0,0],[0,h],[0,0]],[[1,0,0],[w,0],[w,h]]].forEach(function(f){var n=f[0],a=f[1],b=f[2];if(visible(n,(a[0]+b[0])/2,(a[1]+b[1])/2,0))quad([a[0],a[1],-SLAB],[b[0],b[1],-SLAB],[b[0],b[1],WALL_H],[a[0],a[1],WALL_H],shade(theme.slab,n));});
        var fk=shadeK([0,0,1]);flat(0,0,w,h,0,rgb(theme.floor,fk));
        ctx.strokeStyle=col("rgba("+theme.grain.join(",")+",0.45)",rgb(theme.grain.map(function(v,j){return (v+theme.floor[j]*1.4)/2.4;}),fk));ctx.lineWidth=2;
        grain.forEach(function(line){ctx.beginPath();line.forEach(function(p,k){var q=proj(p[0],p[1],0);if(k)ctx.lineTo(q[0],q[1]);else ctx.moveTo(q[0],q[1]);});ctx.stroke();});
        // Felt pads and varnish strips.
        patches.forEach(function(p){
            if(p.type===1){flat(p.c0,p.r,p.c1,p.r+1,0,rgb([58,112,72],fk));flat(p.c0+0.1,p.r+0.42,p.c1-0.1,p.r+0.5,0,rgb([46,94,60],fk));}
            else{flat(p.c0,p.r,p.c1,p.r+1,0,rgb(theme.floor,fk*1.13));for(var x=p.c0+0.3;x<p.c1-0.2;x+=2)quad([x,p.r+0.85,0],[x+0.45,p.r+0.15,0],[x+0.7,p.r+0.15,0],[x+0.25,p.r+0.85,0],rgb(theme.floor,fk*1.28));}
        });
        runs.forEach(function(run){if(run.frame)return;quad([run.c0+0.2,run.r+0.26,0],[run.c1+1.2,run.r+0.26,0],[run.c1+1.2,run.r+1.26,0],[run.c0+0.2,run.r+1.26,0],col("rgba(70,36,12,0.2)",rgb(theme.floor,fk*0.88)));});
        holeSet(l.holes,TimberPhysics.HOLE_R,[rgb(theme.frame,1.05),"#170c05","#070302"]);
        holeSet([l.goal],TimberPhysics.GOAL_R,["#d8b04a","#2a1a0c","#120904"]);
        if(opts.path!==false){
            ctx.strokeStyle=col("rgba(46,26,12,0.8)",rgb(theme.frame,0.62));ctx.lineWidth=Math.max(3,F*0.12/D);ctx.beginPath();
            dashes.forEach(function(d){var a=proj(d[0],d[1],0),b=proj(d[2],d[3],0);ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);});ctx.stroke();
            disc(l.start.x,l.start.y,0,0.32,rgb(theme.frame,0.9),12);disc(l.start.x,l.start.y,0,0.2,rgb(theme.floor,fk),10);
            l.checkpoints.forEach(function(p,k){var reached=state&&state.checkpoint>k;disc(p.x,p.y,0,0.42,"#6e5216",14);disc(p.x,p.y,0,0.34,reached?"#5c9a48":"#d8b04a",14);var q=proj(p.x,p.y,0);text(p.n,q[0],q[1]+7,18,reached?"#fbeedd":"#2b170a","center");});
        }
        var sinking=state&&(state.mode==="falling"||state.mode==="won");
        if(sinking){var hole=state.mode==="won"?l.goal:state.hole,k=state.mode==="won"?1:state.fall;ball(state.x+(hole.x-state.x)*k,state.y+(hole.y-state.y)*k,-0.5*k,1-0.45*k,state.mode==="won"?0.35:k*0.9);}
        else if(state)disc(state.x+0.16,state.y+0.22,0,TimberPhysics.BALL_R*1.02,col("rgba(40,20,6,0.33)",rgb(theme.floor,fk*0.8)),14);
        var ballRow=state&&!sinking?Math.floor(state.y):-1,goalRow=Math.floor(l.goal.y);
        for(var r=0;r<h;r++){
            rows[r].slice().sort(function(a,b){return Math.abs(b.c0+b.c1+1-w)-Math.abs(a.c0+a.c1+1-w);}).forEach(drawRun);
            if(r===0)corners();
            rowAcorns[r].forEach(function(a){if(!state||!state.acorns||!state.acorns[a.i])acorn(a.p);});
            rowPegs[r].forEach(peg);
            if(r===goalRow)flag(l.goal);
            if(r===ballRow)ball(state.x,state.y,0,1,state.mode==="ready"?0.18*Math.max(0,Math.min(1,state.timer)):0);
        }
    }
    function frameRect(x,y,w,h,color,lw){ctx.fillStyle=color;ctx.fillRect(x,y,w,lw);ctx.fillRect(x,y+h-lw,w,lw);ctx.fillRect(x,y,lw,h);ctx.fillRect(x+w-lw,y,lw,h);}
    function panel(x,y,w,h,color){ctx.fillStyle=col("rgba(10,5,2,0.4)","#1c1008");ctx.fillRect(x+8,y+10,w,h);ctx.fillStyle=color||"#f3e4c8";ctx.fillRect(x,y,w,h);frameRect(x,y,w,h,"#6b3d1d",4);
        [[x+10,y+10],[x+w-18,y+10],[x+10,y+h-18],[x+w-18,y+h-18]].forEach(function(p){ctx.fillStyle="#b98a3a";ctx.fillRect(p[0],p[1],8,8);});}
    function button(r,label,selected,small){ctx.fillStyle=selected?"#9b3f17":"#e5cca4";ctx.fillRect(r.x,r.y,r.w,r.h);ctx.fillStyle=selected?"#7a2f10":"#cdb088";ctx.fillRect(r.x,r.y+r.h-6,r.w,6);text(label,r.x+r.w/2,r.y+r.h/2+(small?5:7),small?18:22,selected?"#fff4e2":"#2b170a","center");}
    function wrap(s,x,y,size,color,width,lineH){var words=String(s).split(" "),line="",per=Math.max(4,Math.floor((width+font.scale(size))/(6*font.scale(size))));words.forEach(function(wd){if((line+" "+wd).trim().length>per){text(line,x,y,size,color);y+=lineH;line=wd;}else line=(line+" "+wd).trim();});if(line)text(line,x,y,size,color);return y+lineH;}
    function clock(ms){var s=Math.max(0,ms)/1000,m=Math.floor(s/60),r=s-m*60;return (m<10?"0":"")+m+":"+(r<10?"0":"")+r.toFixed(1);}
    function star(x,y,r,filled){var pts=[];for(var i=0;i<10;i++){var a=-Math.PI/2+i*Math.PI/5,rr=i%2?r*0.45:r;pts.push([x+Math.cos(a)*rr,y+Math.sin(a)*rr]);}poly(pts,filled?"#6e5216":"#8a6a50");var inner=pts.map(function(p){return [x+(p[0]-x)*0.68,y+(p[1]-y)*0.68];});poly(inner,filled?"#e8c25a":"#cdb088");}
    function acornIcon(x,y,r,filled){ctx.beginPath();ctx.arc(x,y+r*0.25,r,0,Math.PI*2);ctx.fillStyle=filled?"#b5732f":"#cdb088";ctx.fill();ctx.fillStyle=filled?"#5a3a1c":"#a88a68";ctx.beginPath();ctx.arc(x,y-r*0.3,r*1.1,Math.PI,Math.PI*2);ctx.closePath();ctx.fill();ctx.fillRect(Math.round(x-r*0.12),Math.round(y-r*1.7),Math.max(2,Math.round(r*0.25)),Math.round(r*0.5));}
    return {W:W,H:H,alphaOK:alphaOK,col:col,font:font,themes:THEMES,theme:function(){return theme;},dim:function(x,y,w,h,rgba){if(alphaOK){ctx.fillStyle=rgba;ctx.fillRect(x,y,w,h);}},setLevel:setLevel,board:board,text:text,panel:panel,button:button,wrap:wrap,clock:clock,star:star,acorn:acornIcon,frameRect:frameRect,
        fit:function(){return {F:F,CX:CX,CY:CY};},project:function(c,r,z){return proj(c,r,z||0);}};
};
if(typeof module!=="undefined")module.exports=createTimberView;

// Timber Tilt rumble: short haptic patterns on top of the accepted handheld pulse helper.
// A transaction is: fresh proof + prepare -> start/stop steps -> zero-amplitude send + free.
// v0.2.1: setup (~35 ms on Switch 2) runs in its own task after the frame is drawn, and an open
// transaction stays zeroed and idle for up to KEEP_MS so a following pattern reuses it within the
// helper's call budget. Nothing stays allocated once the board is idle, paused or exited.
var createTimberHaptics=function(o){
    "use strict";
    var MODES=["FULL","LIGHT","OFF"],mode=0,active=null,pending=null,scheduled=false,closed=false,unavailable=null,cleanup=true,autoLight=false;
    var attempts=[],evicted=0,count=0,totals={},dropped={busy:0,rate:0,mode:0,unavailable:0},patterns={played:0,reused:0,deferred:0};
    var timing={opens:0,totalOpenMs:0,maxOpenMs:0,totalProofMs:0,totalPrepareMs:0},firstDevices=null,lastBumpAt=-1e9,quietUntil=0;
    // Steps: [device, ms] with device 0 = left, 1 = right, 2 = both, null = pause.
    var PATTERNS={peg:[[2,70]],acorn:[[2,55],[null,70],[2,55]],checkpoint:[[2,110]],fall:[[2,260]],won:[[2,120],[null,90],[2,120],[null,90],[2,300]],calibrated:[[2,90]]};
    var PRIORITY={bump:1,peg:1,acorn:2,checkpoint:2,calibrated:2,fall:3,won:4},LIGHT_KINDS={acorn:1,checkpoint:1,calibrated:1,fall:1,won:1};
    var CALL_BUDGET=38,KEEP_MS=1500,MIN_REUSE=5;
    function note(s){try{if(o.note)o.note(s);}catch(_){}}
    function msg(e){return String(e&&e.message||e).slice(0,160);}
    function callsNeeded(steps){var n=2;steps.forEach(function(s){if(s[0]!==null)n+=(s[0]===2?2:1)+2;});return n;}
    function used(){var st=active.native.session.state;return st.calls?st.calls.length:0;}
    function record(entry){count++;if(attempts.length===16){attempts.splice(4,1);evicted++;}attempts.push(entry);}
    function avg(total){return timing.opens?Math.round(total/timing.opens*10)/10:null;}
    function finish(reason,now){
        if(!active)return;var a=active;active=null;quietUntil=Math.max(quietUntil,a.idle?0:now+80);
        try{a.native.session.close();}catch(e){a.entry.error=a.entry.error||msg(e);}
        var st=a.native.session.state;a.entry.stoppedMs=now;a.entry.reason=reason;a.entry.calls=st.calls?st.calls.length:null;a.entry.zeroed=st.zeroed;a.entry.freed=st.allocationFreed;
        if(st.errors&&st.errors.length)a.entry.nativeErrors=st.errors.slice(0,3).map(function(s){return String(s).slice(0,140);});
        var ok=st.zeroed&&st.allocationFreed&&!(st.errors&&st.errors.length);cleanup=cleanup&&ok;
        if(!ok||a.entry.error){unavailable="Rumble stopped after an error";note("error "+(a.entry.error||"cleanup incomplete"));}
    }
    function begin(i,now){
        var a=active,s=a.native.session;
        if(a.on){s.stop();a.on=false;}
        if(i>=a.steps.length){
            // Pattern done: devices are zeroed; keep the transaction briefly for the next pattern.
            a.idle=true;a.steps=null;a.idleUntil=now+KEEP_MS;quietUntil=now+80;
            if(CALL_BUDGET-used()<MIN_REUSE)finish("budget",now);
            return;
        }
        a.idx=i;var step=a.steps[i];a.stepEnd=now+step[1];
        if(step[0]!==null){s.start(step[0]===2?[0,1]:[step[0]]);a.on=true;}
    }
    function run(list,kind,now){
        active.steps=list;active.priority=PRIORITY[kind];active.idle=false;active.entry.patterns++;patterns.played++;
        if(active.entry.kinds.length<60)active.entry.kinds+=(active.entry.kinds?">":"")+kind;
        try{begin(0,now);}catch(e){active.entry.error=msg(e);finish("error",now);}
    }
    function steps(kind,opts){
        if(kind==="bump"){var v=opts&&opts.strength||3,ms=Math.max(45,Math.min(120,Math.round(40+14*(v-2))));return [[opts&&opts.side!==undefined?opts.side:2,ms]];}
        if(kind==="peg"&&opts&&opts.side!==undefined)return [[opts.side,70]];
        return PATTERNS[kind];
    }
    function open(p,now){
        var entry={kind:p.kind,kinds:p.kind,patterns:0,startedMs:now,stoppedMs:null,reason:null,openMs:null,proofMs:null,prepareMs:null,calls:null,error:null},native=null,t0=Date.now(),t1;
        record(entry);
        try{
            native=o.openNative();t1=Date.now();
            if(!native.session.prepare()){entry.reason="disabled";try{native.session.close();}catch(_){}unavailable="System vibration is off";note("disabled by system setting");return;}
            var t2=Date.now();entry.proofMs=t1-t0;entry.prepareMs=t2-t1;entry.openMs=t2-t0;
            timing.opens++;timing.totalOpenMs+=entry.openMs;timing.totalProofMs+=entry.proofMs;timing.totalPrepareMs+=entry.prepareMs;timing.maxOpenMs=Math.max(timing.maxOpenMs,entry.openMs);
            if(!firstDevices&&native.session.state.devices){firstDevices=native.session.state.devices.map(function(d){return {handle:d.handle,mounted:d.mounted,type:d.type,position:d.position};});note("ready openMs="+entry.openMs+" proofMs="+entry.proofMs+" prepareMs="+entry.prepareMs);}
            // Slow native setup on this console: keep the rare events, drop wall/peg taps.
            if(!autoLight&&MODES[mode]==="FULL"&&timing.opens>=3&&timing.totalOpenMs/timing.opens>70){autoLight=true;mode=1;note("auto LIGHT avgOpenMs="+Math.round(timing.totalOpenMs/timing.opens));}
            entry.kinds="";active={native:native,entry:entry,steps:null,priority:0,idx:-1,stepEnd:now,on:false,idle:true,idleUntil:now+KEEP_MS};
            run(p.list,p.kind,now);
        }catch(e){
            entry.error=msg(e);
            if(active)finish("error",now);
            else if(native){try{native.session.close();var st=native.session.state;cleanup=cleanup&&st.zeroed&&st.allocationFreed;}catch(_){cleanup=false;}}
            unavailable="Rumble unavailable: "+entry.error;note("unavailable "+entry.error);
        }
    }
    function flush(now){if(closed||!pending||unavailable){pending=null;return;}var p=pending;pending=null;if(active)finish("replaced",now);open(p,now);}
    function play(kind,now,opts){
        if(closed||!PRIORITY[kind])return false;
        totals[kind]=(totals[kind]||0)+1;
        if(MODES[mode]==="OFF"||(MODES[mode]==="LIGHT"&&!LIGHT_KINDS[kind])){dropped.mode++;return false;}
        if(unavailable){dropped.unavailable++;return false;}
        if(kind==="bump"||kind==="peg"){if(now-lastBumpAt<220){dropped.rate++;return false;}lastBumpAt=now;}
        var list=steps(kind,opts),pr=PRIORITY[kind];
        if(active&&!active.idle&&pr<=active.priority){dropped.busy++;return false;}
        if(active&&used()+callsNeeded(list)<=CALL_BUDGET){if(active.idle)patterns.reused++;run(list,kind,now);return true;}
        // A new transaction is needed: set it up after this frame is drawn.
        if(pending&&pr<pending.priority){dropped.busy++;return false;}
        if(pending)dropped.busy++;
        pending={kind:kind,list:list,priority:pr};
        if(o.defer){if(!scheduled){scheduled=true;patterns.deferred++;o.defer(function(){scheduled=false;flush(o.now?o.now():now);});}}
        else flush(now);
        return true;
    }
    return {
        play:play,flush:flush,
        tick:function(now){if(!active)return;try{active.native.check();if(active.idle){if(now>=active.idleUntil)finish("idle",now);return;}while(active&&!active.idle&&now>=active.stepEnd)begin(active.idx+1,now);}catch(e){if(active){active.entry.error=msg(e);finish("error",now);}}},
        stop:function(now,why){pending=null;finish(why||"stopped",now);},
        busy:function(now){return (!!active&&!active.idle)||now<quietUntil;},
        mode:function(){return MODES[mode];},
        cycle:function(now){mode=(mode+1)%MODES.length;pending=null;if(MODES[mode]==="OFF")finish("turned off",now);else unavailable=null;return MODES[mode];},
        status:function(){return unavailable?unavailable:active&&!active.idle?"PULSING":MODES[mode]==="OFF"?"OFF":"READY";},
        available:function(){return !unavailable;},
        close:function(now){if(closed)return;pending=null;finish("app exit",now);closed=true;},
        report:function(){return {mode:MODES[mode],autoLight:autoLight,unavailable:unavailable,attempts:attempts,totalAttempts:count,evicted:evicted,events:totals,dropped:dropped,patterns:patterns,
            timing:{opens:timing.opens,avgOpenMs:avg(timing.totalOpenMs),avgProofMs:avg(timing.totalProofMs),avgPrepareMs:avg(timing.totalPrepareMs),maxOpenMs:timing.maxOpenMs},devices:firstDevices,nativeCleanup:cleanup,
            limits:{amplitude:0.45,lowFrequency:160,highFrequency:320,callBudget:CALL_BUDGET,keepAliveMs:KEEP_MS,retainedAttempts:16,bumpMinGapMs:220},physicalResult:"Operator observation required; a successful send does not measure perceived vibration"};}
    };
};
if(typeof module!=="undefined")module.exports=createTimberHaptics;

// Timber Tilt: original tilt-maze sample homebrew for the CivSwitch loader.
// Keeps the loader promise pending while playing, then cleans up and resolves.
(async function(){
    "use strict";
    var VERSION="0.2.2",cfg=window.__timberTiltConfig||{},maxSeconds=Math.max(30,Math.min(3600,Number(cfg.maxSeconds)||1800));
    var start=Date.now(),W=1280,H=720,PER=6,canvas,ctx,view,input,timer,deadline,heartbeat,resolveDone,closed=false,lastFrame=null,lastTick=Date.now();
    var INK="#2b170a",CREAM="#fbeedd",RUST="#9b3f17";
    var levels=TIMBER_LEVELS.map(function(d){return TimberPhysics.parse(d);}),chapters=Math.ceil(levels.length/PER);
    var report={schema:"timber-tilt/1",version:VERSION,reason:null,errors:[],warnings:[],durationMs:0,boardsCleared:0,falls:0,bumps:0,pegHits:0,acorns:0,boards:{},
        controls:{motionFrames:0,stickFrames:0,dpadFrames:0,touchFrames:0,recenters:0,precisionFrames:0,tiltHeldFrames:0},touchMenuActivations:0,maxContacts:0,views:{},
        cleanup:{timers:false,input:false,overlay:false,motion:false,rumble:false},environment:{preview:!!cfg.preview,targetHost:cfg.targetHost||null,declaredPlatform:cfg.platform||null,
        viewport:{width:window.innerWidth,height:window.innerHeight},userAgent:String(navigator.userAgent||"").slice(0,160),firmware:null,hardwareModel:null}};
    levels.forEach(function(l){report.boards[l.id]={attempts:0,clears:0,bestMs:null,falls:0,stars:0,acorns:0,par:l.par};});
    var ui={view:"title",selected:0,toast:null,toastUntil:0,info:false,calSkipped:false,calDoneAt:null,calFrom:null,levelIndex:0,nextMove:0,demo:0,levelsFrom:"title"};
    var game=null,tiltFinger=null,nativeReader=null,nativeFailed=false,clearInfo=null;
    var tilt=createTimberTilt(),motionView={status:"not opened",message:"",streams:[]};
    var helpers={write64:typeof write64==="function"?write64:null,malloc:typeof malloc==="function"?malloc:null,free:typeof free==="function"?free:null,call_rop:typeof call_rop==="function"?call_rop:null};
    function logLine(s){try{var p=log(String(s).slice(0,300));if(p&&p.catch)p.catch(function(){});}catch(_){}}
    function openMotionNative(){return createSwitchMotionNative({read64:read64,sdkBase:sdk_base,profiles:window.__switchMotionProfiles});}
    var motion=createSwitchMotion({openNative:openMotionNative,helpers:{write64:helpers.write64,malloc:helpers.malloc,free:helpers.free,call_rop:helpers.call_rop,note:function(s){logLine("TIMBER_MOTION "+s);}}});
    // One read-only motion reader serves every rumble proof (it only polls the stream list); each
    // transaction still re-proves the code profile and creates its own pulse session.
    var rumbleReader=null;function rumbleReaderOnce(){if(!rumbleReader)rumbleReader=openMotionNative();return rumbleReader;}
    var haptics=createTimberHaptics({openNative:function(){return createSwitchRumbleNative({sdkBase:sdk_base,read64:read64,profile:window.__switchRumbleProfile,openReader:rumbleReaderOnce,helpers:helpers});},
        defer:function(fn){setTimeout(fn,0);},now:function(){return Date.now()-start;},note:function(s){logLine("TIMBER_RUMBLE "+s);}});
    function now(){return Date.now()-start;}
    function warn(s){if(report.warnings.length<12)report.warnings.push(String(s).slice(0,180));}
    function toast(s,ms){ui.toast=s;ui.toastUntil=Date.now()+(ms||1800);}
    function close(reason){if(closed)return;closed=true;report.reason=reason;if(resolveDone)resolveDone();}
    function motionLive(){return motionView.status==="live";}
    function go(name){if(name!=="play"&&name!=="clear")haptics.stop(now(),"menu");ui.view=name;ui.selected=0;ui.nextMove=Date.now()+180;tiltFinger=null;report.views[name]=(report.views[name]||0)+1;}
    function label(i){return (Math.floor(i/PER)+1)+"-"+(i%PER+1);}
    function totalStars(){var n=0;levels.forEach(function(l){n+=report.boards[l.id].stars;});return n;}
    function startBoard(i){ui.levelIndex=i;var l=levels[i];view.setLevel(l);game=TimberPhysics.create(l);report.boards[l.id].attempts++;go("play");}
    function openLevels(from){ui.levelsFrom=from;go("levels");ui.selected=ui.levelIndex;}
    function play(i){if(motionLive()&&!tilt.calibrated()&&!ui.calSkipped){calibrate("board:"+i);return;}startBoard(i);}
    function calibrate(from){ui.calFrom=from;ui.calDoneAt=null;if(motionLive())tilt.startWizard(now());go("calibrate");}
    function finishCalibration(){var from=ui.calFrom||"title";tilt.cancelWizard();if(from.indexOf("board:")===0)startBoard(Number(from.slice(6)));else if(from==="pause"){view.setLevel(levels[ui.levelIndex]);go("pause");}else go("title");}
    function recenter(){if(tilt.recenter()){report.controls.recenters++;toast("TILT RECENTERED");}else toast(motionLive()?"CALIBRATE TILT FIRST":"MOTION OFF - USE STICK OR TOUCH");}
    function rumbleLabel(){return "RUMBLE: "+haptics.mode();}
    function cycleRumble(){rumbleReader=null;var m=haptics.cycle(now());toast(m==="OFF"?"RUMBLE OFF":m==="LIGHT"?"RUMBLE LIGHT - BIG MOMENTS ONLY":"RUMBLE FULL - WALL TAPS TOO");if(m!=="OFF")haptics.play("checkpoint",now());}
    // Layouts shared by drawing and touch hit-testing.
    var L={
        title:function(i){return {x:110,y:262+i*58,w:410,h:48};},
        pause:function(i){return {x:420,y:166+i*54,w:440,h:46};},
        clear:function(i){return {x:440,y:452+i*58,w:400,h:48};},
        tab:function(i){return {x:170+i*240,y:146,w:220,h:46};},
        level:function(i){var k=i%PER;return {x:170+(k%3)*322,y:210+Math.floor(k/3)*168,w:296,h:150};},
        levelBack:{x:490,y:604,w:300,h:50},calSkip:{x:300,y:556,w:320,h:52},calBack:{x:660,y:556,w:320,h:52},howBack:{x:490,y:612,w:300,h:50},
        pauseBtn:{x:1128,y:8,w:140,h:40},recenterBtn:{x:978,y:8,w:140,h:40}
    };
    function inside(p,r){return p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h;}
    function items(){
        if(ui.view==="title")return [["PLAY",function(){play(firstOpen());}],["BOARDS",function(){openLevels("title");}],[rumbleLabel(),cycleRumble],["CALIBRATE TILT",function(){calibrate("title");}],["HOW TO PLAY",function(){go("howto");}],["EXIT TO LOADER",function(){close("menu exit");}]];
        if(ui.view==="pause")return [["RESUME",function(){go("play");}],["RECENTER TILT",function(){recenter();go("play");}],["SENSITIVITY: "+tilt.sensitivity(),function(){toast("SENSITIVITY "+tilt.cycleSensitivity());}],[rumbleLabel(),cycleRumble],["RESTART BOARD",function(){startBoard(ui.levelIndex);}],["CALIBRATE TILT",function(){calibrate("pause");}],["BOARDS",function(){openLevels("pause");}],["EXIT TO LOADER",function(){close("menu exit");}]];
        if(ui.view==="clear"){var last=ui.levelIndex===levels.length-1;return [[last?"BACK TO TITLE":"NEXT BOARD",function(){if(last)go("title");else play(ui.levelIndex+1);}],["RETRY",function(){startBoard(ui.levelIndex);}],["BOARDS",function(){openLevels("title");}]];}
        return [];
    }
    // PLAY continues at the first board not yet cleared this session.
    function firstOpen(){for(var i=0;i<levels.length;i++)if(!report.boards[levels[i].id].clears)return i;return 0;}
    function rectFor(i){return ui.view==="title"?L.title(i):ui.view==="pause"?L.pause(i):L.clear(i);}
    function direction(frame){
        var now2=Date.now(),s=frame.sticks.left,dx=0,dy=0;
        if(frame.pressed.indexOf("Down")>=0)dy=1;else if(frame.pressed.indexOf("Up")>=0)dy=-1;else if(frame.pressed.indexOf("Right")>=0)dx=1;else if(frame.pressed.indexOf("Left")>=0)dx=-1;
        else if(now2>=ui.nextMove){if(s.y<-0.6)dy=1;else if(s.y>0.6)dy=-1;else if(s.x>0.6)dx=1;else if(s.x<-0.6)dx=-1;}
        if(dx||dy)ui.nextMove=now2+230;return {dx:dx,dy:dy};
    }
    function touchStarts(frame,pts){return pts.filter(function(p){return frame.touch.startedIds.indexOf(p.id)>=0;});}
    function menu(frame,pts){
        var list=items(),d=direction(frame);if(d.dx||d.dy)ui.selected=(ui.selected+d.dx+d.dy+list.length)%list.length;
        if((frame.pressed.indexOf("B")>=0||frame.pressed.indexOf("Plus")>=0)&&ui.view==="pause"){go("play");return;}
        if(frame.pressed.indexOf("A")>=0){list[ui.selected][1]();return;}
        touchStarts(frame,pts).some(function(p){for(var i=0;i<list.length;i++)if(inside(p,rectFor(i))){ui.selected=i;report.touchMenuActivations++;list[i][1]();return true;}return false;});
    }
    function levelsInput(frame,pts){
        var d=direction(frame),sel=ui.selected,ch=Math.floor(sel/PER),k=sel%PER,col=k%3,row=Math.floor(k/3);
        if(d.dy)row=1-row;
        if(d.dx){col+=d.dx;if(col>2){col=0;ch=(ch+1)%chapters;}else if(col<0){col=2;ch=(ch+chapters-1)%chapters;}}
        if(frame.pressed.indexOf("R")>=0||frame.pressed.indexOf("ZR")>=0)ch=(ch+1)%chapters;
        if(frame.pressed.indexOf("L")>=0||frame.pressed.indexOf("ZL")>=0)ch=(ch+chapters-1)%chapters;
        ui.selected=Math.min(levels.length-1,ch*PER+row*3+col);
        var leave=function(){go(ui.levelsFrom==="pause"&&game?"pause":"title");};
        if(frame.pressed.indexOf("B")>=0){leave();return;}
        if(frame.pressed.indexOf("A")>=0){play(ui.selected);return;}
        touchStarts(frame,pts).some(function(p){
            if(inside(p,L.levelBack)){report.touchMenuActivations++;leave();return true;}
            for(var t=0;t<chapters;t++)if(inside(p,L.tab(t))){report.touchMenuActivations++;ui.selected=t*PER+(ui.selected%PER);return true;}
            var base=Math.floor(ui.selected/PER)*PER;for(var i=base;i<Math.min(levels.length,base+PER);i++)if(inside(p,L.level(i))){report.touchMenuActivations++;play(i);return true;}return false;});
    }
    function calibrateInput(frame,pts,ms){
        var w=tilt.wizard(ms),back=function(){var from=ui.calFrom||"title";tilt.cancelWizard();if(from==="pause"){view.setLevel(levels[ui.levelIndex]);go("pause");}else go("title");};
        var skip=function(){ui.calSkipped=true;toast("USING STICK / TOUCH");finishCalibration();};
        if(motionLive()&&!w&&!tilt.calibrated())tilt.startWizard(ms);
        if(w&&w.step==="done"){if(ui.calDoneAt===null){ui.calDoneAt=ms;ui.calSkipped=false;haptics.play("calibrated",ms);}if(ms-ui.calDoneAt>1300||frame.pressed.indexOf("A")>=0)finishCalibration();return;}
        if(frame.pressed.indexOf("B")>=0){back();return;}
        if(frame.pressed.indexOf("X")>=0){skip();return;}
        if(frame.pressed.indexOf("Y")>=0&&motionLive()){tilt.startWizard(ms);return;}
        touchStarts(frame,pts).some(function(p){if(inside(p,L.calSkip)){report.touchMenuActivations++;skip();return true;}if(inside(p,L.calBack)){report.touchMenuActivations++;back();return true;}return false;});
    }
    function sideOf(hit){return hit.nx>0.5?0:hit.nx<-0.5?1:2;}
    function playInput(frame,pts,dt,ms){
        var b=frame.buttons;
        if(frame.pressed.indexOf("Plus")>=0||frame.pressed.indexOf("Minus")>=0||frame.pressed.indexOf("B")>=0){go("pause");return;}
        if(frame.pressed.indexOf("Y")>=0)recenter();
        if(frame.pressed.indexOf("L")>=0){startBoard(ui.levelIndex);toast("BOARD RESTARTED");return;}
        if(frame.pressed.indexOf("X")>=0)ui.info=!ui.info;
        var starts=touchStarts(frame,pts);
        for(var i=0;i<starts.length;i++){
            if(inside(starts[i],L.pauseBtn)){report.touchMenuActivations++;go("pause");return;}
            if(inside(starts[i],L.recenterBtn)){report.touchMenuActivations++;recenter();continue;}
            if(tiltFinger===null)tiltFinger={id:starts[i].id,x:starts[i].x,y:starts[i].y,cx:starts[i].x,cy:starts[i].y};
        }
        var tx=0,ty=0,s=frame.sticks.left;
        if(tiltFinger){var f=pts.filter(function(p){return p.id===tiltFinger.id;})[0];if(!f)tiltFinger=null;else{tiltFinger.cx=f.x;tiltFinger.cy=f.y;tx+=(f.x-tiltFinger.x)/150;ty+=(f.y-tiltFinger.y)/150;report.controls.touchFrames++;}}
        if(Math.abs(s.x)>0.12||Math.abs(s.y)>0.12){tx+=s.x;ty-=s.y;report.controls.stickFrames++;}
        var dx=(b.Right?1:0)-(b.Left?1:0),dy=(b.Down?1:0)-(b.Up?1:0);if(dx||dy){tx+=dx*0.75;ty+=dy*0.75;report.controls.dpadFrames++;}
        if(motionLive()&&tilt.calibrated()){var m=tilt.tilt();if(m.x||m.y)report.controls.motionFrames++;tx+=m.x;ty+=m.y;}
        if(b.R){tx*=0.5;ty*=0.5;report.controls.precisionFrames++;}
        var mag=Math.sqrt(tx*tx+ty*ty);if(mag>1){tx/=mag;ty/=mag;}
        ui.tilt={x:tx,y:ty};
        TimberPhysics.step(game,ui.tilt,dt);
        var id=game.level.id,rec=report.boards[id];
        game.events.forEach(function(e){
            if(e==="bump"&&game.hit&&game.hit.kind==="wall")haptics.play("bump",ms,{side:sideOf(game.hit),strength:game.hit.v});
            if(e==="peg"){report.pegHits++;haptics.play("peg",ms,game.hit&&game.hit.kind==="peg"?{side:sideOf(game.hit)}:null);}
            if(e==="acorn"){report.acorns++;haptics.play("acorn",ms);toast("ACORN "+game.acornCount+"/"+game.level.acorns.length);}
            if(e==="fall"){report.falls++;rec.falls++;haptics.play("fall",ms);}
            if(e==="checkpoint"){toast("CHECKPOINT "+game.checkpoint);haptics.play("checkpoint",ms);}
            if(e==="won"){
                var t=Math.round(game.elapsed*1000),best=rec.bestMs===null||t<rec.bestMs,all=game.acornCount===game.level.acorns.length,par=game.level.par&&t<=game.level.par*1000;
                var stars=1+(all?1:0)+(par?1:0);rec.clears++;report.boardsCleared++;if(best)rec.bestMs=t;rec.stars=Math.max(rec.stars,stars);rec.acorns=Math.max(rec.acorns,game.acornCount);report.bumps+=game.bumps;
                clearInfo={ms:t,falls:game.falls,best:best,stars:stars,acorns:game.acornCount,all:all,par:par,at:Date.now()};haptics.play("won",ms);
            }
        });
        if(game.mode==="won"&&clearInfo&&Date.now()-clearInfo.at>700)go("clear");
    }
    function motionLine(){
        if(motionLive())return tilt.calibrated()?"TILT READY ("+tilt.sensitivity()+")":"MOTION ON - CALIBRATE TO TILT";
        if(motionView.status==="starting"||motionView.status==="not opened")return "MOTION STARTING - HOLD STILL";
        if(motionView.status==="waiting")return "MOTION WAITING FOR SAMPLES";
        return "MOTION OFF - STICK + TOUCH";
    }
    function stars(x,y,n,r){for(var i=0;i<3;i++)view.star(x+(i-1)*r*2.5,y,r,i<n);}
    function hud(){
        var l=game.level;ctx.fillStyle=view.col("rgba(26,15,8,0.92)","#1a0f08");ctx.fillRect(0,0,W,56);
        view.text(label(ui.levelIndex)+" "+l.name,20,36,22,CREAM);
        view.text(view.clock(game.elapsed*1000),560,40,28,CREAM,"center");
        var over=l.par&&game.elapsed>l.par;view.text("PAR "+view.clock((l.par||0)*1000).slice(0,5),648,36,16,over?"#e08a62":"#cdb088");
        for(var i=0;i<l.acorns.length;i++)view.acorn(790+i*30,30,10,game.acorns[i]);
        view.text("FALLS "+game.falls,880,36,16,CREAM);
        view.button(L.recenterBtn,"RECENTER",false,true);view.button(L.pauseBtn,"PAUSE",false,true);
        var cue=motionLive()&&tilt.calibrated()?"TILT TO ROLL  Y RECENTER  R PRECISION  L RESTART  + PAUSE":"STICK/D-PAD OR DRAG TO TILT  L RESTART  + PAUSE";
        ctx.fillStyle=view.col("rgba(26,15,8,0.8)","#1a0f08");ctx.fillRect(0,690,W,30);view.text(cue,640,712,16,"#e9cf9f","center");
        if(game.mode==="ready"&&game.timer>0.05)view.text(game.timer>0.35?"READY":"GO!",640,150,44,CREAM,"center");
        if(tiltFinger){ctx.strokeStyle=view.col("rgba(255,240,210,0.7)","#f6e2bd");ctx.lineWidth=3;ctx.beginPath();ctx.arc(tiltFinger.x,tiltFinger.y,48,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(tiltFinger.cx,tiltFinger.cy,16,0,Math.PI*2);ctx.fillStyle=view.col("rgba(255,240,210,0.8)","#f6e2bd");ctx.fill();}
        if(ui.info){var iy=480;view.panel(20,iy,420,200);var r=tilt.raw(),t=ui.tilt||{x:0,y:0},hr=haptics.report();
            view.text("TILT  X "+t.x.toFixed(2)+"  Y "+t.y.toFixed(2),38,iy+36,18,INK);view.text("ACC "+(r?r.map(function(v){return v.toFixed(2);}).join(" "):"NONE"),38,iy+66,18,INK);
            view.text("MOTION "+motionView.status,38,iy+96,18,INK);view.text("RUMBLE "+haptics.status().slice(0,24),38,iy+126,18,INK);
            view.text("RUMBLE SETUP "+(hr.timing.avgOpenMs===null?"-":hr.timing.avgOpenMs+" MS"),38,iy+156,18,INK);view.text("FRAME "+perfAvg().toFixed(1)+" MS AVG",38,iy+186,18,INK);}
    }
    function drawMenuPanel(title,sub){view.panel(80,112,470,560);view.text(title,315,184,40,RUST,"center");view.text(sub,315,222,18,INK,"center");}
    function draw(ms){
        var v=ui.view;
        if(v==="title"||v==="howto"){var demo=levels[0],cells=demo.path.cells,u=(ui.demo+=0.033*3)%(cells.length-1),k=Math.floor(u),f=u-k,a=cells[k],b=cells[k+1];view.setLevel(demo);view.board({x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,mode:"rolling",checkpoint:0,acorns:[]},{tilt:{x:(b.x-a.x)*0.6,y:(b.y-a.y)*0.6}});}
        else if(v==="levels"||v==="calibrate"){view.setLevel(levels[v==="levels"?ui.selected:ui.levelIndex]);view.board(null,{path:v==="levels"});}
        else{view.setLevel(game.level);view.board(game,{tilt:ui.tilt||{x:0,y:0}});}
        if(v==="title"){
            drawMenuPanel("TIMBER TILT","ROLL THE STEEL BALL HOME");
            items().forEach(function(it,i){view.button(L.title(i),it[0],i===ui.selected);});
            view.star(250,618,11,true);view.text(totalStars()+"/"+levels.length*3+" STARS",270,626,18,INK);
            view.text(motionLine(),315,656,12,INK,"center");
        }else if(v==="howto"){
            view.panel(160,70,960,630);view.text("HOW TO PLAY",640,124,34,RUST,"center");
            var y=166;["Tilt the board to roll the ball along the dotted line into the brass cup under the blue flag.","Holes swallow the ball. Brass checkpoint tacks set where you restart after a fall.",
             "Green felt slows the ball. Shiny varnish is slick. Brass pegs bounce it away.","Stars: one for the cup, one for all three acorns, one for beating the par time.",
             "Tilt the console after calibrating, or use the stick, D-pad, or drag on the board.","Y re-levels tilt. R holds precision. L restarts. Plus, Minus or B pauses. X shows info.",
             "Rumble: FULL taps on walls and pegs, LIGHT only for acorns, checkpoints, falls and the cup."].forEach(function(s){y=view.wrap(s,200,y,18,INK,880,28)+12;});
            view.button(L.howBack,"BACK",true);
        }else if(v==="levels"){
            var ch=Math.floor(ui.selected/PER);view.panel(130,76,1020,618);view.text("CHOOSE A BOARD",640,124,30,RUST,"center");
            view.text("L / R",1100,124,14,INK,"right");
            for(var t=0;t<chapters;t++){var tr=L.tab(t),th=view.themes[levels[t*PER].theme],sel=t===ch;ctx.fillStyle=sel?"rgb("+th.wall.join(",")+")":"#e5cca4";ctx.fillRect(tr.x,tr.y,tr.w,tr.h);if(sel)view.frameRect(tr.x,tr.y,tr.w,tr.h,"#2b170a",3);
                var cs=0;for(var q=t*PER;q<Math.min(levels.length,t*PER+PER);q++)cs+=report.boards[levels[q].id].stars;view.text((t+1)+" "+th.name,tr.x+14,tr.y+31,18,sel?CREAM:INK);view.text(cs+"*",tr.x+tr.w-12,tr.y+31,18,sel?CREAM:INK,"right");}
            for(var i=ch*PER;i<Math.min(levels.length,ch*PER+PER);i++){var l=levels[i],r=L.level(i),rec=report.boards[l.id],s2=i===ui.selected,ink=s2?"#fff4e2":INK;
                ctx.fillStyle=s2?RUST:"#e5cca4";ctx.fillRect(r.x,r.y,r.w,r.h);
                view.text(label(i),r.x+16,r.y+36,24,ink);view.text(l.name.length>16?l.name.slice(0,16):l.name,r.x+r.w-14,r.y+34,16,ink,"right");
                stars(r.x+70,r.y+72,rec.stars,13);
                for(var a=0;a<l.acorns.length;a++)view.acorn(r.x+190+a*28,r.y+72,9,a<rec.acorns);
                view.text(rec.bestMs===null?"PAR "+view.clock(l.par*1000).slice(0,5):"BEST "+view.clock(rec.bestMs),r.x+r.w/2,r.y+118,18,ink,"center");
                view.text(l.holes.length+" HOLES"+(l.pegs.length?"  "+l.pegs.length+" PEGS":""),r.x+r.w/2,r.y+140,12,ink,"center");}
            view.wrap(levels[ui.selected].hint,170,568,16,INK,940,22);
            view.button(L.levelBack,"BACK",false);
        }else if(v==="calibrate")drawCalibration(ms);
        else{hud();
            if(v==="pause"){view.dim(0,56,W,634,"rgba(20,10,4,0.45)");view.panel(390,92,500,592);view.text("PAUSED",640,144,32,RUST,"center");items().forEach(function(it,i){view.button(L.pause(i),it[0],i===ui.selected,true);});view.text(motionLine(),640,664,12,INK,"center");}
            if(v==="clear"){view.dim(0,56,W,634,"rgba(20,10,4,0.4)");view.panel(390,120,500,540);var last=ui.levelIndex===levels.length-1,c=clearInfo;
                view.text(last?"ALL BOARDS DONE!":"BOARD CLEARED!",640,176,30,RUST,"center");stars(640,226,c.stars,24);
                view.text("TIME "+view.clock(c.ms)+(c.best?"  NEW BEST":""),640,292,22,INK,"center");
                view.text((c.par?"BEAT ":"MISSED ")+"PAR "+view.clock(game.level.par*1000).slice(0,5),640,328,18,c.par?"#3d7a3a":RUST,"center");
                view.text("ACORNS "+c.acorns+"/"+game.level.acorns.length+"   FALLS "+c.falls,640,362,18,INK,"center");
                view.text("BEST "+view.clock(report.boards[game.level.id].bestMs)+"   STARS "+totalStars()+"/"+levels.length*3,640,396,18,INK,"center");
                items().forEach(function(it,i){view.button(L.clear(i),it[0],i===ui.selected);});}
        }
        if(ui.toast&&Date.now()<ui.toastUntil){var tw=Math.max(400,view.font.width(ui.toast,18)+48),ty=v==="play"||v==="calibrate"?620:64;ctx.fillStyle=view.col("rgba(26,15,8,0.9)","#1a0f08");ctx.fillRect(640-tw/2,ty,tw,46);view.text(ui.toast,640,ty+30,18,"#ffe7b8","center");}
    }
    function drawCalibration(ms){
        view.dim(0,0,W,H,"rgba(20,10,4,0.45)");view.panel(240,90,800,560);view.text("CALIBRATE TILT",640,146,32,RUST,"center");
        var w=tilt.wizard(ms),msg,sub="";
        if(!motionLive()){msg=motionView.status==="starting"||motionView.status==="not opened"?"Motion is starting. Keep the console still for a moment.":"Motion is not available: "+String(motionView.message||motionView.status);sub="You can still play with the stick, D-pad or touch.";}
        else if(!w)msg="Starting...";
        else{msg={hold:"Hold the console the way you will play, and keep it still.",right:"Now tilt the RIGHT side DOWN.",level1:"Good. Level it out again.",top:"Now tilt the TOP edge DOWN, away from you.",level2:"Level it out once more.",done:"Tilt is calibrated!"}[w.step];
            if((w.step==="right"||w.step==="top")&&w.stepMs>9000)sub="No tilt seen yet? Tilt further, or SKIP to use the stick.";
            if(w.step==="done")sub="Y or RECENTER in game re-levels it any time.";}
        view.wrap(msg,290,206,24,INK,700,36);if(sub)view.wrap(sub,290,292,16,RUST,700,24);
        // Bubble level: shows live tilt after calibration, or raw change during the wizard.
        var cx=640,cy=420,R=92;ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.fillStyle="#d9bf93";ctx.fill();ctx.strokeStyle="#6b3d1d";ctx.lineWidth=3;ctx.beginPath();ctx.arc(cx,cy,R*0.3,0,Math.PI*2);ctx.stroke();
        var p=tilt.calibrated()&&(!w||w.step==="done")?tilt.tilt():w&&w.preview?{x:w.preview[0]/0.35,y:w.preview[1]/0.35}:{x:0,y:0},m=Math.sqrt(p.x*p.x+p.y*p.y);if(m>1){p.x/=m;p.y/=m;}
        ctx.beginPath();ctx.arc(cx+p.x*(R-18),cy+p.y*(R-18),16,0,Math.PI*2);ctx.fillStyle="#8f9aa5";ctx.fill();
        if(w){var steps=["hold","right","level1","top","level2","done"],k=steps.indexOf(w.step);for(var i=0;i<5;i++){ctx.fillStyle=i<k?"#3d7a3a":i===k?"#c9662f":"#cdb088";ctx.fillRect(420+i*90,526,80,12);}
            if(k<5){ctx.fillStyle="#9b3f17";ctx.fillRect(420+k*90,526,80*Math.max(0,Math.min(1,w.progress)),12);}}
        view.button(L.calSkip,"SKIP - USE STICK (X)",false,true);view.button(L.calBack,"BACK (B)",false,true);
    }
    var perf={ticks:0,totalMs:0,maxMs:0,slow:0,window:[],views:{}};
    function perfAvg(){return perf.window.length?perf.window.reduce(function(a,b){return a+b;},0)/perf.window.length:0;}
    function tick(){
        if(closed)return;
        var t0=Date.now(),v0=ui.view;
        try{
            var nowMs=Date.now(),ms=nowMs-start,dt=Math.min(0.1,(nowMs-lastTick)/1000);lastTick=nowMs;
            if(nativeReader&&!nativeFailed){try{input.pollTouch();}catch(e){nativeFailed=true;warn("Native touch disabled: "+(e&&e.message||e));}}
            var frame=input.drain();lastFrame=frame;
            var pts=(frame.independentTouchContacts||[]).map(function(p){return {id:p.id,x:p.x*W/(window.innerWidth||W),y:p.y*H/(window.innerHeight||H)};});
            report.maxContacts=Math.max(report.maxContacts,pts.length);
            haptics.tick(ms);
            motion.tick(ms,true);motionView=motion.view(ms);
            // Vibration shakes the accelerometer: hold the last tilt while a pattern plays.
            var st=motionView.streams&&motionView.streams[0];
            if(st&&st.latest&&st.ageMs!==null&&st.ageMs<500){if(haptics.busy(ms)&&tilt.calibrated()&&ui.view==="play")report.controls.tiltHeldFrames++;else tilt.feed(st.latest.acceleration,st.latest.samplingNumber,ms);}
            if(motionView.status==="unavailable"&&!ui.motionWarned){ui.motionWarned=true;warn("Motion unavailable: "+motionView.message);}
            var v=ui.view;
            if(v==="play")playInput(frame,pts,dt,ms);
            else if(v==="title"||v==="pause"||v==="clear")menu(frame,pts);
            else if(v==="levels")levelsInput(frame,pts);
            else if(v==="calibrate")calibrateInput(frame,pts,ms);
            else if(v==="howto"){if(frame.pressed.indexOf("B")>=0||frame.pressed.indexOf("A")>=0||touchStarts(frame,pts).some(function(p){return inside(p,L.howBack);}))go("title");}
            if(!closed)draw(ms);
        }catch(e){report.errors.push(String(e&&e.stack||e).slice(0,240));close("runtime error");}
        var spent=Date.now()-t0;perf.ticks++;perf.totalMs+=spent;if(spent>perf.maxMs)perf.maxMs=spent;if(spent>33)perf.slow++;perf.window.push(spent);if(perf.window.length>60)perf.window.shift();
        var pv=perf.views[v0]||(perf.views[v0]={ticks:0,totalMs:0,maxMs:0});pv.ticks++;pv.totalMs+=spent;if(spent>pv.maxMs)pv.maxMs=spent;
    }
    try{
        try{nativeReader=createCivVerifiedNativeTouch(read64,sdk_base);}catch(e){warn("Independent touch unavailable: "+(e&&e.message||e));}
        input=createCivInputAdapter(engine,{nativeTouchReader:nativeReader});
        canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;
        Object.assign(canvas.style,{position:"fixed",left:"0",top:"0",width:"100%",height:"100%",zIndex:"2147483010",pointerEvents:"none",backgroundColor:"#2b1b10"});
        document.body.appendChild(canvas);ctx=canvas.getContext("2d");if(!ctx)throw Error("Canvas 2D unavailable");
        view=createTimberView(ctx);input.attach();
        motion.open(0);go("title");tick();
        if(!closed)await new Promise(function(resolve){resolveDone=resolve;timer=setInterval(tick,33);deadline=setTimeout(function(){close("session time limit");},maxSeconds*1000);
            heartbeat=setInterval(function(){logLine("TIMBER_TILT alive view="+ui.view+" board="+label(ui.levelIndex)+" clears="+report.boardsCleared+" stars="+totalStars()+" motion="+motionView.status+" calibrated="+(tilt.calibrated()?1:0)+" rumble="+haptics.mode()+"/"+(haptics.available()?"ok":"off")+" frameMs="+perfAvg().toFixed(1));},15000);});
    }catch(e){report.errors.push(String(e&&e.stack||e).slice(0,240));report.reason=report.reason||"startup error";}
    finally{
        clearInterval(timer);clearInterval(heartbeat);clearTimeout(deadline);report.cleanup.timers=true;
        try{haptics.close(now());report.rumble=haptics.report();report.cleanup.rumble=report.rumble.nativeCleanup;}catch(e){report.errors.push("Rumble cleanup: "+String(e&&e.message||e).slice(0,160));}
        try{motion.close();report.motion=motion.report();report.cleanup.motion=report.motion.nativeCleanup;if(report.motion.activation)report.motion.activation.errors.forEach(function(s){report.errors.push("Motion: "+String(s).slice(0,180));});}
        catch(e){report.errors.push("Motion cleanup: "+String(e&&e.message||e).slice(0,160));}
        report.tilt=tilt.report();report.canvasAlpha=view?view.alphaOK:null;report.starsTotal=totalStars();
        var byView={};Object.keys(perf.views).forEach(function(k){var p=perf.views[k];byView[k]={ticks:p.ticks,avgMs:Math.round(p.totalMs/p.ticks*10)/10,maxMs:p.maxMs};});
        report.perf={ticks:perf.ticks,avgTickMs:perf.ticks?Math.round(perf.totalMs/perf.ticks*10)/10:null,maxTickMs:perf.maxMs,ticksOver33ms:perf.slow,intervalMs:33,byView:byView};report.calibrationSkipped=ui.calSkipped;
        if(lastFrame)report.actionCounts=lastFrame.actionCounts;if(nativeReader&&nativeReader.stats)report.nativeTouchStats=JSON.parse(JSON.stringify(nativeReader.stats));
        if(input){try{input.detach();report.cleanup.input=true;}catch(e){report.errors.push("Detach: "+String(e&&e.message||e).slice(0,140));}}
        if(canvas&&canvas.parentNode){canvas.parentNode.removeChild(canvas);report.cleanup.overlay=true;}
        report.durationMs=Date.now()-start;report.limits={motionUnits:"raw, player-calibrated directions only",motionSource:"native handheld route; physical source not queried",rumbleRoute:"handheld ID32/style2 only; docked/other controllers refuse",unqueried:["firmware","hardware model","controller identity"]};
    }
    window.__timberTiltLastReport=report;
    await sendCivInputProReport(report);
})();
