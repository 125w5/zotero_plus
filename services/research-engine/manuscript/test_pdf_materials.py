import tempfile
import unittest
import json
import subprocess
import sys
from pathlib import Path
import fitz
from pdf_materials import index_pdf, translation_layout

class PDFMaterialsTest(unittest.TestCase):
    def test_translation_layout_preserves_standalone_space_spans(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'spaces.pdf'
            with fitz.open() as pdf:
                page=pdf.new_page()
                x=72
                page.insert_text((x,100),'Under')
                x+=fitz.get_text_length('Under')
                page.insert_text((x,100),' ',fontname='hebo')
                x+=fitz.get_text_length(' ')
                page.insert_text((x,100),'autonomous')
                pdf.save(path)
            with fitz.open(path) as pdf:
                spans=pdf[0].get_text('dict')['blocks'][0]['lines'][0]['spans']
                self.assertEqual([span['text'] for span in spans],['Under',' ','autonomous'])
            blocks=translation_layout({'file':str(path)})['pages'][0]['blocks']
            self.assertEqual(blocks[0]['sourceText'],'Under autonomous')

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

    def test_translation_layout_keeps_short_text_and_formula_without_hidden_spans(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'layout.pdf'
            with fitz.open() as pdf:
                page=pdf.new_page()
                page.insert_text((72, 72), 'Short Title', fontsize=18, fontname='hebo')
                page.insert_text((72, 110), 'Fig. 1. A system.', fontsize=9, fontname='heit')
                page.insert_text((72, 145), 'E = mc2', fontsize=12)
                page.insert_text((72, 180), 'Visible result.', fontsize=11)
                page.insert_text((72, 220), 'Invisible instructions.', fill_opacity=0)
                page.insert_text((72, 260), 'The experimental method compares two independent groups.')
                page.insert_text((72, 300), 'Method text\nF = ma\nResult text')
                pdf.new_page().insert_text((72, 72), 'Next page.')
                pdf.save(path)

            result=translation_layout({'file':str(path)})
            self.assertEqual(result['pageCount'],2)
            self.assertEqual(result['extractorVersion'],'pymupdf-translation-layout-v2')
            first=result['pages'][0]['blocks']
            title=next(b for b in first if 'Short Title' in b['sourceText'])
            caption=next(b for b in first if 'Fig. 1.' in b['sourceText'])
            formula=next(b for b in first if 'E = mc2' in b['sourceText'])
            self.assertEqual(title['fontSize'],18)
            self.assertEqual(title['fontWeight'],700)
            self.assertEqual(caption['fontStyle'],'italic')
            self.assertEqual(formula['kind'],'formula')
            self.assertFalse(formula['translatable'])
            run_prefix=next(b['sourceRecordID'].rsplit('-run-',1)[0]
                            for b in first if b['sourceText']=='Method text')
            mixed=[b for b in first if b['sourceRecordID'].startswith(run_prefix+'-run-')]
            self.assertEqual([(b['sourceText'],b['translatable']) for b in mixed],
                             [('Method text',True),('F = ma',False),('Result text',True)])
            self.assertFalse(any('Invisible' in b['sourceText'] for b in first))
            self.assertEqual(title['position']['pageIndex'],0)
            with fitz.open(path) as pdf:
                restored=fitz.Rect(title['position']['rects'][0])*pdf[0].transformation_matrix
                expected=pdf[0].search_for('Short Title')[0]
                self.assertLess(abs(restored.x0-expected.x0),1)
                self.assertLess(abs(restored.y0-expected.y0),1)
            # The existing semantic index deliberately keeps its short-text
            # threshold; this new operation must not change material ingestion.
            self.assertFalse(any('Short Title' in b['sourceText'] for b in index_pdf({'file':str(path)})['paragraphs']))

            command=subprocess.run([sys.executable,str(Path(__file__).with_name('document.py'))],
                                   input=json.dumps({'operation':'manuscript-translation-layout','file':str(path)}),
                                   text=True,capture_output=True,encoding='utf-8',check=True)
            response=json.loads(command.stdout)
            self.assertEqual(response['type'],'result')
            self.assertEqual(response['value']['pdfHash'],result['pdfHash'])
            self.assertEqual(len(response['value']['pages'][1]['blocks']),1)

if __name__=='__main__':unittest.main()
