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
