import importlib.util
from pathlib import Path
import tempfile
import unittest
import shutil
import subprocess
import fitz

def load(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+".py"))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class OptimizerTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()
    def source(self,name="source.pdf",text="Total -1234.56",color=(1,0,0)):
        target=str(self.root/name)
        with fitz.open() as doc:
            page=doc.new_page(width=400,height=600)
            page.insert_text((40,80),text)
            page.draw_rect(fitz.Rect(40,100,200,180),color=color,fill=color)
            for index in range(70):
                page.insert_text((40,220+index*4),"Repeated source stream 1234.56",fontsize=3)
            doc.set_metadata({"title":"Optimizer fixture"})
            doc.save(target,deflate=False)
        return target
    def test_deduplication_reduces_size_and_preserves_exact_sampled_rgb_and_words(self):
        source=self.source()
        target=str(self.root/"optimized.pdf")
        self.assertTrue(load("pdf-optimize").optimize(source,target))
        self.assertLess(Path(target).stat().st_size,Path(source).stat().st_size)
        self.assertTrue(load("pdf-preservation").preserved(source,target))
    def test_changed_value_or_color_is_rejected(self):
        source=self.source()
        self.assertFalse(load("pdf-preservation").preserved(source,self.source("changed.pdf",text="Total 1234.56")))
        self.assertFalse(load("pdf-preservation").preserved(source,self.source("color.pdf",color=(0,0,1))))
    def test_rotation_and_metadata_are_preserved(self):
        source=self.source()
        with fitz.open(source) as doc:
            doc[0].set_rotation(90)
            rotated=str(self.root/"rotated.pdf");doc.save(rotated)
        self.assertFalse(load("pdf-preservation").preserved(source,rotated))
        with fitz.open(source) as doc:
            doc.set_metadata({"title":"Changed"})
            other=str(self.root/"metadata.pdf");doc.save(other)
        self.assertFalse(load("pdf-preservation").preserved(source,other))
    def test_rich_annotations_are_not_deduplicated_and_cannot_silently_change(self):
        source=self.source()
        with fitz.open(source) as doc:
            annotation=doc[0].add_text_annot((20,20),"Keep this note")
            annotation.update()
            annotated=str(self.root/"annotated.pdf");doc.save(annotated)
        self.assertFalse(load("pdf-optimize").optimize(annotated,str(self.root/"output.pdf")))
        with fitz.open(annotated) as doc:
            page=doc[0]
            annotation=page.first_annot
            annotation.set_info(content="Changed note")
            annotation.update()
            changed=str(self.root/"changed-note.pdf");doc.save(changed)
        self.assertFalse(load("pdf-preservation").preserved(annotated,changed))
    def test_qpdf_keeps_form_values_links_and_notes(self):
        executable=shutil.which("qpdf")
        if not executable:
            self.skipTest("qpdf unavailable")
        source=self.source()
        rich=str(self.root/"form.pdf")
        with fitz.open(source) as doc:
            page=doc[0]
            widget=fitz.Widget();widget.field_name="amount";widget.field_type=fitz.PDF_WIDGET_TYPE_TEXT
            widget.rect=fitz.Rect(220,100,360,130);widget.field_value="-1234.56";page.add_widget(widget)
            page.insert_link({"kind":fitz.LINK_URI,"from":fitz.Rect(20,20,80,40),"uri":"https://example.com/"})
            page.add_text_annot((20,50),"Keep note")
            doc.save(rich)
        target=str(self.root/"qpdf.pdf")
        subprocess.run([executable,"--object-streams=generate","--stream-data=compress",rich,target],check=True,capture_output=True,timeout=30)
        self.assertTrue(load("pdf-preservation").preserved(rich,target))
        with fitz.open(target) as doc:
            page=doc[0];widget=next(page.widgets());widget.field_value="1234.56";widget.update()
            wrong=str(self.root/"wrong-field.pdf");doc.save(wrong)
        self.assertFalse(load("pdf-preservation").preserved(rich,wrong))
    def test_signature_fields_are_conservatively_kept_original(self):
        source=self.source()
        with fitz.open(source) as doc:
            page=doc[0]
            widget=fitz.Widget();widget.field_name="signature";widget.field_type=fitz.PDF_WIDGET_TYPE_SIGNATURE
            widget.rect=fitz.Rect(220,100,360,130);page.add_widget(widget)
            signed=str(self.root/"signature.pdf");doc.save(signed)
        self.assertFalse(load("pdf-preservation").preserved(signed,signed))
        self.assertFalse(load("pdf-optimize").optimize(signed,str(self.root/"optimized-signed.pdf")))
    def test_archival_declarations_are_not_rewritten_without_conformance_validation(self):
        source=self.source()
        with fitz.open(source) as doc:
            doc.set_xml_metadata('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:p="http://www.aiim.org/pdfa/ns/id/" p:part="1" p:conformance="B"/></rdf:RDF></x:xmpmeta>')
            declared=str(self.root/"declared.pdf");doc.save(declared)
        self.assertFalse(load("pdf-preservation").preserved(declared,declared))
        self.assertFalse(load("pdf-optimize").optimize(declared,str(self.root/"optimized-declared.pdf")))
    def test_attachment_bytes_cannot_silently_change(self):
        source=self.source()
        with fitz.open(source) as doc:
            doc.embfile_add("attachment.txt",b"Preserve these bytes",filename="attachment.txt")
            attached=str(self.root/"attached.pdf");doc.save(attached)
        self.assertTrue(load("pdf-preservation").preserved(attached,attached))
        with fitz.open(attached) as doc:
            doc.embfile_del("attachment.txt")
            doc.embfile_add("attachment.txt",b"Changed",filename="attachment.txt")
            changed=str(self.root/"changed-attachment.pdf");doc.save(changed)
        self.assertFalse(load("pdf-preservation").preserved(attached,changed))
    def test_raster_pixels_and_dimensions_survive_recompression(self):
        source=str(self.root/"image.pdf")
        target=str(self.root/"image-optimized.pdf")
        pixmap=fitz.Pixmap(fitz.csRGB,fitz.IRect(0,0,80,60),False)
        for y in range(60):
            for x in range(80):
                pixmap.set_pixel(x,y,(x*3,y*4,(x+y)%256))
        with fitz.open() as doc:
            page=doc.new_page(width=400,height=600)
            page.insert_image(fitz.Rect(40,40,360,280),pixmap=pixmap)
            doc.save(source,deflate=False)
        self.assertTrue(load("pdf-optimize").optimize(source,target))
        self.assertTrue(load("pdf-preservation").preserved(source,target))
        with fitz.open(source) as original,fitz.open(target) as optimized:
            a=fitz.Pixmap(original,original[0].get_images()[0][0])
            b=fitz.Pixmap(optimized,optimized[0].get_images()[0][0])
            self.assertEqual((a.width,a.height,a.samples),(b.width,b.height,b.samples))
    def test_custom_xmp_metadata_cannot_disappear(self):
        source=self.source()
        with fitz.open(source) as doc:
            doc.set_xml_metadata('<metadata><record>Keep this record</record></metadata>')
            metadata=str(self.root/"custom-metadata.pdf");doc.save(metadata)
        with fitz.open(metadata) as doc:
            doc.del_xml_metadata()
            removed=str(self.root/"removed-metadata.pdf");doc.save(removed)
        self.assertFalse(load("pdf-preservation").preserved(metadata,removed))
    def test_attachment_descriptions_and_filenames_are_preserved(self):
        source=self.source()
        with fitz.open(source) as doc:
            doc.embfile_add("record",b"Same bytes",filename="original.txt",desc="Original description")
            attached=str(self.root/"described.pdf");doc.save(attached)
        with fitz.open(attached) as doc:
            doc.embfile_del("record")
            doc.embfile_add("record",b"Same bytes",filename="changed.txt",desc="Changed description")
            changed=str(self.root/"changed-description.pdf");doc.save(changed)
        self.assertFalse(load("pdf-preservation").preserved(attached,changed))
    def test_qpdf_can_still_optimize_custom_metadata_and_attachments(self):
        executable=shutil.which("qpdf")
        if not executable:
            self.skipTest("qpdf unavailable")
        source=self.source()
        rich=str(self.root/"metadata-and-attachment.pdf")
        with fitz.open(source) as doc:
            doc.set_xml_metadata('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:custom="https://example.com/metadata/" custom:record="Keep this record"/></rdf:RDF></x:xmpmeta>')
            doc.embfile_add("record",b"Preserve these bytes",filename="original.txt",desc="Original description")
            doc.save(rich,deflate=False)
        target=str(self.root/"optimized-rich.pdf")
        subprocess.run([executable,"--object-streams=generate","--stream-data=compress",rich,target],check=True,capture_output=True,timeout=30)
        self.assertTrue(load("pdf-preservation").preserved(rich,target))

if __name__=="__main__":
    unittest.main()
