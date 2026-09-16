"""Build the homepage's self-hosted CJK subset from Adobe's variable font.

Usage: python subset-home-font.py INPUT.woff2 OUTPUT.woff2 < homepage-source-text
Requires fonttools[woff] and brotli. The unmodified font stays outside the app.
"""
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

font = TTFont(sys.argv[1])
options = subset.Options()
options.layout_features = ["*"]
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=sys.stdin.read(), unicodes=range(0x20, 0x7F))
subsetter.subset(font)
# Adobe reserves "Source"; give the derived subset its own internal family name.
names = {1: "HeatSink Han", 2: "Regular", 3: "HeatSinkHan-Home-2.005",
         4: "HeatSink Han", 6: "HeatSinkHan", 16: "HeatSink Han", 17: "Regular", 25: "HeatSinkHan"}
for record in font["name"].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
font.flavor = "woff2"
font.save(sys.argv[2])
