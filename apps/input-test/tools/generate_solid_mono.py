"""Bake printable ASCII outlines into Solid Mono (no runtime font dependency).

Maintenance only: requires fontTools and a DejaVuSansMono-Bold.ttf source.
Ordinary builds use the committed glyph data and need neither dependency.
"""
import argparse
import hashlib
import json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen


class Outline(BasePen):
    def __init__(self, glyphs):
        super().__init__(glyphs)
        self.paths=[]
        self.points=[]
        self.current=None

    def _moveTo(self, point):
        self.points=[point]
        self.current=point

    def _lineTo(self, point):
        self.points.append(point)
        self.current=point

    def _qCurveToOne(self, control, end):
        def flatten(a, b, c, depth=0):
            middle=((a[0]+2*b[0]+c[0])/4,(a[1]+2*b[1]+c[1])/4)
            chord=((a[0]+c[0])/2,(a[1]+c[1])/2)
            if depth>=10 or max(abs(middle[i]-chord[i]) for i in [0,1])<=3:
                self._lineTo(c)
                return
            ab=((a[0]+b[0])/2,(a[1]+b[1])/2)
            bc=((b[0]+c[0])/2,(b[1]+c[1])/2)
            flatten(a,ab,middle,depth+1)
            flatten(middle,bc,c,depth+1)
        flatten(self.current,control,end)

    def _closePath(self):
        points=[]
        for p in self.points:
            rounded=[round(p[0]),round(p[1])]
            if not points or points[-1]!=rounded:
                points.append(rounded)
        if points and points[-1]==points[0]:points.pop()
        if len(points)>=3:self.paths.append(points)
        self.points=[]

    _endPath=_closePath


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("font",type=Path)
    parser.add_argument("--output",type=Path,default=Path(__file__).resolve().parents[1]/"solid-mono.js")
    args=parser.parse_args()
    font=TTFont(args.font);glyphs=font.getGlyphSet();cmap=font.getBestCmap()
    data={"name":"Solid Mono","source":"DejaVu Sans Mono Bold","sourceSha256":hashlib.sha256(args.font.read_bytes()).hexdigest(),"license":"licenses/Solid-Mono.txt","units":font['head'].unitsPerEm,"advance":font['hmtx'].metrics[cmap[ord('M')]][0],"glyphs":{}}
    for code in range(32,127):
        pen=Outline(glyphs);glyphs[cmap[code]].draw(pen)
        data['glyphs'][chr(code)]=pen.paths
    args.output.write_text("// Solid Mono outline data. See licenses/Solid-Mono.txt.\nvar switchSolidMono="+json.dumps(data,separators=(",",":"))+";\n",encoding="utf-8")
    print(args.output,args.output.stat().st_size,"bytes")


if __name__=="__main__":main()
