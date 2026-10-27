"""Isolated experiment, not connected to production. Models stay in temporary cache."""
import hmac
import os
import tempfile
from pathlib import Path

os.environ.setdefault("HF_HOME", "/tmp/docling-models")
os.environ.setdefault("OMP_NUM_THREADS", "1")

from fastapi import FastAPI, File, Header, HTTPException, UploadFile

app = FastAPI()


@app.get("/health")
def health():
    return {"status": "ok", "engine": "docling", "experimental": True}


@app.post("/v1/convert/file")
def convert(files: UploadFile = File(...), x_api_key: str = Header(default="")):
    expected = os.environ.get("DOCLING_API_KEY", "")
    if not expected or not hmac.compare_digest(x_api_key, expected):
        raise HTTPException(401, "Unauthorized")
    source = files.file.read(4 * 1024 * 1024 + 1)
    if len(source) > 4 * 1024 * 1024:
        raise HTTPException(413, "Experimental limit: 4 MiB")
    if not source.startswith(b"%PDF-"):
        raise HTTPException(422, "Invalid PDF")
    try:
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode
        options = PdfPipelineOptions()
        # Native text/tables only here. OCR model downloads exceed Vercel /tmp.
        # Scanned documents continue through the application's existing OCR engine.
        options.do_ocr = False
        options.do_table_structure = True
        options.table_structure_options.mode = TableFormerMode.ACCURATE
        with tempfile.TemporaryDirectory(prefix="docling-") as directory:
            pdf = Path(directory) / "input.pdf"
            pdf.write_bytes(source)
            converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})
            result = converter.convert(pdf, max_num_pages=10, raises_on_error=True)
            if result.status.value != "success":
                raise RuntimeError("Incomplete conversion")
            return {"status": "success", "errors": [], "document": {"json_content": result.document.export_to_dict()}}
    except Exception:
        raise HTTPException(503, "Experimental conversion unavailable") from None
