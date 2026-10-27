"""Bounded read-only PDF text/OCR extraction. No PDF script or embedded file is executed."""
import json
import math
import os
import shutil
import subprocess
import sys
import fitz

def extract(source, selection, use_ocr):
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024, 384 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (40, 40))
    except (ImportError, ValueError, OSError):
        pass
    with fitz.open(source) as document:
        if document.needs_pass:
            return {"error": "protected"}
        total = len(document)
        if not 1 <= total <= 120:
            return {"error": "pages"}
        indices = set()
        if selection:
            import re
            for item in selection.split(','):
                match = re.fullmatch(r'\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?\s*', item)
                if not match:
                    return {"error": "selection"}
                start = int(match[1]); end = int(match[2] or start)
                if start < 1 or end < start or end > total:
                    return {"error": "selection"}
                indices.update(range(start, end + 1))
        else:
            indices.update(range(1, total + 1))
        pages = []; characters = 0; ocr_count = 0
        tesseract = shutil.which(os.environ.get('SUMMARY_TESSERACT', 'tesseract')) if use_ocr else None
        for number in sorted(indices):
            page = document[number - 1]
            text = page.get_text('text', clip=page.rect, sort=True).strip()
            ocr = False; warning = None
            large_image = any(fitz.Rect(image['bbox']).get_area() > page.rect.get_area() * .5 for image in page.get_image_info())
            scan = (not text and (bool(page.get_images()) or bool(page.get_drawings()))) or (large_image and len(text.split()) < 15)
            if scan:
                if tesseract and ocr_count < 10:
                    ocr_count += 1
                    try:
                        scale = min(2.0, math.sqrt(2500000 / max(page.rect.get_area(), 1)))
                        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                        response = subprocess.run([tesseract, 'stdin', 'stdout', '-l', os.environ.get('SUMMARY_OCR_LANGUAGE', 'por+eng')], input=pixmap.tobytes('png'), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=12, check=True)
                        recognized = response.stdout.decode('utf-8', errors='strict').strip()
                        if recognized:
                            text = recognized; ocr = True
                        else:
                            text = ''; warning = 'Página sem texto reconhecível.'
                    except Exception:
                        text = ''; warning = 'OCR não concluído nesta página; ela não foi analisada.'
                else:
                    text = ''; warning = 'Página digitalizada não analisada: OCR indisponível ou limite de 10 páginas OCR atingido.'
            if len(text) > 12000:
                return {"error": "characters"}
            characters += len(text)
            if characters > 60000:
                return {"error": "characters"}
            if not text and not warning:
                warning = 'Página sem texto extraível.'
            pages.append({"number": number, "text": text, "ocr": ocr, **({"warning": warning} if warning else {})})
        return {"totalPages": total, "pages": pages}

if __name__ == '__main__':
    try:
        print(json.dumps(extract(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else '', len(sys.argv) < 4 or sys.argv[3] == '1'), ensure_ascii=True, allow_nan=False))
    except Exception:
        print(json.dumps({"error": "unreadable"}))
