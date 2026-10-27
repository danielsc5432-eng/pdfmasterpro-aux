"""Recompress and deduplicate ordinary PDFs without rasterization or image resampling."""
import json
import sys
import fitz
from pdf_optimizer_policy import eligible


def optimize(source,output):
    with fitz.open(source) as document:
        if not eligible(document):
            return False
        # Keep rich interactive/tagged graphs on the qpdf path. Do not simplify
        # them with a second engine whose rewrite could alter their behavior.
        catalog=document.pdf_catalog()
        if document.is_form_pdf or any(page.first_annot for page in document):
            return False
        if any(document.xref_get_key(catalog,key)[0]!="null" for key in ["StructTreeRoot","OpenAction","AA","Collection","Names"]):
            return False
        document.save(output,garbage=4,deflate=True,deflate_images=True,deflate_fonts=True,use_objstms=1,clean=False)
        return True


if __name__=="__main__":
    print(json.dumps({"optimized":optimize(sys.argv[1],sys.argv[2])}))
