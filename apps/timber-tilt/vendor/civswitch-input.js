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


