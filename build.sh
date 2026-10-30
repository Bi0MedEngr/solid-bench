#!/bin/sh
# Inline the scripts into page.html -> solid-bench.html (the claude.ai artifact page), then wrap it as
# docs/ for GitHub Pages (installable offline web app). private/*.js, if any, go only into
# solid-bench-private.html (git-ignored).
cd "$(dirname "$0")"
python3 -I - <<'PY'
import subprocess, tempfile, os, base64, shutil, hashlib
SLUG, FILES = 'solid-bench', ['vendor/three.min.js', 'vendor/OrbitControls.js', 'vendor/TransformControls.js', 'core.js', 'presets.js', 'explain.js', 'app.js']   # order matters: app.js last
page = open('page.html').read()
faces = [('IBM Plex Sans', '400 600', 'plex-sans-var'), ('IBM Plex Sans Condensed', '500', 'plex-sans-cond-500'), ('IBM Plex Sans Condensed', '600', 'plex-sans-cond-600'),
         ('IBM Plex Mono', '400', 'plex-mono-400'), ('IBM Plex Mono', '500', 'plex-mono-500')]
css = ''.join("@font-face{font-family:'%s';font-style:normal;font-weight:%s;font-display:swap;src:url(data:font/woff2;base64,%s) format('woff2')}\n" % (fam, w, base64.b64encode(open('fonts/%s.woff2' % f, 'rb').read()).decode()) for fam, w, f in faces)
page = page.replace('<!--FONTS-->', '<style>\n' + css + '</style>')
def bundle(files): return '\n'.join(open(f).read().replace('</script', '<\\/script') for f in files)
js = bundle(FILES)
html = page.replace('<!--SCRIPTS-->', '<script>\n' + js + '\n</script>')
open(SLUG + '.html', 'w').write(html)
priv = sorted(f for f in (os.listdir('private') if os.path.isdir('private') else []) if f.endswith('.js') and not f.endswith('_test.js'))
if priv:
    open(SLUG + '-private.html', 'w').write(page.replace('<!--SCRIPTS-->', '<script>\n' + bundle(FILES[:-1] + ['private/' + f for f in priv] + FILES[-1:]) + '\n</script>'))
    print('built', SLUG + '-private.html with', ', '.join(priv))
os.makedirs('docs', exist_ok=True)
reg = "<script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});</script>\n"
open('docs/index.html', 'w').write(open('web/head.html').read() + html + '\n' + reg + '</body></html>\n')
open('docs/sw.js', 'w').write(open('web/sw.js').read().replace('__BUILD__', hashlib.sha1(html.encode()).hexdigest()[:10]))
for f in ['manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png']:
    if os.path.exists('web/' + f): shutil.copy('web/' + f, 'docs/' + f)
open('docs/.nojekyll', 'w').close()
fd, tmp = tempfile.mkstemp(suffix='.js'); os.write(fd, js.encode()); os.close(fd)
r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True); os.unlink(tmp)
print('built', SLUG + '.html,', len(html), 'bytes;', 'syntax ok' if r.returncode == 0 else 'SYNTAX ERROR\n' + r.stderr)
PY
