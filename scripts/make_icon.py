"""Generate assets/icon.png and assets/tray.png (glossy orb with a striped leaf)."""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), "..", "assets")


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def orb(size):
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    px = img.load()
    c = s / 2
    r = s * 0.46
    purple, blue, cyan, pink = (168, 140, 250), (80, 130, 240), (110, 220, 235), (235, 190, 245)
    for y in range(s):
        for x in range(s):
            dx, dy = (x - c) / r, (y - c) / r
            d = math.hypot(dx, dy)
            if d > 1:
                continue
            diag = max(0.0, min(1.0, (dx + dy + 1.4) / 2.8))
            col = lerp(purple, blue, diag * 2) if diag < 0.5 else lerp(blue, cyan, (diag - 0.5) * 2)
            col = lerp(col, pink, max(0.0, d - 0.75) * 2.4 * (1 - diag))
            col = lerp(col, (255, 255, 255), max(0.0, 1 - math.hypot(dx + 0.38, dy + 0.42) / 0.75) ** 1.6 * 0.85)
            col = lerp(col, (60, 90, 200), max(0.0, d - 0.85) * 1.2 * diag)
            px[x, y] = tuple(int(v) for v in col) + (255,)

    leaf = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ld = ImageDraw.Draw(leaf)
    w, h = r * 1.15, r * 0.62
    pts = []
    for i in range(61):
        t = i / 60
        pts.append((c - w / 2 + w * t, c - h / 2 * math.sin(math.pi * t) ** 0.8))
    for i in range(61):
        t = 1 - i / 60
        pts.append((c - w / 2 + w * t, c + h / 2 * math.sin(math.pi * t) ** 0.8))
    ld.polygon(pts, fill=(255, 255, 255, 240))
    mask = leaf.split()[3]
    stripes = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stripes)
    step = h / 7
    for k in range(-4, 5):
        yy = c + k * step
        sd.line([(c - w / 2, yy), (c + w / 2, yy)], fill=(130, 165, 240, 210), width=max(1, int(step * 0.35)))
    leaf.paste(stripes, (0, 0), Image.composite(stripes, Image.new("RGBA", (s, s)), mask).split()[3])
    leaf = leaf.rotate(30, center=(c, c), resample=Image.BICUBIC)
    leaf = leaf.filter(ImageFilter.GaussianBlur(s / 400))
    img.alpha_composite(leaf)
    return img.resize((size, size), Image.LANCZOS)


os.makedirs(ROOT, exist_ok=True)
orb(256).save(os.path.join(ROOT, "icon.png"))
orb(32).save(os.path.join(ROOT, "tray.png"))
print("icons written")
