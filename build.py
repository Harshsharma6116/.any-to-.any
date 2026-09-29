import re
import os

def read(f):
    with open(f, 'r', encoding='utf-8') as file:
        return file.read()

def strip_imports_exports(js):
    js = re.sub(r'import\s+.*?from\s+[\'"].*?[\'"];?', '', js)
    js = re.sub(r'export\s+(const|let|var|function|class)', r'\1', js)
    js = re.sub(r'export\s+\{.*?\};?', '', js)
    return js

html = read('index.html')
css = read('style.css')

modules = ['app/state.js', 'app/utils.js', 'app/editor.js', 'app/readers.js', 'app/writers.js', 'app/ui.js', 'app.js']
all_js = []
for m in modules:
    all_js.append(f'/* --- {m} --- */')
    all_js.append(strip_imports_exports(read(m)))

js_merged = '\n'.join(all_js)

# replace css
html = html.replace('<link rel="stylesheet" href="style.css">', f'<style>\n{css}\n</style>')

# replace app.js
html = html.replace('<script type="module" src="app.js"></script>', f'<script>\n{js_merged}\n</script>')

with open('file-converter.html', 'w', encoding='utf-8') as f:
    f.write(html)

print("Generated file-converter.html")
