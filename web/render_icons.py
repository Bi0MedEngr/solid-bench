# Render web/icon.svg to the PNG sizes the manifest and iOS want (run once after changing the icon).
import os
from playwright.sync_api import sync_playwright
here = os.path.dirname(os.path.abspath(__file__))
svg = open(os.path.join(here, 'icon.svg')).read()
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    for n in (180, 192, 512):
        pg = b.new_page(viewport={'width': n, 'height': n})
        pg.set_content(f'<style>html,body{{margin:0}}svg{{display:block;width:{n}px;height:{n}px}}</style>{svg}')
        pg.screenshot(path=os.path.join(here, f'icon-{n}.png'))
    b.close()
