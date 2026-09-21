"""Deterministic PDF text blocks. No OCR models or generated source text."""
import hashlib
import re
import fitz

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
