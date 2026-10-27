"""Install one pinned, checksum-verified PDFBox CLI distribution. Build-time only."""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

manifest = json.loads((Path(__file__).resolve().parents[1] / "deploy/pdf-engines.json").read_text(encoding="utf8"))["pdfbox"]
target = Path(sys.argv[1]).resolve()
target.mkdir(parents=True, exist_ok=True)
output = target / ("pdfbox-app-" + manifest["version"] + ".jar")
with urllib.request.urlopen(manifest["url"], timeout=60) as response:
    data = response.read(32 * 1024 * 1024 + 1)
if len(data) > 32 * 1024 * 1024 or hashlib.sha512(data).hexdigest() != manifest["sha512"]:
    raise RuntimeError("PDFBox distribution checksum or size does not match pinned manifest.")
output.write_bytes(data)
print("Installed verified PDFBox " + manifest["version"])
