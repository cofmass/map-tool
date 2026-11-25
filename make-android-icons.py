from PIL import Image
import os, sys

src_path = r"D:\WorkSpace\map-tool\icons\icon-512.png"
res = r"D:\WorkSpace\map-tool\android\app\src\main\res"

sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

src = Image.open(src_path).convert("RGBA")

# 普通图标（方形，透明角）
for d, s in sizes.items():
    out = os.path.join(res, d)
    os.makedirs(out, exist_ok=True)
    img = src.resize((s, s), Image.LANCZOS)
    img.save(os.path.join(out, "ic_launcher.png"))
    img.save(os.path.join(out, "ic_launcher_round.png"))
    # 前景层（居中 66%，适配自适应图标）
    fg = Image.new("RGBA", (s*2, s*2), (0, 0, 0, 0))
    inner = src.resize((int(s*2*0.66), int(s*2*0.66)), Image.LANCZOS)
    off = ((s*2 - inner.width)//2, (s*2 - inner.height)//2)
    fg.paste(inner, off, inner)
    fg.save(os.path.join(out, "ic_launcher_foreground.png"))

print("icons done")
