import tempfile
import unittest
import json
import subprocess
import sys
from pathlib import Path
import fitz
from pdf_materials import index_pdf, translation_layout, _inline_crop, _inline_math_line, _joined_lines, _index_heading

class PDFMaterialsTest(unittest.TestCase):
    def test_index_chapters_use_printed_numbered_titles_and_do_not_reclassify_numbered_prose(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'chapters.pdf'
            with fitz.open() as pdf:
                page=pdf.new_page()
                page.insert_text((72,72),'1 Introduction',fontsize=14,fontname='hebo')
                page.insert_text((72,102),'This study concerns learning policies in a model-based environment.',fontsize=10)
                page.insert_text((72,142),'2 World Models',fontsize=14,fontname='hebo')
                page.insert_text((72,172),'A latent dynamics model is trained using the observed transitions.',fontsize=10)
                page.insert_text((72,212),'2.1 Imagination and Policy Learning',fontsize=12,fontname='hebo')
                page.insert_text((72,242),'The policy receives model-generated trajectories during training.',fontsize=10)
                page.insert_text((72,282),'1. Select a model and evaluate its predictions',fontsize=10)
                page.insert_text((72,322),'3 Ablation Study',fontsize=14,fontname='hebo')
                page.insert_text((72,352),'The comparison removes one component while preserving other settings.',fontsize=10)
                page.insert_text((72,392),'References',fontsize=12,fontname='hebo')
                page.insert_text((72,422),'[1] A controlled reference for the chapter parsing fixture.',fontsize=10)
                pdf.save(path)
            rows=index_pdf({'file':str(path)})['paragraphs']
            source={row['sourceText']:row for row in rows}
            self.assertEqual(source['A latent dynamics model is trained using the observed transitions.']['section'],'2 World Models')
            self.assertEqual(source['The policy receives model-generated trajectories during training.']['section'],'2.1 Imagination and Policy Learning')
            self.assertEqual(source['1. Select a model and evaluate its predictions']['section'],'2.1 Imagination and Policy Learning')
            self.assertEqual(source['The comparison removes one component while preserving other settings.']['section'],'3 Ablation Study')
            self.assertEqual(source['[1] A controlled reference for the chapter parsing fixture.']['section'],'References')
        self.assertTrue(_index_heading('参考文献',{},10))
        self.assertFalse(_index_heading('2. Our model uses an equation.',{},10))
        self.assertFalse(_index_heading('2 x = y',{'lines':[{'spans':[{'text':'2 x = y','size':14,'flags':16}]}]},10))

    def test_computer_modern_roman_prose_does_not_create_math_placeholders(self):
        text='I am pleased to submit our work on local adaptation. We use a method to compare results.'
        with fitz.open() as pdf:
            page=pdf.new_page();x=72
            for word in text.split(' '):
                page.insert_text((x,100),word+' ',fontname='tiro',fontsize=10)
                x+=fitz.get_text_length(word+' ',fontname='tiro',fontsize=10)
            raw={'lines':[line for b in page.get_text('dict')['blocks'] for line in b['lines']]}
            # Real CMR exporters emit each short prose word as an individual
            # span, just like the actual C-AMC cover letter that regressed.
            for line in raw['lines']:
                for span in line['spans']:span['font']='CMR10'
            lines=_joined_lines(raw)
            for line in lines:
                protected,assets=_inline_math_line(page,line,None,'roman-prose',0,lines)
                self.assertEqual(assets,[])
                self.assertEqual(protected,line['text'])
                self.assertNotIn('ZXQMATH',protected)

    def test_source_roles_protect_metadata_but_not_capitalized_headings(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'roles.pdf'
            with fitz.open() as pdf:
                page=pdf.new_page()
                page.insert_text((72,72),'A Research Paper About Reliable Methods',fontsize=18)
                page.insert_text((170,100),'Hunmin Lee',fontsize=11)
                page.insert_text((72,135),'Abstract: The method compares recorded samples.',fontsize=10)
                page.insert_text((72,175),'System Model',fontsize=11)
                page.insert_text((72,200),'The signal uses a controlled evaluation protocol.',fontsize=10)
                page.insert_text((72,230),'[2] reports a measured result under controlled conditions.',fontsize=10)
                page.insert_text((72,270),'[1] J. Smith, "A prior method," 2020.',fontsize=9)
                page.insert_text((72,310),'Sincerely,',fontsize=10)
                page.insert_text((72,330),'Hunmin Lee',fontsize=10)
                pdf.save(path)
            blocks=translation_layout({'file':str(path)})['pages'][0]['blocks']
            authors=[b for b in blocks if b.get('sourceRole')=='author']
            self.assertEqual(len(authors),2)
            self.assertTrue(all(not b['translatable'] and b['sourceText']=='Hunmin Lee' for b in authors))
            reference=next(b for b in blocks if b['sourceText'].startswith('[1]'))
            self.assertEqual(reference['sourceRole'],'bibliography');self.assertFalse(reference['translatable'])
            heading=next(b for b in blocks if b['sourceText']=='System Model')
            body_citation=next(b for b in blocks if b['sourceText'].startswith('[2]'))
            for block in [heading,body_citation]:
                self.assertNotIn('sourceRole',block);self.assertTrue(block['translatable'])

    def test_inline_scripts_keep_native_glyphs_without_flattening_prose(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'inline.pdf';folder=Path(temp)/'cache'
            with fitz.open() as pdf:
                page=pdf.new_page()
                page.insert_text((72,100),'Let ',fontname='tiro',fontsize=10)
                page.insert_text((89,100),'x',fontname='tiit',fontsize=10)
                page.insert_text((94,94),'2',fontname='tiro',fontsize=6)
                page.insert_text((94,104),'i',fontname='tiit',fontsize=6)
                page.insert_text((101,100),' denote the recorded signal.',fontname='tiro',fontsize=10)
                page.insert_text((72,135),'The theoretical statement remains ordinary prose.',fontname='tiit',fontsize=10)
                pdf.save(path)
            folder.mkdir()
            with fitz.open(path) as pdf:
                # TeX exports a paragraph as separate positioned spans. Use
                # the real native glyphs to verify the paragraph row join and
                # crop, independent of this synthetic producer's block IDs.
                raw={'lines':[line for b in pdf[0].get_text('dict')['blocks'] for line in b['lines']]}
                lines=_joined_lines(raw)
                line=next(row for row in lines if row['text'].startswith('Let'))
                protected,assets=_inline_math_line(pdf[0],line,folder,'scripts',0,lines)
            self.assertEqual(len(assets),1)
            math=assets[0]
            self.assertIn(math['placeholder'],protected)
            self.assertNotIn(math['placeholder'],line['text'])
            self.assertIn('2',math['sourceText']);self.assertIn('i',math['sourceText'])
            self.assertGreater(math['height'],10,'native crop must include both displaced scripts')
            self.assertGreater(math['baselineOffset'],0)
            self.assertEqual(math['visualAsset']['dpi'],288)
            self.assertTrue(Path(math['visualAsset']['path']).is_file())
            with fitz.open(path) as pdf:
                prose=next(row for row in lines if row['text'].startswith('The theoretical'))
                unchanged,assets=_inline_math_line(pdf[0],prose,folder,'prose',0,lines)
            self.assertEqual(assets,[],'italic sentences are not mathematical images')
            self.assertEqual(unchanged,prose['text'])

    def test_inline_crop_excludes_next_line_ink_without_clipping_fraction(self):
        with fitz.open() as pdf, fitz.open() as clean:
            page=pdf.new_page();reference=clean.new_page()
            for target in [page,reference]:
                target.insert_text((150,100),'1',fontsize=7)
                target.draw_line((149,103),(161,103),width=.5)
                target.insert_text((150,110),'g',fontsize=7)
            page.insert_text((145,123),'Next unrelated line.',fontsize=10)
            span=page.get_text('dict')['blocks'][-1]['lines'][0]['spans'][0]
            metric_rect=fitz.Rect(148,91,170,117)
            crop=_inline_crop(page,metric_rect,103,[{'baseline':123,'spans':[span]}])
            self.assertLess(crop.y1,metric_rect.y1)
            actual=page.get_pixmap(matrix=fitz.Matrix(4,4),clip=crop,alpha=False)
            expected=reference.get_pixmap(matrix=fitz.Matrix(4,4),clip=crop,alpha=False)
            self.assertEqual(actual.samples,expected.samples,'adjacent prose must not appear in inline math')
            full=reference.get_pixmap(matrix=fitz.Matrix(4,4),clip=metric_rect,alpha=False)
            occupied=[y for y in range(full.height)
                      if any(v<220 for v in full.samples[y*full.stride:(y+1)*full.stride])]
            self.assertGreaterEqual(crop.y1,(full.y+max(occupied)+1)/4,'the complete denominator must remain')

    def test_same_baseline_words_and_pdf_hyphenation_form_one_prose_paragraph(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'fragmented.pdf'
            with fitz.open() as pdf:
                page=pdf.new_page()
                for x, word in [(72,'geometry'),(140,'dissolves'),(214,'it'),(240,'entirely.')]:
                    page.insert_text((x,100),word,fontsize=10)
                page.insert_text((72,112),'C-AMC is, to our knowledge, the first frame-',fontsize=10)
                page.insert_text((72,124),'work to meet all three properties.',fontsize=10)
                pdf.save(path)
            text=' '.join(b['sourceText'] for b in translation_layout({'file':str(path)})['pages'][0]['blocks'])
            self.assertIn('geometry dissolves it entirely.',text)
            self.assertIn('the first framework',text)
            self.assertNotIn('\n',text)

    def test_visual_resources_keep_full_fraction_and_image_and_table(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'visuals.pdf';folder=Path(temp)/'cache'
            with fitz.open() as pdf:
                page=pdf.new_page()
                page.insert_text((72,72),'TABLE I: Comparison')
                for y in [85,103,136]:page.draw_line((72,y),(280,y))
                page.insert_text((80,98),'Method');page.insert_text((220,98),'Result')
                page.insert_text((80,119),'CNN');page.insert_text((220,119),'0.8')
                page.insert_text((80,132),'SVM');page.insert_text((220,132),'0.7')
                page.insert_text((72,175),'With x = 1, the method compares recorded samples.')
                page.insert_text((90,205),'E =');page.insert_text((140,200),'a + b')
                page.draw_line((138,205),(177,205));page.insert_text((150,220),'c')
                page.insert_text((270,205),'(1)')
                pix=fitz.Pixmap(fitz.csRGB,fitz.IRect(0,0,30,20),False);pix.clear_with(220)
                page.insert_image(fitz.Rect(72,260,200,330),stream=pix.tobytes('png'))
                pdf.save(path)
            page=translation_layout({'file':str(path),'outputDir':str(folder)})['pages'][0]
            self.assertTrue(Path(page['visualAsset']['path']).is_file())
            self.assertEqual(page['visualAsset']['dpi'],216)
            table=next(b for b in page['blocks'] if b['kind']=='table')
            image=next(b for b in page['blocks'] if b['kind']=='image')
            equation=next(b for b in page['blocks'] if b['kind']=='formula' and '(1)' in b['sourceText'])
            self.assertIn('c',equation['sourceText'])
            with fitz.open(path) as pdf:
                rect=fitz.Rect(equation['position']['rects'][0])*pdf[0].transformation_matrix
                denominator=pdf[0].search_for('c')[-1]
                self.assertGreaterEqual(rect.y1,denominator.y1)
            for block in [table,image,equation]:
                self.assertEqual(block['visualAsset']['dpi'],216)
                self.assertTrue(Path(block['visualAsset']['path']).is_file())
            prose=next(b for b in page['blocks'] if b['sourceText'].startswith('With x'))
            self.assertEqual(prose['kind'],'text','inline symbols cannot swallow ordinary prose')

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
            self.assertEqual(result['extractorVersion'],'pymupdf-translation-layout-v5')
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
