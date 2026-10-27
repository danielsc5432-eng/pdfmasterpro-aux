"""Generate synthetic PDFs offline using the existing Word engine environment."""
from pathlib import Path
import fitz

out = Path('.vercel/review/ocrmypdf-benchmark/fixtures')
out.mkdir(parents=True, exist_ok=True)
lines = ['DOCUMENTO SINTETICO - SEM DADOS DE CLIENTES',
         'Contratante: Maria Silva. Contratada: Empresa Exemplo.',
         'Valor total: R$ 2.500,00. Multa: 10%.',
         'Prazo de entrega: 15 dias uteis. Data: 30/11/2026.',
         'Rescisao mediante aviso escrito com 30 dias corridos.']

def native(size=12):
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    for i, text in enumerate(lines):
        page.insert_text((35, 80+i*max(24,size*3)), text, fontsize=size)
    page.draw_rect(fitz.Rect(30,50,560,300), color=(.2,.3,.7), width=.5)
    return doc

def scan(size=12, rotated=False):
    source = native(size)
    pix = source[0].get_pixmap(matrix=fitz.Matrix(300/72,300/72), alpha=False)
    doc = fitz.open()
    page = doc.new_page(width=595,height=842)
    page.insert_image(page.rect, stream=pix.tobytes('png'))
    if rotated:
        page.set_rotation(90)
    source.close()
    return doc

for name,size,rotated in [('scan-300dpi',12,False),('small-print-6pt',6,False),('rotated-90deg',12,True)]:
    with scan(size,rotated) as doc:
        doc.save(out/f'{name}.pdf')
with native() as doc:
    doc.save(out/'native-text.pdf')
    with fitz.open(out/'scan-300dpi.pdf') as image:
        doc.insert_pdf(image)
    doc.save(out/'mixed-native-scan.pdf')
with native() as doc:
    doc.save(out/'protected.pdf', encryption=fitz.PDF_ENCRYPT_AES_256,
             owner_pw='synthetic-owner',user_pw='synthetic-test')
(out/'corrupt.pdf').write_bytes(b'%PDF-1.7\nSynthetic invalid PDF\n')
print('Synthetic fixtures ready')
