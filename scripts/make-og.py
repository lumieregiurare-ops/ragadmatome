"""ロゴ・ファビコン・OGP 画像を作る。

ロゴは 16x16 のドット絵のスライム（オリジナル）を拡大したもの。公式の絵は使わない。
文字は Windows の游ゴシック（Bold）。無い環境ではフォントのパスを書き換えて使う。

使い方: python scripts/make-og.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
FONT = "C:/Windows/Fonts/YuGothB.ttc"

SPRITE = [
    "................",
    "......KKKK......",
    "....KKPPPPKK....",
    "...KPPPPPLLPK...",
    "..KPPPPPPLWLPK..",
    "..KPPPPPPPLLPK..",
    ".KPPPPPPPPPPPPK.",
    ".KPPPEPPPPEPPPK.",
    ".KPPPEPPPPEPPPK.",
    "KPPRPPPPPPPPRPPK",
    "KPPPPPPKKPPPPPPK",
    "KPPPPPPPPPPPPPPK",
    ".KPPPPPPPPPPPPK.",
    "..KKPPPPPPPPKK..",
    "....KKKKKKKK....",
    "................",
]
COLORS = {
    "K": (92, 30, 58, 255),
    "P": (247, 143, 179, 255),
    "L": (255, 198, 220, 255),
    "W": (255, 255, 255, 255),
    "E": (40, 20, 30, 255),
    "R": (240, 96, 140, 255),
}
NAVY = (36, 54, 95)
FRAME = (135, 150, 189)
TITLE = (40, 58, 104)


def sprite(scale):
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for y, row in enumerate(SPRITE):
        for x, c in enumerate(row):
            if c in COLORS:
                im.putpixel((x, y), COLORS[c])
    return im.resize((16 * scale, 16 * scale), Image.NEAREST)


def icons():
    sprite(4).save(SITE / "assets" / "logo-mark.png", optimize=True)  # 64x64（ヘッダーで 44px 表示）
    sprite(2).save(SITE / "favicon-32.png", optimize=True)
    big = sprite(16)
    big.save(SITE / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    touch = Image.new("RGBA", (180, 180), NAVY + (255,))
    s = sprite(9)  # 144px
    touch.alpha_composite(s, (18, 22))
    touch.convert("RGB").save(SITE / "apple-touch-icon.png", optimize=True)
    rects = []
    for y, row in enumerate(SPRITE):
        for x, c in enumerate(row):
            if c in COLORS:
                r, g, b, _ = COLORS[c]
                rects.append(f'<rect x="{x}" y="{y}" width="1" height="1" fill="#{r:02x}{g:02x}{b:02x}"/>')
    (SITE / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">' + "".join(rects) + "</svg>\n",
        encoding="utf-8",
    )
    print("wrote icons")


def og():
    W, H = 1200, 630
    im = Image.new("RGBA", (W, H), (207, 216, 230, 255))
    d = ImageDraw.Draw(im)
    # 背景の市松
    for y in range(0, H, 24):
        for x in range(0, W, 24):
            if (x // 24 + y // 24) % 2 == 0:
                d.rectangle([x, y, x + 23, y + 23], fill=(219, 226, 237, 255))
    # 上の帯（ヘッダー）
    d.rectangle([0, 0, W, 92], fill=NAVY + (255,))
    d.rectangle([0, 92, W, 98], fill=(19, 33, 63, 255))
    f_logo = ImageFont.truetype(FONT, 50)
    im.alpha_composite(sprite(4), (50, 14))
    d.text((134, 50), "ラグアド速報", font=f_logo, fill=(0, 0, 0), anchor="lm")
    d.text((131, 47), "ラグアド速報", font=f_logo, fill=(255, 255, 255), anchor="lm")

    # ウィンドウ
    x0, y0, x1, y1 = 70, 140, 1130, 500
    d.rounded_rectangle([x0 + 4, y0 + 4, x1 + 4, y1 + 4], radius=10, fill=(90, 100, 130, 120))
    d.rounded_rectangle([x0, y0, x1, y1], radius=10, fill=(255, 255, 255, 255), outline=FRAME, width=3)
    # タイトルバー（上から下へ白→青灰）
    bar_h = 54
    for i in range(bar_h):
        t = i / bar_h
        c = tuple(int(a + (b - a) * t) for a, b in zip((253, 254, 255), (195, 207, 231)))
        d.line([x0 + 3, y0 + 3 + i, x1 - 3, y0 + 3 + i], fill=c)
    d.line([x0, y0 + bar_h + 3, x1, y0 + bar_h + 3], fill=FRAME, width=3)
    d.rectangle([x0 + 20, y0 + 20, x0 + 40, y0 + 40], fill=NAVY, outline=(0, 0, 0))
    f_bar = ImageFont.truetype(FONT, 28)
    d.text((x0 + 56, y0 + 30), "インフォメーション", font=f_bar, fill=TITLE, anchor="lm")
    d.rectangle([x1 - 48, y0 + 16, x1 - 22, y0 + 42], fill=(238, 242, 249), outline=(158, 169, 198), width=2)
    d.text((x1 - 35, y0 + 29), "×", font=ImageFont.truetype(FONT, 22), fill=(122, 134, 166), anchor="mm")

    f_big = ImageFont.truetype(FONT, 64)
    f_mid = ImageFont.truetype(FONT, 34)
    d.text((x0 + 50, y0 + 150), "ラグナロク：アドベンチャーズ", font=f_big, fill=(34, 34, 34), anchor="lm")
    d.text((x0 + 50, y0 + 230), "公式のお知らせ・公式動画・ゲーム媒体の記事・", font=f_mid, fill=(80, 80, 80), anchor="lm")
    d.text((x0 + 50, y0 + 280), "アプリの更新をまとめています", font=f_mid, fill=(80, 80, 80), anchor="lm")

    # 下の帯（全体チャット風）
    d.rectangle([0, 545, W, H], fill=(20, 24, 33, 255))
    f_bc = ImageFont.truetype(FONT, 30)
    d.text((52, 588), "ragadmatome.gamelab.website", font=f_bc, fill=(0, 0, 0), anchor="lm")
    d.text((50, 586), "ragadmatome.gamelab.website", font=f_bc, fill=(255, 243, 92), anchor="lm")
    d.text((1150, 586), "30分おきに更新", font=f_bc, fill=(140, 255, 140), anchor="rm")

    im.convert("RGB").save(SITE / "assets" / "og.png", optimize=True)
    print("wrote og.png")


if __name__ == "__main__":
    icons()
    og()
