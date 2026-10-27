"""Synthetic documents only: extractor refusal, scan detection and rotated evidence."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import fitz

spec = importlib.util.spec_from_file_location("extract_divergences", Path(__file__).with_name("extract-divergences.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pdfmaster-divergences-test-")
        self.target = Path(self.temp.name) / "fixture.pdf"

    def tearDown(self):
        self.temp.cleanup()

    def test_password_is_not_bypassed(self):
        with fitz.open() as doc:
            doc.new_page().insert_text((40, 60), "Private test data")
            doc.save(self.target, encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner-test-only", user_pw="test-only")
        self.assertEqual(module.extract(self.target), {"error": "protected"})

    def test_too_many_pages_are_rejected(self):
        with fitz.open() as doc:
            for _ in range(21):
                doc.new_page()
            doc.save(self.target)
        self.assertEqual(module.extract(self.target), {"error": "pages"})

    def test_image_with_invisible_ocr_is_not_certified_as_native_text(self):
        with fitz.open() as image_doc:
            image_page = image_doc.new_page()
            image_page.insert_text((40, 60), "Total: 100,00 - synthetic scan")
            image = image_page.get_pixmap().tobytes("png")
        with fitz.open() as doc:
            page = doc.new_page()
            page.insert_image(page.rect, stream=image)
            page.insert_text((40, 60), "Total: 999,00 synthetic invisible OCR text with many words", render_mode=3)
            doc.save(self.target)
        self.assertTrue(module.extract(self.target)["pages"][0]["needsOcr"])

    def test_rotated_coordinates_reference_displayed_page(self):
        with fitz.open() as doc:
            page = doc.new_page(width=400, height=600)
            page.insert_text((40, 60), "Total: R$ 123,45")
            page.set_rotation(90)
            doc.save(self.target)
        page = module.extract(self.target)["pages"][0]
        self.assertEqual((page["width"], page["height"]), (600, 400))
        self.assertFalse(page["needsOcr"])
        self.assertIn("123,45", page["lines"][0]["text"])
        x0, y0, x1, y1 = page["lines"][0]["box"]
        self.assertTrue(0 <= x0 < x1 <= 600 and 0 <= y0 < y1 <= 400)


if __name__ == "__main__":
    unittest.main()
