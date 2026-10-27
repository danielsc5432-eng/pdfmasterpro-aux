"""Conservative optimizer validation. Output only booleans/counts, never document text."""
import hashlib
import json
import sys
import fitz
from pdf_optimizer_policy import eligible


def fields(page):
    return [(w.field_name,w.field_value,w.field_type,tuple(w.rect)) for w in (page.widgets() or [])]


def annotations(page):
    return [(a.type,tuple(a.rect),a.info,a.colors,a.border,a.opacity,a.flags,a.vertices) for a in (page.annots() or [])]


def preserved(source,candidate):
    with fitz.open(source) as original,fitz.open(candidate) as result:
        if not eligible(original) or result.needs_pass:
            return False
        if len(original)!=len(result) or not len(original):
            return False
        keys=["title","author","subject","keywords","creator","producer","creationDate","modDate"]
        if any(original.metadata.get(key)!=result.metadata.get(key) for key in keys) or original.get_toc()!=result.get_toc():
            return False
        if original.get_xml_metadata()!=result.get_xml_metadata():
            return False
        names=original.embfile_names()
        if names!=result.embfile_names():
            return False
        for name in names:
            source_info=original.embfile_info(name)
            candidate_info=result.embfile_info(name)
            # Compressed length can change; names, descriptions, dates and
            # decoded size belong to the attachment and must remain intact.
            metadata=lambda info:{key:value for key,value in info.items() if key!="length"}
            if metadata(source_info)!=metadata(candidate_info):
                return False
            if source_info["size"]>16*1024*1024:
                return False
            if hashlib.sha256(original.embfile_get(name)).digest()!=hashlib.sha256(result.embfile_get(name)).digest():
                return False
        for page,other in zip(original,result):
            if any(w.field_type==fitz.PDF_WIDGET_TYPE_SIGNATURE for w in (page.widgets() or [])):
                return False
            if (page.rotation,tuple(page.mediabox),tuple(page.cropbox))!=(other.rotation,tuple(other.mediabox),tuple(other.cropbox)):
                return False
            if page.get_text("words")!=other.get_text("words") or fields(page)!=fields(other) or annotations(page)!=annotations(other):
                return False
            links=lambda p:[{k:v for k,v in link.items() if k not in ("xref","id")} for link in p.get_links()]
            if links(page)!=links(other):
                return False
            scale=min(2,1800/max(page.rect.width,page.rect.height))
            a=page.get_pixmap(matrix=fitz.Matrix(scale,scale),colorspace=fitz.csRGB,alpha=False)
            b=other.get_pixmap(matrix=fitz.Matrix(scale,scale),colorspace=fitz.csRGB,alpha=False)
            if (a.width,a.height)!=(b.width,b.height) or a.samples!=b.samples:
                return False
        return True


if __name__=="__main__":
    print(json.dumps({"preserved":preserved(sys.argv[1],sys.argv[2])}))
