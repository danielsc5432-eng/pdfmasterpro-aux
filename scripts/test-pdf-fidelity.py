"""Native regression tests; requires the same Python dependencies as the worker."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile
from xml.etree import ElementTree

import fitz

spec = importlib.util.spec_from_file_location("fidelity", Path(__file__).with_name("pdf-fidelity.py"))
fidelity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fidelity)


class FidelityRegression(unittest.TestCase):
    def test_cjk_spacing_does_not_mask_missing_characters(self):
        source,_=fidelity.text_content("合同金额 123.45")
        split,_=fidelity.text_content("合 同 金 额 123.45")
        missing,_=fidelity.text_content("合 同 金 123.45")
        self.assertEqual(fidelity.coverage(source,split),1)
        self.assertLess(fidelity.coverage(source,missing),1)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def pdf(self, name, text, rotation=0):
        filename = self.root / name
        with fitz.open() as doc:
            page = doc.new_page(width=400, height=600)
            page.insert_text((40, 80), text, fontsize=12)
            page.set_rotation(rotation)
            doc.save(filename)
        return str(filename)

    def test_negative_sign_and_decimal_separator_are_not_discarded(self):
        a = self.pdf("a.pdf", "Total -123.45")
        b = self.pdf("b.pdf", "Total 123.45")
        report = fidelity.compare(a, b)
        self.assertEqual(report["numberCoverage"], 0)
        self.assertEqual(report["numberPositionCoverage"], 0)
        c = self.pdf("c.pdf", "Total -1.2345")
        self.assertEqual(fidelity.compare(a, c)["numberPositionCoverage"], 0)

    def test_hidden_docx_value_does_not_mask_missing_rendered_value(self):
        a = self.pdf("a.pdf", "Total 123.45")
        b = self.pdf("b.pdf", "Total")
        word = self.root / "result.docx"
        with ZipFile(word, "w") as archive:
            archive.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Total 123.45</w:t></w:r></w:p></w:body></w:document>')
        report = fidelity.compare(a, b, word)
        self.assertEqual(report["numberCoverage"], 1)
        self.assertEqual(report["renderedNumberCoverage"], 0)

    def test_duplicate_values_are_detected(self):
        a = self.pdf("a.pdf", "Total 123.45")
        b = self.pdf("b.pdf", "Total 123.45 123.45")
        self.assertEqual(fidelity.compare(a, b)["renderedNumberPrecision"], 0.5)

    def test_alphanumeric_identifiers_keep_their_numeric_part(self):
        a = self.pdf("a.pdf", "Reference AB123")
        b = self.pdf("b.pdf", "Reference AB999")
        self.assertEqual(fidelity.compare(a, b)["numberCoverage"], 0)

    def test_word_drawing_offsets_and_deleted_values_are_not_document_text(self):
        xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body><w:p><w:r><w:drawing><wp:posOffset>123456</wp:posOffset></w:drawing><w:t>Total</w:t><w:tab/><w:t>-12.34</w:t></w:r><w:del><w:r><w:t>999.99</w:t></w:r></w:del></w:p></w:body></w:document>'
        text = fidelity.editable_word_text(ElementTree.fromstring(xml))
        self.assertEqual(text, "Total\t-12.34\n")

    def test_rotation_coordinates_match_identical_display(self):
        a = self.pdf("a.pdf", "Total 123.45", 90)
        # Flatten the page rotation without changing its displayed appearance.
        b = self.root / "b.pdf"
        with fitz.open(a) as source:
            source[0].remove_rotation()
            source.save(b)
        self.assertEqual(fidelity.compare(a, b)["numberPositionCoverage"], 1)

    def test_word_shape_fallback_is_not_counted_twice(self):
        xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:AlternateContent><mc:Choice Requires="wps"><w:p><w:r><w:t>123.45</w:t></w:r></w:p></mc:Choice><mc:Fallback><w:p><w:r><w:t>123.45</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent></w:document>'
        self.assertEqual(fidelity.editable_word_text(ElementTree.fromstring(xml)), "123.45\n")

    def test_searchable_scan_is_not_treated_as_verified_native_text(self):
        with fitz.open() as source, fitz.open() as scanned:
            native = source.new_page(width=400, height=600)
            text = "This statement has enough searchable words to conceal an OCR layer 123.45"
            native.insert_text((20, 60), text, fontsize=8)
            raster = native.get_pixmap().tobytes("png")
            page = scanned.new_page(width=400, height=600)
            page.insert_image(page.rect, stream=raster)
            page.insert_text((20, 60), text, fontsize=8, render_mode=3)
            self.assertGreater(len(page.get_text("words")), 8)
            self.assertTrue(fidelity.requires_ocr_review(page))

    def test_transparent_ocr_layer_is_also_detected(self):
        with fitz.open() as source, fitz.open() as scanned:
            native = source.new_page(width=400, height=600)
            native.insert_text((20,60), "Reference scanned statement", fontsize=8)
            image = native.get_pixmap().tobytes("png")
            page = scanned.new_page(width=400, height=600)
            page.insert_image(page.rect, stream=image)
            page.insert_text((20,60), "This statement contains enough searchable words to test transparent OCR 123.45", fontsize=8, fill_opacity=0)
            self.assertGreater(len(page.get_text("words")), 8)
            self.assertTrue(fidelity.requires_ocr_review(page))


if __name__ == "__main__":
    unittest.main()
