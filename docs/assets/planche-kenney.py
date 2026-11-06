# Planche de démonstration : assemble des tuiles Kenney (CC0) en une petite scène.
import sys, random
from PIL import Image, ImageDraw
K = sys.argv[1]; OUT = sys.argv[2]
P = 17  # 16 px + 1 px de marge
def sheet(p):
    im = Image.open(p).convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            if px[x, y][:3] == (255, 0, 255): px[x, y] = (0, 0, 0, 0)
    return im
city = sheet(K + "/city/Spritesheet/roguelikeCity_transparent.png")
chars = sheet(K + "/chars/Spritesheet/roguelikeChar_transparent.png")
rpg = sheet(K + "/rpg/Spritesheet/roguelikeSheet_transparent.png")  # eau et berges (Roguelike RPG pack)
def T(c, r, s=city): return s.crop((c*P, r*P, c*P+16, r*P+16))

W, H = 26, 20
cv = Image.new("RGBA", (W*16, H*16), (0, 0, 0, 255))
def put(c, r, x, y, s=city): cv.alpha_composite(T(c, r, s), (x*16, y*16))

# Sol : trottoir partout, puis rue, puis parc
for y in range(H):
    for x in range(W): put(1, 20, x, y)
for x in range(W):
    for y in (7, 8, 9): put(11, 19, x, y)          # asphalte
    if x % 2 == 0: put(9, 19, x, 8)                # pointillés centraux
for x in range(15, W):
    for y in range(11, H): put(0, 24, x, y)        # pelouse du parc
for x in range(0, 14):
    for y in range(11, H): put(0, 24, x, y)

def building(x0, w, roof_c0, wall_c0):
    # toit 9-slice (3 rangées) + façade (rangées 9-10 du pack)
    for y in range(3):
        for x in range(w):
            cx = 0 if x == 0 else (1 if x == w-1 else 2)
            if y == 0: c, r = [(0,0),(1,0),(2,0)][cx]
            elif y == 2: c, r = [(0,1),(1,1),(2,1)][cx]
            else: c, r = [(3,0),(3,1),(2,3)][cx]
            put(roof_c0 + c, r, x0 + x, y + 1)
    for x in range(w):
        put(wall_c0 + (0 if x == 0 else 3 if x == w-1 else 1), 4, x0 + x, 4)
        for i, y in enumerate((5, 6)):
            put(wall_c0 + (0 if x == 0 else 3 if x == w-1 else 1), 9 + i, x0 + x, y)
    for x in range(1, w-1, 2): put(25, 16, x0 + x, 5)   # fenêtres
    d = x0 + w // 2
    put(20, 26, d, 5); put(20, 27, d, 6)                 # porte

building(0, 6, 0, 0)     # brique rouge
building(7, 5, 8, 4)     # pierre grise
building(13, 6, 24, 8)   # pierre beige
# arbres et lampadaires le long du trottoir
for x in (20, 22, 24):
    put(31 + (x % 3), 10, x, 4); put(31 + (x % 3), 11, x, 5)
for x in (6, 12, 19):
    put(1, 16, x, 4); put(1, 17, x, 5); put(1, 18, x, 6)

# Rivière (Roguelike RPG pack) : quai en pierre à gauche, berge naturelle à droite
for x in range(W):
    for y in range(15, H): put(1, 20, x, y)
for x in range(W):
    stone = x < 13
    c0 = 3 if 0 < x < W - 1 else (2 if x == 0 else 4)
    if not stone: c0 = 3
    top, mid, bot = ((3, 4, 5) if stone else (0, 1, 2))
    put(c0, top, x, 16, rpg); put(c0, mid, x, 17, rpg); put(c0, mid, x, 18, rpg); put(c0, bot, x, 19, rpg)
for x in range(13, W):
    put(5, 0, x, 15, rpg)   # pelouse claire au-dessus de la berge naturelle

# Parc : bassin (eau), arbres, bancs
for dy in range(3):
    for dx in range(2): put(26 + dx, 4 + dy, 17 + dx, 11 + dy)
    for dx in range(2): put(28 + dx, 4 + dy, 19 + dx, 11 + dy)
for (x, y) in [(22, 11), (24, 12), (16, 13), (23, 13)]:
    put(33, 10, x, y - 1); put(33, 11, x, y)
put(17, 15, 21, 14); put(18, 15, 22, 14)
for (x, y) in [(2, 12), (5, 13), (9, 12), (12, 13)]:
    put(32, 10, x, y - 1); put(32, 11, x, y)

# Personnages modulaires : corps + pantalon + haut + cheveux
random.seed(4)
skins = [0, 1, 2]
pants = [0, 1, 2, 5, 6, 7]
tops = [(c, r) for c in range(6, 18) for r in (0, 2, 5, 7)]
hairs = [(c, r) for c in range(19, 27) for r in (0, 1, 4, 5, 8, 9)]
colors = [(214, 92, 64), (64, 160, 150), (240, 200, 90), (150, 120, 200), (110, 180, 90)]
def person(px_, py_, sign):
    sp = Image.new("RGBA", (16, 16))
    sp.alpha_composite(T(0, random.choice(skins), chars))
    sp.alpha_composite(T(3, random.choice(pants), chars))
    sp.alpha_composite(T(*random.choice(tops), chars))
    sp.alpha_composite(T(*random.choice(hairs), chars))
    if sign:  # pancarte générée par script : couleur + forme, sur un manche
        d = ImageDraw.Draw(cv)
        col = random.choice(colors); dark = tuple(int(v * .6) for v in col)
        d.line([(px_ + 12, py_ - 4), (px_ + 12, py_ + 8)], fill=(120, 80, 50))
        d.rectangle([px_ + 7, py_ - 10, px_ + 17, py_ - 3], fill=col, outline=dark)
    cv.alpha_composite(sp, (px_, py_))
spots = [(x * 16 + random.randint(-3, 3), y * 16 + random.randint(-4, 2))
         for x in range(3, 23) for y in (7, 8, 9) if random.random() < .55]
for (x, y) in sorted(spots, key=lambda p: p[1]):   # profondeur = position y
    person(x, y, random.random() < .45)
# quelques passants dans le parc
for (x, y) in [(14, 12), (21, 13), (7, 13)]:
    person(x * 16, y * 16, False)

cv.resize((cv.width * 3, cv.height * 3), Image.NEAREST).save(OUT)
print(OUT, cv.size)
