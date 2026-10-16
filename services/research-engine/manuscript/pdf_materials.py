"""Deterministic PDF text blocks. No OCR models or generated source text."""
import hashlib
import re
import fitz
from pathlib import Path
from contextlib import redirect_stdout
from io import StringIO
from statistics import median

TRANSLATION_LAYOUT_VERSION = 'pymupdf-translation-layout-v5'

_MATH_FUNCTIONS = {'arg', 'min', 'max', 'log', 'exp', 'sin', 'cos', 'tan',
                   'dist', 'energy', 'mahal', 'softmax', 'global', 'local',
                   'blend', 'sdist', 'senergy', 'smahal', 'dcos', 'dmin',
                   'ker', 'row', 'span', 'diag', 'rank', 'tr', 'det', 'lim'}

def _math_font(span):
    """Dedicated mathematical fonts, rather than italic prose, are evidence."""
    name = span.get('font', '').lower().split('+')[-1]
    # CMR / CMBX / CMSS / CMTT are ordinary Computer Modern text fonts.
    # A PDF can split every prose word into a span in any of these fonts.
    return bool(re.search(r'(?:^cm(?:mi|sy|ex)\d|^ms(?:am|bm)\d|'
                          r'^(?:lm|latinmodern)math|math|symbol)', name))

def _math_span(span):
    text = span.get('text', '').strip()
    if not text: return False
    if text in {'•', '▪', '◦', '●'}: return False
    # CMR is also a normal LaTeX prose font. Never turn a whole English word
    # or a theorem's italic sentence into an image simply because of its font.
    words = re.findall(r'[A-Za-z]{3,}', text)
    if any(word.lower() not in _MATH_FUNCTIONS for word in words): return False
    return _math_font(span) or bool(re.search(r'[Α-ωϑϕϵ∇∂∈∉≤≥≠∞∥⊤ℝℂℕℤ]', text)) or bool(re.fullmatch(r'[=+−×÷∑∫∂∇√±]+', text))

def _span_text(spans):
    text = ''; previous = None
    for span in spans:
        part = span.get('text', '')
        gap = span['bbox'][0] - previous['bbox'][2] if previous else 0
        if previous and gap > max(.7, min(span.get('size', 10), previous.get('size', 10)) * .12) and not text.endswith(' ') and not part.startswith(' '):
            text += ' '
        text += part; previous = span
    return text

def _inline_crop(page, rect, baseline, neighbours):
    """Font metric boxes can include ink from the following PDF line.

    Tighten only at a rendered, completely blank horizontal gap before that
    unrelated line. This never guesses where a denominator or script ends.
    If mathematical ink meets the next line, preserve the original crop.
    """
    crop = (rect + (-.65, -.65, .65, .65)) & page.rect
    next_tops = [span['bbox'][1] for row in neighbours
                 if row['baseline'] > baseline + 3
                 for span in row['spans']
                 if span.get('text', '').strip() and
                 span['bbox'][0] < crop.x1 and span['bbox'][2] > crop.x0 and
                 span['bbox'][1] < crop.y1 and span['bbox'][3] > crop.y0]
    previous_bottoms = [span['bbox'][3] for row in neighbours
                        if row['baseline'] < baseline - 3
                        for span in row['spans']
                        if span.get('text', '').strip() and
                        span['bbox'][0] < crop.x1 and span['bbox'][2] > crop.x0 and
                        span['bbox'][3] > crop.y0 and span['bbox'][1] < crop.y1]
    side_spans = [span for row in neighbours if abs(row['baseline']-baseline) < 1
                  for span in row['spans'] if span.get('text', '').strip() and
                  span['bbox'][1] < crop.y1 and span['bbox'][3] > crop.y0]
    left_ink = any(span['bbox'][0] < rect.x0 and crop.x0 < span['bbox'][2] <= rect.x0+.05 for span in side_spans)
    right_ink = any(span['bbox'][2] > rect.x1 and rect.x1-.05 <= span['bbox'][0] < crop.x1 for span in side_spans)
    if not next_tops and not previous_bottoms and not left_ink and not right_ink: return crop
    scale = 4
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=crop, alpha=False)
    pixels = pix.samples
    # Whitespace is judged across the entire crop, so a small subscript at
    # either edge cannot be accidentally separated from its base glyph.
    # Two blank raster rows protect against a single antialiased gap inside a
    # small glyph. Keep a white row below the complete mathematical content.
    def blank_runs(indices, white):
        runs = []
        for value in indices:
            if not white(value): continue
            if not runs or value != runs[-1][-1]+1: runs.append([value])
            else: runs[-1].append(value)
        return [run for run in runs if len(run) >= 2]
    white_row = lambda y: all(value >= 245 for value in pixels[y*pix.stride:(y+1)*pix.stride])
    if next_tops:
        top = max(baseline, min(next_tops))
        gaps = blank_runs(range(max(0, int(top*scale-pix.y)), min(pix.height, int(rect.y1*scale-pix.y)+1)), white_row)
        if gaps:
            gap = gaps[-1];crop.y1 = min(crop.y1, (pix.y+gap[len(gap)//2]+1)/scale)
    if previous_bottoms:
        # CM glyph overhang can paint slightly beyond its nominal descender
        # box. The extra margin is considered only if it is visibly blank.
        bottom = min(baseline, max(previous_bottoms)+.65)
        gaps = blank_runs(range(0, min(pix.height, int(bottom*scale-pix.y)+1)), white_row)
        if gaps:
            gap = gaps[0];crop.y0 = max(crop.y0, (pix.y+gap[len(gap)//2])/scale)
    # Affiliation superscripts sit directly beside an author's name. Padding
    # must not carry the last letter below the raised number into its image.
    white_column = lambda x: all(value >= 245 for y in range(pix.height)
        for value in pixels[y*pix.stride+x*pix.n:y*pix.stride+(x+1)*pix.n])
    if left_ink:
        gaps = blank_runs(range(0, min(pix.width, int((rect.x0+.65)*scale-pix.x)+1)), white_column)
        if gaps:
            gap = gaps[-1];crop.x0 = max(crop.x0, (pix.x+gap[len(gap)//2])/scale)
    if right_ink:
        gaps = blank_runs(range(max(0, int((rect.x1-.65)*scale-pix.x)), pix.width), white_column)
        if gaps:
            gap = gaps[0];crop.x1 = min(crop.x1, (pix.x+gap[len(gap)//2]+1)/scale)
    return crop

def _inline_math_line(page, line, folder, name, offset, neighbours=()):
    """Protect native inline math; plain text cannot encode TeX baselines.

    Each image is an exact PDF crop, not inferred LaTeX. PDF point dimensions
    and its bottom-to-prose-baseline offset let the Reader place it inline at
    any zoom without flattening superscripts, subscripts or stacked glyphs.
    """
    spans = line['spans']; base_size = max(float(s.get('size', 10)) for s in spans)
    baseline = line['baseline']
    candidates = []
    for span in spans:
        text = span.get('text', '').strip()
        shifted = (float(span.get('size', 10)) < base_size * .88 and
                   abs(float(span.get('origin', (0, baseline))[1]) - baseline) > base_size * .11)
        # A small shifted footnote is protected too, but the preceding prose
        # word is not eligible. Mathematical bases in other fonts can join a
        # script only when that base is a separate short token.
        words = re.findall(r'[A-Za-z]{3,}', text)
        short = bool(text) and not words and not re.search(r'\b(?:as|at|be|by|in|is|it|of|on|or|to|we)\b', text, re.I)
        operator = bool(text) and bool(re.fullmatch(r'[\d\s=+−\-*/<>≤≥≠().\[\]{}:|]+', text))
        function = text.lower() in _MATH_FUNCTIONS
        candidates.append({'seed': _math_span(span) or shifted,
                           'eligible': _math_span(span) or shifted or short or operator or function})
    ranges = []; start = None
    for index, candidate in enumerate(candidates + [{'eligible': False}]):
        separated = (index > 0 and index < len(spans) and
                     spans[index]['bbox'][0] - spans[index-1]['bbox'][2] > base_size * .8)
        if candidate['eligible'] and not separated:
            if start is None: start = index
            continue
        if start is not None:
            end = index
            # A blank span can separate two mathematical tokens, but prose
            # whitespace must not inflate the crop or eat its surrounding gap.
            selected = spans[start:end]
            if any(c['seed'] for c in candidates[start:end]): ranges.append((start, end))
            start = None
        if candidate['eligible']: start = index
    # Fill only whitespace gaps between eligible mathematical fragments. It
    # is common for PDF exporters to emit spaces in a different prose font.
    for index in range(len(ranges)-1, 0, -1):
        a, b = ranges[index-1]; c, d = ranges[index]
        if all(not s.get('text', '').strip() for s in spans[b:c]) and spans[c]['bbox'][0]-spans[b-1]['bbox'][2] <= base_size*.8:
            ranges[index-1:index+1] = [(a, d)]
    if not ranges: return line['text'], []
    output = []; assets = []; cursor = 0
    for start, end in ranges:
        output.append(_span_text(spans[cursor:start]))
        selected = spans[start:end]; rect = fitz.Rect(selected[0]['bbox'])
        for span in selected[1:]: rect |= fitz.Rect(span['bbox'])
        # Keep overhanging italic glyphs / fraction rules, but exclude nearby
        # prose when a font's nominal descender box is larger than its ink.
        crop = _inline_crop(page, rect, baseline, neighbours)
        number = offset + len(assets); placeholder = f'ZXQMATH{number}ZXQ'
        source = re.sub(r'\s+', ' ', _span_text(selected)).strip()
        assets.append({'id': f'inline-math-{number}', 'sourceText': source,
                       'placeholder': placeholder,
                       'visualAsset': _asset(page, crop, folder, f'{name}-math{number}', scale=4),
                       'width': crop.width, 'height': crop.height,
                       'baselineOffset': crop.y1-baseline})
        # Boundaries include a word separator for the translation API; images
        # still render as a single inline object in Chinese after translation.
        output.append(' ' + placeholder + ' '); cursor = end
    output.append(_span_text(spans[cursor:]))
    return re.sub(r'\s+', ' ', ''.join(output)).strip(), assets

def _math_word(word):
    return word in {'arg','min','max','log','exp','sin','cos','tan','dist','energy','mahal',
                    'softmax','global','local','blend','sdist','senergy','smahal','dcos','dmin',
                    'pblend','pglobal','plocal'} or word.isupper()

def _formula_line(text, spans=None):
    """Keep standalone equations out of the prose sent to a translator."""
    line = text.strip()
    if re.fullmatch(r'\(\d{1,3}[a-z]?\)', line, re.I):
        return True
    if not line or len(line) > 180:
        return False
    symbols = len(re.findall(r'[=≤≥≠∑∫∈∥∞√∂±×÷∝⊤Σλθταβκ∇]', line))
    words = len(re.findall(r'[A-Za-z]{3,}', line))
    # An inline equation is still part of its sentence. In particular, "where
    # ...", "with ..." and "Let ..." must not become an untranslatable crop.
    prose = re.findall(r'\b[A-Za-z]{3,}\b', line)
    if any(not _math_word(word) for word in prose):
        # Joining genuine subscripts can turn p + blend + c into "pblendc".
        # Classify a numbered equation from its original spans before losing
        # that geometry; do not mistake the fused token for an English word.
        if not spans or not re.search(r'\(\d{1,3}\)\s*$', line): return False
        if not any(_math_span(span) for span in spans): return False
        if any(word.lower() not in _MATH_FUNCTIONS
               for span in spans for word in re.findall(r'[A-Za-z]{3,}', span.get('text', ''))): return False
    numbered = bool(re.search(r'\(\d{1,3}\)\s*$', line))
    return words <= 8 and (numbered or symbols >= 1 and ('=' in line or symbols >= 2))

def _paragraph_text(lines):
    """PDF line breaks are layout, not paragraph breaks or translation input."""
    value = ' '.join(line['text'].strip() for line in lines)
    # Remove a line-end discretionary hyphen without removing real compounds
    # such as "open-set" which were not split by the PDF layout.
    value = re.sub(r'([A-Za-z])[-\u00ad]\s+(?=[a-z])', r'\1', value)
    return re.sub(r'\s+', ' ', value).strip()

def _joined_lines(raw):
    """Join separately positioned words on the same baseline, including spaces."""
    rows = []
    for line in raw.get('lines', []):
        spans = [s for s in line.get('spans', []) if s.get('text', '') and int(s.get('alpha', 255)) > 0]
        visible = [s for s in spans if s.get('text', '').strip()]
        if not visible:
            continue
        size = max(float(s.get('size', 10)) for s in visible)
        # Use the dominant normal-size baseline. max(origin.y) erroneously
        # chooses the subscript's lowered baseline, while a prime can move a
        # following space upwards. Neither is the prose's alignment baseline.
        baseline_weights = {}
        for span in visible:
            if float(span.get('size', 10)) < size*.88: continue
            value = round(float(span.get('origin', (0, span['bbox'][3]))[1]), 2)
            baseline_weights[value] = baseline_weights.get(value, 0) + len(span.get('text', '').strip())
        baseline = max(baseline_weights, key=baseline_weights.get)
        # Superscripts/subscripts are retained in their nearby main-text row;
        # this avoids isolated "c" or "1" lines poisoning paragraph prose.
        match = next((r for r in rows if abs(r['baseline'] - baseline) <= max(1.4, min(r['size'], size) * .24)), None)
        if match is None:
            rows.append({'baseline': baseline, 'size': size, 'spans': spans})
        else:
            match['spans'].extend(spans)
    # TeX emits a numerator, sum limit or a superscript/subscript as another
    # "line" even when it belongs inside one prose line. Reattach only pure
    # mathematical fragments that physically overlap a nearby prose row.
    # The row's original baseline remains unchanged for correct CSS alignment.
    def prose_row(row):
        return any(re.search(r'[A-Za-z]{3,}', s.get('text', '')) and not _math_span(s)
                   for s in row['spans'])
    prose = [row for row in rows if prose_row(row)]
    for row in list(rows):
        if row in prose: continue
        visible = [s for s in row['spans'] if s.get('text', '').strip()]
        pure_math = any(_math_span(s) for s in visible)
        short_script = all(re.fullmatch(r'[\dA-Za-zΑ-ωϑϕϵ\u2032+-]{1,3}', s.get('text', '').strip()) for s in visible)
        if not pure_math and not short_script: continue
        rect = fitz.Rect(visible[0]['bbox'])
        for span in visible[1:]: rect |= fitz.Rect(span['bbox'])
        matches = []
        for target in prose:
            bound = fitz.Rect(target['spans'][0]['bbox'])
            for span in target['spans'][1:]: bound |= fitz.Rect(span['bbox'])
            if ((pure_math or row['size'] < target['size']*.88) and
                abs(row['baseline']-target['baseline']) <= target['size']*.9 and
                rect.y0 <= bound.y1 and rect.y1 >= bound.y0 and
                rect.x0 >= bound.x0-target['size'] and rect.x1 <= bound.x1+target['size']):
                matches.append(target)
        if matches:
            target = min(matches, key=lambda r:abs(r['baseline']-row['baseline']))
            target['spans'].extend(row['spans']); rows.remove(row)
    rows.sort(key=lambda r: r['baseline'])
    out = []
    for row in rows:
        spans = sorted(row['spans'], key=lambda s: s['bbox'][0])
        text = _span_text(spans)
        visible = [s for s in spans if s.get('text', '').strip()]
        rect = fitz.Rect(visible[0]['bbox'])
        for span in visible[1:]: rect |= fitz.Rect(span['bbox'])
        if text.strip() and not rect.is_empty and not rect.is_infinite:
            out.append({'text': text.strip(), 'rect': rect, 'spans': spans, 'baseline': row['baseline']})
    return out

def _asset(page, rect, folder, name, scale=3):
    """Native PDF rasterization preserves font glyphs and vector table borders."""
    if not folder:
        return None
    clipped = fitz.Rect(rect) & page.rect
    if clipped.is_empty: return None
    path = folder / (name + '.png')
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clipped, alpha=False)
    pix.save(path)
    return {'path': str(path), 'width': pix.width, 'height': pix.height,
            'dpi': 72*scale, 'mimeType': 'image/png'}

def _ruled_tables(page, raw_blocks):
    """Academic three-line tables have no vertical borders for find_tables."""
    captions = [fitz.Rect(b['bbox']) for b in raw_blocks if b.get('type') == 0 and
                re.match(r'^\s*(?:TABLE\s+[IVX\d]+|表\s*\d+)',
                         ' '.join(''.join(s.get('text', '') for s in l.get('spans', [])) for l in b.get('lines', [])), re.I)]
    rules = [d['rect'] for d in page.get_drawings() if d['rect'].width >= 100 and d['rect'].height <= .8]
    groups = []
    for rule in rules:
        group = next((g for g in groups if abs(g[0].x0-rule.x0)<2 and abs(g[0].x1-rule.x1)<2), None)
        if group is None: groups.append([rule])
        else: group.append(rule)
    regions = []
    for caption in captions:
        group = next((sorted(g,key=lambda r:r.y0) for g in groups if len(g)>=3 and
                      abs(g[0].x0-caption.x0)<65 and g[0].x1>caption.x0+30 and
                      min(r.y0 for r in g) >= caption.y1-4 and min(r.y0 for r in g) <= caption.y1+45), None)
        if not group: continue
        first = group[0]; last = group[-1]
        if last.y0-first.y0 > 400: continue
        regions.append(fitz.Rect(first.x0-2,first.y0-2,first.x1+2,last.y1+2))
    return regions

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

def _source_roles(raw_blocks, page_height):
    """Keep identifiable author and bibliography metadata verbatim.

    This is a conservative layout/context decision, not a model guess. A
    capitalized heading alone is never sufficient to label a block an author.
    """
    records = []
    for raw in raw_blocks:
        if raw.get('type') != 0: continue
        lines = _joined_lines(raw)
        if not lines: continue
        text = _paragraph_text(lines)
        spans = [span for line in lines for span in line['spans']]
        records.append((raw, text, _font_hint(spans)))
    roles = {}
    name_word = r"[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]*"
    person = re.compile(name_word + r'(?:\s+' + name_word + r'){1,5}')
    for index, (raw, text, font) in enumerate(records):
        if (re.match(r'^\[\d+\]\s+[A-Z]\.\s*(?:[A-Z]\.\s*)*[A-Z][a-z]', text) and
            re.search(r'(?:\b(?:19|20)\d{2}\b|doi\s*:|[“”"]|\bvol\.)', text, re.I)):
            roles[raw.get('number')] = 'bibliography'
            continue
        # Remove affiliation markers only for role recognition. The actual
        # source and displaced superscript glyphs are retained unchanged.
        names = re.sub(r'[\d*†‡,;]+', ' ', text)
        names = re.sub(r'\s+(?:and|&)\s+', ' ', names).strip()
        if len(text) > 180 or not person.fullmatch(names): continue
        previous = records[index-1] if index else None
        following = records[index+1] if index+1 < len(records) else None
        signature = previous and re.fullmatch(r'(?:Sincerely|Yours sincerely|Best regards|Regards),?', previous[1], re.I)
        front_author = (raw['bbox'][1] < page_height*.3 and previous and following and
                        previous[2]['size'] > font['size']*1.15 and
                        raw['bbox'][1]-previous[0]['bbox'][3] < 70 and
                        re.match(r'^(?:Abstract\b|Department\b|School\b|University\b|Institute\b|\d+\s*(?:Department|School|University)|[^\s]+@)', following[1], re.I))
        if signature or front_author: roles[raw.get('number')] = 'author'
    return roles

def translation_layout(req):
    """Extract a separate, loss-aware layout for a facing translated PDF page.

    This does not change the semantic manuscript index or create material cards.
    Rectangles use the native Reader's PDF coordinates, not display pixels.
    """
    with open(req['file'], 'rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    pages = []
    folder = Path(req['outputDir']) if req.get('outputDir') else None
    if folder: folder.mkdir(parents=True, exist_ok=True)
    with fitz.open(req['file']) as pdf:
        for page_index, page in enumerate(pdf):
            inverse = ~page.transformation_matrix
            blocks = []; visual_rects = []
            raw_blocks = page.get_text('dict', sort=True)['blocks']
            source_roles = _source_roles(raw_blocks, page.rect.height)
            # Native tables include all rows, borders, symbols and footnotes.
            # The caption remains ordinary Chinese-translatable prose.
            try:
                # PyMuPDF prints an optional-package advertisement on its
                # first table pass. The worker's stdout is a JSON protocol.
                with redirect_stdout(StringIO()):
                    tables = page.find_tables().tables
            except (AttributeError, ValueError):
                tables = []
            for number, table in enumerate(tables):
                rect = fitz.Rect(table.bbox)
                if rect.width < 25 or rect.height < 15: continue
                visual_rects.append(rect)
                pdf_rect = rect * inverse
                blocks.append({'sourceRecordID': f'page-{page_index}-table-{number}',
                    'sourceText': '\n'.join(' | '.join(str(c or '') for c in row) for row in table.extract()),
                    'kind': 'table', 'translatable': False,
                    'position': {'pageIndex': page_index, 'rects': [list(pdf_rect)]},
                    'visualAsset': _asset(page, rect, folder, f'{digest}-p{page_index}-table{number}')})
            for number, rect in enumerate(_ruled_tables(page, raw_blocks)):
                if any((rect & found).get_area()/max(rect.get_area(),1) > .7 for found in visual_rects): continue
                visual_rects.append(rect)
                blocks.append({'sourceRecordID': f'page-{page_index}-ruled-table-{number}',
                    'sourceText': page.get_textbox(rect), 'kind': 'table', 'translatable': False,
                    'position': {'pageIndex': page_index, 'rects': [list(rect * inverse)]},
                    'visualAsset': _asset(page, rect, folder, f'{digest}-p{page_index}-ruledtable{number}')})
            # Embedded vector graphs are not bitmap image blocks. Preserve
            # axes, labels and complete chart extents as one native image.
            for number, rect in enumerate(page.cluster_drawings()):
                if rect.width < 35 or rect.height < 20 or any((rect & found).get_area()/max(rect.get_area(),1) > .7 for found in visual_rects): continue
                visual_rects.append(rect)
                blocks.append({'sourceRecordID': f'page-{page_index}-vector-image-{number}',
                    'sourceText': '', 'kind': 'image', 'translatable': False,
                    'position': {'pageIndex': page_index, 'rects': [list(rect * inverse)]},
                    'visualAsset': _asset(page, rect, folder, f'{digest}-p{page_index}-vector{number}')})
            for raw in raw_blocks:
                if raw.get('type') == 1:
                    rect = fitz.Rect(raw['bbox'])
                    pdf_rect = rect * inverse
                    visual_rects.append(rect)
                    blocks.append({'sourceRecordID': f'page-{page_index}-image-{raw.get("number", len(blocks))}',
                        'sourceText': '', 'kind': 'image', 'translatable': False,
                        'position': {'pageIndex': page_index, 'rects': [list(pdf_rect)]},
                        'visualAsset': _asset(page, rect, folder, f'{digest}-p{page_index}-image{len(blocks)}')})
                    continue
                if raw.get('type') != 0: continue
                lines = []
                for line in _joined_lines(raw):
                    text = line['text']; spans = line['spans']; rect = line['rect']
                    if any((rect & visual).get_area() / max(rect.get_area(), 1) > .8 for visual in visual_rects):
                        continue
                    pdf_rect = rect * inverse
                    lines.append({'text': text, 'kind': 'formula' if _formula_line(text, spans) else 'text',
                                  'rect': [pdf_rect.x0, pdf_rect.y0, pdf_rect.x1, pdf_rect.y1],
                                  'nativeRect': rect, 'spans': spans, 'baseline': line['baseline']})
                # Segment mixed blocks at equation lines. This preserves the
                # equation's original position without passing it to the model.
                if any(line['kind'] == 'formula' for line in lines) and all(
                    not any(not _math_word(w)
                            for w in re.findall(r'\b[A-Za-z]{3,}\b', line['text'])) for line in lines):
                    for line in lines: line['kind'] = 'formula'
                segments = []
                for line in lines:
                    if not segments or segments[-1][0] != line['kind']:
                        segments.append((line['kind'], []))
                    segments[-1][1].append(line)
                for segment_index, (kind, part) in enumerate(segments):
                    spans = [span for line in part for span in line['spans']]
                    rects = [line['rect'] for line in part]
                    font = _font_hint(spans)
                    gaps = [part[i+1]['baseline']-part[i]['baseline'] for i in range(len(part)-1)
                            if part[i+1]['baseline']-part[i]['baseline'] >= font['size']*.7]
                    record_id = f'page-{page_index}-block-{raw.get("number", len(blocks))}-run-{segment_index}'
                    source_role = source_roles.get(raw.get('number'))
                    original_text = _paragraph_text(part) if kind == 'text' else '\n'.join(line['text'] for line in part)
                    inline_math = []; protected_lines = []
                    if kind == 'text':
                        for line in part:
                            protected, assets = _inline_math_line(page, line, folder,
                                f'{digest}-p{page_index}-{record_id}', len(inline_math), lines)
                            protected_lines.append({'text': protected}); inline_math.extend(assets)
                    blocks.append({'sourceRecordID': record_id,
                                   'sourceText': _paragraph_text(protected_lines) if kind == 'text' else original_text,
                                   'originalText': original_text, 'inlineMath': inline_math,
                                   'kind': kind, 'translatable': kind == 'text' and not source_role,
                                   **({'sourceRole': source_role} if source_role else {}),
                                   'position': {'pageIndex': page_index, 'rects': rects},
                                   'fontSize': font['size'], 'fontFamily': font['name'],
                                   'fontWeight': 700 if font['bold'] else 400,
                                   'fontStyle': 'italic' if font['italic'] else 'normal',
                                   'lineHeight': median(gaps)/font['size'] if gaps and font['size'] else 1.15,
                                   'serif': font['serif'], 'monospace': font['monospace']})
            # TeX fractions / sums are frequently several raw blocks. Merge
            # their neighbouring pieces before rasterization; never crop just
            # the numerator. Distinct numbered equations remain distinct.
            def native_rect(block):
                rect = fitz.Rect(block['position']['rects'][0]) * page.transformation_matrix
                for part in block['position']['rects'][1:]: rect |= fitz.Rect(part) * page.transformation_matrix
                return rect
            formulas = [b for b in blocks if b['kind'] == 'formula']
            seeds = [(b, native_rect(b)) for b in formulas if re.search(r'\(\d{1,3}\)\s*$', b['sourceText'], re.M)]
            # Assign each disconnected fraction/sum fragment to its nearest
            # numbered equation before expanding any crop. Transitive rectangle
            # merging would otherwise swallow a neighbouring equation.
            for other in list(blocks):
                if any(other is seed for seed, _ in seeds) or other['kind'] not in ('text','formula'): continue
                text = other['sourceText']; words = re.findall(r'\b[A-Za-z]{3,}\b', text)
                if len(text) > 120 or any(not _math_word(word) for word in words): continue
                rect = native_rect(other)
                if rect.height > 45: continue
                candidates = [(seed, bound) for seed, bound in seeds
                    if max(0, bound.y0-rect.y1, rect.y0-bound.y1) <= 15 and
                    ((bound.x0+bound.x1 < page.rect.width) == (rect.x0+rect.x1 < page.rect.width))]
                if not candidates: continue
                equation, _ = min(candidates, key=lambda pair:abs((pair[1].y0+pair[1].y1)-(rect.y0+rect.y1)))
                equation['sourceText'] += '\n' + text
                equation['position']['rects'].extend(other['position']['rects']); blocks.remove(other)
            for equation in formulas:
                if equation not in blocks: continue
                native = native_rect(equation)
                # Include the visible rule, radical or glyph overhang around
                # the union of all fraction components at full native scale.
                crop = (native + (-2, -2, 2, 2)) & page.rect
                equation['position']['rects'] = [list(crop * inverse)]
                equation['visualAsset'] = _asset(page, crop, folder, f'{digest}-p{page_index}-{equation["sourceRecordID"]}')
            for order, block in enumerate(blocks):
                block['readingOrder'] = order
            pages.append({'pageIndex': page_index, 'width': page.rect.width,
                          'height': page.rect.height, 'rotation': page.rotation, 'blocks': blocks,
                          'visualAsset': _asset(page, page.rect, folder, f'{digest}-p{page_index}-page')})
    return {'pdfHash': digest, 'extractorVersion': TRANSLATION_LAYOUT_VERSION,
            'pageCount': len(pages), 'pages': pages}

def _index_heading(text, block, body_size):
    """Use printed standalone headings, not numbered prose, as chapter boundaries."""
    name = ' '.join(text.split())
    if not name or len(name) >= 160 or len(text.splitlines()) > 2:
        return False
    known = re.match(r'^(?:\d+(?:\.\d+)*\.?\s+|[IVX]+\.\s+)?'
                     r'(?:(?:abstract|introduction|background|related work|method(?:s|ology)?|model|'
                     r'experiment(?:s)?|results?|discussion|conclusion(?:s)?|references|bibliography)\b|'
                     r'摘要|引言|绪论|方法|实验|结果|讨论|结论|参考文献)', name, re.I)
    if known and not re.search(r'[.!?。！？;；=]', re.sub(r'^\d+(?:\.\d+)*\.?\s+|^[IVX]+\.\s+', '', name)):
        return True
    numbered = re.match(r'^(?:\d{1,2}(?:\.\d{1,2})*\.?|[IVX]+\.)\s+([A-Z][A-Za-z]|[\u3400-\u9fff])', name)
    if not numbered or len(name.split()) > 16 or re.search(r'[.!?。！？;；=]', re.sub(r'^\d+(?:\.\d+)*\.?\s+|^[IVX]+\.\s+', '', name)):
        return False
    spans = [span for line in block.get('lines', []) for span in line.get('spans', []) if span.get('text', '').strip()]
    return bool(spans) and (max(span.get('size', 0) for span in spans) > body_size * 1.1
                            or all(span.get('flags', 0) & 16 or 'bold' in span.get('font', '').lower() for span in spans))

def index_pdf(req):
    with open(req['file'],'rb') as source:
        digest=hashlib.file_digest(source,'sha256').hexdigest()
    if req.get('pdfHash')==digest:
        return {'pdfHash':digest,'unchanged':True}
    paragraphs=[]
    section='未识别章节'
    with fitz.open(req['file']) as pdf:
        for page_index,page in enumerate(pdf):
            text_blocks = [b for b in page.get_text('dict', sort=True)['blocks'] if b.get('type') == 0]
            sizes = [span.get('size', 0) for b in text_blocks for line in b.get('lines', [])
                     for span in line.get('spans', []) if len(span.get('text', '').strip()) >= 3]
            body_size = sorted(sizes)[len(sizes) // 2] if sizes else 10
            printed_headings = {' '.join(''.join(span.get('text', '') for span in line.get('spans', []))
                                        for line in b.get('lines', [])).strip(): b for b in text_blocks}
            for number,block in enumerate(page.get_text('blocks',sort=True)):
                if len(block)>6 and block[6]!=0:continue
                text=block[4].strip()
                if not text:continue
                if _index_heading(text, printed_headings.get(' '.join(text.split()), {}), body_size):section=text
                if len(text)<30:continue
                x0,y0,x1,y1=block[:4]
                # Native Reader anchors use PDF coordinates, rather than screen pixels.
                inverse=~page.transformation_matrix
                rect=fitz.Rect(x0,y0,x1,y1)*inverse
                paragraphs.append({'sourceRecordID':f'page-{page_index}-block-{number}',
                  'sourceText':text,'pageIndex':page_index,'section':section,
                  'position':{'pageIndex':page_index,'rects':[[rect.x0,rect.y0,rect.x1,rect.y1]]}})
    if not paragraphs:raise ValueError('PDF 未提取到可用文字；扫描件请先使用已有 OCR 工具识别。未下载任何模型。')
    return {'pdfHash':digest,'paragraphs':paragraphs,'extractorVersion':'pymupdf-blocks-v3'}
