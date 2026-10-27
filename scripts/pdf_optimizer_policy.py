"""Conservative eligibility shared by optimizer and output verifier."""
def eligible(document):
    if document.needs_pass or document.is_repaired or document.get_sigflags()>0 or document.metadata.get("encryption"):
        return False
    if document.xref_get_key(document.pdf_catalog(),"Perms")[0]!="null":
        return False
    # A raster comparison cannot certify PDF/A, PDF/X or PDF/UA conformance.
    # Keep declared archival/printing/accessibility documents byte-for-byte.
    metadata=document.get_xml_metadata().lower()
    if any(token in metadata for token in ["pdfaid:","pdfuaid:","pdfxid:","pdfxversion","www.aiim.org/pdfa/ns/id","www.aiim.org/pdfua/ns/id","www.npes.org/pdfx/ns"]):
        return False
    kind,info=document.xref_get_key(-1,"Info")
    if kind=="xref":
        reference=int(info.split()[0])
        if any(document.xref_get_key(reference,key)[0]!="null" for key in ["GTS_PDFXVersion","GTS_PDFXConformance"]):
            return False
    return True
