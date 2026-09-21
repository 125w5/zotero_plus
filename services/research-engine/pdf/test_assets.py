import tempfile, unittest
from pathlib import Path
import pymupdf as fitz
from assets import main

class AssetTests(unittest.TestCase):
    def test_three_rule_table_uses_borders_not_caption_width_or_next_figure(self):
        with tempfile.TemporaryDirectory() as temp:
            pdf=Path(temp)/'table.pdf'
            with fitz.open() as d:
                p=d.new_page();p.insert_text((230,100),'TABLE I: Data summary.')
                for y in [115,135,190]:p.draw_line((70,y),(500,y))
                p.insert_text((75,128),'Dataset       Samples       Accuracy')
                p.insert_text((75,160),'Measured A     100             0.8')
                p.draw_rect((70,240,500,430));d.save(pdf)
            table=main(dict(operation='assets-index',pdf=str(pdf),cacheRoot=str(Path(temp)/'cache')))['assets'][0]
            self.assertLess(table['bbox'][0],75);self.assertGreater(table['bbox'][2],495);self.assertLess(table['bbox'][3],210)
    def test_page_text_cache_and_real_image_palette(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); pdf=root/'paper.pdf'
            with fitz.open() as d:
                p=d.new_page(); p.insert_text((70,70),'Evidence page');p.draw_rect((70,100,300,260),fill=(.1,.4,.7));d.save(pdf)
                p.get_pixmap().save(root/'image.png')
            request=dict(cacheRoot=str(root/'cache'),operation='assets-text',pdf=str(pdf))
            self.assertIn('Evidence page',main(request)['pages'][0]['text']);self.assertTrue(main(request)['cacheHit'])
            colors=main(dict(request,operation='assets-palette',files=[str(root/'image.png')]))['colors'];self.assertTrue(colors)
            image=main(dict(request,operation='assets-user-image',file=str(root/'image.png')))
            main(dict(request,operation='assets-clear'));self.assertTrue(Path(image['path']).exists())
    def test_import_rejects_missing_values_and_excel_formulas(self):
        from datasets import read_dataset
        from openpyxl import Workbook
        with tempfile.TemporaryDirectory() as temp:
            csv=Path(temp)/'observations.csv';csv.write_text('x,y\n1,2\n3,4\n',encoding='utf-8')
            self.assertEqual(read_dataset(csv)[0]['series'][0]['values'],[2,4])
            csv.write_text('x,y\n1,\n',encoding='utf-8')
            with self.assertRaises(ValueError): read_dataset(csv)
            xlsx=Path(temp)/'observations.xlsx';wb=Workbook();ws=wb.active;ws.append(['x','y']);ws.append([1,'=1+1']);wb.save(xlsx)
            with self.assertRaises(ValueError): read_dataset(xlsx)
    def test_cache_invalidation_and_manual_survival(self):
        with tempfile.TemporaryDirectory() as temp:
            pdf=Path(temp)/'paper.pdf'
            with fitz.open() as d:
                p=d.new_page(); p.draw_rect((70,100,300,260)); p.insert_text((70,285),'Fig. 1: Test method.'); d.save(pdf)
            request=dict(operation='assets-index',pdf=str(pdf),cacheRoot=str(Path(temp)/'cache'))
            first=main(request); self.assertFalse(first['cacheHit']); self.assertTrue(first['assets'])
            self.assertTrue(main(request)['cacheHit'])
            a=first['assets'][0]
            crop=main(dict(request,operation='assets-crop',asset=a,bbox=[75,105,200,200]))
            main(dict(request,operation='assets-clear',pdfHash=first['pdfHash']))
            self.assertTrue(Path(crop['path']).exists())
            second=main(request); self.assertTrue(any(v['id']==crop['id'] for v in second['assets']))
            with fitz.open(pdf) as d:
                d[0].insert_text((70,320),'A changed PDF.'); d.saveIncr()
            third=main(request); self.assertFalse(third['cacheHit']); self.assertNotEqual(first['pdfHash'],third['pdfHash'])
            self.assertTrue(Path(crop['path']).exists())

if __name__=='__main__': unittest.main()
