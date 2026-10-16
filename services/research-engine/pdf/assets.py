"""Deterministic PDF evidence extraction. No model, network or document execution."""
import hashlib, json, os, re, sqlite3, sys, time, uuid, shutil
from pathlib import Path
import pymupdf as fitz

VERSION = 'mupdf-assets-16'
COVER_VERSION = 'paper-cover-2'


def caption_label(text):
    # Springer/BMC separates Fig. 1 and its caption with a typographic space,
    # without a colon/full stop. The capitalized caption start distinguishes
    # these labels from prose such as "Fig. 1 shows ...".
    match = re.match(r'^\s*((?:Fig(?:ure)?\.?)\s*\d+[a-z]?|(?:TABLE|Table)\s*[\dIVX]+)'
                     r'(?:[.:]\s*|\s+(?=[A-Z\u3400-\u9fff]))', text)
    return re.sub(r'\s+', ' ', match.group(1)).strip() if match else None
def emit(kind, **kw):
    print(json.dumps(dict(type=kind, **kw), ensure_ascii=False), flush=True)
def digest(value):
    return hashlib.sha256(value).hexdigest()
def filehash(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024*1024), b''): h.update(chunk)
    return h.hexdigest()

class Cache:
    def __init__(self, root):
        self.root = Path(root).resolve(); self.root.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.root / 'index.sqlite', timeout=30)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, layer TEXT, pdf TEXT, payload TEXT, touched REAL, protected INTEGER DEFAULT 0)')
    def get(self, key):
        row = self.db.execute('SELECT payload,touched,protected FROM entries WHERE key=?', (key,)).fetchone()
        if not row or (not row[2] and time.time()-row[1]>30*86400): return None
        self.db.execute('UPDATE entries SET touched=? WHERE key=?',(time.time(),key)); self.db.commit()
        return json.loads(row[0])
    def put(self, key, layer, pdf, payload, protected=False):
        self.db.execute('INSERT OR REPLACE INTO entries VALUES (?,?,?,?,?,?)', (key,layer,pdf,json.dumps(payload,ensure_ascii=False),time.time(),int(protected))); self.db.commit()
    def manual(self, pdf):
        return [json.loads(r[0]) for r in self.db.execute("SELECT payload FROM entries WHERE pdf=? AND layer='manual'",(pdf,))]
    def stats(self):
        return dict(bytes=sum(p.stat().st_size for p in self.root.rglob('*') if p.is_file()), entries=self.db.execute('SELECT COUNT(*) FROM entries').fetchone()[0], protected=self.db.execute('SELECT COUNT(*) FROM entries WHERE protected=1').fetchone()[0])
    def clear(self, pdf=None):
        # Only generated cache records and their own files; protected crops always survive.
        def paths(value):
            if isinstance(value,dict): return set().union(*(paths(v) for v in value.values())) if value else set()
            if isinstance(value,list): return set().union(*(paths(v) for v in value)) if value else set()
            if isinstance(value,str) and Path(value).is_absolute(): return {Path(value).resolve()}
            return set()
        rows=self.db.execute('SELECT key,payload,layer FROM entries WHERE protected=0'+(' AND pdf=?' if pdf else ''), (pdf,) if pdf else ()).fetchall()
        protected=set().union(*(paths(json.loads(r[0])) for r in self.db.execute('SELECT payload FROM entries WHERE protected=1')))
        for key, raw, layer in rows:
            payload=json.loads(raw)
            for target in paths(payload)-protected:
                if target.is_relative_to(self.root) and target.is_file(): target.unlink(missing_ok=True)
            if layer=='ppt' and payload.get('path'):
                folder=Path(payload['path']).resolve().parent
                if folder.is_relative_to(self.root/'previews') and folder.name.startswith('easysch-deck-') and not any(p.is_relative_to(folder) for p in protected): shutil.rmtree(folder,ignore_errors=True)
            self.db.execute('DELETE FROM entries WHERE key=?',(key,))
        self.db.commit(); return self.stats()

def save_region(doc, page, rect, asset, folder):
    rect=fitz.Rect(rect) & page.rect
    if rect.width<4 or rect.height<4: raise ValueError('裁切区域过小或超出页面')
    scale=min(6, 3600/max(rect.width,rect.height))
    pix=page.get_pixmap(matrix=fitz.Matrix(scale,scale),clip=rect,alpha=False,annots=False)
    # A rectangular crop can touch a neighbouring footer/accent even when its
    # formula is complete. Remove only text boxes disjoint from every selected
    # equation box; do not alter the source PDF or redraw mathematical glyphs.
    masks=[fitz.Rect(r) & rect for r in asset.get('excludedTextRects',[])] if not page.rotation and not asset.get('userModified') else []
    for mask in masks:
        pix.set_rect((mask*fitz.Matrix(scale,scale)).irect,(255,)*pix.n)
    out=folder/(asset['id']+'.png'); pix.save(out)
    thumbscale=360/max(rect.width,rect.height)
    thumb=page.get_pixmap(matrix=fitz.Matrix(thumbscale,thumbscale),clip=rect,alpha=False,annots=False)
    for mask in masks:
        thumb.set_rect((mask*fitz.Matrix(thumbscale,thumbscale)).irect,(255,)*thumb.n)
    thumbpath=folder/(asset['id']+'-thumb.png'); thumb.save(thumbpath)
    asset.update(path=str(out),thumbnail=str(thumbpath),bbox=list(rect),width=pix.width,height=pix.height,assetHash=filehash(out),cropped=True)
    if asset.get('isVector'):
        # Preserve vector operators in a clipped one-page PDF and an SVG companion.
        with fitz.open() as vector:
            p=vector.new_page(width=rect.width,height=rect.height)
            p.show_pdf_page(p.rect,doc,page.number,clip=rect)
            for mask in masks:
                p.draw_rect(mask+(-rect.x0,-rect.y0,-rect.x0,-rect.y0),color=None,fill=(1,1,1),overlay=True)
            vp=folder/(asset['id']+'.svg'); vp.write_text(p.get_svg_image(),encoding='utf-8')
            asset['vectorPath']=str(vp)
    return asset

def graphic_regions(page, blocks=None):
    """Cluster actual figure ink without a proof/export page's white canvas.

    A large un-stroked white rectangle can join every drawing on the page into
    one cluster, including the caption and neighbouring prose. Exclude only
    that blank canvas, not coloured panel backgrounds or white plot interiors.
    The source PDF is never altered.
    """
    if page.rotation:
        return []
    paths = page.get_drawings()
    blocks = blocks if blocks is not None else [b for b in page.get_text('blocks') if b[6] == 0]
    captions = [fitz.Rect(b[:4]) for b in blocks if caption_label(b[4])]
    filtered = []
    for path in paths:
        rect = fitz.Rect(path['rect'])
        fill = path.get('fill')
        blank_canvas = (path.get('type') == 'f' and fill and len(fill) >= 3
                        and min(fill[:3]) >= .985
                        and len(path.get('items', [])) == 1
                        and path['items'][0][0] == 're'
                        and rect.get_area() >= page.rect.get_area()*.12
                        and any(rect.intersects(cap) and rect.y1 >= cap.y1+3
                                for cap in captions))
        if not blank_canvas:
            filtered.append(path)
    return page.cluster_drawings(drawings=filtered)


def figure_region(page, cap, drawings, images, blocks):
    """Keep complete embedded images, including transparent margins at captions.

    A caption's text width is not the width of its figure. Prefer actual graphic
    bounds and extend vector regions to nearby axis labels. Ambiguous proposals
    remain reviewable, with the full page available to the crop editor.
    """
    caption = fitz.Rect(cap[:4])
    # A previous printed caption is a firm boundary between separate figures,
    # including two vertically stacked figures in one column.
    preceding = [fitz.Rect(b[:4]) for b in blocks
                 if b[3] < caption.y0 and b[2] > caption.x0 and b[0] < caption.x1
                 and caption_label(b[4])]
    top = max((r.y1+3 for r in preceding), default=page.rect.y0)
    regions = [fitz.Rect(r) for r in drawings] + [fitz.Rect(i['bbox']) for i in images]
    for b in blocks:
        # A table caption belongs above its table. The nearest lower graphic,
        # rather than that caption alone, is the boundary before a later plot.
        if not (caption_label(b[4]) or '').startswith(('Table', 'TABLE')) \
                or b[3] >= caption.y0 or b[2] <= caption.x0 or b[0] >= caption.x1:
            continue
        table_parts = [r for r in regions if b[3]-1 <= r.y0 <= b[3]+60
                       and r.x1 > b[0] and r.x0 < b[2] and r.y1 < caption.y0-10]
        if table_parts:
            top = max(top, min(table_parts, key=lambda r:r.y0).y1+3)
    regions = [r for r in regions if r.width > 12 and r.height > 12
               and r.x1 > caption.x0 and r.x0 < caption.x1
               and top <= r.y0 < caption.y0 - 10
               and caption.y0 - 420 < r.y1 <= caption.y1 + 8]
    # Plot exporters often leave a white vector canvas behind the printed
    # caption. Keep its actual plot bounds, then trim the caption portion.
    regions = [fitz.Rect(r.x0, r.y0, r.x1, min(r.y1, caption.y0-1)) for r in regions]
    if not regions:
        # Column width is safer than short caption text, but still needs review.
        midpoint = page.rect.width / 2
        left, right = (36, midpoint-8) if caption.x1 < midpoint else ((midpoint+4, page.rect.width-28) if caption.x0 >= midpoint else (36, page.rect.width-28))
        return fitz.Rect(left, max(25, caption.y0-210), right, caption.y0-2)
    nearest = min(regions, key=lambda r: abs(caption.y0-r.y1))
    rect = fitz.Rect(nearest)
    # Paragraphs separate diagrams; short axis labels, equations and module
    # names do not. Repeated passes retain multi-panel figures whose panels do
    # not overlap vertically, rather than saving only the nearest small image.
    def prose(text, bound):
        # Legends can have several short lines; a block's total character
        # count alone cannot distinguish them from an adjacent paragraph.
        return (len(text.strip()) > 100 and len(re.findall(r'[A-Za-z]{3,}', text)) > 12
                and (bound.height > 65 or bound.width > page.rect.width*.30))
    body = [fitz.Rect(b[:4]) for b in blocks
            if prose(b[4], fitz.Rect(b[:4]))
            and not caption_label(b[4])]
    pending = [r for r in regions if r != nearest]
    changed = True
    while changed:
        changed = False
        for r in pending[:]:
            dx = max(0, r.x0-rect.x1, rect.x0-r.x1)
            dy = max(0, r.y0-rect.y1, rect.y0-r.y1)
            if dx > 24 or dy > 32:
                continue
            bridge = fitz.Rect(min(rect.x0, r.x0), min(rect.y1, r.y1),
                               max(rect.x1, r.x1), max(rect.y0, r.y0))
            if dy > 0 and any(b.intersects(bridge) for b in body):
                continue
            rect |= r; pending.remove(r); changed = True
    # Whole text blocks can contain adjacent body columns; accept only short
    # axis/legend labels close to the actual graphic, never whole paragraphs.
    labels = []
    # A legend and one of its superscripts may share a large text block. Work
    # with individual original lines so their full extent is kept, without a
    # long neighbouring text column expanding the crop by hundreds of points.
    for b in page.get_text('dict')['blocks']:
        if b.get('type') != 0:
            continue
        text = '\n'.join(''.join(s['text'] for s in line['spans']) for line in b['lines'])
        if prose(text, fitz.Rect(b['bbox'])) or caption_label(text):
            continue
        for line in b['lines']:
            text = ''.join(s['text'] for s in line['spans'])
            bound = fitz.Rect(line['bbox'])
            gutter = bound.x1 < page.rect.width*.055 and bool(re.fullmatch(r'[\d\s]+', text))
            if not gutter and len(text.strip()) <= 100 and bound.y0 >= top \
                    and bound.y1 <= caption.y0-1:
                labels.append(bound)
    for _ in range(3):
        expanded = rect + (-22, -18, 14, 18)
        prior = list(rect)
        for label in labels:
            if expanded.intersects(label) and expanded.x0 <= label.x0 \
                    and label.x1 <= expanded.x1:
                rect |= label
        if list(rect) == prior:
            break
    rect = (rect + (-3, -3, 3, 3)) & page.rect
    rect.y0 = max(top, rect.y0); rect.y1 = min(caption.y0-1, rect.y1)
    midpoint = page.rect.x0+page.rect.width/2
    if rect.width < page.rect.width*.55:
        if caption.x0 >= midpoint:
            rect.x0 = max(rect.x0, midpoint+2)
        elif caption.x1 <= midpoint:
            rect.x1 = min(rect.x1, midpoint-2)
    return rect

_EQUATION_NUMBER = re.compile(r'^\s*\((\d{1,3}[a-z]?)\)\s*$', re.I)
_MATH_FONT = re.compile(r'(?:CM(?:MIB|MI|BSY|SY|EX|BX|R)\d|MS[AB]M\d|math|symbol)', re.I)


def _math_block(block):
    """Distinguish displayed mathematics from prose containing inline symbols."""
    spans = [s for line in block.get('lines', []) for s in line['spans']
             if not _EQUATION_NUMBER.fullmatch(s['text'])]
    text = ' '.join(s['text'] for s in spans)
    if not text.strip():
        return False
    total = sum(len(s['text'].strip()) for s in spans)
    mathematical = sum(len(s['text'].strip()) for s in spans
                       if _MATH_FONT.search(s.get('font', '')))
    # A paragraph can contain many math spans, but its prose is in the text
    # font. Never extend a formula into its following explanation.
    prose = ' '.join(s['text'] for s in spans
                     if not _MATH_FONT.search(s.get('font', '')))
    words = re.findall(r'[A-Za-z]{3,}', prose)
    # Some TeX publishers set explanatory sentences in the same CMR font as
    # equations. English clauses remain prose regardless of that font name.
    all_words=re.findall(r'[A-Za-z]{3,}',text)
    if len(all_words)>=3 and re.search(r'\b(?:where|which|denotes|the|is|are|this|that|from)\b',text,re.I):
        return False
    # PDF reading lines can split P with a text-font superscript (e.g. V2V)
    # from the rest of its equation. The tiny script can outweigh the single
    # math glyph by character count; it is not a prose baseline. Require actual
    # math-font base glyphs and smaller, displaced text-font runs so ordinary
    # explanations containing inline mathematics remain prose.
    math_spans = [s for s in spans if s['text'].strip() and _MATH_FONT.search(s.get('font', ''))]
    text_spans = [s for s in spans if s['text'].strip() and not _MATH_FONT.search(s.get('font', ''))]
    if math_spans and text_spans:
        base_size = max(s['size'] for s in math_spans)
        bases = [s.get('origin', (0, s['bbox'][3]))[1] for s in math_spans if s['size'] >= base_size*.9]
        if sum(len(s['text'].strip()) for s in text_spans) <= 24 and all(
                s['size'] <= base_size*.82 and any(
                    abs(s.get('origin', (0, s['bbox'][3]))[1]-base) >= base_size*.12
                    for base in bases) for s in text_spans):
            return True
    if len(words) >= 5:
        return False
    if re.fullmatch(r'\s*(?:s\.?\s*t\.?|subject\s+to|otherwise|if|for)\s*[,.:]?\s*', text, re.I):
        return True
    # Inline mathematics can dominate a short prose line. A few ordinary
    # words still identify that line as prose, regardless of its math ratio.
    if len(words) >= 3:
        return False
    if len(words) >= 2 and re.search(r'\b(?:where|which|denotes|and|the|is|are|as|this|that|from)\b', prose, re.I):
        return False
    if total and mathematical / total >= .45:
        return True
    if re.fullmatch(r'\s*(?:[A-Za-z]|\d+(?:\.\d+)?|sin|cos|tan|log|exp|lim)\s*', text):
        return True
    return bool(re.search(r'[=∑∫∈≤≥≠]', text)) and len(words) <= 2


def formula_regions(page, layout=None, mask_regions=None):
    """Collect complete original equation crops around their printed number.

    Fractions, scripts and multiline displays are often separate PDF blocks;
    the number may be isolated. Preserve vectors rather than guessing TeX from
    lossy extracted characters.
    """
    layout = layout or page.get_text('dict')
    source_blocks = [b for b in layout['blocks'] if b.get('type') == 0]
    # PDF blocks are reading-order containers, not equation boundaries. A
    # single block can contain a paragraph followed by its equation, or all
    # four numbered constraints in an aligned display. Own individual lines
    # so neither prose nor a neighbouring equation can enter a crop wholesale.
    blocks = [dict(type=0, bbox=line['bbox'], lines=[line])
              for block in source_blocks for line in block.get('lines', [])]
    anchors = []
    for block in source_blocks:
        for line in block.get('lines', []):
            text = ''.join(s['text'] for s in line['spans'])
            match = _EQUATION_NUMBER.fullmatch(text)
            if match and (len(block['lines']) == 1 or _math_block(block)
                          or line['bbox'][0] >= block['bbox'][0]
                          + (block['bbox'][2]-block['bbox'][0])*.7):
                anchors.append(dict(number=match.group(1), rect=fitz.Rect(line['bbox'])))
    mathematical = [b for b in blocks if _math_block(b)]
    middle = page.rect.x0 + page.rect.width / 2
    for anchor in anchors:
        r = anchor['rect']
        y = (r.y0+r.y1)/2
        cross = any(b['bbox'][0] < middle-8 < middle+8 < b['bbox'][2]
                    and b['bbox'][1]-18 <= y <= b['bbox'][3]+18
                    for b in mathematical)
        anchor['lane'] = 'wide' if cross else ('left' if r.x1 <= middle+4 else 'right')

    def in_lane(block, anchor):
        r = fitz.Rect(block['bbox'])
        return (r.x0 < anchor['rect'].x1+3
                and (anchor['lane'] == 'wide'
                     or anchor['lane'] == 'left' and r.x1 <= middle+8
                     or anchor['lane'] == 'right' and r.x0 >= middle-8))

    owned = {id(a): [] for a in anchors}
    prose_blocks = [b for b in blocks if not _math_block(b)
                    and not _EQUATION_NUMBER.fullmatch(''.join(s['text'] for line in b['lines'] for s in line['spans']))
                    and len(''.join(s['text'] for line in b['lines'] for s in line['spans']).strip()) > 1]

    def text_baseline(block):
        spans = [s for line in block['lines'] for s in line['spans']
                 if s['text'].strip() and not re.search(r'CMEX|math.*extension', s.get('font', ''), re.I)]
        if not spans:
            return None
        size = max(s['size'] for s in spans)
        origins = sorted(s.get('origin', (0, s['bbox'][3]))[1] for s in spans if s['size'] >= size*.9)
        return origins[len(origins)//2], size

    # A cases display pairs mathematical rows with short prose conditions.
    # Those conditions share a baseline with the formula by design. Identify
    # the tall, narrow extension delimiter first so inline-prose exclusion
    # cannot remove the cases' expressions or treat their conditions as prose
    # barriers. Ordinary parentheses and radical glyphs are not tall clusters.
    delimiters = []
    for block in mathematical:
        spans = [s for line in block['lines'] for s in line['spans']]
        if spans and all(re.search(r'CMEX|math.*extension', s.get('font', ''), re.I)
                         for s in spans if s['text'].strip()) and fitz.Rect(block['bbox']).width < 15:
            rect = fitz.Rect(block['bbox'])
            nearby = next((r for r in delimiters if abs(r.x0-rect.x0) < 3
                           and max(0, r.y0-rect.y1, rect.y0-r.y1) < 12), None)
            if nearby is None:
                delimiters.append(rect)
            else:
                # Rect.__ior__ creates a new object; retain the combined brace
                # in the list rather than rebinding only this local variable.
                nearby.include_rect(rect)
    case_conditions = []
    for delimiter in delimiters:
        if delimiter.height < 18 or not any(abs((a['rect'].y0+a['rect'].y1)/2
                                                -(delimiter.y0+delimiter.y1)/2) <= 85 for a in anchors):
            continue
        matches = []
        for condition in prose_blocks:
            bound = fitz.Rect(condition['bbox']); base = text_baseline(condition)
            text = ''.join(s['text'] for line in condition['lines'] for s in line['spans'])
            if not base or len(text) > 90 or bound.width > page.rect.width*.33 \
                    or bound.x0 < delimiter.x1+2 or not delimiter.y0-3 <= base[0] <= delimiter.y1+8:
                continue
            paired = [b for b in mathematical if text_baseline(b)
                      and delimiter.x0 <= b['bbox'][0] < bound.x0
                      and 0 <= bound.x0-b['bbox'][2] <= base[1]*2
                      and abs(text_baseline(b)[0]-base[0]) <= base[1]*.3]
            if paired:
                matches.append(condition)
        if len(matches) >= 2:
            case_conditions.extend(matches)
    mathematical.extend(case_conditions)
    prose_blocks = [b for b in prose_blocks if b not in case_conditions]

    # Inline fractions/accents are sometimes emitted as isolated lines beside
    # a prose line. Their shared baseline identifies the paragraph they belong
    # to. Extension glyph origins are not baselines (large delimiters use them
    # as their top), so they must never trigger this exclusion.
    prose_baselines = [(b, text_baseline(b)) for b in prose_blocks]
    def inline_math(block):
        baseline = text_baseline(block)
        if not baseline:
            spans=[s for line in block['lines'] for s in line['spans'] if s['text'].strip()]
            size=max((s['size'] for s in spans),default=0)
            bound=fitz.Rect(block['bbox'])
            # Ordinary-height extension brackets in an inline expression have
            # top-based origins. Infer their row from the glyph box, while a
            # genuinely tall operator remains exempt from prose baselines.
            if not size or bound.height>size*1.25:
                return False
            baseline=(bound.y1-size*.15,size)
        for prose, base in prose_baselines:
            same_column = ((block['bbox'][0] < middle and prose['bbox'][2] <= middle+8)
                           or (block['bbox'][0] >= middle and prose['bbox'][0] >= middle-8))
            horizontal_gap = max(0, block['bbox'][0]-prose['bbox'][2], prose['bbox'][0]-block['bbox'][2])
            numbered_row=any(in_lane(block,a) and abs((a['rect'].y0+a['rect'].y1)/2
                            -(baseline[0]-baseline[1]*.35)) <= baseline[1]*.6 for a in anchors)
            # A paragraph's left-hand expression and explanatory clause may be
            # separated by a large TeX gap. Match their whole column baseline,
            # while retaining a display with its own printed number on that row.
            if base and same_column and not numbered_row and horizontal_gap <= page.rect.width/2 \
                    and abs(baseline[0]-base[0]) <= min(baseline[1], base[1])*.35:
                return True
        return False
    mathematical = [b for b in mathematical
                    if b['bbox'][2] > page.rect.width*.055
                    and not inline_math(b)]

    def separated_by_prose(bound, anchor):
        r = anchor['rect']
        if bound.y1 <= r.y0:
            bridge=fitz.Rect(bound.x0,bound.y1,bound.x1,r.y0)
        elif r.y1 <= bound.y0:
            bridge=fitz.Rect(bound.x0,r.y1,bound.x1,bound.y0)
        else:
            return False
        return any(fitz.Rect(b['bbox']).intersects(bridge) for b in prose_blocks)

    for block in mathematical:
        r = fitz.Rect(block['bbox'])
        numbers = [_EQUATION_NUMBER.fullmatch(''.join(s['text'] for s in line['spans']))
                   for line in block['lines']]
        numbers = [n.group(1) for n in numbers if n]
        possible = [a for a in anchors if in_lane(block, a)
                    and (not numbers or a['number'] in numbers)
                    and not separated_by_prose(r,a)]
        if not possible:
            continue
        # Own entire blocks so a subscript is not stolen by the next constraint.
        nearest = min(possible, key=lambda a: abs((r.y0+r.y1-a['rect'].y0-a['rect'].y1)/2))
        if abs((r.y0+r.y1-nearest['rect'].y0-nearest['rect'].y1)/2) <= 85:
            owned[id(nearest)].append(block)

    # Small isolated sum/product bounds belong to their large operator, even
    # when their baseline is closer to the next numbered constraint.
    owner = {id(b): a for a in anchors for b in owned[id(a)]}
    for block in mathematical:
        spans = [s for line in block['lines'] for s in line['spans']]
        if not spans or max(s['size'] for s in spans) >= 8 \
                or sum(len(s['text'].strip()) for s in spans) > 15 or id(block) not in owner:
            continue
        r = fitz.Rect(block['bbox'])
        parents = [b for b in mathematical if b is not block and id(b) in owner
                   and any(re.search(r'CMEX|math.*extension', s.get('font', ''), re.I)
                           for line in b['lines'] for s in line['spans'])
                   and b['bbox'][0] <= r.x1 and r.x0 <= b['bbox'][2]
                   and max(0, b['bbox'][1]-r.y1, r.y0-b['bbox'][3]) <= 12]
        if parents:
            parent = min(parents, key=lambda b:abs((b['bbox'][1]+b['bbox'][3]-r.y0-r.y1)/2))
            old, new = owner[id(block)], owner[id(parent)]
            if old is not new:
                owned[id(old)].remove(block)
                owned[id(new)].append(block)
                owner[id(block)] = new

    output = []
    for anchor in anchors:
        parts = owned[id(anchor)]
        if not parts:
            continue
        r = anchor['rect']
        first = min(parts, key=lambda b: max(0, b['bbox'][1]-r.y1, r.y0-b['bbox'][3]))
        if max(0, first['bbox'][1]-r.y1, r.y0-first['bbox'][3]) > 24:
            continue
        region = fitz.Rect(first['bbox'])
        chosen = [first]
        pending = [b for b in parts if b is not first]
        changed = True
        while changed:
            changed = False
            for block in pending[:]:
                bound = fitz.Rect(block['bbox'])
                gap = max(0, bound.y0-region.y1, region.y0-bound.y1)
                if gap > 12:
                    continue
                bridge = fitz.Rect(min(bound.x0, region.x0), min(bound.y1, region.y1),
                                   max(bound.x1, region.x1), max(bound.y0, region.y0))
                if gap > 0 and any(fitz.Rect(b['bbox']).intersects(bridge)
                                   for b in prose_blocks):
                    continue
                region |= bound
                chosen.append(block)
                pending.remove(block)
                changed = True
        # Thin fraction rules and delimiter paths may extend beyond font boxes.
        for drawing in page.get_drawings():
            bound = fitz.Rect(drawing['rect'])
            if bound.width <= region.width+4 and bound.height <= region.height+4 \
                    and (region+(-2,-2,2,2)).intersects(bound):
                region |= bound
        region |= r
        crop = (region+(-3,-2,3,2)) & page.rect
        # Tight typesetting can leave less than two points between prose and
        # a tall operator. Keep the operator, without a strip of prose ink.
        for block in [b for b in blocks if b not in chosen]:
            bound=fitz.Rect(block['bbox'])
            if bound.x0 >= region.x1 or bound.x1 <= region.x0:
                continue
            if crop.y0 < bound.y1 <= region.y0:
                crop.y0=min(region.y0,bound.y1+.3)
            if region.y1 <= bound.y0 < crop.y1:
                crop.y1=max(region.y1,bound.y0-.3)
        text = '\n'.join(''.join(s['text'] for line in b['lines'] for s in line['spans'])
                         for b in sorted(chosen, key=lambda b:(b['bbox'][1], b['bbox'][0])))
        label='Equation '+anchor['number']
        if mask_regions is not None:
            protected=[fitz.Rect(b['bbox'])+(-.6,-.6,.6,.6) for b in chosen]+[r+(-.6,-.6,.6,.6)]
            masks=[]
            for block in blocks:
                if block in chosen:
                    continue
                bound=fitz.Rect(block['bbox'])+(-.15,-.15,.15,.15)
                if crop.intersects(bound) and not any(bound.intersects(p) for p in protected):
                    masks.append(list(bound & crop))
            mask_regions[(label,tuple(crop))]=masks
        output.append((crop, 'formula', label, text.strip(), True, True))
    return output


def caption_runs(layout, bbox):
    """Safe text runs based only on original PDF font and baseline geometry."""
    rect = fitz.Rect(bbox)
    spans = [s for b in layout['blocks'] if b.get('type') == 0
             and rect.intersects(fitz.Rect(b['bbox']))
             for line in b['lines'] for s in line['spans']
             if rect.contains(fitz.Rect(s['bbox']))]
    if not spans:
        return []
    weights = {}
    for span in spans:
        size = round(span['size'], 1)
        weights[size] = weights.get(size, 0)+len(span['text'].strip())
    size = max(weights, key=weights.get)
    primary = [s for s in spans if s['size'] >= size*.9]
    baselines = []
    for span in sorted(primary, key=lambda s:s['origin'][1]):
        baseline = span['origin'][1]
        if not baselines or abs(baseline-baselines[-1]) > size*.25:
            baselines.append(baseline)
    if not baselines:
        return []
    rows = {y: [] for y in baselines}
    for span in spans:
        y = span['origin'][1]
        baseline = min(baselines, key=lambda b:abs(y-b))
        small = span['size'] < size*.85
        script = ('super' if small and y < baseline-size*.15 else
                  'sub' if small and y > baseline+size*.12 else None)
        rows[baseline].append((span, script))
    result = []

    def append(text, script=None, italic=False):
        # Text data, not HTML; drop C0 glyph codes without inventing a symbol.
        text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)
        if not text:
            return
        if result and result[-1]['script'] == script \
                and (result[-1].get('fontStyle') == 'italic') == italic:
            result[-1]['text'] += text
        else:
            result.append(dict(text=text, script=script))
            if italic:
                result[-1]['fontStyle']='italic'

    for index, baseline in enumerate(baselines):
        if index and result and not result[-1]['text'].endswith((' ', '-')):
            append(' ')
        previous = None
        for span, script in sorted(rows[baseline], key=lambda entry:entry[0]['bbox'][0]):
            text = span['text']
            if previous and span['bbox'][0]-previous['bbox'][2] > size*.2 \
                    and result and not result[-1]['text'].endswith(' ') \
                    and not text.startswith((' ', ',', '.', ';', ':', ')')) and script is None:
                append(' ')
            append(text, script, bool(span.get('flags',0)&2)
                   or bool(re.search(r'CMMI|italic|oblique|ReguItal',span.get('font',''),re.I)))
            previous = span
    return result


def non_research_image(rect, blocks):
    """Exclude clearly identified publisher graphics and author portraits.

    This uses document context, never guesses an experiment from image pixels.
    Uncertain uncaptained figures remain available for manual review.
    """
    text = ' '.join(re.sub(r'-\s*\n\s*', '', b[4]) for b in blocks)
    if re.search(r'\bSubmission ID\b', text, re.I) and re.search(r'\bManuscript ID\b', text, re.I):
        return 'publisher-cover'
    # ScholarOne proof covers can have a Manuscript ID without a Submission
    # ID. Identify the submission form from several independent fields and its
    # review notice, never from the journal name or an IEEE logo alone.
    form = re.sub(r'\s+', ' ', text)
    cover_fields = [
        r'\bManuscript Type\s*:',
        r'\bDate Submitted by (?:the )?Author\s*:',
        r'\bComplete List of Authors\s*:',
    ]
    if (re.search(r'\bManuscript ID\b', form, re.I)
            and re.search(r'\bJournal\s*:\s*\S', form, re.I)
            and re.search(r'\bUnder review for possible publication in\b', form, re.I)
            and sum(bool(re.search(field, form, re.I)) for field in cover_fields) >= 2):
        return 'publisher-cover'
    rect = fitz.Rect(rect)
    near = []
    for block in blocks:
        bound = fitz.Rect(block[:4])
        # The biography normally wraps beside or immediately below its photo.
        dx = max(0, bound.x0-rect.x1, rect.x0-bound.x1)
        dy = max(0, bound.y0-rect.y1, rect.y0-bound.y1)
        overlap = max(0, min(bound.y1,rect.y1)-max(bound.y0,rect.y0))
        if dx <= 45 and (overlap >= min(rect.height,bound.height)*.4 or dx == 0 and dy <= 22):
            near.append(re.sub(r'-\s*\n\s*', '', block[4]))
    context = ' '.join(near)
    biography = re.search(r'(?:received.{0,120}(?:degree|B\.?[ES]\.?|M\.?S\.?|Ph\.?D)|research interests|(?:he|she) is currently|author biography|作者简介|作者介绍)', context, re.I|re.S)
    if biography and rect.width < 180 and rect.height < 230:
        return 'author-portrait'
    return None

def cover_sheet_reason(page):
    """Only skip explicit editorial covers, never an unfamiliar article layout."""
    text = page.get_text('text')
    # A paper discussing submission systems can mention every form field. Its
    # abstract still makes it an article; a journal logo alone proves nothing.
    if re.search(r'^\s*(?:Abstract|摘要)\s*(?:[—–:：-]|$)', text, re.I|re.M):
        return None
    text = re.sub(r'\s+', ' ', text)
    if (re.search(r'\bSubmission ID\b', text, re.I)
            and re.search(r'\bManuscript ID\b', text, re.I)
            and sum(bool(re.search(field, text, re.I)) for field in [
                r'\bSubmission Version\b', r'\bPDF Generation\b',
                r'\bCorresponding Author\b', r'\bSubmitting Author\b']) >= 2):
        return 'submission-form'
    if (re.search(r'\bManuscript ID\b', text, re.I)
            and re.search(r'\bJournal\s*:\s*\S', text, re.I)
            and re.search(r'\bUnder review for possible publication in\b', text, re.I)
            and sum(bool(re.search(field, text, re.I)) for field in [
                r'\bManuscript Type\s*:',
                r'\bDate Submitted by (?:the )?Author\s*:',
                r'\bComplete List of Authors\s*:']) >= 2):
        return 'submission-form'
    if (re.search(r'\bFiles for peer review\b', text, re.I)
            and re.search(r'\bAll files submitted by the author for peer review\b', text, re.I)
            and re.search(r'\bName\s+Type of File\s+Size\s+Page\b', text, re.I)):
        return 'submission-file-list'
    return None

def content_rect(page):
    """Trim external paper whitespace using actual printed pixels, not text alone.

    Text bounds alone miss vector formula accents, rules, images and scanned
    content. A small complete-page grayscale render retains those elements;
    six PDF points of padding keep punctuation, descenders and footnotes safe.
    PDF annotations are excluded without changing the source document.
    """
    scale = min(1, 1100/max(page.rect.width, page.rect.height))
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csGRAY,
                          alpha=False, annots=False)
    mask = pix.samples.translate(bytes(1 if n < 246 else 0 for n in range(256)))
    left, top, right, bottom = pix.width, pix.height, -1, -1
    for y in range(pix.height):
        row = mask[y*pix.stride:y*pix.stride+pix.width]
        start = row.find(b'\x01')
        if start < 0:
            continue
        left, right = min(left, start), max(right, row.rfind(b'\x01'))
        top, bottom = min(top, y), y
    if right < left:
        return fitz.Rect(page.rect)
    # Pixmap dimensions round at the pixel edge; use the actual scale and add
    # one pixel at x1/y1 so the last printed glyph is never clipped.
    bounds = fitz.Rect(page.rect.x0+left/scale, page.rect.y0+top/scale,
                       page.rect.x0+(right+1)/scale, page.rect.y0+(bottom+1)/scale)
    return (bounds+(-6, -6, 6, 6)) & page.rect

def remove_editorial_marks(page, journal=''):
    """Remove verified submission-system marginalia from the temporary preview.

    This is only used after an explicit submission cover was found. Original
    article page numbers, footnotes, author names and journal artwork remain.
    """
    spans = [s for b in page.get_text('dict')['blocks'] for line in b.get('lines', [])
             for s in line['spans']]
    marks, line_numbers = [], []
    for span in spans:
        text, rect = span['text'].strip(), fitz.Rect(span['bbox'])
        peripheral = rect.y1 < page.rect.height*.07 or rect.y0 > page.rect.height*.94
        if peripheral and (re.fullmatch(r'Page\s+\d+\s+of\s+\d+', text, re.I)
                           or re.match(r'^(?:Under review for possible publication in|For consideration in)\b', text, re.I)
                           or journal and rect.y0 > page.rect.height*.94
                           and text.casefold() == journal.casefold()):
            marks.append(rect)
        if (rect.x1 < page.rect.width*.055 and re.fullmatch(r'\d{1,3}', text)
                and span['size'] <= 13):
            line_numbers.append((int(text), rect))
    # A long regularly spaced numerical gutter is an editorial line counter,
    # rather than a lonely page number or a number embedded in a formula.
    line_numbers.sort(key=lambda value:value[1].y0)
    values = [value for value, _ in line_numbers]
    if (len(values) >= 10 and values == list(range(values[0], values[0]+len(values)))
            and all(4 <= line_numbers[i+1][1].y0-line_numbers[i][1].y0 <= 22
                    for i in range(len(line_numbers)-1))):
        marks.extend(rect for _, rect in line_numbers)
    for rect in marks:
        page.add_redact_annot(rect+(-.5,-.5,.5,.5), fill=(1,1,1))
    if marks:
        page.apply_redactions(images=0, graphics=0, text=0)
    return len(marks)

def cover(request, cache):
    pdf = Path(request['pdf']).resolve()
    sha = filehash(pdf)
    key = sha+':'+COVER_VERSION
    cached = None if request.get('force') else cache.get(key)
    if cached and all(Path(cached[field]).is_file() for field in ('path', 'thumbnail')):
        return dict(cached, cacheHit=True)
    folder = cache.root/sha/COVER_VERSION
    folder.mkdir(parents=True, exist_ok=True)
    with fitz.open(pdf) as doc:
        if doc.needs_pass:
            raise ValueError('PDF 有密码，请先解锁后预览')
        if not len(doc):
            raise ValueError('PDF 没有可预览的页面')
        page_index, skipped = 0, []
        for index in range(min(8, len(doc))):
            reason = cover_sheet_reason(doc[index])
            if not reason:
                page_index = index
                break
            skipped.append(dict(pageIndex=index, reason=reason))
        else:
            # Do not presume a ninth page is an article when every inspected
            # page is a cover. The original first page remains a safe fallback.
            skipped = []
        # Edit only an in-memory one-page rendering copy. Never save changes to
        # the source attachment or erase its reader annotations.
        with fitz.open() as preview:
            preview.insert_pdf(doc, from_page=page_index, to_page=page_index)
            page = preview[0]
            journal, removed = '', 0
            if skipped:
                form = re.sub(r'\s+', ' ', doc[0].get_text())
                name = re.search(r'\bJournal\s*:\s*(.*?)\s+Manuscript ID\b', form, re.I)
                if name:
                    journal = name.group(1).strip()
                removed = remove_editorial_marks(page, journal)
            rect = content_rect(page)
            # MuPDF rounds the absolute clip edges outward to whole pixels. Leave
            # two pixels for rounding so even fractional PDF bounds stay <=2000.
            scale = min(220/72, 1998/max(rect.width, rect.height))
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=rect,
                                  alpha=False, annots=False)
            output = folder/'cover.png'
            pix.save(output)
            thumb_scale = min(scale, 560/max(rect.width, rect.height))
            thumb = page.get_pixmap(matrix=fitz.Matrix(thumb_scale, thumb_scale), clip=rect,
                                    alpha=False, annots=False)
            thumbnail = folder/'cover-thumb.png'
            thumb.save(thumbnail)
            result = dict(pdfHash=sha, version=COVER_VERSION, pageIndex=page_index,
                          page=page_index+1, pages=len(doc), pageWidth=page.rect.width,
                          pageHeight=page.rect.height, bbox=list(rect), path=str(output),
                          thumbnail=str(thumbnail), width=pix.width, height=pix.height,
                          dpi=round(scale*72, 2), cropped=True, skippedPages=skipped,
                          removedEditorialMarks=removed, cacheHit=False)
    cache.put(key, 'cover', sha, result)
    return result

def index(request, cache):
    pdf=Path(request['pdf']).resolve(); sha=filehash(pdf); key=sha+':'+VERSION
    cache.db.execute('BEGIN IMMEDIATE')
    old=None if request.get('force') else cache.get(key)
    if old and all(Path(a['path']).exists() for a in old['assets']):
        return dict(old,assets=list({a['id']:a for a in old['assets']+cache.manual(sha)}.values()),cacheHit=True)
    folder=cache.root/sha/VERSION; folder.mkdir(parents=True,exist_ok=True)
    assets=[]
    with fitz.open(pdf) as doc:
        if doc.needs_pass: raise ValueError('PDF 有密码，请先解锁后提取')
        alltext=[p.get_text() for p in doc]
        for pi,page in enumerate(doc):
            emit('progress',stage=f'正在提取第 {pi+1}/{len(doc)} 页素材并匹配图注',status='running')
            blocks=[b for b in page.get_text('blocks') if b[6]==0]
            layout=page.get_text('dict')
            drawings=graphic_regions(page,blocks)
            images=page.get_image_info(xrefs=True)
            captions=[]
            for b in blocks:
                label=caption_label(b[4])
                if label: captions.append((b,label))
            candidates=[]
            for cap,label in captions:
                is_table=bool(re.match(r'Table|TABLE|表',label))
                if not is_table:
                    rect=figure_region(page,cap,drawings,images,blocks)
                    candidates.append((rect,'figure',label,cap[4].strip(),True,any(rect.intersects(r) for r in drawings)))
                    continue
                x0,x1=cap[0],cap[2]
                # Academic three-rule tables have horizontal rules, often no
                # vertical borders. Do not mistake the next figure for a table.
                rules=[d['rect'] for d in page.get_drawings() if d['rect'].height<3 and d['rect'].width>80 and cap[3]<=d['rect'].y0<cap[3]+240 and d['rect'].x0<(x0+x1)/2<d['rect'].x1] if is_table else []
                if rules:
                    first=min(rules,key=lambda r:r.y0)
                    aligned=[r for r in rules if abs(r.x0-first.x0)<8 and abs(r.x1-first.x1)<8]
                    if len(aligned)>=2:
                        rect=fitz.Rect(first.x0-4,first.y0-3,first.x1+4,max(r.y1 for r in aligned)+4)
                        candidates.append((rect,'table',label,cap[4].strip(),True,True));continue
                relevant=[fitz.Rect(r) for r in drawings]+[fitz.Rect(i['bbox']) for i in images]
                relevant=[r for r in relevant if r.width>12 and r.height>12 and r.x1>x0 and r.x0<x1 and ((cap[3]<=r.y0<cap[3]+260) if is_table else (cap[1]-300<r.y1<=cap[1]+3))]
                if relevant:
                    nearest=min(relevant,key=lambda r:abs((r.y0-cap[3]) if is_table else (cap[1]-r.y1)))
                    relevant=[r for r in relevant if r.y0<nearest.y1+8 and r.y1>nearest.y0-8]
                    rect=fitz.Rect(relevant[0])
                    for r in relevant[1:]: rect |= r
                    rect += (-5,-5,5,5)
                    # Include axis labels between the vector boundary and caption.
                    if not is_table: rect.y1=max(rect.y1,cap[1]-3)
                else:
                    # A conservative proposed crop, explicitly pending user confirmation.
                    top=max(25,cap[1]-200) if not is_table else cap[3]+3
                    bottom=cap[1]-3 if not is_table else min(page.rect.height-25,top+170)
                    rect=fitz.Rect(x0,top,x1,bottom)
                candidates.append((rect,'table' if is_table else 'figure',label,cap[4].strip(),True,any(rect.intersects(r) for r in drawings)))
            formula_masks={}
            # Preserve-spans extraction used for caption typography splits a
            # sentence into individual font spans. Formula ownership needs the
            # original reading lines, including their explanatory prose.
            for formula in formula_regions(page,mask_regions=formula_masks):
                if not any(c[1]!='formula' and formula[0].intersects(c[0]) for c in candidates):
                    candidates.append(formula)
            # Keep embedded images without captions too; do not treat a scanned whole page as a figure.
            for image in images:
                r=fitz.Rect(image['bbox'])
                if r.width<40 or r.height<40 or r.get_area()>page.rect.get_area()*.7 or any(r.intersects(c[0]) for c in candidates): continue
                candidates.append((r,'image','未匹配图号','',True,False))
            for rect,kind,label,caption,review,vector in candidates:
                ident=digest(f'{sha}:{pi}:{list(rect)}:{VERSION}'.encode())[:24]
                needle=re.escape(label).replace(r'\ ',r'\s*')
                refs=[]
                if label!='未匹配图号':
                    for text in alltext:
                        for sentence in re.split(r'(?<=[.!?])\s+(?=[A-Z])',re.sub(r'\s+',' ',text)):
                            if re.search(needle,sentence,re.I) and sentence.strip()!=caption: refs.append(sentence[:700])
                    refs=refs[:3]
                role=non_research_image(rect,blocks) if kind=='image' else None
                asset=dict(id=ident,pdfHash=sha,pageIndex=pi,page=pi+1,pageWidth=page.rect.width,pageHeight=page.rect.height,kind=kind,label=label,caption=caption,references=refs,isVector=vector,method='vector-region' if vector else 'coordinate-crop',needsReview=review,userModified=False,extractorVersion=VERSION,panels=[],evidenceEligible=not bool(role),researchRole=role or 'research-visual')
                if kind=='formula':
                    asset['excludedTextRects']=formula_masks.get((label,tuple(rect)),[])
                cap=next((b for b,l in captions if l==label),None)
                if cap:
                    asset['captionRuns']=caption_runs(layout,cap[:4])
                    asset['captionLayoutVersion']='pdf-baseline-1'
                for b in blocks:
                    for m in re.finditer(r'\(([a-d])\)',b[4]):
                        if rect.intersects(fitz.Rect(b[:4])): asset['panels'].append(dict(label=m.group(1),bbox=list(b[:4]),needsReview=True))
                save_region(doc,page,rect,asset,folder)
                contained=[i for i in images if rect.contains(fitz.Rect(i['bbox'])) and i.get('xref')]
                if len(contained)==1:
                    try:
                        img=doc.extract_image(contained[0]['xref']); op=folder/(ident+'-original.'+img['ext']); op.write_bytes(img['image'])
                        asset.update(originalPath=str(op),originalResolution=[img['width'],img['height']])
                    except (ValueError,RuntimeError): pass
                assets.append(asset)
    result=dict(pdfHash=sha,assets=assets,pages=len(alltext),cacheHit=False,version=VERSION)
    cache.put(key,'raw',sha,result)
    return dict(result,assets=list({a['id']:a for a in assets+cache.manual(sha)}.values()))

def main(request):
    cache=Cache(request['cacheRoot'])
    try:
        op=request['operation']
        if op=='assets-chat-spreadsheet':
            from chat_spreadsheet import read_spreadsheet
            return read_spreadsheet(request['file'],request.get('sheet'),request.get('ranges'))
        if op=='assets-dataset':
            from datasets import read_dataset
            return read_dataset(request['file'])
        if op=='assets-text':
            sha=filehash(request['pdf']); key='page-text-2:'+sha
            found=cache.get(key)
            if found: return dict(found,cacheHit=True)
            with fitz.open(request['pdf']) as doc:
                # Coordinate sorting interleaves lines from two-column papers.
                # Preserve PDF text-block order and join line-end hyphenation.
                result=dict(pdfHash=sha,pages=[dict(pageIndex=i,text=p.get_text('text',sort=False,flags=fitz.TEXTFLAGS_TEXT|fitz.TEXT_DEHYPHENATE)) for i,p in enumerate(doc)],cacheHit=False)
            cache.put(key,'text',sha,result); return result
        if op=='assets-user-image':
            file=Path(request['file'])
            if file.stat().st_size>20_000_000: raise ValueError('实验图片超过 20 MB')
            sha=filehash(file); folder=cache.root/'user-images'; folder.mkdir(exist_ok=True)
            pix=fitz.Pixmap(str(file))
            if pix.width*pix.height>25_000_000: raise ValueError('实验图片分辨率过大')
            if pix.colorspace and pix.colorspace.n!=3: pix=fitz.Pixmap(fitz.csRGB,pix)
            output=folder/(sha+'.png'); pix.save(output)
            result=dict(id='user-'+sha[:20],path=str(output),thumbnail=str(output),width=pix.width,height=pix.height,assetHash=sha,label=file.name,kind='user_image',userModified=True,needsReview=False,provenance=request.get('provenance','用户导入的实验图片'),paperTitle='我的实验',page=0)
            cache.put(result['id'],'manual','',result,True); return result
        if op=='assets-palette':
            from collections import Counter
            colors=Counter()
            for file in request.get('files',[])[:8]:
                pix=fitz.Pixmap(file)
                if pix.colorspace and pix.colorspace.n!=3: pix=fitz.Pixmap(fitz.csRGB,pix)
                samples=pix.samples; stride=max(1,pix.width*pix.height//3000)*pix.n
                for i in range(0,len(samples)-pix.n,stride):
                    rgb=tuple(samples[i:i+3])
                    if max(rgb)-min(rgb)>35 and 40<sum(rgb)/3<215:
                        colors[tuple(min(255,round(v/32)*32) for v in rgb)]+=1
            palette=[''.join(f'{v:02X}' for v in rgb) for rgb,_ in colors.most_common(5)]
            return dict(colors=palette,source='论文原图颜色采样' if palette else '原图没有足够彩色像素，使用学术默认配色')
        if op=='assets-index': return index(request,cache)
        if op=='assets-cover': return cover(request,cache)
        if op=='assets-page':
            sha=filehash(request['pdf']); page_index=int(request['pageIndex'])
            folder=cache.root/sha/'pages'; folder.mkdir(parents=True,exist_ok=True)
            with fitz.open(request['pdf']) as doc:
                page=doc[page_index]
                asset=save_region(doc,page,page.rect,dict(id='page-'+str(page_index),pageIndex=page_index,pdfHash=sha),folder)
            cache.put(sha+':page:'+str(page_index),'page',sha,asset)
            return asset
        if op=='assets-stats': return cache.stats()
        if op=='assets-clear': return cache.clear(request.get('pdfHash'))
        if op=='assets-crop':
            a=request['asset']; sha=filehash(request['pdf'])
            if sha!=a['pdfHash']: raise ValueError('PDF 已改变，请重新提取；原手动素材已保留')
            folder=cache.root/sha/'manual'; folder.mkdir(parents=True,exist_ok=True)
            a=dict(a,id=uuid.uuid4().hex,userModified=True,needsReview=False,parentID=a['id'],method='user-crop')
            with fitz.open(request['pdf']) as doc: save_region(doc,doc[a['pageIndex']],request['bbox'],a,folder)
            cache.put(a['id'],'manual',sha,a,True); return a
        if op=='assets-cache-get': return cache.get(request['key']) or {'miss':True}
        if op=='assets-cache-put':
            cache.put(request['key'],request['layer'],request.get('pdfHash',''),request['value'],request.get('protected',False)); return {'saved':True}
        raise ValueError('未知素材操作')
    finally: cache.db.close()

if __name__=='__main__':
    try: emit('result',value=main(json.load(sys.stdin)))
    except Exception as e: emit('error',message=str(e)); sys.exit(1)
