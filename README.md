# Any-to-any file converter

Runs entirely in the browser. No build step and no server.

## Run it
Open `index.html` in a browser (needs internet once, to load the libraries from CDNs).
Or serve the folder: `python3 -m http.server` then open http://localhost:8000

## Files
- `index.html` page structure and library script tags
- `style.css` styling (light and dark)
- `app.js` readers, table editor, writers and UI

## Libraries (loaded from CDN)
SheetJS (Excel), mammoth (Word read), docx (Word write), PptxGenJS (PowerPoint write),
JSZip (PowerPoint read), jsPDF + autotable (PDF write), pdf.js (PDF read), marked (Markdown), html2canvas (PDF for non-Latin text).

## How it works
Every input is read into a simple list of blocks (headings, paragraphs, lists, tables).
The table editor removes columns/rows from that list, then a writer turns it into the chosen format.
To add a format: add a reader in `parseFile` and/or a writer in `WRITERS` in `app.js`.
