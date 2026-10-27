"""Unicode/geometry extraction from MuPDF, without reflow or network access."""
import argparse
import json
import math
import os
import re
import fitz


def extract(source):
    pages = []
    with fitz.open(source) as document:
        if document.needs_pass:
            raise ValueError("Password protected PDF")
        for page in document:
            matrix = page.rotation_matrix
            zero = fitz.Point(0, 0) * matrix
            texts = []
            raw = page.get_text("rawdict", flags=fitz.TEXTFLAGS_RAWDICT & ~fitz.TEXT_PRESERVE_IMAGES)
            for block_index, block in enumerate(raw["blocks"]):
                if block["type"] != 0:
                    continue
                for line in block["lines"]:
                    vector = fitz.Point(line["dir"]) * matrix - zero
                    angle = (round(math.degrees(math.atan2(vector.y, vector.x))) + 360) % 360
                    for span in line["spans"]:
                        family = re.sub(r"^[A-Z]{6}\+", "", span["font"])
                        family = {"Helvetica": "Arial", "Times-Roman": "Times New Roman", "Courier": "Courier New"}.get(family, family)
                        cjk = any("\u2e80" <= char["c"] <= "\u9fff" for char in span["chars"])
                        if cjk:
                            family = os.getenv("PDF_CJK_FONT", family)
                        font = {"family": family, "size": span["size"], "color": f'#{span["color"]:06X}', "bold": bool(span["flags"] & 16), "italic": bool(span["flags"] & 2)}
                        groups, current = [], []
                        for char in span["chars"]:
                            if char["c"].isspace():
                                if current:
                                    groups.append(current)
                                    current = []
                            else:
                                current.append(char)
                        if current:
                            groups.append(current)
                        words = []
                        for group in groups:
                            box = fitz.Rect(group[0]["bbox"])
                            for char in group[1:]:
                                box |= fitz.Rect(char["bbox"])
                            box = box * matrix & page.rect
                            if box.is_empty:
                                continue
                            words.append({"text": "".join(char["c"] for char in group), "x": box.x0, "y": box.y0, "width": box.width, "height": box.height, "bold": font["bold"], "italic": font["italic"]})
                        if not words:
                            continue
                        box = fitz.Rect(span["bbox"]) * matrix & page.rect
                        origin = fitz.Point(span["origin"]) * matrix
                        texts.append({"x": box.x0, "y": box.y0, "width": box.width, "height": box.height, "font": font, "words": words, "segments": [{"text": span_text(span), "bold": font["bold"], "italic": font["italic"]}], "rotation": angle, "baseline": origin.y, "block": block_index})
            images = []
            for index, image in enumerate(page.get_image_info()):
                box = fitz.Rect(image["bbox"]) * matrix & page.rect
                if not box.is_empty:
                    images.append({"x": box.x0, "y": box.y0, "width": box.width, "height": box.height, "source": f"native-image-{index}"})
            pages.append({"width": page.rect.width, "height": page.rect.height, "texts": texts, "images": images})
    return pages


def span_text(span):
    return "".join(char["c"] for char in span["chars"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    print(json.dumps(extract(parser.parse_args().source), ensure_ascii=True, allow_nan=False))
