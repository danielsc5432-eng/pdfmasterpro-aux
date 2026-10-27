"""Bounded PDFium/pikepdf helper. No network, JavaScript, URLs or document instructions executed."""
import argparse
import json
import math
import re
import sys
from pathlib import Path

import pikepdf
import pypdfium2 as pdfium
from PIL import Image, ImageChops, ImageStat

MAX_PAGES = 60
MAX_PIXELS = 4_000_000

def validate_images(folder):
    """Decode in a short-lived process, keeping full pixel buffers out of Node."""
    files = sorted(p for p in folder.iterdir() if re.fullmatch(r'pagina-?\d+\.png',p.name,re.I))
    if not 1 <= len(files) <= MAX_PAGES:
        raise ValueError('Invalid image count')
    total = 0
    for file in files:
        if file.is_symlink() or not file.is_file():
            raise ValueError('Invalid output file')
        total += file.stat().st_size
        if total > 32*1024*1024:
            raise ValueError('Image budget exceeded')
        with Image.open(file) as image:
            if image.format != 'PNG' or image.width*image.height > MAX_PIXELS:
                raise ValueError('Invalid image dimensions or format')
            image.verify()
        with Image.open(file) as image:
            image.load()
    return {'valid': True, 'count':len(files)}

def inspect(path):
    if path.stat().st_size > 25 * 1024 * 1024:
        raise ValueError("Limite de 25 MB do motor complementar excedido.")
    with pikepdf.open(path, attempt_recovery=False) as structure:
        if structure.is_encrypted:
            raise ValueError("Envie uma cópia desbloqueada autorizada do PDF.")
        if not 1 <= len(structure.pages) <= MAX_PAGES:
            raise ValueError("Limite de 60 páginas do motor complementar excedido.")
        rich = bool(structure.Root.get("/AcroForm")) or bool(structure.Root.get("/Perms"))
        for page in structure.pages:
            rich = rich or bool(page.get("/Annots"))
            for image in page.images.values():
                if int(image.get("/Width", 0)) * int(image.get("/Height", 0)) > 25_000_000:
                    raise ValueError("Imagem interna excede o limite de 25 milhões de pixels.")
    doc = pdfium.PdfDocument(path)
    try:
        pages = []
        total = 0
        for index in range(len(doc)):
            page = doc[index]
            textpage = page.get_textpage()
            try:
                count = textpage.count_chars()
                if count > 120000 or total + count > 240000:
                    raise ValueError("Limite de texto do motor complementar excedido.")
                text = textpage.get_text_range().strip()
                total += len(text)
                width, height = page.get_size()
                if not all(math.isfinite(v) and 0 < v <= 20000 for v in (width, height)):
                    raise ValueError("Dimensões de página não suportadas.")
                bitmap = page.render(scale=min(0.5, math.sqrt(250000 / (width * height))))
                try:
                    image = bitmap.to_pil().convert("L")
                    ink = ImageStat.Stat(image).mean[0] < 254.8
                finally:
                    bitmap.close()
                pages.append({"number": index + 1, "width": width, "height": height, "text": text, "needsOcr": len(text) < 5 and ink, "rotation": page.get_rotation()})
            finally:
                textpage.close()
                page.close()
        return {"pages": pages, "rich": rich}
    finally:
        doc.close()

def normalize(text):
    return " ".join(text.split())

def check_ocr(source, output):
    before, after = inspect(source), inspect(output)
    errors = []
    if len(before["pages"]) != len(after["pages"]):
        return {"valid": False, "errors": ["Quantidade de páginas alterada."]}
    one, two = pdfium.PdfDocument(source), pdfium.PdfDocument(output)
    try:
        for original, updated in zip(before["pages"], after["pages"]):
            if original["text"] and normalize(original["text"]) != normalize(updated["text"]):
                errors.append("Texto nativo alterado na página " + str(original["number"]))
            if original["needsOcr"] and len(updated["text"].strip()) < 10:
                errors.append("OCR sem texto utilizável na página " + str(original["number"]))
            p1, p2 = one[original["number"] - 1], two[updated["number"] - 1]
            bitmaps = []
            try:
                images = []
                for page in (p1, p2):
                    w, h = page.get_size()
                    bitmap = page.render(scale=min(1, math.sqrt(1000000 / (w * h))))
                    bitmaps.append(bitmap)
                    images.append(bitmap.to_pil().convert("L"))
                errors_by_rotation = []
                for rotation in (0, 90, 180, 270):
                    candidate = images[1].rotate(rotation, expand=True)
                    if candidate.size == images[0].size:
                        errors_by_rotation.append(ImageStat.Stat(ImageChops.difference(images[0], candidate)).mean[0] / 255)
                if not errors_by_rotation or min(errors_by_rotation) > 0.015:
                    errors.append("Diferença visual acima do limite na página " + str(original["number"]))
            finally:
                for bitmap in bitmaps:
                    bitmap.close()
                p1.close()
                p2.close()
    finally:
        one.close()
        two.close()
    return {"valid": not errors, "errors": errors[:10]}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["inspect", "text", "render", "check-ocr", "check-images"])
    parser.add_argument("input", type=Path)
    parser.add_argument("output", nargs="?", type=Path)
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int, default=0)
    parser.add_argument("--dpi", type=int, default=144)
    args = parser.parse_args()
    if args.operation == 'check-images':
        print(json.dumps(validate_images(args.input)))
        return
    if args.operation == "check-ocr":
        print(json.dumps(check_ocr(args.input, args.output)))
        return
    info = inspect(args.input)
    if args.operation == "inspect":
        print(json.dumps(info))
    elif args.operation == "text":
        args.output.write_text("\n\f\n".join(p["text"] for p in info["pages"]), encoding="utf8")
    else:
        end = args.end or len(info["pages"])
        if not 1 <= args.start <= end <= len(info["pages"]) or not 72 <= args.dpi <= 300:
            raise ValueError("Intervalo ou resolução inválidos.")
        args.output.mkdir(exist_ok=True)
        doc = pdfium.PdfDocument(args.input)
        try:
            for index in range(args.start - 1, end):
                page = doc[index]
                w, h = page.get_size()
                bitmap = page.render(scale=min(args.dpi / 72, math.sqrt(MAX_PIXELS / (w * h)) * 0.99))
                try:
                    bitmap.to_pil().save(args.output / f"pagina-{index + 1}.png")
                finally:
                    bitmap.close()
                    page.close()
        finally:
            doc.close()

if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never log PDF text, metadata, credentials or source filenames.
        print("Não foi possível validar ou processar o PDF dentro dos limites seguros.", file=sys.stderr)
        sys.exit(2)
