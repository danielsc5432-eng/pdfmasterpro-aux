"""Bounded grayscale/deskew OCR candidate; returns inverse coordinates to source."""
import json
import math
import sys
import cv2
import numpy as np

cv2.setNumThreads(1)


def preprocess(source, output):
    gray = cv2.imread(source, cv2.IMREAD_GRAYSCALE)
    if gray is None or gray.size > 18000000:
        raise ValueError("Invalid OCR image dimensions")
    scale = min(1, 1800 / max(gray.shape))
    small = cv2.resize(gray, None, fx=scale, fy=scale)
    edges = cv2.Canny(small, 60, 180)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 1800, 60, minLineLength=60, maxLineGap=10)
    angles = []
    for x1, y1, x2, y2 in ([] if lines is None else lines.reshape(-1, 4)):
        angle = math.degrees(math.atan2(int(y2)-int(y1), int(x2)-int(x1)))
        if abs(angle) <= 5:
            angles.append(angle)
    angle = float(np.median(angles)) if len(angles) >= 5 else 0.0
    if abs(angle) < .3:
        angle = 0.0
    transform = cv2.getRotationMatrix2D((gray.shape[1]/2, gray.shape[0]/2), angle, 1)
    # Expand the canvas so deskew cannot cut off corner text.
    cosine, sine = abs(transform[0, 0]), abs(transform[0, 1])
    width = math.ceil(gray.shape[1]*cosine + gray.shape[0]*sine)
    height = math.ceil(gray.shape[0]*cosine + gray.shape[1]*sine)
    transform[0, 2] += (width-gray.shape[1])/2
    transform[1, 2] += (height-gray.shape[0])/2
    if width*height > 21000000:
        raise ValueError("Deskew image exceeds memory bound")
    corrected = cv2.warpAffine(gray, transform, (width, height), flags=cv2.INTER_CUBIC, borderValue=255)
    binary = cv2.adaptiveThreshold(corrected, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, 13)
    if not cv2.imwrite(output, binary):
        raise ValueError("Could not write OCR candidate")
    return {"inverse": cv2.invertAffineTransform(transform).tolist(), "angle": angle}


if __name__ == "__main__":
    print(json.dumps(preprocess(sys.argv[1], sys.argv[2]), allow_nan=False))
