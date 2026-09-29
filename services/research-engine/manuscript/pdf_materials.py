"""Deterministic PDF text blocks. No OCR models or generated source text."""
import hashlib
import re
import fitz

TRANSLATION_LAYOUT_VERSION = 'pymupdf-translation-layout-v2'

def _formula_line(text):
    """Keep standalone equations out of the prose sent to a translator."""
    line = text.strip()
    if re.fullmatch(r'\(?\d{1,3}[a-z]?\)?', line, re.I):
        return True
    if not line or len(line) > 180:
        return False
    symbols = len(re.findall(r'[=≤≥≠∑∫∈∥∞√∂±×÷∝⊤Σλθταβκ∇]', line))
    words = len(re.findall(r'[A-Za-z]{3,}', line))
    return symbols >= 1 and words <= 8 and ('=' in line or symbols >= 2 or bool(re.search(r'\(\d{1,3}\)\s*$', line)))

def _font_hint(spans):
    # A block can contain italic variables and a bold label. Choose the font
    # used by most visible characters rather than the first span in the PDF.
    weights = {}
    for span in spans:
        key = (span.get('font', ''), round(float(span.get('size', 0)), 2), int(span.get('flags', 0)))
        weights[key] = weights.get(key, 0) + max(1, len(span.get('text', '').strip()))
    name, size, flags = max(weights, key=weights.get)
    return {'name': name, 'size': size,
            'bold': bool(flags & fitz.TEXT_FONT_BOLD),
            'italic': bool(flags & fitz.TEXT_FONT_ITALIC),
            'serif': bool(flags & fitz.TEXT_FONT_SERIFED),
            'monospace': bool(flags & fitz.TEXT_FONT_MONOSPACED)}

def translation_layout(req):
    """Extract a separate, loss-aware layout for a facing translated PDF page.

    This does not change the semantic manuscript index or create material cards.
    Rectangles use the native Reader's PDF coordinates, not display pixels.
    """
    with open(req['file'], 'rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    pages = []
    with fitz.open(req['file']) as pdf:
        for page_index, page in enumerate(pdf):
            inverse = ~page.transformation_matrix
            blocks = []
            for raw in page.get_text('dict', sort=True)['blocks']:
                if raw.get('type') != 0:
                    continue
                lines = []
                for line in raw.get('lines', []):
                    text_spans = [span for span in line.get('spans', [])
                                  if span.get('text', '') and int(span.get('alpha', 255)) > 0]
                    spans = [span for span in text_spans if span.get('text', '').strip()]
                    if not spans:
                        continue
                    # PyMuPDF can expose spaces as separate spans. Dropping
                    # them before joining turns ordinary prose into a single
                    # English token and poisons both translation and layout.
                    text = ''.join(span.get('text', '') for span in text_spans).strip()
                    if not text:
                        continue
                    visible = [fitz.Rect(span['bbox']) for span in spans]
                    rect = visible[0]
                    for part in visible[1:]:
                        rect |= part
                    if rect.is_empty or rect.is_infinite:
                        continue
                    pdf_rect = rect * inverse
                    lines.append({'text': text, 'kind': 'formula' if _formula_line(text) else 'text',
                                  'rect': [pdf_rect.x0, pdf_rect.y0, pdf_rect.x1, pdf_rect.y1],
                                  'spans': spans})
                # Segment mixed blocks at equation lines. This preserves the
                # equation's original position without passing it to the model.
                segments = []
                for line in lines:
                    if not segments or segments[-1][0] != line['kind']:
                        segments.append((line['kind'], []))
                    segments[-1][1].append(line)
                for segment_index, (kind, part) in enumerate(segments):
                    spans = [span for line in part for span in line['spans']]
                    rects = [line['rect'] for line in part]
                    font = _font_hint(spans)
                    blocks.append({'sourceRecordID': f'page-{page_index}-block-{raw.get("number", len(blocks))}-run-{segment_index}',
                                   'sourceText': '\n'.join(line['text'] for line in part),
                                   'kind': kind, 'translatable': kind == 'text',
                                   'position': {'pageIndex': page_index, 'rects': rects},
                                   'fontSize': font['size'], 'fontFamily': font['name'],
                                   'fontWeight': 700 if font['bold'] else 400,
                                   'fontStyle': 'italic' if font['italic'] else 'normal',
                                   'serif': font['serif'], 'monospace': font['monospace']})
            for order, block in enumerate(blocks):
                block['readingOrder'] = order
            pages.append({'pageIndex': page_index, 'width': page.rect.width,
                          'height': page.rect.height, 'rotation': page.rotation, 'blocks': blocks})
    return {'pdfHash': digest, 'extractorVersion': TRANSLATION_LAYOUT_VERSION,
            'pageCount': len(pages), 'pages': pages}

def index_pdf(req):
    with open(req['file'],'rb') as source:
        digest=hashlib.file_digest(source,'sha256').hexdigest()
    if req.get('pdfHash')==digest:
        return {'pdfHash':digest,'unchanged':True}
    paragraphs=[]
    section='未识别章节'
    with fitz.open(req['file']) as pdf:
        for page_index,page in enumerate(pdf):
            for number,block in enumerate(page.get_text('blocks',sort=True)):
                if len(block)>6 and block[6]!=0:continue
                text=block[4].strip()
                if not text:continue
                heading=re.match(r'^(?:\d+(?:\.\d+)*\.?\s+|[IVX]+\.\s+)?(abstract|introduction|background|related work|method(?:s|ology)?|model|experiment(?:s)?|results?|discussion|conclusion(?:s)?|references|摘要|引言|方法|实验|结果|讨论|结论|参考文献)\b',text,re.I)
                if heading and len(text)<160:section=text
                if len(text)<30:continue
                x0,y0,x1,y1=block[:4]
                # Native Reader anchors use PDF coordinates, rather than screen pixels.
                inverse=~page.transformation_matrix
                rect=fitz.Rect(x0,y0,x1,y1)*inverse
                paragraphs.append({'sourceRecordID':f'page-{page_index}-block-{number}',
                  'sourceText':text,'pageIndex':page_index,'section':section,
                  'position':{'pageIndex':page_index,'rects':[[rect.x0,rect.y0,rect.x1,rect.y1]]}})
    if not paragraphs:raise ValueError('PDF 未提取到可用文字；扫描件请先使用已有 OCR 工具识别。未下载任何模型。')
    return {'pdfHash':digest,'paragraphs':paragraphs,'extractorVersion':'pymupdf-blocks-v1'}
