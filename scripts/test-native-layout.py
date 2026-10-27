"""Native geometry and image preprocessing regressions, without network or user PDFs."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import cv2
import fitz
import numpy as np


def load(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+".py"))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class NativeLayoutTest(unittest.TestCase):
    def test_profile_prioritizes_directional_and_form_engines(self):
        with tempfile.TemporaryDirectory() as directory:
            source=str(Path(directory)/"source.pdf")
            with fitz.open() as doc:
                page=doc.new_page()
                page.insert_text((40,80),"CPF 123.45")
                doc.save(source)
            self.assertEqual(load("pdf2docx-convert").analyze(source)["primary"],"page-grid")
            with fitz.open(source) as doc:
                doc[0].set_rotation(90)
                target=str(Path(directory)/"rotated.pdf")
                doc.save(target)
            self.assertEqual(load("pdf2docx-convert").analyze(target)["primary"],"native")

    def test_rotation_uses_displayed_geometry_and_keeps_numeric_sign(self):
        with tempfile.TemporaryDirectory() as directory:
            source=str(Path(directory)/"source.pdf")
            with fitz.open() as doc:
                page=doc.new_page(width=400,height=600)
                page.insert_text((40,80),"Total -345.67",fontsize=12)
                page.set_rotation(90)
                doc.save(source)
            [page]=load("pdf-native-layout").extract(source)
            self.assertEqual((page["width"],page["height"]),(600,400))
            self.assertEqual(page["texts"][0]["rotation"],90)
            self.assertIn("-345.67",[word["text"] for item in page["texts"] for word in item["words"]])
            self.assertTrue(all(0<=word["x"]<600 and 0<=word["y"]<400 for item in page["texts"] for word in item["words"]))

    def test_unicode_survives_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            source=str(Path(directory)/"source.pdf")
            with fitz.open() as doc:
                page=doc.new_page()
                page.insert_text((40,80),"合同 123.45",fontname="china-s")
                doc.save(source)
            pages=load("pdf-native-layout").extract(source)
            self.assertIn("合同","".join(segment["text"] for page in pages for item in page["texts"] for segment in item["segments"]))

    def test_deskew_inverse_is_finite_and_canvas_preserves_image(self):
        with tempfile.TemporaryDirectory() as directory:
            source=str(Path(directory)/"scan.png")
            target=str(Path(directory)/"prepared.png")
            image=np.full((500,700),255,dtype=np.uint8)
            for y in range(60,420,40):
                cv2.line(image,(60,y),(600,y+20),0,2)
            cv2.imwrite(source,image)
            result=load("pdf-ocr-preprocess").preprocess(source,target)
            self.assertTrue(.3<abs(result["angle"])<5)
            self.assertTrue(np.isfinite(result["inverse"]).all())
            prepared=cv2.imread(target,0)
            self.assertGreaterEqual(prepared.shape[0],image.shape[0])
            self.assertGreaterEqual(prepared.shape[1],image.shape[1])


if __name__=="__main__":
    unittest.main()
