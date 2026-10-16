"""Export actual DOCX files and inspect the resulting WordprocessingML.

These are manuscript exporter regressions, not rendered-document mocks. They
need python-docx/lxml and make no network or model requests.
"""
import copy
import importlib.util
import os
import struct
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from lxml import etree

REPOSITORY = Path(__file__).resolve().parents[2]
MODULE_PATH = REPOSITORY / 'services/research-engine/manuscript/document.py'
SPEC = importlib.util.spec_from_file_location('manuscript_word_tools_document', MODULE_PATH)
EXPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORTER)


def block(kind, text='', **kwargs):
    return dict(id=kwargs.pop('id', kind), sectionID='s', type=kind, text=text, **kwargs)


def png_fixture(width=320, height=80):
    """A valid RGB PNG with deliberately different horizontal/vertical sizes."""
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)
    header = struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0)
    rows = (b'\0' + bytes([225, 235, 245]) * width) * height
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')


class WordToolsExport(unittest.TestCase):
    def export(self, blocks, *, make_images=False, pandoc=None):
        """Read the document and XML before removing only our temporary files."""
        with tempfile.TemporaryDirectory(prefix='easysch-word-tools-') as root:
            reference = Path(root) / 'reference.docx'
            EXPORTER.default_reference(reference)
            source_png = None
            if make_images:
                source = Path(root) / 'original.png'
                source.write_bytes(png_fixture())
                source_png = source.read_bytes()
                for entry in blocks:
                    if entry['type'] == 'image':
                        entry['imagePath'] = str(source)
            project = dict(title='Word tool verification', sections=[dict(id='s', title='Research')], blocks=blocks)
            before = copy.deepcopy(project)
            request = dict(directory=root, referenceDoc=str(reference), project=project)
            if pandoc:
                request['pandoc'] = str(pandoc)
            result = EXPORTER.export(request)
            self.assertEqual(project, before, 'export must not mutate source content or formatting')
            with zipfile.ZipFile(result['path']) as archive:
                xml = etree.fromstring(archive.read('word/document.xml'))
                images = [archive.read(name) for name in archive.namelist() if name.startswith('word/media/')]
            return Document(result['path']), xml, images, source_png

    def paragraph(self, document, text):
        return next(par for par in document.paragraphs if par.text == text)

    def test_rich_run_styles_sizes_scripts_highlight_and_color_survive_actual_docx(self):
        specs = [
            dict(text='Measured ', bold=True, italic=False, underline=True, fontSize=14.5,
                 color='rgb(12, 34, 56)', highlight='#fff0a0', fontFamily='"Cambria Math"'),
            dict(text='x', italic=True, fontSize=11),
            dict(text='i', sub=True),
            dict(text='2', sup=True),
            dict(text=' excluded', strike=True),
            dict(text=' retained', strike=False, bold=False, underline=False),
        ]
        text = ''.join(spec['text'] for spec in specs)
        document, _, _, _ = self.export([block('paragraph', text, runs=specs)])
        runs = self.paragraph(document, text).runs
        first = runs[0]
        self.assertTrue(first.bold)
        self.assertFalse(first.italic)
        self.assertTrue(first.underline)
        self.assertEqual(first.font.size.pt, 14.5)
        self.assertEqual(first._r.rPr.find(qn('w:sz')).get(qn('w:val')), '29')
        self.assertEqual(first._r.rPr.find(qn('w:color')).get(qn('w:val')), '0C2238')
        shading = first._r.rPr.find(qn('w:shd'))
        self.assertEqual(shading.get(qn('w:fill')).upper(), 'FFF0A0')
        self.assertEqual(shading.get(qn('w:val')), 'clear')
        self.assertEqual(first._r.rPr.rFonts.get(qn('w:ascii')), 'Cambria Math')
        self.assertEqual(first._r.rPr.rFonts.get(qn('w:eastAsia')), 'Cambria Math')
        self.assertTrue(runs[1].italic)
        self.assertEqual(runs[1].font.size.pt, 11)
        self.assertEqual(runs[2]._r.rPr.find(qn('w:vertAlign')).get(qn('w:val')), 'subscript')
        self.assertEqual(runs[3]._r.rPr.find(qn('w:vertAlign')).get(qn('w:val')), 'superscript')
        self.assertTrue(runs[4].font.strike)
        self.assertFalse(runs[5].font.strike)
        self.assertFalse(runs[5].bold)
        self.assertFalse(runs[5].underline)

    def test_heading_and_numbered_list_keep_run_format_across_line_boundaries(self):
        heading = block('heading', 'Heading xi', runs=[
            dict(text='Heading ', bold=False, fontSize=16, highlight='#ddeeff'),
            dict(text='x', italic=True), dict(text='i', sub=True),
        ], textAlign='center', lineSpacing=1.5, indent=4)
        listing = block('list', 'First xi\nSecond y2', listStyle='number', runs=[
            dict(text='First ', bold=True), dict(text='x', italic=True), dict(text='i', sub=True),
            dict(text='\nSecond ', strike=True, fontSize=12), dict(text='y', italic=True), dict(text='2', sup=True),
        ], textAlign='right', lineSpacing=1.8, indent=8)
        document, _, _, _ = self.export([heading, listing])
        paragraph = self.paragraph(document, 'Heading xi')
        self.assertEqual(paragraph.style.name, 'Heading 2')
        self.assertFalse(paragraph.runs[0].bold)
        self.assertEqual(paragraph.runs[0].font.size.pt, 16)
        self.assertEqual(paragraph.runs[0]._r.rPr.find(qn('w:shd')).get(qn('w:fill')).upper(), 'DDEEFF')
        self.assertTrue(paragraph.runs[2].font.subscript)
        first, second = (self.paragraph(document, line) for line in ['First xi', 'Second y2'])
        self.assertEqual(first.style.name, 'List Number')
        self.assertEqual(second.style.name, 'List Number')
        self.assertTrue(first.runs[0].bold)
        self.assertTrue(first.runs[2].font.subscript)
        self.assertEqual(second.runs[0].text, 'Second ')
        self.assertTrue(second.runs[0].font.strike)
        self.assertEqual(second.runs[0].font.size.pt, 12)
        self.assertTrue(second.runs[2].font.superscript)
        self.assertEqual(first.paragraph_format.line_spacing, 1.8)
        self.assertEqual(second.paragraph_format.line_spacing, 1.8)

    def test_line_spacing_and_indents_are_explicit_for_body_heading_and_list(self):
        for kind in ['paragraph', 'heading', 'list']:
            for multiplier in [1, 1.15, 1.5, 1.8, 2]:
                with self.subTest(kind=kind, multiplier=multiplier):
                    document, _, _, _ = self.export([block(kind, 'spaced content', lineSpacing=multiplier,
                                                         indent=12.5, textAlign='justify', spaceBefore=6)])
                    paragraph = self.paragraph(document, 'spaced content')
                    spacing = paragraph._p.pPr.find(qn('w:spacing'))
                    self.assertEqual(int(spacing.get(qn('w:line'))), round(multiplier * 240))
                    self.assertEqual(spacing.get(qn('w:lineRule')), 'auto')
                    self.assertEqual(paragraph._p.pPr.find(qn('w:ind')).get(qn('w:left')), '709')
                    self.assertEqual(paragraph._p.pPr.find(qn('w:jc')).get(qn('w:val')), 'both')
                    if kind == 'paragraph':
                        self.assertEqual(spacing.get(qn('w:before')), '120')
        document, _, _, _ = self.export([block('paragraph', 'zero indent', indent=0)])
        self.assertEqual(self.paragraph(document, 'zero indent')._p.pPr.find(qn('w:ind')).get(qn('w:left')), '0')

    def test_invalid_optional_run_and_paragraph_formats_do_not_create_bad_xml(self):
        document, _, _, _ = self.export([block('paragraph', 'safe format', runs=[
            dict(text='safe format', fontSize=90, highlight='not-a-color', color='#oops'),
        ], lineSpacing=7, indent=-1)])
        paragraph = self.paragraph(document, 'safe format')
        properties = paragraph.runs[0]._r.rPr
        self.assertTrue(properties is None or properties.find(qn('w:sz')) is None)
        self.assertTrue(properties is None or properties.find(qn('w:shd')) is None)
        self.assertIsNone(paragraph.paragraph_format.line_spacing)
        self.assertIsNone(paragraph.paragraph_format.left_indent)

    def test_independent_image_width_height_are_exported_in_both_drawing_extents(self):
        document, xml, images, source = self.export([
            block('image', 'Independent dimensions', width=73, height=45),
            block('image', 'Original ratio', id='image-ratio', width=80),
        ], make_images=True)
        extents = xml.findall('.//' + qn('wp:extent'))
        transforms = xml.findall('.//' + qn('a:xfrm') + '/' + qn('a:ext'))
        expected = [('2628000', '1620000'), ('2880000', '720000')]
        self.assertEqual([(value.get('cx'), value.get('cy')) for value in extents], expected)
        self.assertEqual([(value.get('cx'), value.get('cy')) for value in transforms], expected)
        self.assertEqual(len(document.inline_shapes), 2)
        self.assertEqual(document.inline_shapes[0].width.mm, 73)
        self.assertEqual(document.inline_shapes[0].height.mm, 45)
        self.assertTrue(images)
        self.assertTrue(all(value == source for value in images), 'resizing must not replace original image pixels')

    def test_invalid_independent_image_dimensions_are_rejected_before_export(self):
        for width, height in [(0, 45), (159, 45), (73, 0), (73, 241), ('73', 45)]:
            with self.subTest(width=width, height=height):
                with self.assertRaisesRegex(ValueError, '图片[宽高]度无效'):
                    self.export([block('image', width=width, height=height)], make_images=True)

    def test_formula_stays_editable_word_math_with_subscripts_and_superscripts(self):
        default = REPOSITORY.parent / '.tools/pandoc/pandoc-3.11/pandoc.exe'
        pandoc = Path(os.environ.get('EASYSCH_TEST_PANDOC', str(default)))
        if not pandoc.is_file():
            self.skipTest('Set EASYSCH_TEST_PANDOC to run actual OMML conversion')
        _, xml, _, _ = self.export([block('formula', r'E_{\mathrm{F}}=\frac{x_i^2}{2m}')], pandoc=pandoc)
        self.assertEqual(len(xml.findall('.//' + qn('m:oMath'))), 1)
        self.assertEqual(len(xml.findall('.//' + qn('w:drawing'))), 0)
        self.assertTrue(xml.findall('.//' + qn('m:f')))
        subscript_text = ''.join(node.text or '' for sub in xml.findall('.//' + qn('m:sub'))
                                 for node in sub.findall('.//' + qn('m:t')))
        superscript_text = ''.join(node.text or '' for sup in xml.findall('.//' + qn('m:sup'))
                                   for node in sup.findall('.//' + qn('m:t')))
        self.assertIn('F', subscript_text)
        self.assertIn('i', subscript_text)
        self.assertIn('2', superscript_text)


if __name__ == '__main__':
    unittest.main()
