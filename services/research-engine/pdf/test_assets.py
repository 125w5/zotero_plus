import tempfile, unittest, json
from unittest.mock import patch
from pathlib import Path
import pymupdf as fitz
from assets import main, non_research_image, formula_regions, caption_runs, figure_region, graphic_regions, caption_label


def text_block(text, bbox, font='CMMI10', size=10, baseline=None):
    span=dict(text=text,bbox=bbox,font=font,size=size,
              origin=(bbox[0],baseline if baseline is not None else bbox[3]-2))
    return dict(type=0,bbox=bbox,lines=[dict(bbox=bbox,spans=[span])])


class LayoutPage:
    rect=fitz.Rect(0,0,612,792)
    def __init__(self,blocks):self.blocks=blocks
    def get_text(self,kind):return dict(blocks=self.blocks)
    def get_drawings(self):return []

class AssetTests(unittest.TestCase):
    def test_typographic_figure_caption_without_colon_is_not_lost(self):
        for text, label in [('Fig.\u202f1\u2002 Search framework\n', 'Fig. 1'), ('Fig. 30 A four-panel evaluation\n', 'Fig. 30'), ('Table 1 Summary of applications\n','Table 1'), ('TABLE II: Existing methods\n','TABLE II')]:
            self.assertEqual(caption_label(text),label)
        self.assertIsNone(caption_label('Fig. 1 shows how the neural network processes inputs.'))
        self.assertIsNone(caption_label('The following paragraph discusses Fig. 2.'))

    def test_actual_springer_review_has_all_30_figures_and_five_tables(self):
        fixture=Path(__file__).resolve().parents[3]/'test/node/fixtures/deep-learning-review-caption-layout.json'
        layout=json.loads(fixture.read_text(encoding='utf-8'))
        labels=[caption_label(block['text']) for page in layout for block in page['blocks']]
        figures=[label for label in labels if label and label.startswith('Fig.')]
        tables=[label for label in labels if label and label.startswith('Table')]
        self.assertEqual(figures,[f'Fig. {number}' for number in range(1,31)])
        self.assertEqual(sorted(tables),[f'Table {number}' for number in range(1,6)])

    def test_proof_white_canvas_does_not_hide_whole_multilevel_figure(self):
        with fitz.open() as d:
            p=d.new_page(width=612,height=792)
            p.draw_rect((20,30,610,445),fill=(1,1,1),color=None)
            p.draw_rect((54,60,560,195),fill=(.99,.94,.95),color=None)
            p.draw_rect((54,198,270,366),fill=(.91,.95,.88),color=None)
            p.draw_rect((298,199,534,366),fill=(.88,.95,.97),color=None)
            p.draw_line((260,280),(315,280))
            p.insert_text((64,86),'Satellite: Semantic Decoder',fontsize=9)
            p.insert_text((64,345),'Preprocessing and receiver',fontsize=9)
            p.insert_text((49,399),'Fig. 2. Overview of the two-level communication framework.',fontsize=9)
            p.insert_text((49,424),'The following body paragraph must never join the figure.',fontsize=9)
            for i in range(40):p.insert_text((8,50+i*17),str(i+1),fontsize=9)
            blocks=[b for b in p.get_text('blocks') if b[6]==0]
            cap=next(b for b in blocks if b[4].startswith('Fig. 2.'))
            old=p.cluster_drawings();self.assertTrue(any(r.y1>cap[3] for r in old))
            region=figure_region(p,cap,graphic_regions(p),[],blocks)
            self.assertLessEqual(region.y0,60);self.assertGreaterEqual(region.y1,366)
            self.assertLessEqual(region.x0,54);self.assertGreaterEqual(region.x1,560)
            self.assertGreater(region.x0,30,'proof line numbers are outside the crop')
            self.assertLess(region.y1,cap[1],'caption and neighbouring paragraph are outside the crop')

    def test_stacked_disconnected_panels_share_their_printed_caption(self):
        with fitz.open() as d:
            p=d.new_page()
            p.draw_rect((70,110,280,190));p.draw_rect((70,212,280,302))
            p.insert_text((70,197),'(a)',fontsize=8);p.insert_text((70,313),'(b)',fontsize=8)
            p.insert_text((70,335),'Fig. 1. Two complementary experiments.',fontsize=9)
            blocks=[b for b in p.get_text('blocks') if b[6]==0];cap=blocks[-1]
            region=figure_region(p,cap,graphic_regions(p),[],blocks)
            self.assertLess(region.y0,110);self.assertGreater(region.y1,313)

    def test_prose_and_previous_caption_bound_separate_figure_regions(self):
        with fitz.open() as d:
            p=d.new_page()
            p.draw_rect((60,80,285,170));p.insert_text((60,190),'Fig. 1. Previous diagram.',fontsize=9)
            p.draw_rect((60,212,285,240));p.draw_rect((60,270,285,340))
            paragraph='A detailed paragraph separates the displayed diagram from the subsequent experimental results and discusses their assumptions.'
            p.insert_textbox((60,242,285,268),paragraph,fontsize=7)
            p.insert_text((60,370),'Fig. 2. Current diagram.',fontsize=9)
            blocks=[b for b in p.get_text('blocks') if b[6]==0];cap=next(b for b in blocks if b[4].startswith('Fig. 2.'))
            region=figure_region(p,cap,graphic_regions(p),[],blocks)
            self.assertGreaterEqual(region.y0,267,'prose blocks cannot bridge independent graphics')
            self.assertGreater(region.y1,340)

    def test_large_coloured_panel_and_stroked_white_plot_are_not_blank_canvases(self):
        with fitz.open() as d:
            p=d.new_page()
            p.draw_rect((45,70,550,300),fill=(.94,.97,1),color=None)
            p.draw_rect((55,330,545,560),fill=(1,1,1),color=(0,0,0))
            regions=graphic_regions(p)
            self.assertTrue(any(r.contains(fitz.Rect(45,70,550,300)) for r in regions))
            self.assertTrue(any(r.contains(fitz.Rect(55,330,545,560)) for r in regions))

    def test_white_parent_for_tall_multi_panel_figure_remains_when_caption_is_below(self):
        with fitz.open() as d:
            p=d.new_page()
            p.draw_rect((310,80,565,620),fill=(1,1,1),color=None)
            for y in [90,280,470]:p.draw_rect((320,y,550,y+105))
            p.insert_text((312,640),'Fig. 3. Three datasets and their convergence.',fontsize=8)
            blocks=[b for b in p.get_text('blocks') if b[6]==0];cap=blocks[-1]
            region=figure_region(p,cap,graphic_regions(p,blocks),[],blocks)
            self.assertLess(region.y0,90);self.assertGreater(region.y1,620)
            self.assertGreater(region.x0,300,'adjacent left text column must remain outside')

    def test_exported_plot_canvas_overlaps_caption_but_does_not_force_a_wide_fallback(self):
        with fitz.open() as d:
            p=d.new_page()
            p.draw_rect((55,60,295,232),fill=(1,1,1),color=None)
            p.draw_rect((75,74,284,208))
            p.insert_text((54,231),'Fig. 4. The reward under environment steps.',fontsize=8)
            blocks=[b for b in p.get_text('blocks') if b[6]==0];cap=blocks[-1]
            region=figure_region(p,cap,graphic_regions(p,blocks),[],blocks)
            self.assertGreater(region.x0,45);self.assertLess(region.y0,60)
            self.assertLess(region.y1,cap[1]);self.assertGreater(region.y1,208)

    def test_nearby_short_prose_in_other_column_cannot_expand_figure_sideways(self):
        with fitz.open() as d:
            p=d.new_page()
            p.draw_rect((312,60,552,270))
            p.insert_text((50,110),'This short sentence is still prose in the left column.',fontsize=9)
            p.insert_text((312,290),'Fig. 3. A protected semantic module.',fontsize=9)
            blocks=[b for b in p.get_text('blocks') if b[6]==0];cap=blocks[-1]
            region=figure_region(p,cap,graphic_regions(p,blocks),[],blocks)
            self.assertGreater(region.x0,300)

    def test_table_above_current_plot_cannot_merge_into_its_crop(self):
        with fitz.open() as d:
            p=d.new_page()
            p.insert_text((335,69),'TABLE II: Models comparison.',fontsize=8)
            p.draw_rect((319,85,556,122));p.insert_text((325,102),'Small model     Large model',fontsize=8)
            p.draw_rect((321,136,547,349))
            p.insert_text((312,378),'Fig. 9. Comparison of the link quality.',fontsize=8)
            blocks=[b for b in p.get_text('blocks') if b[6]==0];cap=blocks[-1]
            region=figure_region(p,cap,graphic_regions(p,blocks),[],blocks)
            self.assertGreaterEqual(region.y0,133,'neighbouring table belongs to its own caption')
            self.assertGreater(region.y1,349)

    def test_separate_multiline_legend_above_image_keeps_all_original_lines(self):
        with fitz.open() as source:
            source.new_page(width=300,height=160).draw_rect((2,2,298,158))
            png=source[0].get_pixmap().tobytes('png')
        with fitz.open() as d:
            p=d.new_page();p.insert_image((55,96,560,245),stream=png,keep_proportion=False)
            p.insert_text((85,70),'Path of Ground Truth\nPath of Continual Semantic Anchors\nPath of Two Anchors\nPath of Only Text',fontsize=7)
            p.insert_text((55,270),'Fig. 4. Semantic and pixel domains.',fontsize=8)
            blocks=[b for b in p.get_text('blocks') if b[6]==0];cap=next(b for b in blocks if b[4].startswith('Fig. 4.'))
            region=figure_region(p,cap,graphic_regions(p,blocks),p.get_image_info(),blocks)
            self.assertLess(region.y0,65,'top legend line survives, not only the last intersecting line')
            self.assertGreater(region.y1,244)

    def test_multiline_formula_collects_separate_blocks_and_isolated_number(self):
        blocks=[text_block('x = a + b',(100,55,380,80)),
                text_block('c / d',(355,55,510,82)),
                text_block('y = c + d',(100,85,380,109)),
                text_block('+ e / f',(220,112,507,137)),
                text_block('(6)',(546,92,558,102),'Times-Roman'),
                text_block('The following paragraph explains the equation and its data.',
                           (54,160,558,184),'Times-Roman')]
        regions=formula_regions(LayoutPage(blocks))
        self.assertEqual(len(regions),1)
        rect,kind,label,*_=regions[0]
        self.assertEqual((kind,label),('formula','Equation 6'))
        self.assertLess(rect.y0,55);self.assertGreater(rect.y1,137)
        self.assertLess(rect.x0,100);self.assertGreater(rect.x1,558)
        self.assertLess(rect.y1,160,'do not include following body text')

    def test_two_line_formula_keeps_upper_line_and_excludes_previous_formula(self):
        blocks=[text_block('q = 1',(120,269,225,293)),
                text_block('(4)',(288,276,300,286),'Times-Roman'),
                text_block('The link probability has the following two cases.',
                           (54,299,300,345),'Times-Roman'),
                text_block('P = a',(94,347,209,363)),
                text_block('P = b',(94,359,260,380)),
                text_block('(5)',(288,359,300,369),'Times-Roman'),
                text_block('The explanation must not be part of the formula image.',
                           (54,384,300,420),'Times-Roman')]
        regions={r[2]:r[0] for r in formula_regions(LayoutPage(blocks))}
        self.assertEqual(set(regions),{'Equation 4','Equation 5'})
        rect=regions['Equation 5']
        self.assertLess(rect.y0,347);self.assertGreaterEqual(rect.y0,345)
        self.assertGreater(rect.y1,380);self.assertLess(rect.y1,384)

    def test_text_font_superscripts_preserve_both_formula_rows_and_are_not_masked(self):
        # A real publisher separates P + V2V/V2I from the rest of each row.
        # Treating that short scripted fragment as prose excluded both rows,
        # leaving only the tiny F and the equation number in the screenshot.
        parts=[]
        for y,script in [(358.6,'V2V'),(375.75,'V2I')]:
            base=text_block('P',(94,y-9,101,y+2),size=10,baseline=y)
            sup=text_block(script,(102,y-10,115,y-3),'Times-Roman',7,baseline=y-4)
            base['lines'][0]['spans']+=sup['lines'][0]['spans']
            base['lines'][0]['bbox']=base['bbox']=(94,y-10,115,y+2)
            parts.extend([base,text_block('LoS (d) = exp(-x)',(100,y-11,260,y+5),baseline=y),
                          text_block('F',(239,y-6,243,y-1),'CMR5',5,baseline=y-2)])
        blocks=[text_block('The two link probabilities are given by',
                           (54,333,300,345),'Times-Roman',baseline=343),
                *parts,text_block('(5)',(288,359,300,369),'Times-Roman',baseline=367),
                text_block('The explanation is the empirical model',
                           (54,384,300,400),'Times-Roman',baseline=395)]
        masks={};regions=formula_regions(LayoutPage(blocks),mask_regions=masks)
        self.assertEqual(len(regions),1)
        rect,_,label,caption,*_=regions[0]
        self.assertEqual(label,'Equation 5')
        for part in parts:
            bound=fitz.Rect(part['bbox'])
            self.assertTrue(rect.contains(bound),'all original math and scripts must survive')
            self.assertFalse(any(fitz.Rect(mask).intersects(bound)
                                 for mask in masks[(label,tuple(rect))]))
        self.assertIn('V2V',caption);self.assertIn('V2I',caption)
        self.assertGreaterEqual(rect.y0,345);self.assertLess(rect.y1,384)

    def test_equation_columns_and_lettered_constraints_stay_separate(self):
        blocks=[text_block('P = a',(90,348,260,378)),
                text_block('(5)',(288,359,300,369),'Times-Roman'),
                text_block('min a',(390,330,500,350)),
                text_block('(8a)',(541,335,558,346),'Times-Roman'),
                text_block('a <= b',(375,358,500,370)),
                text_block('(8b)',(541,360,558,370),'Times-Roman')]
        regions={r[2]:r[0] for r in formula_regions(LayoutPage(blocks))}
        self.assertEqual(set(regions),{'Equation 5','Equation 8a','Equation 8b'})
        self.assertLess(regions['Equation 5'].x1,310)
        self.assertGreater(regions['Equation 8a'].x0,350)
        self.assertLess(regions['Equation 8a'].y1,358)
        self.assertGreater(regions['Equation 8b'].y0,350)

    def test_inline_number_and_prose_wrap_are_not_equation_anchors(self):
        prose=text_block('As discussed by the authors in equation (5)',
                         (54,100,300,112),'Times-Roman')
        wrapped=text_block('(5)',(54,114,66,124),'Times-Roman')
        prose['lines']+=wrapped['lines'];prose['bbox']=(54,100,300,124)
        blocks=[prose,text_block('a = b',(80,130,240,142))]
        self.assertEqual(formula_regions(LayoutPage(blocks)),[])

    def test_bottom_number_keeps_large_upper_operator_after_prose_boundary(self):
        blocks=[text_block('q = r',(70,430,230,460)),
                text_block('(10)',(288,450,300,460),'Times-Roman'),
                text_block('The value function is subsequently given by this display.',
                           (54,466,300,478),'Times-Roman'),
                text_block('H - 1',(135,480,160,498),'CMEX10'),
                text_block('V = sum',(54,489,307,510)),
                text_block('W = E',(54,520,270,545))]
        number=text_block('(11)',(288,544,300,554),'Times-Roman')
        body=text_block('where the following text explains the symbols and controls.',
                        (54,557,300,579),'Times-Roman')
        number['lines']+=body['lines'];number['bbox']=(54,544,300,579)
        blocks.append(number)
        regions={r[2]:r[0] for r in formula_regions(LayoutPage(blocks))}
        self.assertEqual(set(regions),{'Equation 10','Equation 11'})
        self.assertLess(regions['Equation 11'].y0,480)
        self.assertGreaterEqual(regions['Equation 11'].y0,478)
        self.assertLess(regions['Equation 11'].y1,557)

    def test_paragraph_and_equation_in_same_pdf_block_are_split_at_original_lines(self):
        body=text_block('The transmitter extracts the compact symbols from the video.',
                        (312,410,563,421),'Times-Roman')
        formula=text_block('Z = E(X)',(407,473,465,485))
        number=text_block('(6)',(551,473,563,483),'Times-Roman')
        body['lines']+=text_block('This semantic encoding process can be denoted as',
                                  (312,449,563,471),'Times-Roman')['lines']
        body['lines']+=formula['lines']+number['lines'];body['bbox']=(312,410,563,485)
        regions=formula_regions(LayoutPage([body]))
        self.assertEqual(len(regions),1)
        rect,_,label,caption,*_=regions[0]
        self.assertEqual(label,'Equation 6')
        self.assertGreaterEqual(rect.y0,471);self.assertGreater(rect.y1,485)
        self.assertGreater(rect.x0,400);self.assertNotIn('transmitter',caption)

    def test_each_lettered_constraint_keeps_its_own_number_inside_shared_pdf_block(self):
        objective=text_block('min x = sum',(50,660,250,686))
        limit=text_block('t=1',(90,686,102,693),'CMR7',7)
        lines=[]
        for number,text,y in [('14a',None,694),('14b','a <= b',709),
                              ('14c','t <= T',724),('14d','t = a + b',739)]:
            if text:lines+=text_block(text,(76,y,194,y+12))['lines']
            lines+=text_block('('+number+')',(279,y,300,y+10),'Times-Roman')['lines']
        shared=dict(type=0,bbox=(76,694,300,751),lines=lines)
        regions={r[2]:r for r in formula_regions(LayoutPage([objective,limit,shared]))}
        self.assertEqual(set(regions),{'Equation 14a','Equation 14b','Equation 14c','Equation 14d'})
        self.assertLess(regions['Equation 14a'][0].y0,660)
        self.assertGreaterEqual(regions['Equation 14a'][0].y1,704)
        for label,low,high in [('Equation 14b',709,721),('Equation 14c',724,736),('Equation 14d',739,751)]:
            rect=regions[label][0]
            self.assertLess(rect.y0,low);self.assertGreaterEqual(rect.y1,high)
        self.assertLess(regions['Equation 14b'][0].y1,724)
        self.assertGreater(regions['Equation 14c'][0].y0,721)
        self.assertLess(regions['Equation 14c'][0].y1,739)
        self.assertGreater(regions['Equation 14d'][0].y0,736)

    def test_isolated_inline_equal_on_prose_baseline_cannot_join_previous_equation(self):
        blocks=[text_block('s = root(a)',(386,591,473,624)),
                text_block('(7)',(551,602,563,612),'Times-Roman'),
                text_block('We define the channel bandwidth ratio as eta',
                           (312,630,546,640),'Times-Roman',baseline=638),
                text_block('=',(555,630,563,640),'CMR10',baseline=638)]
        region=formula_regions(LayoutPage(blocks))[0][0]
        self.assertLess(region.y1,630)

    def test_short_where_explanation_with_mostly_math_spans_is_prose(self):
        blocks=[text_block('s = root(a)',(364,557,471,584)),
                text_block('(7)',(551,567,563,577),'Times-Roman')]
        where=text_block('where ',(312,588,338,600),'Times-Roman',baseline=598)
        where['lines'][0]['spans']+=text_block('n = CN(0,v), sigma = N B',(338,588,465,603))['lines'][0]['spans']
        where['lines'][0]['spans']+=text_block(' and',(465,588,489,600),'Times-Roman',baseline=598)['lines'][0]['spans']
        where['bbox']=where['lines'][0]['bbox']=(312,588,489,603)
        blocks.append(where)
        regions=formula_regions(LayoutPage(blocks))
        self.assertLess(regions[0][0].y1,588)
        self.assertNotIn('where',regions[0][3])

    def test_display_extension_origin_is_not_mistaken_for_nearby_prose_baseline(self):
        blocks=[text_block('The following display is the encoded representation.',
                           (312,460,386,471),'Times-Roman',baseline=469),
                text_block('Z = E',(408,473,439,485),baseline=481),
                text_block('(', (441,469,447,479),'CMEX10',baseline=469.5),
                text_block('X)',(447,473,462,484),baseline=481),
                text_block('(6)',(551,473,563,483),'Times-Roman',baseline=481)]
        region=formula_regions(LayoutPage(blocks))[0][0]
        self.assertLessEqual(region.y0,469)
        self.assertGreater(region.y1,485)

    def test_plain_font_fraction_digits_and_scripts_remain_in_display(self):
        blocks=[text_block('x =',(94,347,118,360),'Times-Roman'),
                text_block('1',(121,343,127,350),'Times-Roman',7),
                text_block('y',(121,358,127,365),'Times-Roman',7),
                text_block('(5)',(288,349,300,359),'Times-Roman')]
        region=formula_regions(LayoutPage(blocks))[0][0]
        self.assertLess(region.y0,343);self.assertGreater(region.y1,365)

    def test_piecewise_conditions_share_math_baselines_without_becoming_inline_prose(self):
        blocks=[text_block('A[t+1] =',(54,657,103,668),baseline=665),
                text_block('{',(106,640,114,663),'CMEX10',baseline=641),
                text_block('{',(106,670,114,683),'CMEX10',baseline=671),
                text_block('t - G + 1',(115,640,181,653),baseline=650),
                text_block('v receives from pair m,',(191,643,307,653),'Times-Roman',baseline=650),
                text_block('t - H + 1',(115,654,178,668),baseline=664),
                text_block('v receives from pair z,',(191,657,307,668),'Times-Roman',baseline=664),
                text_block('A[t] + 1',(115,671,156,683),baseline=679),
                text_block('otherwise',(191,672,232,682),'Times-Roman',baseline=679),
                text_block('(7)',(288,683,300,693),'Times-Roman',baseline=690),
                text_block('The next paragraph describes the communication model.',
                           (54,700,300,723),'Times-Roman')]
        regions=formula_regions(LayoutPage(blocks))
        self.assertEqual(len(regions),1)
        rect,_,_,caption,*_=regions[0]
        self.assertLess(rect.x0,54);self.assertGreater(rect.x1,307)
        self.assertLess(rect.y0,640);self.assertGreater(rect.y1,693)
        self.assertIn('t - G + 1',caption);self.assertIn('t - H + 1',caption)
        self.assertIn('v receives from pair m',caption);self.assertIn('otherwise',caption)
        self.assertLess(rect.y1,700)

    def test_fragmented_piecewise_brace_keeps_conditions_beyond_equation_number(self):
        blocks=[text_block('A[t+1] =',(54,657,103,668),baseline=665),
                *[text_block('{',(106,y,114,y+10),'CMEX10',baseline=y+.6)
                  for y in [640,649,652,670,673]],
                text_block('t - G + 1',(115,640,181,653),baseline=650),
                text_block('v receives from V2I pair m,',(191,643,307,653),'Times-Roman',baseline=650),
                text_block('t - H + 1',(115,654,178,668),baseline=664),
                text_block('v receives from V2V pair z,',(191,657,307,668),'Times-Roman',baseline=664),
                text_block('A[t] + 1',(115,671,156,683),baseline=679),
                text_block('otherwise',(191,672,232,682),'Times-Roman',baseline=679),
                text_block('(7)',(288,683,300,693),'Times-Roman',baseline=690),
                text_block('Neighbouring column prose must remain outside the crop.',
                           (312,649,558,660),'Times-Roman',baseline=657)]
        regions=formula_regions(LayoutPage(blocks))
        self.assertEqual(len(regions),1)
        rect,_,_,caption,*_=regions[0]
        self.assertGreater(rect.x1,307)
        self.assertLess(rect.x1,312)
        self.assertLess(rect.y0,640)
        self.assertGreater(rect.y1,693)
        self.assertIn('v receives from V2I pair m,',caption)
        self.assertIn('v receives from V2V pair z,',caption)
        self.assertNotIn('Neighbouring',caption)

    def test_tex_roman_explanation_and_its_inline_symbols_are_not_display_math(self):
        blocks=[text_block('psi(z) = z + t',(85,158,262,173),baseline=168),
                text_block('(21)',(283,160,300,170),'Times-Roman',baseline=168),
                text_block('=',(93,179,101,189),'CMR10',baseline=187),
                text_block('[',(111,178,115,188),'CMEX10',baseline=178.6),
                text_block('z0,z1',(115,179,155,190),baseline=187),
                text_block(']',(156,178,160,188),'CMEX10',baseline=178.6),
                text_block('is the condition input, z',(168,179,282,190),'CMR10',baseline=187),
                text_block('=',(292,179,300,189),'CMR10',baseline=187)]
        regions=formula_regions(LayoutPage(blocks))
        self.assertEqual(len(regions),1)
        self.assertLess(regions[0][0].y1,179)
        self.assertNotIn('condition',regions[0][3])

    def test_bold_latex_variable_and_prime_remain_at_display_left_edge(self):
        variable=text_block('x',(100,448,106,460),'CMBX10',baseline=457)
        variable['lines'][0]['spans']+=text_block("'",(106,448,109,455),'CMBSY7',7,453)['lines'][0]['spans']
        variable['bbox']=variable['lines'][0]['bbox']=(100,448,109,460)
        blocks=[variable,text_block('j + r = x',(109,448,183,461),baseline=457),
                text_block('(25)',(283,450,300,460),'Times-Roman',baseline=457)]
        region=formula_regions(LayoutPage(blocks))[0]
        self.assertLess(region[0].x0,100)
        self.assertIn("x'",region[3])

    def test_separate_short_prose_words_exclude_their_inline_bold_symbol(self):
        blocks=[text_block('d f = eta J g',(85,725,263,740),baseline=736),
                text_block('(12)',(283,729,300,739),'Times-Roman',baseline=736),
                text_block('which',(49,747,73,757),'Times-Roman',baseline=755),
                text_block('is',(81,747,88,757),'Times-Roman',baseline=755),
                text_block('strictly',(96,747,124,757),'Times-Roman',baseline=755),
                text_block('positive',(132,747,163,757),'Times-Roman',baseline=755),
                text_block('except',(172,747,197,757),'Times-Roman',baseline=755),
                text_block('when',(205,747,227,757),'Times-Roman',baseline=755),
                text_block('g',(235,747,241,757),'CMBX10',baseline=755),
                text_block('lies',(249,747,263,757),'Times-Roman',baseline=755)]
        region=formula_regions(LayoutPage(blocks))[0]
        self.assertLess(region[0].y1,747)
        self.assertNotIn('\ng',region[3])

    def test_formula_preview_removes_disjoint_footer_ink_without_changing_source(self):
        from assets import filehash
        with tempfile.TemporaryDirectory() as temp:
            pdf=Path(temp)/'footer-near-equation.pdf'
            with fitz.open() as d:
                p=d.new_page(width=600,height=800)
                p.insert_text((80,120),'x = 1',fontsize=12)
                p.insert_text((170,135),'y',fontsize=12)
                p.insert_text((250,120),'(4)',fontsize=12)
                p.insert_text((5,139),'journal footer metadata',fontsize=8)
                d.save(pdf)
            before=filehash(pdf)
            result=main(dict(operation='assets-index',pdf=str(pdf),cacheRoot=str(Path(temp)/'cache')))
            asset=next(a for a in result['assets'] if a['kind']=='formula')
            self.assertTrue(asset['excludedTextRects'])
            clean=fitz.Pixmap(asset['path'])
            with fitz.open(pdf) as d:
                raw=d[0].get_pixmap(matrix=fitz.Matrix(6,6),clip=fitz.Rect(asset['bbox']),alpha=False)
                self.assertIn('journal footer metadata',d[0].get_text())
            mask=(fitz.Rect(asset['excludedTextRects'][0])*fitz.Matrix(6,6)).irect & raw.irect
            pixels=[(x-raw.x,y-raw.y) for y in range(mask.y0,mask.y1) for x in range(mask.x0,mask.x1)]
            self.assertTrue(any(min(raw.pixel(x,y))<128 for x,y in pixels))
            self.assertTrue(all(min(clean.pixel(x,y))==255 for x,y in pixels))
            manual=main(dict(operation='assets-crop',pdf=str(pdf),cacheRoot=str(Path(temp)/'cache'),asset=asset,bbox=asset['bbox']))
            manual_image=fitz.Pixmap(manual['path'])
            self.assertTrue(any(min(manual_image.pixel(x,y))<128 for x,y in pixels),
                            'an explicit user crop retains its original pixels')
            self.assertEqual(filehash(pdf),before)

    def test_caption_scripts_come_from_pdf_baselines_and_keep_safe_text(self):
        blocks=[text_block('Fig. 1. Response A',(54,91,140,102),'Times-Roman',10,100),
                text_block('v',(140,100,145,108),'Times-Roman',7,105),
                text_block(' + q',(146,91,172,102),'CMMI10',10,100),
                text_block('2',(172,87,176,94),'Times-Roman',7,92),
                text_block(' <script>\x01',(178,91,220,102),'Times-Roman',10,100)]
        runs=caption_runs(dict(blocks=blocks),(54,87,220,108))
        self.assertTrue(any(r==dict(text='v',script='sub') for r in runs))
        self.assertTrue(any(r==dict(text='2',script='super') for r in runs))
        self.assertTrue(any(r.get('fontStyle')=='italic' and 'q' in r['text'] for r in runs))
        text=''.join(r['text'] for r in runs)
        self.assertIn('<script>',text,'renderer receives plain text, never generated HTML')
        self.assertNotIn('\x01',text)
        self.assertNotIn('^',text);self.assertNotIn('_',text)

    def test_equation_version_upgrade_retains_old_crops_and_manual_assets(self):
        with tempfile.TemporaryDirectory() as temp:
            pdf=Path(temp)/'equation.pdf'
            with fitz.open() as d:
                p=d.new_page();p.insert_text((110,200),'x = a + b')
                p.insert_text((288,200),'(5)');d.save(pdf)
            request=dict(operation='assets-index',pdf=str(pdf),cacheRoot=str(Path(temp)/'cache'))
            with patch('assets.VERSION','formula-test-old'):
                old=main(request)
            formula=next(a for a in old['assets'] if a['kind']=='formula')
            manual=main(dict(request,operation='assets-crop',asset=formula,bbox=formula['bbox']))
            upgraded=main(request)
            self.assertFalse(upgraded['cacheHit'])
            self.assertTrue(Path(formula['path']).is_file(),'upgrading cannot delete the old crop')
            self.assertTrue(any(a['id']==manual['id'] and a['userModified'] for a in upgraded['assets']))
            self.assertTrue(main(request)['cacheHit'])

    def test_cover_skips_submission_form_and_file_list_without_changing_pdf(self):
        from assets import filehash
        with tempfile.TemporaryDirectory() as temp:
            pdf=Path(temp)/'submission.pdf'
            with fitz.open() as d:
                p=d.new_page();p.insert_text((70,70),
                    'Submission ID 123\nManuscript ID 123\n'
                    'Submission Version Initial\nPDF Generation 2026\nAuthors Test Author')
                p=d.new_page();p.insert_text((70,70),
                    'Files for peer review\nAll files submitted by the author for peer review '
                    'are listed below.\nName\nType of File\nSize\nPage\nmain.pdf\nMain Document - PDF')
                p=d.new_page();p.insert_text((65,80),'A real article title')
                p.insert_text((65,120),'Abstract: Evidence from an actual experiment.')
                p.insert_text((65,210),'I. INTRODUCTION')
                p.draw_line((65,500),(490,500))
                p.insert_text((65,720),'Author footnote and equation (1).',fontsize=7)
                d.save(pdf)
            before=filehash(pdf)
            result=main(dict(operation='assets-cover',pdf=str(pdf),cacheRoot=str(Path(temp)/'cache')))
            self.assertEqual(result['pageIndex'],2)
            self.assertEqual([v['reason'] for v in result['skippedPages']],
                             ['submission-form','submission-file-list'])
            self.assertLess(result['bbox'][0],65);self.assertGreater(result['bbox'][0],30)
            self.assertGreater(result['bbox'][3],720)
            self.assertLess(result['bbox'][3],800)
            self.assertGreater(result['dpi'],150)
            self.assertLessEqual(max(result['width'],result['height']),2000)
            self.assertTrue(Path(result['path']).is_file());self.assertTrue(Path(result['thumbnail']).is_file())
            self.assertEqual(filehash(pdf),before)
            full=main(dict(operation='assets-page',pdf=str(pdf),pageIndex=0,cacheRoot=str(Path(temp)/'cache')))
            with fitz.open(pdf) as d:self.assertEqual(full['bbox'],list(d[0].rect))

    def test_cover_scholarone_and_conservative_article_detection(self):
        from assets import cover_sheet_reason
        with fitz.open() as d:
            p=d.new_page();p.insert_text((60,70),
                'Journal: IEEE Transactions on Communications\nManuscript ID TCOM-123\n'
                'Manuscript Type: Transactions Paper Submissions\n'
                'Date Submitted by the Author: 2026\nComplete List of Authors: Test Author\n'
                'Under review for possible publication in')
            self.assertEqual(cover_sheet_reason(p),'submission-form')
            p=d.new_page();p.insert_text((60,70),
                'Submission systems in academic publishing\nAbstract: We study editorial workflows.\n'
                'Submission ID 123\nManuscript ID 123\nSubmission Version Initial\nPDF Generation 2026')
            self.assertIsNone(cover_sheet_reason(p))
            p=d.new_page();p.insert_text((60,70),
                'IEEE Transactions on Communications\nManuscript ID TCOM-123\nSubmission ID 123\n'
                'This article evaluates a network protocol.\nIntroduction')
            self.assertIsNone(cover_sheet_reason(p),'identifiers alone must not hide an article')

    def test_cover_crop_preserves_scanned_content_and_annotations_stay_out(self):
        with tempfile.TemporaryDirectory() as temp:
            pdf=Path(temp)/'scan.pdf'
            with fitz.open() as source:
                p=source.new_page(width=600,height=800)
                p.insert_text((80,95),'Scanned research title',fontsize=20)
                p.draw_rect((80,270,520,520))
                p.insert_text((80,720),'Important footnote.',fontsize=8)
                image=p.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False).tobytes('png')
            with fitz.open() as d:
                p=d.new_page(width=600,height=800);p.insert_image(p.rect,stream=image)
                note=p.add_freetext_annot((5,5,120,30),'Reader comment',fontsize=10)
                note.update();d.save(pdf)
            result=main(dict(operation='assets-cover',pdf=str(pdf),cacheRoot=str(Path(temp)/'cache')))
            self.assertEqual(result['pageIndex'],0)
            self.assertGreater(result['bbox'][0],50);self.assertGreater(result['bbox'][1],40)
            self.assertLess(result['bbox'][2],560);self.assertGreater(result['bbox'][3],720)

    def test_cover_removes_editorial_gutter_from_preview_but_keeps_paper_footnotes(self):
        from assets import filehash
        with tempfile.TemporaryDirectory() as temp:
            pdf=Path(temp)/'proof.pdf'
            with fitz.open() as d:
                p=d.new_page();p.insert_text((70,70),
                    'Journal: A Research Journal\nManuscript ID 123\nManuscript Type: Paper\n'
                    'Date Submitted by the Author: 2026\nUnder review for possible publication in')
                p=d.new_page()
                p.insert_text((8,15),'Page 1 of 12')
                p.insert_text((200,15),'Under review for possible publication in')
                for i in range(30):p.insert_text((8,60+i*20),str(i+1),fontsize=9)
                p.insert_text((75,90),'Research title')
                p.insert_text((75,150),'Abstract: Testable evidence.')
                p.draw_rect((75,200,500,500))
                p.insert_text((75,720),'Author affiliation and scientific footnote.',fontsize=7)
                p.insert_text((200,810),'A Research Journal')
                d.save(pdf)
            before=filehash(pdf)
            result=main(dict(operation='assets-cover',pdf=str(pdf),cacheRoot=str(Path(temp)/'cache')))
            self.assertEqual(result['removedEditorialMarks'],33)
            self.assertGreater(result['bbox'][0],50);self.assertGreater(result['bbox'][1],50)
            self.assertGreater(result['bbox'][3],720);self.assertLess(result['bbox'][3],790)
            self.assertEqual(filehash(pdf),before)
            with fitz.open(pdf) as d:
                self.assertIn('Page 1 of 12',d[1].get_text())
                self.assertIn('Author affiliation',d[1].get_text())

    def test_cover_cache_checks_images_fingerprint_and_own_version(self):
        with tempfile.TemporaryDirectory() as temp:
            pdf=Path(temp)/'paper.pdf'
            with fitz.open() as d:
                d.new_page().insert_text((70,70),'A research title');d.save(pdf)
            request=dict(operation='assets-cover',pdf=str(pdf),cacheRoot=str(Path(temp)/'cache'))
            first=main(request);self.assertFalse(first['cacheHit'])
            second=main(request);self.assertTrue(second['cacheHit']);self.assertEqual(second['path'],first['path'])
            Path(second['thumbnail']).unlink()
            self.assertFalse(main(request)['cacheHit'],'missing cache images must regenerate')
            with patch('assets.COVER_VERSION','paper-cover-test-next'):
                versioned=main(request)
            self.assertFalse(versioned['cacheHit']);self.assertNotEqual(versioned['path'],first['path'])
            with fitz.open(pdf) as d:
                d[0].insert_text((70,120),'Updated content');d.saveIncr()
            changed=main(request)
            self.assertFalse(changed['cacheHit']);self.assertNotEqual(changed['pdfHash'],first['pdfHash'])
            self.assertTrue(main(request)['cacheHit'])

    def test_cover_inspects_only_first_eight_pages_and_uses_safe_fallback(self):
        with tempfile.TemporaryDirectory() as temp:
            pdf=Path(temp)/'forms.pdf'
            with fitz.open() as d:
                for i in range(9):
                    p=d.new_page();p.insert_text((70,70),
                        'Submission ID 123\nManuscript ID 123\nSubmission Version Initial\nPDF Generation 2026'
                        if i<8 else 'Article title\nAbstract: Actual paper')
                d.save(pdf)
            result=main(dict(operation='assets-cover',pdf=str(pdf),cacheRoot=str(Path(temp)/'cache')))
            self.assertEqual(result['pageIndex'],0);self.assertEqual(result['skippedPages'],[])

    def test_author_portrait_and_publisher_cover_do_not_become_research_evidence(self):
        photo=(52,366,119,456)
        biography=(130,366,300,490,'Hunmin Lee received the B.E. degree in computer engineering.\nHis current re-\nsearch interests include AI.',0,0)
        self.assertEqual(non_research_image(photo,[biography]),'author-portrait')
        cover=(30,30,500,400,'Submission ID 123\nManuscript ID draft-123',0,0)
        self.assertEqual(non_research_image(photo,[cover]),'publisher-cover')
        plot=(30,30,400,100,'Accuracy versus SNR. The experiment evaluates a neural network.',0,0)
        self.assertIsNone(non_research_image(photo,[plot]))
        self.assertIsNone(non_research_image((330,500,500,650),[biography]),'a remote biography must not suppress a research image')
    def test_scholarone_proof_cover_without_submission_id_excludes_branding(self):
        # The real TCOM proof cover has these fields, but no Submission ID.
        form=(30,30,560,500,
              'Breaking the Kbps Uplink Barrier: Semantic-Guided\n'
              'Generative Satellite Communications for Video Transmission\n'
              'Journal:\nIEEE Transactions on Communications\n'
              'Manuscript ID\nTCOM-TPS-26-0292\n'
              'Manuscript Type:\nTransactions Paper Submissions\n'
              'Date Submitted by the\nAuthor:\n02-Feb-2026\n'
              'Complete List of Authors:\nChen, Zhihan; Peking University\n'
              'Under review for possible publication in',0,0)
        for graphic in [(183,72,429,122),(241,413,371,455)]:
            self.assertEqual(non_research_image(graphic,[form]),'publisher-cover')
        article=(30,30,560,500,
                 'IEEE Transactions on Communications\n'
                 'This paper evaluates a satellite communication method.\n'
                 'Manuscript ID TCOM-TPS-26-0292 is noted in the appendix.',0,0)
        self.assertIsNone(non_research_image((183,72,429,122),[article]),
                          'a journal name and manuscript identifier alone are not a cover form')
        partial=(30,30,560,500,
                 'Journal: IEEE Transactions on Communications\n'
                 'Manuscript ID TCOM-TPS-26-0292\n'
                 'Under review for possible publication in',0,0)
        self.assertIsNone(non_research_image((183,72,429,122),[partial]),
                          'the cover rule also requires independent submission fields')
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
