"""Deterministic manuscript IO. No network or model execution."""
import csv, hashlib, io, json, re, subprocess, sys, tempfile, zipfile
from pathlib import Path
from copy import deepcopy
from docx import Document
from docx.shared import Mm, Pt
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from lxml import etree

def element(tag, **attrs):
    el = OxmlElement(tag)
    for key, value in attrs.items(): el.set(qn('w:'+key), str(value))
    return el

def field(p, instruction, text):
    r = p.add_run()._r
    r.append(element('w:fldChar', fldCharType='begin'))
    i = element('w:instrText'); i.text = instruction; r.append(i)
    r.append(element('w:fldChar', fldCharType='separate'))
    t = element('w:t'); t.text = str(text); r.append(t)
    r.append(element('w:fldChar', fldCharType='end'))

def default_reference(path):
    doc = Document()
    for name in ['Normal','Title','Heading 1','Heading 2','Heading 3','Caption']:
        s = doc.styles[name]; s.font.name = 'Times New Roman'; s.font.size = Pt(11 if name == 'Normal' else 14)
        s.element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'), '宋体' if name == 'Normal' else '黑体')
    sect = doc.sections[0]; sect.page_width=Mm(210); sect.page_height=Mm(297)
    sect.top_margin=sect.bottom_margin=Mm(25.4); sect.left_margin=sect.right_margin=Mm(26)
    sect.header.paragraphs[0].text='论文装配 · 研究稿'
    p=sect.footer.paragraphs[0]; p.alignment=WD_ALIGN_PARAGRAPH.CENTER; field(p,' PAGE ','1')
    math = OxmlElement('m:mathPr'); font = OxmlElement('m:mathFont'); font.set(qn('m:val'),'Cambria Math'); math.append(font); doc.settings.element.append(math)
    doc.save(path)

def dataset(file):
    p=Path(file)
    if p.suffix.lower()=='.csv':
        try: text=p.read_text(encoding='utf-8-sig')
        except UnicodeDecodeError: text=p.read_text(encoding='gb18030')
        rows=list(csv.reader(io.StringIO(text)))
    elif p.suffix.lower()=='.xlsx':
        from openpyxl import load_workbook
        book=load_workbook(p,read_only=True,data_only=True)
        rows=[list(r) for r in book.active.iter_rows(values_only=True)]; book.close()
    else: raise ValueError('请选择 CSV 或 XLSX 数据文件')
    rows=[r for r in rows if any(x is not None and str(x)!='' for x in r)]
    if not rows or len(rows)>100 or max(map(len,rows))>30: raise ValueError('数据需包含 1–100 行、1–30 列；请先选择实验所需范围')
    cols=max(map(len,rows)); rows=[[str(v) if v is not None else '' for v in r]+['']*(cols-len(r)) for r in rows]
    return dict(rows=rows,file=str(p.resolve()),hash=hashlib.sha256(p.read_bytes()).hexdigest(),sheet=p.stem)

def formula(latex,pandoc,folder):
    if not pandoc or not Path(pandoc).is_file(): raise ValueError('公式转换需要配置 Pandoc')
    out=Path(folder)/'formula.docx'
    run=subprocess.run([pandoc,'-f','markdown+tex_math_dollars','-t','docx','-o',str(out)],input='$$\n'+latex+'\n$$',text=True,capture_output=True,encoding='utf-8',timeout=30)
    if run.returncode or 'Could not convert' in run.stderr: raise ValueError('公式转换失败：'+run.stderr[:400])
    with zipfile.ZipFile(out) as z: root=etree.fromstring(z.read('word/document.xml'))
    nodes=root.findall('.//'+qn('m:oMath'))
    if not nodes: raise ValueError('公式没有生成可编辑 OMML：'+latex)
    return [deepcopy(n) for n in nodes]

def write_table(doc,b,number):
    spec=b['table']; rows=spec['rows']; cols=len(rows[0])
    p=doc.add_paragraph(style='Caption')
    bookmark='table_'+re.sub(r'\W','_',b['id']); p._p.append(element('w:bookmarkStart',id=number,name=bookmark))
    p.add_run('表 ');field(p,' SEQ Table \\* ARABIC ',number);p.add_run(' '+spec.get('caption',''));p._p.append(element('w:bookmarkEnd',id=number))
    t=doc.add_table(rows=len(rows),cols=cols);t.autofit=False;t.alignment=WD_TABLE_ALIGNMENT.CENTER
    width=t._tbl.tblPr.find(qn('w:tblW'))
    if width is None:width=element('w:tblW');t._tbl.tblPr.append(width)
    width.set(qn('w:w'),str(round(spec.get('width',158)*56.693)));width.set(qn('w:type'),'dxa')
    for c,w in enumerate(spec['widths']): t.columns[c].width=Mm(w)
    for ri,row in enumerate(rows):
        t.rows[ri].height=Mm(spec['heights'][ri]); t.rows[ri]._tr.get_or_add_trPr().append(element('w:cantSplit'))
        if ri==0:t.rows[ri]._tr.get_or_add_trPr().append(element('w:tblHeader'))
        for ci,data in enumerate(row):
            if data.get('hidden'):continue
            cell=t.cell(ri,ci)
            rs,cs=data.get('rowspan',1),data.get('colspan',1)
            if rs>1 or cs>1:cell=cell.merge(t.cell(ri+rs-1,ci+cs-1))
            cell.width=Mm(sum(spec['widths'][ci:ci+cs])); cell.text=data.get('text','')
            cell.vertical_alignment={'top':WD_CELL_VERTICAL_ALIGNMENT.TOP,'bottom':WD_CELL_VERTICAL_ALIGNMENT.BOTTOM}.get(data.get('vertical'),WD_CELL_VERTICAL_ALIGNMENT.CENTER)
            p=cell.paragraphs[0];align=data.get('align','auto')
            if align=='auto':align='center' if ri==0 or re.fullmatch(r'[-+]?\d[\d.,% ±Ee-]*',cell.text.strip()) else 'left'
            p.alignment={'center':WD_ALIGN_PARAGRAPH.CENTER,'right':WD_ALIGN_PARAGRAPH.RIGHT}.get(align,WD_ALIGN_PARAGRAPH.LEFT)
            if ri==0:
                for r in p.runs:r.bold=True
            borders=element('w:tcBorders')
            for edge in ['top','left','bottom','right']:
                visible=spec.get('style')!='three-line' or edge=='top' and ri==0 or edge=='bottom' and (ri==0 or ri+rs==len(rows))
                borders.append(element('w:'+edge,val='single' if visible else 'nil',sz=round(spec.get('border',1)*8),color=spec.get('color','000000')))
            cell._tc.get_or_add_tcPr().append(borders)
            margins=element('w:tcMar')
            for edge in ['top','left','bottom','right']:margins.append(element('w:'+edge,w=round(spec.get('padding',1.8)*56.693),type='dxa'))
            cell._tc.get_or_add_tcPr().append(margins)

def export(req):
    root=Path(req['directory']);root.mkdir(parents=True,exist_ok=True)
    folder=Path(tempfile.mkdtemp(prefix='manuscript-',dir=root))
    reference=Path(req.get('referenceDoc') or Path(__file__).with_name('reference.docx'))
    if not reference.exists(): raise ValueError('找不到 reference.docx')
    doc=Document(reference)
    # Retain styles/headers/footers/section properties; discard template example body.
    for node in list(doc.element.body):
        if node.tag!=qn('w:sectPr'):doc.element.body.remove(node)
    p=req['project'];doc.add_heading(p['title'],0);table_number=0
    for section in p['sections']:
        blocks=[b for b in p['blocks'] if b['sectionID']==section['id'] and not (b.get('emptyStarter') and not b.get('text','').strip() and not b.get('materials'))]
        if not blocks:continue
        doc.add_heading(section['title'],1)
        for b in blocks:
            kind=b['type'];text=b.get('text','')
            if b.get('pageBreakBefore'):doc.add_page_break()
            if b.get('emptyStarter') and not text.strip():continue
            if kind=='placeholder':raise ValueError('存在待填卡，请补齐后导出')
            if kind=='heading':doc.add_heading(text,2)
            elif kind=='list':
                for line in text.splitlines():doc.add_paragraph(line,style='List Bullet')
            elif kind=='formula':
                par=doc.add_paragraph()
                for node in formula(text,req.get('pandoc'),folder):par._p.append(node)
            elif kind=='image':
                path=Path(b['imagePath'])
                if not path.is_file():raise ValueError('图片不存在：'+str(path))
                doc.add_picture(str(path),width=Mm(min(b.get('width',140),158)))
                if text:doc.add_paragraph(text,style='Caption')
            elif kind=='table':table_number+=1;write_table(doc,b,table_number)
            elif kind=='citation':
                cited=req.get('citationText',{}).get(str(b.get('citationItemID')))
                if not cited:raise ValueError('引用尚未由 Zotero 格式化')
                doc.add_paragraph(cited)
            elif kind=='crossref':
                target=next((x for x in p['blocks'] if x['id']==b.get('targetID') and x['type']=='table'),None)
                if not target:raise ValueError('交叉引用指向不存在的表格')
                par=doc.add_paragraph();field(par,' REF table_'+re.sub(r'\W','_',target['id'])+' \\h ',text or '表')
            else:
                par=doc.add_paragraph()
                if b.get('spaceBefore'):par.paragraph_format.space_before=Pt(b['spaceBefore'])
                if b.get('runs'):
                    for spec in b['runs']:
                        run=par.add_run(spec.get('text',''));run.bold=bool(spec.get('bold'));run.italic=bool(spec.get('italic'));run.underline=bool(spec.get('underline'));run.font.superscript=bool(spec.get('sup'));run.font.subscript=bool(spec.get('sub'))
                        color=spec.get('color','').lstrip('#')
                        if color.startswith('rgb'):
                            values=re.findall(r'\d+',color)[:3];color=''.join(format(min(255,int(v)),'02X') for v in values)
                        if re.fullmatch(r'[0-9a-fA-F]{6}',color):run.font.color.rgb=__import__('docx.shared',fromlist=['RGBColor']).RGBColor.from_string(color)
                        if spec.get('fontFamily'):
                            font=spec['fontFamily'].strip('"\'');run.font.name=font;run._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),font)
                else:par.add_run(text)
    if req.get('bibliography'):
        doc.add_heading('参考文献',1)
        for entry in req['bibliography']:doc.add_paragraph(entry.strip())
    output=folder/'manuscript.docx';doc.save(output)
    with zipfile.ZipFile(output) as z:
        xml=etree.fromstring(z.read('word/document.xml'))
        report=dict(parts=z.namelist(),tables=len(xml.findall('.//'+qn('w:tbl'))),formulas=len(xml.findall('.//'+qn('m:oMath'))),images=len(xml.findall('.//'+qn('w:drawing'))))
    (folder/'structure-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    (folder/'project.json').write_text(json.dumps(p,ensure_ascii=False,indent=2),encoding='utf-8')
    return dict(path=str(output),directory=str(folder),structure=report,citations='Zotero 格式化的静态引用')

if __name__=='__main__':
    try:
        req=json.load(sys.stdin)
        if req['operation']=='manuscript-index':
            from pdf_materials import index_pdf
            value=index_pdf(req)
        else:
            value=dataset(req['file']) if req['operation']=='manuscript-data' else export(req)
        print(json.dumps(dict(type='result',value=value),ensure_ascii=False))
    except Exception as e:
        print(json.dumps(dict(type='error',message=str(e)),ensure_ascii=False));sys.exit(1)
