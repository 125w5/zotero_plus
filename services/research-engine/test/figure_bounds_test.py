"""Regression for graphics whose transparent margin overlaps a short caption."""
import importlib.util
from pathlib import Path
import unittest
import pymupdf as fitz

spec=importlib.util.spec_from_file_location('assets',Path(__file__).parents[1]/'pdf'/'assets.py')
assets=importlib.util.module_from_spec(spec);spec.loader.exec_module(assets)

class FigureBounds(unittest.TestCase):
    def test_complete_image_even_when_margin_overlaps_caption(self):
        with fitz.open() as doc:
            page=doc.new_page(width=612,height=792)
            cap=(54,225,272,233,'Fig. 4. Test plot',0,0)
            image={'bbox':(56,57,294,230)}
            adjacent={'bbox':(312,43,579,222)}
            rect=assets.figure_region(page,cap,[],[image,adjacent],[cap])
            self.assertTrue(rect.contains(fitz.Rect(image['bbox'])))
            self.assertFalse(rect.intersects(fitz.Rect(adjacent['bbox'])))

    def test_short_axis_labels_are_included_without_body_paragraphs(self):
        with fitz.open() as doc:
            page=doc.new_page(width=612,height=792)
            cap=(54,225,272,233,'Fig. 4. Test plot',0,0)
            graphic=fitz.Rect(70,65,280,204)
            axis=(64,208,282,218,'Environment steps',0,0)
            body=(54,254,300,720,'Body text '*80,0,0)
            rect=assets.figure_region(page,cap,[graphic],[],[cap,axis,body])
            self.assertTrue(rect.contains(fitz.Rect(axis[:4])))
            self.assertFalse(rect.intersects(fitz.Rect(body[:4])))

if __name__=='__main__': unittest.main()
