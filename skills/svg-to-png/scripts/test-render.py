#!/usr/bin/env python3
"""Exercise the real CLI and inspect the emitted PNG bytes using only stdlib."""

import base64
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
import zlib

SCRIPTS = Path(__file__).resolve().parent
SVG = ('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60" '
       'viewBox="0 0 100 60"><rect x="10" y="10" width="20" height="20" '
       'fill="#ff0000"/></svg>')


def png_pixels(file):
    data = file.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not PNG"
    offset, compressed = 8, b""
    while offset < len(data):
        size = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        chunk = data[offset + 8:offset + 8 + size]
        if kind == b"IHDR":
            width, height, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", chunk)
            assert (depth, color, interlace) == (8, 6, 0), "expected RGBA8 PNG"
        elif kind == b"IDAT":
            compressed += chunk
        offset += size + 12
    raw = zlib.decompress(compressed)
    stride = width * 4
    previous, rows = bytearray(stride), []
    for y in range(height):
        start = y * (stride + 1)
        method, row = raw[start], bytearray(raw[start + 1:start + 1 + stride])
        for x in range(stride):
            left = row[x - 4] if x >= 4 else 0
            up = previous[x]
            upper_left = previous[x - 4] if x >= 4 else 0
            if method == 0:
                predictor = 0
            elif method == 1:
                predictor = left
            elif method == 2:
                predictor = up
            elif method == 3:
                predictor = (left + up) // 2
            elif method == 4:
                estimate = left + up - upper_left
                predictor = min((left, up, upper_left), key=lambda n: abs(estimate - n))
            else:
                raise AssertionError(f"unexpected PNG filter {method}")
            row[x] = (row[x] + predictor) & 255
        rows.append(row)
        previous = row
    return width, height, lambda x, y: tuple(rows[y][x * 4:x * 4 + 4])


class RenderTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="svg-to-png-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "source.svg"
        self.source.write_text(SVG, encoding="utf-8")

    def run_cli(self, *args, success=True):
        result = subprocess.run(
            ["node", str(SCRIPTS / "render-svg.mjs"), *map(str, args)],
            cwd=self.root, text=True, capture_output=True,
        )
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
        return result

    def test_default_dimensions_transparency_and_shape_pixels(self):
        result = self.run_cli(self.source)
        png = self.root / "source.png"
        width, height, pixel = png_pixels(png)
        self.assertEqual((width, height), (200, 120))
        self.assertEqual(pixel(0, 0), (0, 0, 0, 0))
        self.assertEqual(pixel(40, 40), (255, 0, 0, 255))
        report = json.loads(result.stdout)
        self.assertEqual(report["bytes"], png.stat().st_size)
        self.assertEqual(Path(report["output"]), png)
        self.assertEqual(self.source.read_text(), SVG)

    def test_width_height_scale_and_background(self):
        cases = [("--width", "150", (150, 90)),
                 ("--height", "48", (80, 48)),
                 ("--scale", "0.5", (50, 30))]
        for flag, value, dimensions in cases:
            with self.subTest(flag=flag):
                target = self.root / f"{flag}.png"
                self.run_cli(self.source, flag, value, "-o", target, "--background", "#ffffff")
                width, height, pixel = png_pixels(target)
                self.assertEqual((width, height), dimensions)
                self.assertEqual(pixel(0, 0), (255, 255, 255, 255))

    def test_batch_preserves_directories_and_uppercase_extension(self):
        nested = self.root / "child"
        nested.mkdir()
        (nested / "source.SVG").write_text(SVG)
        hidden = self.root / ".hidden"
        hidden.mkdir()
        (hidden / "ignored.svg").write_text("broken")
        target = self.root / "png"
        result = self.run_cli(self.root, "--output-dir", target)
        self.assertEqual(len(result.stdout.splitlines()), 2)
        self.assertTrue((target / "source.png").exists())
        self.assertTrue((target / "child/source.png").exists())
        self.assertFalse((target / ".hidden").exists())

    def test_overwrite_requires_explicit_flag(self):
        target = self.root / "source.png"
        target.write_bytes(b"keep existing output")
        self.run_cli(self.source, success=False)
        self.assertEqual(target.read_bytes(), b"keep existing output")
        self.run_cli(self.source, "--overwrite")
        self.assertEqual(png_pixels(target)[:2], (200, 120))

    def test_invalid_arguments_and_empty_directory(self):
        for args in [("--scale", "0"), ("--width", "1.5"), ("--scale", "NaN"),
                     ("--width", "100", "--scale", "2"), ("--font", "missing.ttf"),
                     ("--output", "source.svg"), ("--unknown", "1")]:
            with self.subTest(args=args):
                self.run_cli(self.source, *args, success=False)
        empty = self.root / "empty"
        empty.mkdir()
        self.run_cli(empty, success=False)
        self.assertEqual(self.source.read_text(), SVG)
        self.assertFalse((self.root / "source.png").exists())

    def test_malformed_svg_does_not_create_png(self):
        self.source.write_text("<svg><g></svg>")
        self.run_cli(self.source, success=False)
        self.assertFalse((self.root / "source.png").exists())

    def test_external_images_fail_but_embedded_images_render(self):
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'
               '<image href="{}" width="10" height="10"/></svg>')
        self.source.write_text(svg.format("https://example.invalid/absent.png"))
        self.run_cli(self.source, success=False)
        self.assertFalse((self.root / "source.png").exists())
        self.source.write_text(SVG)
        self.run_cli(self.source)
        encoded = base64.b64encode((self.root / "source.png").read_bytes()).decode()
        self.source.write_text(svg.format("data:image/png;base64," + encoded))
        self.run_cli(self.source, "--overwrite")
        self.assertEqual(png_pixels(self.root / "source.png")[:2], (20, 20))

    def test_audit_accepts_svg_and_rejects_empty_wrong_root_and_malformed(self):
        def audit(file):
            return subprocess.run(["python3", str(SCRIPTS / "audit-svg.py"), str(file)],
                                  capture_output=True).returncode
        self.assertEqual(audit(self.source), 0)
        for content in ("<svg><g></svg>", "<html/>", '<svg xmlns="urn:wrong"/>'):
            self.source.write_text(content)
            self.assertNotEqual(audit(self.source), 0)
        empty = self.root / "empty"
        empty.mkdir()
        self.assertNotEqual(audit(empty), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
