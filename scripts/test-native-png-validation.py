"""Real decoding failures must be rejected by the isolated validator."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from PIL import Image

spec=importlib.util.spec_from_file_location('native_engine',Path(__file__).with_name('native-pdf-engine.py'))
engine=importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)

class Images(unittest.TestCase):
    def test_valid_and_truncated(self):
        with tempfile.TemporaryDirectory() as folder:
            file=Path(folder)/'pagina-1.png'
            Image.new('RGB',(700,900),'white').save(file)
            self.assertEqual(engine.validate_images(Path(folder))['count'],1)
            file.write_bytes(file.read_bytes()[:-20])
            with self.assertRaises(Exception):
                engine.validate_images(Path(folder))

    def test_oversize(self):
        with tempfile.TemporaryDirectory() as folder:
            Image.new('L',(2001,2000),'white').save(Path(folder)/'pagina-1.png')
            with self.assertRaises(ValueError):
                engine.validate_images(Path(folder))

    def test_wrong_format_and_empty(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):
                engine.validate_images(Path(folder))
            Image.new('RGB',(10,10)).save(Path(folder)/'pagina-1.png',format='JPEG')
            with self.assertRaises(ValueError):
                engine.validate_images(Path(folder))

if __name__=='__main__':
    unittest.main()
