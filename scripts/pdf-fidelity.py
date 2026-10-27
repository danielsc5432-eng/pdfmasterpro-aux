"""Compare a reference PDF and a rendered DOCX; output metrics, never content."""
import argparse
from collections import Counter
import json
import re
import unicodedata
from zipfile import ZipFile
from xml.etree import ElementTree

import cv2
import fitz
import numpy as np
from pdf_page_analysis import searchable_scan


def normalize(text):
    return unicodedata.normalize("NFKC", text).casefold().replace("\u2212", "-")


def text_content(text):
    text = normalize(text)
    text = re.sub(r"(?<=\d)\s+(?=[.,/\-])|(?<=[.,/\-])\s+(?=\d)", "", text)
    text = re.sub(r"([+\-])\s+(?=\d)", r"\1", text)
    # Ideographs need no spaces. PDF engines disagree about CJK word segmentation;
    # compare the same individual characters, while keeping Latin words intact.
    cjk = r"\u3400-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f"
    tokens = re.findall("["+cjk+"]|[^\\W"+cjk+"]+", text)
    return Counter(tokens), Counter(re.findall(r"[+\-]?\d+(?:[.,/\-]\d+)*", text))


def numeric_words(page):
    """PyMuPDF word coordinates are unrotated; compare in displayed page space."""
    result = []
    for word in page.get_text("words"):
        key = normalize(word[4])
        if not re.fullmatch(r"[+\-]?\d+(?:[.,/:\-]\d+)*", key):
            continue
        rect = fitz.Rect(word[:4]) * page.rotation_matrix
        result.append((*rect, key))
    return result


def editable_word_text(root):
    """Read Word text, not drawing offsets, field instructions or deleted revisions."""
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    compatibility = "{http://schemas.openxmlformats.org/markup-compatibility/2006}"
    result = []

    def visit(node):
        if node.tag == compatibility + "AlternateContent":
            # Word stores a modern shape and a legacy fallback for the same text.
            choice = node.find(compatibility + "Choice")
            selected = choice if choice is not None else node.find(compatibility + "Fallback")
            if selected is not None:
                visit(selected)
            return
        if node.tag in (namespace + "del", namespace + "moveFrom"):
            return
        if node.tag == namespace + "t":
            result.append(node.text or "")
        elif node.tag == namespace + "tab":
            result.append("\t")
        elif node.tag in (namespace + "br", namespace + "cr"):
            result.append("\n")
        else:
            for child in node:
                visit(child)
        if node.tag == namespace + "p":
            result.append("\n")

    visit(root)
    return "".join(result)


def content(page):
    return text_content(page.get_text())


def requires_ocr_review(page):
    large_image = any(fitz.Rect(image["bbox"]).get_area() > page.rect.get_area() * 0.5 for image in page.get_image_info())
    if not large_image:
        return False
    if len(page.get_text("words")) < 8:
        return True
    # Searchable scans have many words, but their OCR text is deliberately invisible.
    return searchable_scan(page)


def coverage(expected, actual):
    total = sum(expected.values())
    return sum((expected & actual).values()) / total if total else 1.0


def raster(page, width, height):
    scale = min(1.0, 900.0 / max(page.rect.width, page.rect.height))
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csGRAY, alpha=False)
    pixels = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    return cv2.resize(pixels, (width, height), interpolation=cv2.INTER_AREA) < 190


def compare(reference, candidate, docx=None):
    with fitz.open(reference) as source, fitz.open(candidate) as result:
        expected_words, actual_words, expected_numbers, actual_numbers = Counter(), Counter(), Counter(), Counter()
        similarity, dimensions = [], True
        scanned = False
        positioned_numbers = 0
        expected_positioned_numbers = 0
        for index, page in enumerate(source):
            words, numbers = content(page)
            # Page-specific counters catch content moved onto another page.
            expected_words.update({(index, key): value for key, value in words.items()})
            expected_numbers.update({(index, key): value for key, value in numbers.items()})
            scanned |= requires_ocr_review(page)
            if index >= len(result):
                expected_positioned_numbers += len(numeric_words(page))
                similarity.append(0.0)
                continue
            other = result[index]
            available = numeric_words(other)
            for word in numeric_words(page):
                expected_positioned_numbers += 1
                key = word[4]
                choices = [(i, item) for i, item in enumerate(available) if item[4] == key]
                if choices:
                    center = ((word[0]+word[2])/2, (word[1]+word[3])/2)
                    best, item = min(choices, key=lambda choice: abs((choice[1][0]+choice[1][2])/2-center[0])+abs((choice[1][1]+choice[1][3])/2-center[1]))
                    distance = max(abs((item[0]+item[2])/2-center[0]), abs((item[1]+item[3])/2-center[1]))
                    if distance <= 5:
                        positioned_numbers += 1
                    available.pop(best)
            words, numbers = content(other)
            actual_words.update({(index, key): value for key, value in words.items()})
            actual_numbers.update({(index, key): value for key, value in numbers.items()})
            dimensions &= abs(page.rect.width - other.rect.width) < 2 and abs(page.rect.height - other.rect.height) < 2
            width = max(1, round(page.rect.width * min(1, 900 / max(page.rect.width, page.rect.height))))
            height = max(1, round(width * page.rect.height / page.rect.width))
            a, b = raster(page, width, height), raster(other, width, height)
            kernel = np.ones((3, 3), np.uint8)
            near_a = cv2.dilate(a.astype(np.uint8), kernel).astype(bool)
            near_b = cv2.dilate(b.astype(np.uint8), kernel).astype(bool)
            unmatched = np.count_nonzero(a & ~near_b) + np.count_nonzero(b & ~near_a)
            ink = np.count_nonzero(a) + np.count_nonzero(b)
            similarity.append(1 - unmatched / max(1, ink))
        rendered_coverage = coverage(expected_words, actual_words)
        rendered_number_coverage = coverage(expected_numbers, actual_numbers)
        rendered_number_precision = coverage(actual_numbers, expected_numbers)
        if docx:
            with ZipFile(docx) as archive:
                root = ElementTree.fromstring(archive.read("word/document.xml"))
                actual_text, actual_values = text_content(editable_word_text(root))
                reference_text, reference_values = text_content("\n".join(page.get_text() for page in source))
                text_coverage = coverage(reference_text, actual_text)
                number_coverage = coverage(reference_values, actual_values)
                number_precision = coverage(actual_values, reference_values)
        else:
            text_coverage = coverage(expected_words, actual_words)
            number_coverage = coverage(expected_numbers, actual_numbers)
            number_precision = rendered_number_precision
        return {
            "sourcePages": len(source), "outputPages": len(result),
            "sameDimensions": bool(dimensions),
            "textCoverage": text_coverage,
            "numberCoverage": number_coverage,
            "numberPrecision": number_precision,
            "renderedNumberCoverage": rendered_number_coverage,
            "renderedNumberPrecision": rendered_number_precision,
            "renderedTextCoverage": rendered_coverage,
            "numberPositionCoverage": positioned_numbers / expected_positioned_numbers if expected_positioned_numbers else 1.0,
            "visualSimilarity": sum(similarity) / max(1, len(similarity)),
            "worstPageSimilarity": min(similarity, default=0.0),
            "ocrReview": bool(scanned),
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("reference")
    parser.add_argument("candidate")
    parser.add_argument("--docx")
    args = parser.parse_args()
    print(json.dumps(compare(args.reference, args.candidate, args.docx), allow_nan=False))
