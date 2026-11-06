// Offline lettering checks: glyph shapes, integer-aligned rectangles, coverage of every on-screen string.
"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const createTimberFont=require("./font.js");
const calls=[];const ctx={set fillStyle(v){calls.push(["style",v]);},fillRect(x,y,w,h){calls.push([x,y,w,h]);}};
const f=createTimberFont(ctx);
assert.equal(f.width("ABC",18),6*2*3-2);assert.equal(f.scale(12),2);assert.equal(f.scale(40),4);
f.draw("Timber Tilt 1-2: 100%",101.4,50.6,22,"#2b170a","center");
const rects=calls.filter(c=>c.length===4);assert(rects.length>40);
rects.forEach(r=>r.forEach(v=>assert(Number.isInteger(v),"non-integer rect "+r)));
assert.deepEqual(calls.filter(c=>c[0]==="style"),[["style","#2b170a"]],"one flat colour per string");
// Every displayed string in the game and level data must be drawable.
const ctx2={module:undefined};vm.createContext(ctx2);vm.runInContext(fs.readFileSync(path.join(__dirname,"levels.js"),"utf8"),ctx2);
const texts=[];ctx2.TIMBER_LEVELS.forEach(l=>texts.push(l.name,l.hint));
const game=fs.readFileSync(path.join(__dirname,"game.js"),"utf8");
for(const line of game.split(/\r?\n/)){for(const m of line.matchAll(/"([^"]*)"/g))if(m[1].length>1)texts.push(m[1]);}
const missing=new Set();texts.forEach(s=>{for(const ch of s.toUpperCase())if(!f.has(ch))missing.add(ch);});
assert.deepEqual([...missing],[],"glyphs missing: "+[...missing].join(" "));
for(const name of ["font.js","render.js","game.js"]){const src=fs.readFileSync(path.join(__dirname,name),"utf8");assert(!/fillText|strokeText|\.font\s*=|Gradient/.test(src),name+" must not use system text or gradients");}
console.log("PASS: "+f.glyphs+" glyphs, integer rectangles, one colour per string, all "+texts.length+" strings drawable, no system text");
