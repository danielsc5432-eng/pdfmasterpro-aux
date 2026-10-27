"""Offline page classification shared by reconstruction and fidelity checking."""
import argparse
import json
import fitz


def searchable_scan(page):
    if not any(fitz.Rect(image["bbox"]).get_area() > page.rect.get_area() * 0.5 for image in page.get_image_info()):
        return False
    traces = page.get_texttrace()
    return bool(traces) and all(span.get("type") == 3 or span.get("opacity", 1) == 0 for span in traces)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    with fitz.open(parser.parse_args().source) as document:
        print(json.dumps({"searchableScans": [i for i, page in enumerate(document) if searchable_scan(page)]}))
