# UI smoke test: desktop light + dark, iPad, phone (no horizontal scroll), console errors, clicking real geometry,
# adding a part, the math drawer, and JSON / STL downloads.
# Run: ~/.venvs/mcmaster_torx/bin/python tests/browser_test.py <out_dir>
import os, sys
from playwright.sync_api import sync_playwright
here = os.path.dirname(os.path.abspath(__file__)); out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/tool_shots'
os.makedirs(out, exist_ok=True)
url = 'file://' + os.path.join(here, '..', 'docs', 'index.html')
errs, fails = [], []
def check(ok, msg):
    print(('PASS ' if ok else 'FAIL ') + msg)
    if not ok: fails.append(msg)
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    for name, w, h, scheme in [('desk_light', 1440, 900, 'light'), ('desk_dark', 1440, 900, 'dark'), ('ipad', 1180, 820, 'light'), ('phone', 390, 844, 'light')]:
        ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, device_scale_factor=2, has_touch=name in ('ipad', 'phone'), accept_downloads=True)
        pg = ctx.new_page()
        pg.on('console', lambda m, n=name: m.type == 'error' and errs.append(f'{n}: {m.text}'))
        pg.on('pageerror', lambda e, n=name: errs.append(f'{n}: {e}'))
        pg.goto(url); pg.wait_for_timeout(1200)
        pg.screenshot(path=f'{out}/{name}.png', full_page=name == 'phone')
        sw = pg.evaluate('document.documentElement.scrollWidth')
        print(name, '|', pg.inner_text('#status'), '| scrollWidth', sw, 'of', w)
        check(sw <= w, f'{name}: no horizontal scroll')
        if name == 'desk_light':
            n0 = pg.evaluate('__tool.model.parts.length')
            # click the nose cone's center of mass on screen → it becomes selected
            nose = pg.evaluate("__tool.model.parts.find(p => p.type === 'cone').id")
            x, y = pg.evaluate(f"__tool.partScreen('{nose}')")
            pg.mouse.click(x, y); pg.wait_for_timeout(300)
            check(pg.evaluate('__tool.selId') == nose, 'clicking the nose cone selects it')
            check('cone' in pg.inner_text('#inspTitle').lower(), 'inspector shows the cone')
            pg.screenshot(path=f'{out}/selected.png')
            # change its height in the inspector → mass changes
            m0 = pg.evaluate('__tool.res.M')
            pg.fill('[data-dim="h"]', '45'); pg.press('[data-dim="h"]', 'Enter'); pg.wait_for_timeout(200)
            check(pg.evaluate('__tool.res.M') > m0, 'taller nose cone → more mass')
            pg.keyboard.press('Meta+z'); pg.wait_for_timeout(200)
            check(abs(pg.evaluate('__tool.res.M') - m0) < 1e-9, 'undo restores the mass')
            # add a box with the keyboard (focus the view first)
            pg.mouse.click(30, h - 30) if False else pg.focus('#cv')
            pg.keyboard.press('1'); pg.wait_for_timeout(300)
            check(pg.evaluate('__tool.model.parts.length') == n0 + 1, 'key 1 adds a box')
            pg.screenshot(path=f'{out}/added_box.png')
            pg.click('#mathBtn'); pg.wait_for_timeout(400)
            check('closed-form' in pg.inner_text('#mathBody'), 'math drawer explains the selected part')
            pg.screenshot(path=f'{out}/math.png')
            pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
            for act, ext in [('save', '.json'), ('stl', '.stl')]:
                pg.click('#fileBtn')
                with pg.expect_download() as d: pg.click(f'[data-act="{act}"]')
                path = d.value.path()
                check(d.value.suggested_filename.endswith(ext) and os.path.getsize(path) > 100, f'download {d.value.suggested_filename} ({os.path.getsize(path)} bytes)')
            pg.click('[data-view="front"]'); pg.click('#orthoBtn'); pg.wait_for_timeout(300)
            pg.screenshot(path=f'{out}/front_ortho.png')
        ctx.close()
    b.close()
print('\n'.join(errs) or 'no console errors')
check(not errs, 'no console errors')
sys.exit(1 if fails else 0)
