# Generates ~60 local placeholder images + demo.json (fake filenames, dates, sizes). No network.
import json, random, pathlib, datetime
from PIL import Image, ImageDraw, ImageFilter, ImageFont
random.seed(42)
OUT = pathlib.Path(__file__).resolve().parent.parent / 'app' / 'demo'
for f in OUT.glob('*'): f.unlink()
try: FONT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 34); SMALL = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22)
except Exception: FONT = SMALL = ImageFont.load_default()
W, H = 720, 960
PAL = [((255,183,94),(255,94,98)),((86,204,242),(47,128,237)),((168,224,99),(86,171,47)),((250,208,196),(255,154,158)),((161,140,209),(251,194,235)),((255,236,210),(252,182,159)),((132,250,176),(143,211,244)),((246,211,101),(253,160,133))]
def grad(c1, c2):
    im = Image.new('RGB', (W, H)); d = ImageDraw.Draw(im)
    for y in range(H):
        t = y / H; d.line([(0, y), (W, y)], fill=tuple(int(c1[i]*(1-t)+c2[i]*t) for i in range(3)))
    return im
def scene(i):
    c1, c2 = random.choice(PAL); im = grad(c1, c2); d = ImageDraw.Draw(im)
    kind = random.choice(['hills', 'sea', 'city', 'pet'])
    sx, sy, r = random.randint(100, 600), random.randint(120, 380), random.randint(50, 110)
    d.ellipse([sx-r, sy-r, sx+r, sy+r], fill=(255, 245, 200))
    if kind == 'hills':
        for k in range(3):
            base = 600 + k*110; col = (40+k*30, 120+k*25, 70+k*10)
            pts = [(0, H)] + [(x, base - int(80*abs(((x/(180+k*40)) % 2) - 1))) for x in range(0, W+40, 40)] + [(W, H)]
            d.polygon(pts, fill=col)
    elif kind == 'sea':
        d.rectangle([0, 620, W, H], fill=(30, 90, 160))
        for y in range(640, H, 28): d.line([(0, y), (W, y+6)], fill=(90, 160, 220), width=3)
        d.polygon([(300, 600), (360, 480), (420, 600)], fill=(250, 250, 250))
    elif kind == 'city':
        x = 0
        while x < W:
            w, h = random.randint(60, 130), random.randint(200, 520); d.rectangle([x, H-h, x+w, H], fill=(40, 40, 70))
            for wy in range(H-h+20, H-20, 40):
                for wx in range(x+12, x+w-16, 26):
                    if random.random() < .6: d.rectangle([wx, wy, wx+12, wy+18], fill=(255, 220, 120))
            x += w + 6
    else:
        cx, cy = W//2, 640; col = random.choice([(90, 70, 60), (230, 150, 70), (40, 40, 40), (200, 200, 200)])
        d.rectangle([0, 780, W, H], fill=(120, 90, 70))
        d.ellipse([cx-170, cy-60, cx+170, cy+180], fill=col); d.ellipse([cx-110, cy-260, cx+110, cy-40], fill=col)
        d.polygon([(cx-100, cy-200), (cx-80, cy-320), (cx-20, cy-240)], fill=col); d.polygon([(cx+100, cy-200), (cx+80, cy-320), (cx+20, cy-240)], fill=col)
        for ex in (-45, 45): d.ellipse([cx+ex-16, cy-170, cx+ex+16, cy-138], fill=(250, 230, 90))
    d.text((24, H-56), f'Demo photo #{i+1}', font=SMALL, fill=(255, 255, 255))
    return im, kind
def screenshot(i):
    im = Image.new('RGB', (W, H), (245, 245, 247)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 40], fill=(20, 20, 20)); d.text((20, 8), '9:41', font=SMALL, fill='white'); d.text((W-110, 8), '87%', font=SMALL, fill='white')
    style = random.choice(['chat', 'receipt', 'map'])
    if style == 'chat':
        d.rectangle([0, 40, W, 120], fill=(255, 255, 255)); d.text((24, 62), random.choice(['Mom', 'Sam', 'Group: Brunch']), font=FONT, fill=(20, 20, 20))
        y = 150
        while y < H-140:
            me = random.random() < .5; w = random.randint(220, 520); h = random.choice([60, 90, 120])
            x0 = W-w-24 if me else 24; d.rounded_rectangle([x0, y, x0+w, y+h], 22, fill=(56, 132, 255) if me else (229, 229, 234)); y += h + 22
        d.rounded_rectangle([20, H-90, W-20, H-30], 30, outline=(200, 200, 200), width=3, fill='white')
    elif style == 'receipt':
        d.text((40, 80), 'Order confirmed', font=FONT, fill=(20, 20, 20))
        for k, y in enumerate(range(160, H-160, 56)):
            d.rectangle([40, y, 40+random.randint(200, 420), y+20], fill=(200, 200, 205)); d.rectangle([W-160, y, W-40, y+20], fill=(170, 170, 175))
        d.rounded_rectangle([40, H-130, W-40, H-60], 16, fill=(0, 150, 90)); d.text((W//2-60, H-112), 'Track', font=FONT, fill='white')
    else:
        d.rectangle([0, 40, W, H], fill=(229, 227, 223))
        for k in range(14): d.line([(random.randint(0, W), 40), (random.randint(0, W), H)], fill='white', width=random.choice([6, 10, 16]))
        d.ellipse([W//2-20, H//2-20, W//2+20, H//2+20], fill=(234, 67, 53)); d.rounded_rectangle([20, 60, W-20, 130], 30, fill='white')
    d.text((24, H-26), f'Demo screenshot #{i+1}', font=SMALL, fill=(120, 120, 120))
    return im
items = []
start = datetime.datetime(2014, 3, 1)
N = 60
kinds = ['photo']*44 + ['screenshot']*9 + ['blurry']*7
random.shuffle(kinds)
for i, k in enumerate(kinds):
    dt = start + datetime.timedelta(seconds=random.randint(0, int((datetime.datetime(2026, 10, 1)-start).total_seconds())))
    if k == 'screenshot':
        im = screenshot(i); fn = dt.strftime('Screenshot_%Y%m%d-%H%M%S.png'); size = random.randint(180_000, 1_400_000); label = 'screenshot'
    else:
        im, scn = scene(i)
        if k == 'blurry': im = im.filter(ImageFilter.GaussianBlur(14)); label = 'blurry'
        else: label = scn
        fn = (dt.strftime('PXL_%Y%m%d_%H%M%S') + f'{random.randint(100,999)}.jpg') if dt.year >= 2019 else dt.strftime('IMG_%Y%m%d_%H%M%S.jpg')
        size = random.randint(1_800_000, 9_500_000)
    if i % 13 == 7: size = None   # some items with unknown size, like the Picker API
    local = f'demo/{i+1:02d}.jpg'
    im.save(OUT/f'{i+1:02d}.jpg', quality=78)
    items.append({'id': f'demo-{i+1:02d}', 'filename': fn, 'createTime': dt.strftime('%Y-%m-%dT%H:%M:%SZ'), 'sizeBytes': size,
                  'type': 'PHOTO', 'mimeType': 'image/png' if fn.endswith('.png') else 'image/jpeg', 'src': local, 'demoLabel': label, 'width': W, 'height': H})
items.sort(key=lambda x: x['createTime'], reverse=True)
(OUT/'demo.json').write_text(json.dumps(items, indent=1))
print(len(items), 'items;', sum(1 for x in items if x['sizeBytes'] is None), 'unknown size')
