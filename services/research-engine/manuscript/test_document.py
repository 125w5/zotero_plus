import tempfile, unittest, zipfile
from pathlib import Path
from document import export, dataset, qn
from lxml import etree

class DocumentTest(unittest.TestCase):
 def test_table_geometry_and_reference_styles(self):
  with tempfile.TemporaryDirectory() as tmp:
   file=Path(tmp)/'data.csv';file.write_text('方法,准确率\n甲,95%\n乙,96%',encoding='utf-8');data=dataset(file)
   self.assertEqual(data['rows'][2][1],'96%')
   rows=[[dict(text='实验比较',rowspan=1,colspan=2),dict(text='',hidden=True)], [dict(text='甲',rowspan=1,colspan=1),dict(text='95%',rowspan=1,colspan=1,align='center')]]
   b=dict(id='table-one',type='table',sectionID='s',table=dict(rows=rows,width=158,widths=[70,88],heights=[10,12],style='grid',caption='比较',border=1))
   result=export(dict(directory=tmp,project=dict(title='验收',sections=[dict(id='s',title='结果')],blocks=[b,dict(id='ref',type='crossref',sectionID='s',targetID=b['id'],text='表 1')]),bibliography=[]))
   with zipfile.ZipFile(result['path']) as z:
    root=etree.fromstring(z.read('word/document.xml'))
    self.assertEqual(root.find('.//'+qn('w:gridSpan')).get(qn('w:val')),'2')
    self.assertEqual(root.find('.//'+qn('w:tcBorders')+'/'+qn('w:top')).get(qn('w:sz')),'8')
    self.assertIsNotNone(root.find('.//'+qn('w:trHeight')))
    self.assertIn('REF table_table_one',z.read('word/document.xml').decode())
    self.assertIn('宋体',z.read('word/styles.xml').decode())
    self.assertIn('Cambria Math',z.read('word/settings.xml').decode())
    self.assertIn('word/footer1.xml',z.namelist())

if __name__=='__main__':unittest.main()
