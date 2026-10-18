"""Rebuild the reader from the author's PDF, preserving its text and illustrations.

Usage: python scripts/extract_book.py /absolute/path/to/source.pdf
Requires PyMuPDF and Pillow. The website itself has no Python dependency.
"""
from pathlib import Path
import sys, re, json, unicodedata, shutil, io, math, hashlib
import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1])
ASSETS = ROOT / 'public/assets'
DATA = ROOT / 'public/data'
ASSETS.mkdir(parents=True, exist_ok=True)
DATA.mkdir(parents=True, exist_ok=True)
document = fitz.open(SOURCE)
def clean(text):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', text)).strip()

images = {0: ('cover', 'Portada original de La niña de la montaña'),
          3: ('mountain-ink', 'Una niña frente a una montaña, ilustración original del libro'),
          7: ('child-ink', 'Retrato de la niña en tinta, ilustración original del libro'),
          19: ('fire-ink', 'Una casa, el fuego y los pájaros, ilustración original del libro'),
          50: ('freedom-ink', 'Una mujer en motocicleta, ilustración original del libro')}
for page, (name, _) in images.items():
    image = document.extract_image(document[page].get_images()[0][0])
    bitmap = Image.open(io.BytesIO(image['image'])).convert('RGB')
    bitmap.thumbnail((1500, 1900))
    bitmap.save(ASSETS / f'{name}.webp', quality=87, method=6)

chapters = []
chapter = None
epigraph = None
source_text = []
for index in range(4, len(document)):
    for block in document[index].get_text('dict')['blocks']:
        if block['type'] == 1:
            if index in images and chapter:
                name, alt = images[index]
                chapter['blocks'].append({'type':'image','src':f'assets/{name}.webp','alt':alt,'page':index+1})
            continue
        if block['bbox'][1] < 65 or block['bbox'][1] > 740:
            continue
        lines = [line for line in block['lines'] if clean(' '.join(span['text'] for span in line['spans']))]
        if not lines:
            continue
        text = clean(' '.join(''.join(span['text'] for span in line['spans']) for line in lines))
        if not text:
            continue
        source_text.append(text)
        if text.startswith('CAPÍTULO ') or text.startswith('PRÓLOGO:'):
            is_prologue = text.startswith('PRÓLOGO:')
            number = 0 if is_prologue else int(re.search(r'CAPÍTULO (\d+)', text)[1])
            chapter = {'id':'prologo' if is_prologue else f'capitulo-{number}',
                       'number':number, 'label':'Prólogo' if is_prologue else f'Capítulo {number}',
                       'title':text.split(':',1)[1].strip().capitalize(),
                       'sourceHeading':text, 'page':index+1, 'blocks':[]}
            if is_prologue and epigraph:
                chapter['blocks'].append({'type':'epigraph','text':epigraph,'page':index+1})
            chapters.append(chapter)
            continue
        if not chapter:
            epigraph = text
            continue
        # The third chapter's heading is split into two PDF text blocks.
        if text == 'AJENO' and chapter['number'] == 3 and not chapter['blocks']:
            chapter['title'] += ' ajeno'
            chapter['sourceHeading'] += ' AJENO'
            continue
        if re.match(r'^[IVXLCDM]+\.\s', text):
            chapter['blocks'].append({'type':'heading','text':text,'page':index+1})
        elif text == 'Fin de la Primera Parte':
            chapter['blocks'].append({'type':'ending','text':text,'page':index+1})
        elif lines[0]['bbox'][0] < 95 and chapter['blocks'] and chapter['blocks'][-1]['type'] == 'paragraph':
            chapter['blocks'][-1]['text'] += ' ' + text
        else:
            chapter['blocks'].append({'type':'paragraph','text':text,'page':index+1})

for ch in chapters:
    for n, b in enumerate(ch['blocks']):
        b['id'] = f"{ch['id']}-{n}"
    ch['words'] = sum(len(b.get('text','').split()) for b in ch['blocks'])
    ch['minutes'] = max(1, math.ceil(ch['words'] / 200))
book = {'title':'La niña de la montaña','author':'Santiago Herrera','edition':'Primera parte',
        'pages':len(document),'pdf':'assets/la-nina-de-la-montana.pdf',
        'words':sum(ch['words'] for ch in chapters), 'chapters':chapters}
(DATA / 'book.json').write_text(json.dumps(book, ensure_ascii=False, separators=(',',':')), encoding='utf-8')
if SOURCE.resolve() != (ASSETS/'la-nina-de-la-montana.pdf').resolve():
    shutil.copyfile(SOURCE, ASSETS/'la-nina-de-la-montana.pdf')
pdf_bytes = SOURCE.read_bytes()
source_dir = ROOT / 'book-source'
source_dir.mkdir(exist_ok=True)
part_names = []
for offset in range(0, len(pdf_bytes), 7864320):
    name = f'original.part-{len(part_names)+1}'
    (source_dir / name).write_bytes(pdf_bytes[offset:offset+7864320])
    part_names.append(name)
(source_dir / 'manifest.json').write_text(json.dumps({'parts':part_names,'bytes':len(pdf_bytes),
    'sha256':hashlib.sha256(pdf_bytes).hexdigest()},indent=2),encoding='utf-8')
# Compare every non-whitespace character, including the PDF's final unindexed section.
extracted = [epigraph] if epigraph else []
for ch in chapters:
    extracted.append(ch['sourceHeading'])
    extracted.extend(b['text'] for b in ch['blocks'] if 'text' in b and b['type'] != 'epigraph')
canonical = lambda s: re.sub(r'\s+', '', s)
assert canonical(' '.join(source_text)) == canonical(' '.join(extracted)), 'Source text mismatch'
assert len(chapters) == 6
assert any('El Hombre que le Sonrió' in b.get('text','') for b in chapters[-1]['blocks'])
print(json.dumps({'pages':book['pages'],'words':book['words'],'textVerified':True,
                  'chapters':[{k:ch[k] for k in ['title','page','minutes']} for ch in chapters]},ensure_ascii=False,indent=2))
