# -*- coding: utf-8 -*-
"""生成 PWA 图标：icon-192.png / icon-512.png / apple-touch-icon.png（180x180）"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
BG = (15, 23, 42, 255)  # #0f172a

# 🗺️ 的 SVG 字体路径太麻烦，直接画简化地图图形：深底圆角矩形 + 折线路径 + 定位点
def rounded(draw, xy, r, fill):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle(xy, radius=r, fill=fill)

def make(size, out, apple=False):
    s = size
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(s * 0.22)
    if apple:
        d.rectangle([0, 0, s, s], fill=BG)
    else:
        d.rounded_rectangle([0, 0, s, s], radius=r, fill=BG)

    # 折线路径（A→B 示意），白色带圆角端点
    lw = max(3, s // 16)
    pts = [(s*0.28, s*0.72), (s*0.42, s*0.50), (s*0.58, s*0.60), (s*0.74, s*0.32)]
    d.line(pts, fill=(255, 255, 255, 255), width=lw, joint='curve')
    dot_r = lw * 1.3
    for p in (pts[0], pts[-1]):
        d.ellipse([p[0]-dot_r, p[1]-dot_r, p[0]+dot_r, p[1]+dot_r], fill=(255, 255, 255, 255))
    # 终点圆环（蓝色高亮）
    er = lw * 2.0
    ex, ey = pts[-1]
    d.ellipse([ex-er, ey-er, ex+er, ey+er], outline=(59, 130, 246, 255), width=max(2, s//48))

    # 转 RGB（apple 图标不支持透明），PNG 保存
    if apple:
        img = img.convert('RGB')
    img.save(out)
    print('OK', out, f'{s}x{s}')

make(192, os.path.join(HERE, 'icon-192.png'))
make(512, os.path.join(HERE, 'icon-512.png'))
make(180, os.path.join(HERE, 'apple-touch-icon.png'), apple=True)
