"""Synthetic-only, local OCR comparison. Does not change production dependencies or upload PDFs.

Run with the isolated OCRmyPDF environment; requires PyMuPDF, Pillow and psutil for measurements.
"""
import hashlib
import io
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

import fitz
import psutil
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".vercel/review/ocrmypdf-benchmark"
OUT.mkdir(parents=True, exist_ok=True)
FIXTURES = OUT / "fixtures"
FIXTURES.mkdir(exist_ok=True)
LANG = OUT / "tessdata"
LANG.mkdir(exist_ok=True)
for language in ("por", "eng"):
    shutil.copyfile(ROOT / f"public/legal-assets/ocr/lang/{language}.traineddata", LANG / f"{language}.traineddata")
tesseract = shutil.which("tesseract")
if not tesseract:
    raise RuntimeError("Tesseract is required for this isolated comparison.")
for folder in ("configs", "tessconfigs"):
    installed = Path(tesseract).parent / "tessdata" / folder
    if installed.is_dir():
        shutil.copytree(installed, LANG / folder, dirs_exist_ok=True)
osd_candidates = [Path(tesseract).parent / "tessdata/osd.traineddata", Path("/usr/share/tesseract-ocr/5/tessdata/osd.traineddata")]
osd = next((p for p in osd_candidates if p.exists()), None)
if osd:
    shutil.copyfile(osd, LANG / "osd.traineddata")
ENV = {**os.environ, "TESSDATA_PREFIX": str(LANG), "OMP_THREAD_LIMIT": "1", "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1"}

TEXT = [
    "DOCUMENTO SINTETICO - SEM DADOS DE CLIENTES",
    "Contratante: Maria Silva. Contratada: Empresa Exemplo.",
    "Valor total: R$ 2.500,00. Multa: 10%.",
    "Prazo de entrega: 15 dias uteis. Data: 30/11/2026.",
    "Rescisao mediante aviso escrito com 30 dias corridos.",
]
NUMBERS = ["2.500,00", "10%", "15", "30/11/2026", "30"]

def native_document(font_size=12):
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    for index, text in enumerate(TEXT):
        page.insert_text((35, 80 + index * max(24, font_size * 3)), text, fontsize=font_size)
    page.draw_rect(fitz.Rect(30, 50, 560, 300), color=(0.2, 0.3, 0.7), width=0.5)
    return doc

def scan_document(font_size=12, skew=0, rotated=False):
    source = native_document(font_size)
    pix = source[0].get_pixmap(matrix=fitz.Matrix(300 / 72, 300 / 72), alpha=False)
    image = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    if skew:
        image = image.rotate(skew, resample=Image.Resampling.BICUBIC, expand=False, fillcolor="white")
    encoded = io.BytesIO()
    image.save(encoded, format="PNG")
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_image(page.rect, stream=encoded.getvalue())
    if rotated:
        page.set_rotation(90)
    source.close()
    return doc

def fixtures():
    normal = scan_document()
    normal.save(FIXTURES / "scan-300dpi.pdf")
    normal.close()
    small = scan_document(font_size=6)
    small.save(FIXTURES / "small-print-6pt.pdf")
    small.close()
    tilted = scan_document(skew=3)
    tilted.save(FIXTURES / "skew-3deg.pdf")
    tilted.close()
    rotated = scan_document(rotated=True)
    rotated.save(FIXTURES / "rotated-90deg.pdf")
    rotated.close()
    native = native_document()
    native.save(FIXTURES / "native-text.pdf")
    scan = fitz.open(FIXTURES / "scan-300dpi.pdf")
    native.insert_pdf(scan)
    native.save(FIXTURES / "mixed-native-scan.pdf")
    native.close()
    scan.close()
    protected = native_document()
    protected.save(FIXTURES / "protected.pdf", encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="synthetic-owner", user_pw="synthetic-test")
    protected.close()
    (FIXTURES / "corrupt.pdf").write_bytes(b"%PDF-1.7\nSynthetic invalid PDF\n")

def run_measured(command, name, timeout=180):
    stdout_path, stderr_path = OUT / (name + ".stdout.txt"), OUT / (name + ".stderr.txt")
    start, peak = time.perf_counter(), 0
    with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
        process = subprocess.Popen(command, cwd=ROOT, env=ENV, stdout=stdout, stderr=stderr, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        parent = psutil.Process(process.pid)
        timed_out = False
        while process.poll() is None:
            if time.perf_counter() - start > timeout:
                timed_out = True
                try:
                    for child in parent.children(recursive=True):
                        child.kill()
                    parent.kill()
                except psutil.Error:
                    pass
                break
            try:
                processes = [parent] + parent.children(recursive=True)
                total = 0
                for child in processes:
                    try:
                        total += child.memory_info().rss
                    except psutil.Error:
                        pass
                peak = max(peak, total)
            except psutil.Error:
                pass
            time.sleep(0.05)
        process.wait()
    return {"exitCode": process.returncode, "timedOut": timed_out, "seconds": round(time.perf_counter() - start, 3), "peakAggregateRssMiB": round(peak / 1024 / 1024, 1), "stderrLog": str(stderr_path.relative_to(ROOT))}

def tokens(value):
    value = "".join(c for c in unicodedata.normalize("NFKD", value.lower()) if not unicodedata.combining(c))
    return re.findall(r"[a-z0-9]+", value)

def evaluate(source_path, output_path):
    source, output = fitz.open(source_path), fitz.open(output_path)
    pages = []
    expected_tokens = set(tokens(" ".join(TEXT)))
    for index, page in enumerate(output):
        text = page.get_text()
        recognized = set(tokens(text))
        recall = len(recognized & expected_tokens) / len(expected_tokens)
        compact = re.sub(r"\s+", "", text)
        amounts = {value: re.sub(r"\s+", "", value) in compact for value in NUMBERS}
        normalized_text = "".join(c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c))
        fields = {"valor": bool(re.search(r"2\.500,00", normalized_text)), "multa": bool(re.search(r"10\s*%", normalized_text)), "prazoEntrega": bool(re.search(r"15\s+dias\s+uteis", normalized_text)), "data": "30/11/2026" in normalized_text, "avisoRescisao": bool(re.search(r"30\s+dias\s+corridos", normalized_text))}
        src = source[index]
        source_pix, target_pix = src.get_pixmap(colorspace=fitz.csGRAY, alpha=False), page.get_pixmap(colorspace=fitz.csGRAY, alpha=False)
        left = Image.frombytes("L", (source_pix.width, source_pix.height), source_pix.samples)
        right = Image.frombytes("L", (target_pix.width, target_pix.height), target_pix.samples)
        normalized_errors = []
        for rotation in (0, 90, 180, 270):
            candidate = right.rotate(rotation, expand=True)
            if candidate.size == left.size:
                normalized_errors.append(ImageStat.Stat(ImageChops.difference(left, candidate)).mean[0] / 255)
        native_text = src.get_text()
        pages.append({"page": index + 1, "wordSetRecall": round(recall, 4), "numbersFound": amounts, "fieldsFound": fields, "text": text, "dimensions": [round(page.rect.width, 3), round(page.rect.height, 3)], "rotation": page.rotation, "imageObjects": len(page.get_images()), "vectorDrawings": len(page.get_drawings()), "bestOrthogonalVisualMAE": round(min(normalized_errors), 6) if normalized_errors else None, "nativeTextWasPresent": bool(native_text.strip()), "nativeTextExactlyPreserved": text.strip() == native_text.strip() if native_text.strip() else None})
    result = {"pageCount": len(output), "pageCountPreserved": len(output) == len(source), "bytes": output_path.stat().st_size, "pages": pages}
    source.close()
    output.close()
    return result

def main():
    fixtures()
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node is required for the unchanged baseline implementation.")
    cases = ["scan-300dpi", "small-print-6pt", "mixed-native-scan", "native-text", "rotated-90deg", "skew-3deg", "corrupt", "protected"]
    results = []
    versions = subprocess.run([sys.executable, "-m", "ocrmypdf", "--version"], env=ENV, capture_output=True, text=True, check=True).stdout.strip()
    for case in cases:
        source = FIXTURES / (case + ".pdf")
        engines = ["baseline-144dpi", "ocrmypdf-preserve"]
        if case in ("rotated-90deg", "skew-3deg"):
            engines.append("ocrmypdf-deskew-rotate")
        for engine in engines:
            output = OUT / f"{case}-{engine}.pdf"
            if engine == "baseline-144dpi":
                command = [node, str(ROOT / "node_modules/tsx/dist/cli.mjs"), str(ROOT / "scripts/benchmark-ocr-baseline.ts"), str(source), str(output)]
            else:
                command = [sys.executable, "-m", "ocrmypdf", "--mode", "skip", "--output-type", "pdf", "--optimize", "0", "--jobs", "1", "--oversample", "300", "--rasterizer", "pypdfium", "-l", "por+eng"]
                if engine.endswith("rotate"):
                    command += ["--rotate-pages", "--deskew"]
                command += [str(source), str(output)]
            measured = run_measured(command, case + "-" + engine)
            row = {"case": case, "engine": engine, **measured}
            if measured["exitCode"] == 0 and output.exists():
                row["quality"] = evaluate(source, output)
            results.append(row)
            (OUT / "results.json").write_text(json.dumps({"platform": platform.platform(), "python": platform.python_version(), "ocrmypdf": versions, "note": "Synthetic Windows-only benchmark. Aggregate RSS sampled at 50 ms; not a Linux/Render capacity guarantee. Word-set recall ignores order and duplicates; not a universal accuracy score. Rotation-aligned visual metric permits only orthogonal rotations; deskew may change appearance.", "results": results}, ensure_ascii=False, indent=2), encoding="utf8")
            print(json.dumps({"case": case, "engine": engine, "exit": measured["exitCode"], "seconds": measured["seconds"], "peakMiB": measured["peakAggregateRssMiB"], "recall": [p["wordSetRecall"] for p in row.get("quality", {}).get("pages", [])]}, ensure_ascii=True), flush=True)
    unexpected = [row for row in results if (row["case"] not in ("corrupt", "protected") and (row["exitCode"] != 0 or not row.get("quality", {}).get("pageCountPreserved"))) or (row["case"] in ("corrupt", "protected") and row["exitCode"] == 0)]
    if unexpected:
        raise RuntimeError("Unexpected processing failures; inspect results.json before drawing conclusions.")

def rotation_followup():
    """Investigate a measured quality regression without rerunning unrelated cases."""
    report_path = OUT / "results.json"
    report = json.loads(report_path.read_text(encoding="utf8"))
    source = FIXTURES / "rotated-90deg.pdf"
    profiles = [("ocrmypdf-rotation-threshold5", ["--rotate-pages", "--rotate-pages-threshold", "5"]), ("ocrmypdf-pageseg-osd", ["--tesseract-pagesegmode", "1"])]
    if "--renderer-followup" in sys.argv:
        profiles = [("ocrmypdf-sandwich", ["--pdf-renderer", "sandwich"]), ("ocrmypdf-sandwich-rotate", ["--pdf-renderer", "sandwich", "--rotate-pages", "--rotate-pages-threshold", "5"])]
    if "--ghostscript-followup" in sys.argv:
        profiles = [("ocrmypdf-ghostscript", ["--rasterizer", "ghostscript"]), ("ocrmypdf-ghostscript-rotate", ["--rasterizer", "ghostscript", "--rotate-pages", "--rotate-pages-threshold", "5"])]
    for name, flags in profiles:
        output = OUT / f"rotated-90deg-{name}.pdf"
        command = [sys.executable, "-m", "ocrmypdf", "--mode", "skip", "--output-type", "pdf", "--optimize", "0", "--jobs", "1", "--oversample", "300", "--rasterizer", "pypdfium", "-l", "por+eng", *flags, str(source), str(output)]
        measured = run_measured(command, "rotated-90deg-" + name)
        row = {"case": "rotated-90deg", "engine": name, **measured}
        if measured["exitCode"] == 0 and output.exists():
            row["quality"] = evaluate(source, output)
        report["results"] = [r for r in report["results"] if r["engine"] != name] + [row]
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
        print(json.dumps({"case": row["case"], "engine": name, "exit": measured["exitCode"], "seconds": measured["seconds"], "peakMiB": measured["peakAggregateRssMiB"], "recall": [p["wordSetRecall"] for p in row.get("quality", {}).get("pages", [])]}, ensure_ascii=True), flush=True)

if __name__ == "__main__":
    if "--recheck-quality" in sys.argv:
        report_path = OUT / "results.json"
        report = json.loads(report_path.read_text(encoding="utf8"))
        for row in report["results"]:
            if "quality" in row:
                row["quality"] = evaluate(FIXTURES / (row["case"] + ".pdf"), OUT / (row["case"] + "-" + row["engine"] + ".pdf"))
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
        print("Quality metrics rechecked without running OCR again.")
    else:
        rotation_followup() if any(flag in sys.argv for flag in ("--rotation-followup", "--renderer-followup", "--ghostscript-followup")) else main()
