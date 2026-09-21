import tempfile
import unittest
from pathlib import Path
import fitz
from pdf_materials import index_pdf

class PDFMaterialsTest(unittest.TestCase):
    def test_exact_blocks_positions_and_hash_invalidation(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'paper.pdf'
            def write(text):
                with fitz.open() as pdf:
                    page=pdf.new_page();page.insert_text((72,72),'1. Methods')
                    page.insert_text((72,110),text);pdf.save(path)
            source='The experiment uses recorded samples from the source dataset.'
            write(source)
            first=index_pdf({'file':str(path)})
            block=next(b for b in first['paragraphs'] if source in b['sourceText'])
            self.assertEqual(block['sourceText'],source)
            self.assertEqual(block['section'],'1. Methods')
            self.assertEqual(block['position']['pageIndex'],0)
            self.assertEqual(len(block['position']['rects'][0]),4)
            self.assertTrue(index_pdf({'file':str(path),'pdfHash':first['pdfHash']})['unchanged'])
            write('The revised experiment describes a different source dataset.')
            second=index_pdf({'file':str(path),'pdfHash':first['pdfHash']})
            self.assertNotEqual(first['pdfHash'],second['pdfHash'])
            self.assertEqual(first['paragraphs'][0]['sourceRecordID'],second['paragraphs'][0]['sourceRecordID'])

    def test_empty_scanned_document_reports_no_text(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'scan.pdf'
            with fitz.open() as pdf:pdf.new_page();pdf.save(path)
            with self.assertRaisesRegex(ValueError,'未提取到可用文字'):
                index_pdf({'file':str(path)})

if __name__=='__main__':unittest.main()
