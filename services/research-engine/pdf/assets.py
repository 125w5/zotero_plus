"""Deterministic PDF evidence extraction. No model, network or document execution."""
import hashlib, json, os, re, sqlite3, sys, time, uuid, shutil
from pathlib import Path
import pymupdf as fitz

VERSION = 'mupdf-assets-6'
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
    out=folder/(asset['id']+'.png'); pix.save(out)
    thumb=page.get_pixmap(matrix=fitz.Matrix(360/max(rect.width,rect.height),360/max(rect.width,rect.height)),clip=rect,alpha=False,annots=False)
    thumbpath=folder/(asset['id']+'-thumb.png'); thumb.save(thumbpath)
    asset.update(path=str(out),thumbnail=str(thumbpath),bbox=list(rect),width=pix.width,height=pix.height,assetHash=filehash(out),cropped=True)
    if asset.get('isVector'):
        # Preserve vector operators in a clipped one-page PDF and an SVG companion.
        with fitz.open() as vector:
            p=vector.new_page(width=rect.width,height=rect.height)
            p.show_pdf_page(p.rect,doc,page.number,clip=rect)
            vp=folder/(asset['id']+'.svg'); vp.write_text(p.get_svg_image(),encoding='utf-8')
            asset['vectorPath']=str(vp)
    return asset

def figure_region(page, cap, drawings, images, blocks):
    """Keep complete embedded images, including transparent margins at captions.

    A caption's text width is not the width of its figure. Prefer actual graphic
    bounds and extend vector regions to nearby axis labels. Ambiguous proposals
    remain reviewable, with the full page available to the crop editor.
    """
    caption = fitz.Rect(cap[:4])
    regions = [fitz.Rect(r) for r in drawings] + [fitz.Rect(i['bbox']) for i in images]
    regions = [r for r in regions if r.width > 12 and r.height > 12
               and r.x1 > caption.x0 and r.x0 < caption.x1
               and caption.y0 - 340 < r.y1 <= caption.y1 + 8
               and r.y0 < caption.y0 - 10]
    if not regions:
        # Column width is safer than short caption text, but still needs review.
        midpoint = page.rect.width / 2
        left, right = (36, midpoint-8) if caption.x1 < midpoint else ((midpoint+4, page.rect.width-28) if caption.x0 >= midpoint else (36, page.rect.width-28))
        return fitz.Rect(left, max(25, caption.y0-210), right, caption.y0-2)
    nearest = min(regions, key=lambda r: abs(caption.y0-r.y1))
    rect = fitz.Rect(nearest)
    for r in regions:
        if r.y0 < nearest.y1+8 and r.y1 > nearest.y0-8:
            rect |= r
    # Whole text blocks can contain adjacent body columns; accept only short
    # axis/legend labels close to the actual graphic, never whole paragraphs.
    expanded = rect + (-22, -14, 14, 18)
    for b in blocks:
        label = fitz.Rect(b[:4])
        if len(b[4].strip()) <= 100 and label.y1 <= caption.y0+1 and expanded.intersects(label):
            rect |= label
    return (rect + (-3, -3, 3, 3)) & page.rect

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
            drawings=page.cluster_drawings() if not page.rotation else []
            images=page.get_image_info(xrefs=True)
            captions=[]
            for b in blocks:
                match=re.match(r'^\s*((?:Fig(?:ure)?\.?)\s*\d+[a-z]?)[.:]\s|^\s*((?:TABLE|Table)\s*[\dIVX]+)\s*(?:[.:]|\n)',b[4])
                if match: captions.append((b,match.group(1) or match.group(2)))
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
            for b in blocks:
                number=re.search(r'\((\d{1,3})\)\s*$', b[4])
                if number and len(b[4])<260 and re.search(r'[=∑∫∈≤≥]',b[4]) and not any(fitz.Rect(b[:4]).intersects(c[0]) for c in candidates):
                    candidates.append((fitz.Rect(b[:4])+(-3,-3,3,3),'formula','Equation '+number.group(1),b[4].strip(),True,True))
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
                asset=dict(id=ident,pdfHash=sha,pageIndex=pi,page=pi+1,pageWidth=page.rect.width,pageHeight=page.rect.height,kind=kind,label=label,caption=caption,references=refs,isVector=vector,method='vector-region' if vector else 'coordinate-crop',needsReview=review,userModified=False,extractorVersion=VERSION,panels=[])
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
