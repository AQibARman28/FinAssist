"""Renders the brushed-metal textures the dashboard uses (DESIGN.md › Materials).

    python views/scripts/render-metal.py

Writes public/textures/brushed-titanium.webp (the wallet card face, 1.586:1)
and public/textures/brushed-platinum.webp (the FA monogram and quick-add
chips). Pure numpy: random grain, a long horizontal blur for the brushing,
a tone ramp across the plate and one soft band of reflected light. The seed
is fixed, so the files come out the same every run.
"""
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "public" / "textures"
SEED = 20261105


def brushing(rng: np.random.Generator, h: int, w: int, reach: int) -> np.ndarray:
    """Horizontal streaks: noise smeared along x, plus whole-row variation."""
    noise = rng.normal(0.0, 1.0, (h, w))
    padded = np.concatenate([noise[:, -reach:], noise], axis=1)
    run = np.cumsum(padded, axis=1)
    smear = (run[:, reach:] - run[:, :-reach]) / np.sqrt(reach)
    rows = rng.normal(0.0, 1.0, (h, 1))
    rows = (rows + np.roll(rows, 1, axis=0) + np.roll(rows, -1, axis=0)) / 3
    streaks = 0.65 * smear / smear.std() + 0.35 * rows / rows.std()
    grain = rng.normal(0.0, 1.0, (h, w)) * 0.18
    tex = streaks + grain
    return tex / tex.std()


def ramp(h: int, w: int, angle_deg: float, stops: list[tuple[float, float]]) -> np.ndarray:
    """A linear tone ramp across the plate, like CSS linear-gradient(angle)."""
    a = np.deg2rad(angle_deg)
    ys, xs = np.mgrid[0:h, 0:w]
    # CSS angles: 0deg points up, 90deg right.
    d = (xs - w / 2) * np.sin(a) - (ys - h / 2) * np.cos(a)
    span = abs(w / 2 * np.sin(a)) + abs(h / 2 * np.cos(a))
    t = np.clip((d / span + 1) / 2, 0, 1)
    pos, val = zip(*stops)
    return np.interp(t, pos, val)


def reflection(h: int, w: int, centre: float, width: float) -> np.ndarray:
    """A soft band of light, stretched across the brushing (as on real brushed metal)."""
    xs = np.linspace(0, 1, w)[None, :]
    ys = np.linspace(0, 1, h)[:, None]
    lean = xs + (ys - 0.5) * 0.35
    return np.exp(-((lean - centre) ** 2) / (2 * width ** 2))


def bevel(lum: np.ndarray, light: float, dark: float, px: int) -> np.ndarray:
    """Catch the light on the top edge and fall into shadow on the bottom one."""
    out = lum.copy()
    for i in range(px):
        k = 1 - i / px
        out[i, :] += light * k
        out[-1 - i, :] -= dark * k
    return out


def save(lum: np.ndarray, tint: tuple[float, float, float], path: Path) -> None:
    rgb = np.clip(lum[..., None] * np.array(tint)[None, None, :], 0, 1)
    Image.fromarray((rgb * 255 + 0.5).astype(np.uint8), "RGB").save(path, "WEBP", quality=90, method=6)
    print(f"wrote {path.name} ({path.stat().st_size // 1024} KB)")


def titanium(rng: np.random.Generator) -> None:
    h, w = 630, 1000
    base = ramp(h, w, 155, [(0, 0.24), (0.42, 0.105), (0.68, 0.185), (1, 0.075)])
    band = reflection(h, w, 0.3, 0.16)
    tex = brushing(rng, h, w, reach=220)
    lum = base + 0.085 * band + tex * (0.012 + 0.034 * band)
    save(bevel(lum, 0.09, 0.06, 3), (0.985, 0.99, 1.03), OUT / "brushed-titanium.webp")


def platinum(rng: np.random.Generator) -> None:
    h = w = 256
    base = ramp(h, w, 150, [(0, 0.93), (0.55, 0.74), (1, 0.89)])
    band = reflection(h, w, 0.35, 0.2)
    tex = brushing(rng, h, w, reach=90)
    lum = base + 0.04 * band + tex * 0.022
    save(bevel(lum, 0.05, 0.0, 2), (0.99, 0.99, 1.0), OUT / "brushed-platinum.webp")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED)
    titanium(rng)
    platinum(rng)
