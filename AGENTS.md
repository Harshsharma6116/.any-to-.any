# AGENTS.md — instructions for AI coding agents

This file is for any AI agent (Claude, Gemini, GPT, Cursor, etc.) picking up
this codebase. Read this before making changes. It tells you what exists,
why it's built this way, and the rules to follow so changes don't break the
converter or the working parts of the app.

## What this project is

A browser-only any-to-any file converter. Plain HTML/CSS/JS — no framework,
no build step, no `npm install`. Everything runs by opening `index.html` in
a browser. External libraries (SheetJS, mammoth, docx, PptxGenJS, JSZip,
jsPDF + autoTable, pdf.js, marked, html2canvas) load from CDNs via
`<script>` tags already in `index.html` — do not add a bundler,
package.json, or framework unless the human explicitly asks for a stack
migration.

Every input file is read into one simple document model (blocks), the table
editor modifies that model, and every output format is written from it.

Block types: `h` (heading), `p` (paragraph), `ul`/`ol` (list),
`code`, `quote`, `table`.

## File map

| File/Folder | Owns |
|---|---|
| `index.html` | Page structure, CDN script/link tags, file input & drop zone, conversion UI |
| `style.css` | All styling (light and dark themes, responsive layout) |
| `app.js` | Main entry point. Imports modules, binds UI events |
| `app/` | ES Modules directory (`state.js`, `utils.js`, `readers.js`, `editor.js`, `writers.js`, `ui.js`) |
| `file-converter.html` | Self-contained single-file version (HTML + CSS + JS inlined) |
| `README.md` | Human-facing docs: stack, install/run, architecture |

There is no CSS-in-JS, no inline `<style>` blocks in `index.html`, and no npm bundler. We use native browser ES modules (`<script type="module">`).

## `app/` architecture — the sections you need to know

The logic is split into the following native ES modules:

| Module | What it does |
|---|---|
| `state.js` | Constants (`FORMATS`, `MIME`), and the global `state` object |
| `utils.js` | DOM selector (`$`), text escaping (`esc`), array cleaners (`normRows`) |
| `readers.js` | `parseFile()` — HTML→blocks, delimited text, plain text, JSON, Excel, PowerPoint, PDF |
| `editor.js` | Table editor logic (`effectiveDoc` — applies hidden-row/column edits) |
| `writers.js` | `WRITERS` object — outputs docx, pdf, xlsx, pptx, csv, md, html, txt, json |
| `ui.js` | UI rendering (`renderPreview()`, `renderTables()`, format buttons, CSV dialog) |

### How to add a new format

1. **Reader**: Add a case in `app/readers.js` (`parseFile()`) that returns `{blocks, ext}`.
2. **Writer**: Add a key in the `WRITERS` object in `app/writers.js` that takes the blocks array and returns `{blob, ext}`.
3. **Format entry**: Add to the `FORMATS` array and `MIME` map in `app/state.js`.

Copy an existing reader/writer of similar complexity as your starting template.

## CDN libraries — what's loaded and why

| Library | Purpose |
|---|---|
| SheetJS (`xlsx`) | Read & write Excel (.xlsx, .xls, .ods) |
| mammoth | Read Word (.docx) → HTML |
| docx | Write Word (.docx) from blocks |
| PptxGenJS | Write PowerPoint (.pptx) |
| JSZip | Read PowerPoint (.pptx) by unzipping XML |
| jsPDF + autoTable | Write PDF |
| pdf.js | Read PDF |
| marked | Parse Markdown → HTML |
| html2canvas | Render non-Latin text to PDF via canvas |

Do not upgrade, remove, or replace any of these without explicit approval.
If a CDN fails at runtime, the converter should degrade gracefully — readers
and writers that depend on a missing library should throw a clear error
message, not crash the page.

## Key selectors and IDs — don't rename without updating `app.js`

These IDs and classes are referenced by exact string match in `app.js`:

`#drop`, `#dropWhat`, `#pick`, `#sample`, `#file`, `#rFrom`, `#rTo`,
`#fmts`, `#convert`, `#edWrap`, `#preview`, `.route`, `.drop`, `.panel`,
`.btn.primary`.

Renaming any of these without updating every reference in `app.js` will
silently break features.

## Before you commit a change, verify

1. Open `index.html` directly in a browser (no build step) — confirm it
   still renders and converts at least one format end-to-end.
2. Test the specific format(s) you touched — drag a file in, convert, and
   open the output.
3. If you changed `style.css`, verify both light and dark themes still work.
4. If you changed `app.js`, check the browser console for zero errors after
   a conversion.
5. Don't introduce a package manager, bundler, or framework as a
   side-effect of an unrelated change — if a task genuinely requires one,
   stop and ask the human first.

## What NOT to do

- Don't add a server, backend, or database — this is explicitly a
  browser-only tool. Files never leave the user's machine.
- Don't add a CSS framework (Bootstrap, Tailwind, etc.) on top of the
  existing hand-built styles — it will conflict and bloat the bundle.
- Don't replace CDN-loaded libraries with npm packages — this project has
  no build step and must stay that way.
- Don't modify `file-converter.html` independently of the main files — it
  is a self-contained snapshot and should be regenerated from the main
  source files when they change.
- Don't break the existing block model. All readers must output the same
  block format, and all writers must consume blocks — this shared contract
  is what makes any-to-any conversion work.
