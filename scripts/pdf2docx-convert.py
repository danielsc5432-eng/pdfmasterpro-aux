"""Isolated native PDF -> structural DOCX conversion; no network access."""
import argparse
import logging
import json
import re
from pathlib import Path

import fitz  # PyMuPDF
from pdf2docx import Converter


def analyze(source: str) -> dict:
    scan, form, directional, unicode_text = False, False, False, False
    with fitz.open(source) as document:
        if document.needs_pass:
            raise ValueError("PDF protegido por senha.")
        for page in document:
            text = page.get_text()
            if len(page.get_text("words")) < 8 and any(
                fitz.Rect(image["bbox"]).get_area() >= page.rect.get_area() * 0.5
                for image in page.get_image_info()
            ):
                scan = True
            if re.search(r"\b(?:CPF|CNPJ|MATR[IÍ]CULA|ASSINATURA|DECLARA[CÇ][AÃ]O)\b", text, re.I):
                form = True
            unicode_text |= any("\u3400" <= char <= "\u9fff" for char in text)
            directional |= page.rotation in (90, 270)
            if not directional:
                directional |= any(abs(line["dir"][1]) > .99 for block in page.get_text("dict", flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)["blocks"] if block["type"] == 0 for line in block["lines"])
    if scan:
        return {"mode": "layout", "reason": "scan", "primary": "layout"}
    if directional or unicode_text:
        return {"mode": "layout", "reason": "directional" if directional else "unicode", "primary": "native"}
    if form:
        return {"mode": "layout", "reason": "form", "primary": "page-grid"}
    return {"mode": "tables", "reason": "native", "primary": "tables"}


def convert(source: str, destination: str) -> None:
    with fitz.open(source) as document:
        if document.needs_pass:
            raise ValueError("PDF protegido por senha.")
        if not len(document):
            raise ValueError("PDF sem páginas.")
        # pdf2docx is a structural converter, not an OCR engine. Do not silently
        # deliver an image-only DOCX when the user requested editable content.
        if any(not page.get_text("words") and page.get_images() for page in document):
            raise ValueError("PDF digitalizado: utilize o modo de preservar layout com OCR.")
    converter = Converter(source)
    try:
        converter.convert(destination, multi_processing=False)
    finally:
        converter.close()
    if not Path(destination).is_file() or Path(destination).stat().st_size < 100:
        raise ValueError("O motor não produziu um documento válido.")


if __name__ == "__main__":
    logging.getLogger().setLevel(logging.WARNING)
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("destination", nargs="?")
    parser.add_argument("--analyze", action="store_true")
    args = parser.parse_args()
    if args.analyze:
        print(json.dumps(analyze(args.source)))
    elif args.destination:
        convert(args.source, args.destination)
    else:
        parser.error("destination is required")
