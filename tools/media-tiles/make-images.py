#!/usr/bin/env python3
"""Writes the test photograph for /media-tiles/ at four widths.

    python3 tools/media-tiles/make-images.py

Needs Pillow. The picture is drawn by this script (a sun, hills, a lake and a field of thin
lines), so no file comes from anywhere else. It is drawn once at 2560 by 1440 and reduced to
1280, 640, 320 and 160 pixels wide. Each file has its own width written in the top left
corner ("640w"), so a page can show which file the browser picked from a srcset. Output:
public/media-tiles/img/hills-<width>.webp and .jpg, and hills.webp (960 wide, no label) for the figure.
"""
import math, os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'media-tiles', 'img')
W, H = 2560, 1440
random.seed(15)

def lerp(a, b, t): return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

img = Image.new('RGB', (W, H))
d = ImageDraw.Draw(img)
# Sky: three stops, top to horizon.
sky = [(24, 32, 84), (214, 96, 110), (255, 196, 120)]
horizon = int(H * 0.62)
for y in range(horizon):
    t = y / horizon
    c = lerp(sky[0], sky[1], t / 0.6) if t < 0.6 else lerp(sky[1], sky[2], (t - 0.6) / 0.4)
    d.line([(0, y), (W, y)], fill=c)
# Stars, small enough that only the large files keep them.
for _ in range(500):
    x, y = random.randrange(W), random.randrange(int(horizon * 0.5))
    r = random.choice([1, 1, 2, 3])
    d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 250, 230))
# Sun with rings.
sx, sy = int(W * 0.68), int(H * 0.47)
glow = Image.new('RGB', (W, H), (0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([sx - 520, sy - 520, sx + 520, sy + 520], fill=(120, 50, 30))
gd.ellipse([sx - 300, sy - 300, sx + 300, sy + 300], fill=(200, 110, 50))
glow = glow.filter(ImageFilter.GaussianBlur(120))
from PIL import ImageChops
img = ImageChops.add(img, glow)
d = ImageDraw.Draw(img)
d.ellipse([sx - 190, sy - 190, sx + 190, sy + 190], fill=(255, 240, 190))
# Hills: five ranges, far to near.
ranges = [((120, 70, 120), 0.50, 110, 3), ((92, 52, 108), 0.54, 150, 5), ((62, 40, 92), 0.58, 120, 7), ((40, 30, 70), 0.63, 90, 4), ((22, 22, 48), 0.70, 60, 9)]
for colour, base, amp, freq in ranges:
    ph = random.random() * 10
    pts = [(0, H)]
    for x in range(0, W + 8, 8):
        y = H * base - amp * (0.6 * math.sin(x / W * freq * math.pi + ph) + 0.3 * math.sin(x / W * freq * 3.1 * math.pi + ph * 2) + 0.1 * math.sin(x / W * freq * 9.7 * math.pi))
        pts.append((x, y))
    pts.append((W, H))
    d.polygon(pts, fill=colour)
# Lake with the sun's reflection as thin bright lines.
lake_top = int(H * 0.74)
for y in range(lake_top, H):
    t = (y - lake_top) / (H - lake_top)
    d.line([(0, y), (W, y)], fill=lerp((70, 50, 110), (14, 16, 40), t))
for i in range(90):
    y = lake_top + 6 + int((i / 90) ** 1.6 * (H - lake_top - 12))
    half = 30 + i * 5 + random.randrange(40)
    d.line([(sx - half, y), (sx + half, y)], fill=(255, 214, 150), width=2 + i // 30)
# A fence of thin posts along the shore: one pixel wide in the 320 file, gone in the 160 file.
for x in range(40, W, 16):
    d.line([(x, lake_top - 34), (x, lake_top + 2)], fill=(250, 236, 210), width=4)
d.line([(0, lake_top - 22), (W, lake_top - 22)], fill=(250, 236, 210), width=4)

font_path = next((p for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'] if os.path.exists(p)), None)
os.makedirs(OUT, exist_ok=True)
img.resize((960, 540), Image.LANCZOS).save(os.path.join(OUT, 'hills.webp'), quality=82, method=6)
for w in (1280, 640, 320, 160):
    h = w * H // W
    small = img.resize((w, h), Image.LANCZOS)
    sd = ImageDraw.Draw(small)
    size = max(10, w // 16)
    font = ImageFont.truetype(font_path, size) if font_path else ImageFont.load_default()
    label = f'{w}w'
    box = sd.textbbox((0, 0), label, font=font)
    pad = max(3, size // 4)
    sd.rectangle([0, 0, box[2] + pad * 2, box[3] + pad * 2], fill=(255, 255, 255))
    sd.text((pad, pad), label, font=font, fill=(0, 0, 0))
    small.save(os.path.join(OUT, f'hills-{w}.webp'), quality=82, method=6)
    small.save(os.path.join(OUT, f'hills-{w}.jpg'), quality=82, optimize=True, progressive=True)
    print(w, h, os.path.getsize(os.path.join(OUT, f'hills-{w}.webp')), os.path.getsize(os.path.join(OUT, f'hills-{w}.jpg')))
