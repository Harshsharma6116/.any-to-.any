'use strict';
/* =====================================================================
   Any-to-any converter. Every input is read into one simple document
   model (blocks), the table editor changes that model, and every output
   is written from it.
   Block types: h {level,text} | p {text} | ul/ol {items:[{text,level}]}
                code {text} | quote {text} | table {rows,header,name,...}
   ===================================================================== */
const PDF_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const FORMATS = [
  {id:'docx', ext:'docx', name:'Word'},
  {id:'pdf',  ext:'pdf',  name:'PDF'},
  {id:'xlsx', ext:'xlsx', name:'Excel'},
  {id:'pptx', ext:'pptx', name:'PowerPoint'},
  {id:'csv',  ext:'csv',  name:'CSV'},
  {id:'md',   ext:'md',   name:'Markdown'},
  {id:'html', ext:'html', name:'HTML'},
  {id:'txt',  ext:'txt',  name:'Plain text'},
  {id:'json', ext:'json', name:'JSON'},
];
const MIME = {docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf:'application/pdf', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv:'text/csv', md:'text/markdown', html:'text/html', txt:'text/plain', json:'application/json'};

const state = {doc:null, base:'', srcExt:'', target:'pdf', csvChoice:'0', last:null, busy:false};

/* ---------- small helpers ---------- */
const $ = (s, r=document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clean = s => String(s == null ? '' : s).replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/\s*\n\s*/g,' ').trim();
function letters(i){let s='';i++;while(i>0){const m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26);}return s;}
const fmtOf = id => FORMATS.find(f => f.id === id);

function normRows(rows){
  rows = rows.map(r => r.map(c => c == null ? '' : String(c)));
  const isEmpty = r => r.every(c => c.trim() === '');
  while(rows.length && isEmpty(rows[rows.length-1])) rows.pop();
  while(rows.length && isEmpty(rows[0])) rows.shift();
  if(!rows.length) return [];
  let w = Math.max(...rows.map(r => r.length));
  while(w > 0 && rows.every(r => (r[w-1] || '').trim() === '')) w--;
  if(w === 0) return [];
  return rows.map(r => { const x = r.slice(0,w); while(x.length < w) x.push(''); return x; });
}
function makeTable(rows, name){
  rows = normRows(rows);
  if(!rows.length) return null;
  return {t:'table', rows, name:name||'', header:true, include:true, hiddenCols:new Set(), hiddenRows:new Set(), showAll:false};
}

/* ---------- readers: HTML → blocks (used by Word, Markdown and HTML) ---------- */
const BLOCK_TAGS = new Set(['p','div','section','article','header','footer','main','nav','aside','h1','h2','h3','h4','h5','h6','ul','ol','table','pre','blockquote','figure','li']);
function hasBlock(n){ return !!Array.from(n.querySelectorAll('*')).find(e => BLOCK_TAGS.has(e.tagName.toLowerCase())); }
function collectList(listEl, items, level){
  for(const li of Array.from(listEl.children)){
    if(li.tagName.toLowerCase() !== 'li') continue;
    const c = li.cloneNode(true);
    c.querySelectorAll('ul,ol').forEach(x => x.remove());
    const t = clean(c.textContent);
    if(t) items.push({text:t, level});
    li.querySelectorAll(':scope > ul, :scope > ol').forEach(sub => collectList(sub, items, level+1));
  }
}
function tableFromEl(el){
  const rows = [];
  el.querySelectorAll('tr').forEach(tr => {
    if(tr.closest('table') !== el) return;
    const row = [];
    Array.from(tr.children).forEach(td => {
      const tag = td.tagName.toLowerCase();
      if(tag !== 'td' && tag !== 'th') return;
      row.push(clean(td.textContent));
      const span = parseInt(td.getAttribute('colspan') || '1', 10);
      for(let i = 1; i < span && i < 50; i++) row.push('');
    });
    if(row.length) rows.push(row);
  });
  const cap = el.querySelector('caption');
  return makeTable(rows, cap ? clean(cap.textContent) : '');
}
function walk(node, out){
  for(const n of Array.from(node.childNodes)){
    if(n.nodeType === 3){ const t = clean(n.textContent); if(t) out.push({t:'p', text:t}); continue; }
    if(n.nodeType !== 1) continue;
    const tag = n.tagName.toLowerCase();
    if(/^h[1-6]$/.test(tag)){ const t = clean(n.textContent); if(t) out.push({t:'h', level:+tag[1], text:t}); }
    else if(tag === 'p'){ const t = clean(n.textContent); if(t) out.push({t:'p', text:t}); }
    else if(tag === 'ul' || tag === 'ol'){ const items = []; collectList(n, items, 0); if(items.length) out.push({t:tag, items}); }
    else if(tag === 'table'){ const tb = tableFromEl(n); if(tb) out.push(tb); }
    else if(tag === 'pre'){ const t = n.textContent.replace(/\s+$/,''); if(t.trim()) out.push({t:'code', text:t}); }
    else if(tag === 'blockquote'){ const t = clean(n.textContent); if(t) out.push({t:'quote', text:t}); }
    else if(['script','style','head','img','svg','hr','br','noscript'].includes(tag)){}
    else if(!hasBlock(n)){ const t = clean(n.textContent); if(t) out.push({t:'p', text:t}); }
    else walk(n, out);
  }
}
function htmlToBlocks(html){
  const d = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  walk(d.body, out);
  return out;
}

/* ---------- readers: delimited text ---------- */
function sniffDelim(text){
  const sample = text.split(/\r?\n/).slice(0,10).join('\n');
  let best = ',', bestN = 0;
  for(const d of [',',';','\t','|']){ const n = sample.split(d).length - 1; if(n > bestN){ best = d; bestN = n; } }
  return best;
}
function parseDelimited(text, delim){
  const rows = []; let row = [], cur = '', q = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(q){ if(c === '"'){ if(text[i+1] === '"'){ cur += '"'; i++; } else q = false; } else cur += c; }
    else if(c === '"' && cur === '') q = true;
    else if(c === delim){ row.push(cur); cur = ''; }
    else if(c === '\n' || c === '\r'){ if(c === '\r' && text[i+1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if(cur !== '' || row.length){ row.push(cur); rows.push(row); }
  return rows.map(r => r.map(c => c.trim()));
}

/* ---------- readers: plain text ---------- */
function textToBlocks(text){
  const blocks = [];
  for(const para of text.replace(/\r\n?/g,'\n').split(/\n{2,}/)){
    const lines = para.split('\n').filter(l => l.trim() !== '');
    if(!lines.length) continue;
    if(lines.length >= 2 && lines.every(l => l.includes('\t'))){
      const tb = makeTable(lines.map(l => l.split('\t').map(c => c.trim())));
      if(tb){ blocks.push(tb); continue; }
    }
    if(lines.every(l => /^\s*[-*\u2022]\s+/.test(l))){ blocks.push({t:'ul', items:lines.map(l => ({text:clean(l.replace(/^\s*[-*\u2022]\s+/,'')), level:0}))}); continue; }
    if(lines.every(l => /^\s*\d+[.)]\s+/.test(l))){ blocks.push({t:'ol', items:lines.map(l => ({text:clean(l.replace(/^\s*\d+[.)]\s+/,'')), level:0}))}); continue; }
    const avg = lines.reduce((a,l) => a + l.length, 0) / lines.length;
    if(lines.length > 1 && avg < 50) lines.forEach(l => blocks.push({t:'p', text:clean(l)}));
    else blocks.push({t:'p', text:clean(lines.join(' '))});
  }
  return blocks;
}

/* ---------- readers: JSON ---------- */
function jsonToBlocks(text){
  const data = JSON.parse(text.replace(/^\uFEFF/,''));
  const blocks = [];
  const fromArray = (arr, name) => {
    if(!arr.length) return null;
    if(arr.every(x => x && typeof x === 'object' && !Array.isArray(x))){
      const keys = []; arr.forEach(o => Object.keys(o).forEach(k => { if(!keys.includes(k)) keys.push(k); }));
      const v = x => x == null ? '' : (typeof x === 'object' ? JSON.stringify(x) : String(x));
      return makeTable([keys, ...arr.map(o => keys.map(k => v(o[k])))], name);
    }
    if(arr.every(x => Array.isArray(x))) return makeTable(arr.map(r => r.map(c => c == null ? '' : typeof c === 'object' ? JSON.stringify(c) : String(c))), name);
    return null;
  };
  if(Array.isArray(data)){
    const t = fromArray(data, 'data');
    if(t) blocks.push(t); else blocks.push({t:'code', text:JSON.stringify(data, null, 2)});
  } else if(data && typeof data === 'object'){
    let found = false;
    for(const [k,v] of Object.entries(data)){
      if(Array.isArray(v)){ const t = fromArray(v, k); if(t){ blocks.push(t); found = true; } }
    }
    if(!found) blocks.push({t:'code', text:JSON.stringify(data, null, 2)});
  } else blocks.push({t:'p', text:String(data)});
  return blocks;
}

/* ---------- readers: Excel ---------- */
function xlsxToBlocks(buf){
  const wb = XLSX.read(buf, {type:'array'});
  const blocks = [];
  for(const name of wb.SheetNames){
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], {header:1, raw:false, defval:'', blankrows:false});
    const t = makeTable(aoa.map(r => r.map(c => String(c).trim())), name);
    if(t) blocks.push(t);
  }
  return blocks;
}

/* ---------- readers: PowerPoint ---------- */
async function pptxToBlocks(buf){
  const zip = await JSZip.loadAsync(buf);
  const files = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a,b) => parseInt(a.match(/(\d+)\.xml/)[1]) - parseInt(b.match(/(\d+)\.xml/)[1]));
  const blocks = [];
  let n = 0;
  for(const f of files){
    n++;
    const xml = new DOMParser().parseFromString(await zip.files[f].async('string'), 'application/xml');
    const slide = []; let title = null, pendingList = null;
    const paraText = p => Array.from(p.getElementsByTagName('a:t')).map(t => t.textContent).join('');
    const flush = () => { if(pendingList){ slide.push(pendingList); pendingList = null; } };
    const shapes = container => {
      for(const el of Array.from(container.children)){
        const tag = el.tagName;
        if(tag === 'p:grpSp'){ shapes(el); }
        else if(tag === 'p:sp'){
          const ph = el.getElementsByTagName('p:ph')[0];
          const type = ph ? (ph.getAttribute('type') || 'body') : '';
          const paras = Array.from(el.getElementsByTagName('a:p')).map(p => ({p, text:clean(paraText(p))})).filter(x => x.text);
          if(!paras.length) continue;
          if(type === 'title' || type === 'ctrTitle'){
            title = {t:'h', level: type === 'ctrTitle' ? 1 : 2, text: paras.map(x => x.text).join(' ')};
          } else {
            for(const {p, text} of paras){
              const pPr = p.getElementsByTagName('a:pPr')[0];
              const lvl = pPr && pPr.getAttribute('lvl') ? parseInt(pPr.getAttribute('lvl'), 10) : 0;
              const isList = type === 'body' || (pPr && pPr.getElementsByTagName('a:buChar').length) || (pPr && pPr.getElementsByTagName('a:buAutoNum').length);
              if(isList){ if(!pendingList) pendingList = {t:'ul', items:[]}; pendingList.items.push({text, level:lvl}); }
              else { flush(); slide.push({t:'p', text}); }
            }
            flush();
          }
        }
        else if(tag === 'p:graphicFrame'){
          const tbl = el.getElementsByTagName('a:tbl')[0];
          if(tbl){
            flush();
            const rows = Array.from(tbl.getElementsByTagName('a:tr')).map(tr =>
              Array.from(tr.getElementsByTagName('a:tc')).map(tc => clean(Array.from(tc.getElementsByTagName('a:p')).map(paraText).join(' '))));
            const t = makeTable(rows, ''); if(t) slide.push(t);
          }
        }
      }
    };
    const tree = xml.getElementsByTagName('p:spTree')[0];
    if(tree) shapes(tree);
    flush();
    blocks.push(title || {t:'h', level:2, text:'Slide ' + n});
    blocks.push(...slide);
  }
  return blocks;
}

/* ---------- readers: PDF ---------- */
async function pdfToBlocks(buf){
  if(!window.pdfjsLib) throw new Error('The PDF reader did not load. Check your connection and reload the page.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  // Run pdf.js without a separate worker thread: cross-origin workers are blocked here.
  const RealWorker = window.Worker;
  window.Worker = function(){ throw new Error('workers disabled'); };
  const pages = [];
  try{
    const pdf = await pdfjsLib.getDocument({data:new Uint8Array(buf)}).promise;
    for(let p = 1; p <= pdf.numPages; p++){
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent({disableCombineTextItems:true});
      pages.push({h:page.view[3], items:tc.items.filter(i => i.str !== undefined && i.str !== '').map(i => ({
        s:i.str, x:i.transform[4], y:i.transform[5], w:i.width, h:Math.abs(i.transform[3]) || i.height || 10}))});
    }
  } finally { window.Worker = RealWorker; }
  return pdfPagesToBlocks(pages);
}
function pdfPagesToBlocks(pages){
  // body font size = weighted median
  const sizes = [];
  pages.forEach(pg => pg.items.forEach(i => { for(let k = 0; k < Math.min(i.s.length, 30); k++) sizes.push(Math.round(i.h * 2) / 2); }));
  if(!sizes.length) return [];
  sizes.sort((a,b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] || 10;
  const blocks = [];
  for(const pg of pages){
    // group items into lines
    const items = pg.items.slice().sort((a,b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for(const it of items){
      if(!it.s.trim()) continue;   // pdf.js reports wide gaps as whitespace items; measure real distances instead
      const ln = lines.find(l => Math.abs(l.y - it.y) < Math.max(2, it.h * 0.45));
      if(ln) ln.items.push(it); else lines.push({y:it.y, h:it.h, items:[it]});
    }
    lines.sort((a,b) => b.y - a.y);
    for(const ln of lines){
      ln.items.sort((a,b) => a.x - b.x);
      const cells = []; let prev = null;
      for(const it of ln.items){
        if(prev){
          const gap = it.x - (prev.x + prev.w);
          if(gap > Math.max(ln.h * 1.3, 9)) cells.push({x:it.x, text:it.s});
          else { const last = cells[cells.length-1]; last.text += (gap > ln.h * 0.15 && !/\s$/.test(last.text) && !/^\s/.test(it.s) ? ' ' : '') + it.s; }
        } else cells.push({x:it.x, text:it.s});
        prev = it;
      }
      cells.forEach(c => c.text = clean(c.text));
      ln.cells = cells.filter(c => c.text);
      ln.text = ln.cells.map(c => c.text).join(' ');
      ln.h = Math.max(...ln.items.map(i => i.h));
    }
    const kept = lines.filter(l => l.text && !(/^(page\s*)?\d{1,4}(\s*(\/|of)\s*\d{1,4})?$/i.test(l.text) && (l.y < pg.h * 0.07 || l.y > pg.h * 0.93)));
    let i = 0, para = null, prevLine = null;
    const endPara = () => { if(para){ blocks.push({t:'p', text:clean(para)}); para = null; } };
    while(i < kept.length){
      const ln = kept[i];
      // table run
      if(ln.cells.length >= 2){
        let j = i; while(j < kept.length && kept[j].cells.length >= 2) j++;
        if(j - i >= 2){
          endPara();
          const group = kept.slice(i, j);
          const counts = {}; group.forEach(g => counts[g.cells.length] = (counts[g.cells.length] || 0) + 1);
          const mode = +Object.keys(counts).sort((a,b) => counts[b] - counts[a])[0];
          const anchors = Array.from({length:mode}, (_,c) => {
            const xs = group.filter(g => g.cells.length === mode).map(g => g.cells[c].x);
            return xs.reduce((a,b) => a + b, 0) / xs.length;
          });
          const rows = group.map(g => {
            const r = Array(mode).fill('');
            g.cells.forEach(c => {
              let bi = 0, bd = Infinity;
              anchors.forEach((a, ai) => { const d = Math.abs(a - c.x); if(d < bd){ bd = d; bi = ai; } });
              r[bi] = r[bi] ? r[bi] + ' ' + c.text : c.text;
            });
            return r;
          });
          const t = makeTable(rows, ''); if(t) blocks.push(t);
          i = j; prevLine = null; continue;
        }
      }
      const ratio = ln.h / body;
      const isBullet = /^([\u2022\u25CF\u25AA\-\u2013*]|\d{1,2}[.)])\s+/.test(ln.text);
      if(ratio >= 1.15 && ln.text.length < 140){
        endPara();
        blocks.push({t:'h', level: ratio >= 1.7 ? 1 : ratio >= 1.35 ? 2 : 3, text:ln.text});
      } else if(isBullet){
        endPara();
        const ordered = /^\d/.test(ln.text);
        const text = ln.text.replace(/^([\u2022\u25CF\u25AA\-\u2013*]|\d{1,2}[.)])\s+/, '');
        const last = blocks[blocks.length-1];
        if(last && last.t === (ordered ? 'ol' : 'ul') && last._open) last.items.push({text, level:0});
        else blocks.push({t:ordered ? 'ol' : 'ul', items:[{text, level:0}], _open:true});
      } else {
        const last = blocks[blocks.length-1];
        if(last && last._open && prevLine && (prevLine.y - ln.y) < ln.h * 1.6 && !para){
          last.items[last.items.length-1].text += ' ' + ln.text;   // wrapped bullet
        } else {
          const newPara = !para || !prevLine || (prevLine.y - ln.y) > ln.h * 1.7;
          if(newPara){ endPara(); para = ln.text; } else para += ' ' + ln.text;
          if(blocks.length) delete blocks[blocks.length-1]._open;
        }
      }
      prevLine = ln; i++;
    }
    endPara();
    blocks.forEach(b => delete b._open);
  }
  return blocks;
}

/* ---------- read any file ---------- */
async function parseFile(file){
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let blocks;
  if(ext === 'doc' || ext === 'ppt') throw new Error('Older .' + ext + ' files are not supported. Open it and save it as .' + ext + 'x, then add it again.');
  if(ext === 'docx'){
    if(!window.mammoth) throw new Error('The Word reader did not load. Reload the page and try again.');
    const r = await mammoth.convertToHtml({arrayBuffer: await file.arrayBuffer()});
    blocks = htmlToBlocks(r.value);
  }
  else if(ext === 'pdf') blocks = await pdfToBlocks(await file.arrayBuffer());
  else if(['xlsx','xls','xlsm','ods'].includes(ext)) blocks = xlsxToBlocks(await file.arrayBuffer());
  else if(ext === 'pptx') blocks = await pptxToBlocks(await file.arrayBuffer());
  else if(ext === 'csv' || ext === 'tsv'){
    const text = (await file.text()).replace(/^\uFEFF/,'');
    const t = makeTable(parseDelimited(text, ext === 'tsv' ? '\t' : sniffDelim(text)), file.name.replace(/\.[^.]+$/,''));
    blocks = t ? [t] : [];
  }
  else if(ext === 'md' || ext === 'markdown') blocks = htmlToBlocks(marked.parse(await file.text(), {mangle:false, headerIds:false}));
  else if(ext === 'html' || ext === 'htm') blocks = htmlToBlocks(await file.text());
  else if(ext === 'json') blocks = jsonToBlocks(await file.text());
  else {
    const text = await file.text();
    if(text.includes('\u0000')) throw new Error('This file type (.' + ext + ') cannot be read. Try .docx, .pdf, .xlsx, .pptx, .csv, .md, .html, .json or .txt.');
    blocks = textToBlocks(text);
  }
  if(!blocks.length) throw new Error(ext === 'pdf'
    ? 'No selectable text was found. This may be a scanned PDF made of images, which this tool cannot read.'
    : 'No content was found in this file.');
  return {blocks, ext};
}

/* ---------- apply the table edits ---------- */
function effectiveDoc(){
  const blocks = [];
  for(const b of state.doc.blocks){
    if(b.t !== 'table'){ blocks.push(b); continue; }
    if(!b.include) continue;
    const keep = b.rows[0].map((_,i) => i).filter(i => !b.hiddenCols.has(i));
    if(!keep.length) continue;
    const rows = b.rows.map((r,ri) => ({r,ri})).filter(x => !b.hiddenRows.has(x.ri)).map(x => keep.map(c => x.r[c]));
    if(!rows.length) continue;
    blocks.push({t:'table', rows, header:b.header, name:b.name});
  }
  return {blocks, title:state.base};
}
const tablesOf = doc => doc.blocks.filter(b => b.t === 'table');
const tableTitle = (b, doc) => (b.name && tablesOf(doc).length > 1) ? b.name : '';
function numberItems(list){
  const cnt = [];
  return list.items.map(it => {
    const l = it.level || 0;
    if(list.t === 'ul') return '\u2022';
    cnt.length = l + 1; cnt[l] = (cnt[l] || 0) + 1;
    return cnt[l] + '.';
  });
}
function coerce(v){
  if(typeof v !== 'string') return v;
  const s = v.trim();
  if(/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(s)) return Number(s);
  return v;
}
function headerRow(b){ return b.header ? b.rows[0] : b.rows[0].map((_,i) => 'Column ' + letters(i)); }
function bodyRows(b){ return b.header ? b.rows.slice(1) : b.rows; }

/* ---------- writers ---------- */
function toMD(doc){
  const out = [];
  const cell = c => String(c).replace(/\|/g,'\\|').replace(/\n/g,' ');
  for(const b of doc.blocks){
    if(b.t === 'h') out.push('#'.repeat(Math.min(6,b.level)) + ' ' + b.text);
    else if(b.t === 'p') out.push(b.text);
    else if(b.t === 'ul' || b.t === 'ol'){
      const labels = numberItems(b);
      out.push(b.items.map((it,i) => '  '.repeat(it.level || 0) + (b.t === 'ul' ? '- ' : labels[i] + ' ') + it.text).join('\n'));
    }
    else if(b.t === 'code') out.push('```\n' + b.text + '\n```');
    else if(b.t === 'quote') out.push('> ' + b.text);
    else if(b.t === 'table'){
      const ttl = tableTitle(b, doc); if(ttl) out.push('### ' + ttl);
      const head = headerRow(b);
      out.push(['| ' + head.map(cell).join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |',
        ...bodyRows(b).map(r => '| ' + r.map(cell).join(' | ') + ' |')].join('\n'));
    }
  }
  return out.join('\n\n') + '\n';
}
function listHTML(b){
  const tag = b.t; let html = '<' + tag + '>', cur = 0, first = true;
  for(const it of b.items){
    const l = Math.min(it.level || 0, first ? 0 : cur + 1);
    if(first){ html += '<li>' + esc(it.text); first = false; cur = 0; continue; }
    if(l > cur){ html += '<' + tag + '><li>' + esc(it.text); cur = l; }
    else { while(cur > l){ html += '</li></' + tag + '>'; cur--; } html += '</li><li>' + esc(it.text); }
  }
  while(cur > 0){ html += '</li></' + tag + '>'; cur--; }
  return html + '</li></' + tag + '>';
}
function bodyHTML(doc){
  let h = '';
  for(const b of doc.blocks){
    if(b.t === 'h') h += '<h' + Math.min(6,b.level) + '>' + esc(b.text) + '</h' + Math.min(6,b.level) + '>\n';
    else if(b.t === 'p') h += '<p>' + esc(b.text) + '</p>\n';
    else if(b.t === 'ul' || b.t === 'ol') h += listHTML(b) + '\n';
    else if(b.t === 'code') h += '<pre>' + esc(b.text) + '</pre>\n';
    else if(b.t === 'quote') h += '<blockquote>' + esc(b.text) + '</blockquote>\n';
    else if(b.t === 'table'){
      const ttl = tableTitle(b, doc); if(ttl) h += '<h3>' + esc(ttl) + '</h3>\n';
      h += '<table>\n';
      if(b.header) h += '<thead><tr>' + b.rows[0].map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead>\n';
      h += '<tbody>\n' + bodyRows(b).map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('\n') + '\n</tbody></table>\n';
    }
  }
  return h;
}
const DOC_CSS = 'body{font:16px/1.6 system-ui,-apple-system,"Segoe UI","Noto Sans","Noto Sans Tamil","Nirmala UI",Arial,sans-serif;color:#1c2a25;max-width:860px;margin:2rem auto;padding:0 1rem}' +
  'h1,h2,h3{line-height:1.25}table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.95em}th,td{border:1px solid #c9d6cf;padding:6px 10px;text-align:left;vertical-align:top}' +
  'th{background:#e6eeea}pre{background:#f1f5f3;padding:12px;overflow:auto}blockquote{margin:1rem 0;padding-left:1rem;border-left:4px solid #c9d6cf;color:#51655c}';
function toHTML(doc){
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' +
    esc(doc.title) + '</title>\n<style>' + DOC_CSS + '</style>\n</head>\n<body>\n' + bodyHTML(doc) + '</body>\n</html>\n';
}
function toTXT(doc){
  const out = [];
  for(const b of doc.blocks){
    if(b.t === 'h'){ out.push(b.text + (b.level <= 2 ? '\n' + (b.level === 1 ? '=' : '-').repeat(Math.min(b.text.length, 80)) : '')); }
    else if(b.t === 'p') out.push(b.text);
    else if(b.t === 'ul' || b.t === 'ol'){ const l = numberItems(b); out.push(b.items.map((it,i) => '   '.repeat(it.level || 0) + (b.t === 'ul' ? '- ' : l[i] + ' ') + it.text).join('\n')); }
    else if(b.t === 'code') out.push(b.text);
    else if(b.t === 'quote') out.push('> ' + b.text);
    else if(b.t === 'table'){
      const ttl = tableTitle(b, doc); if(ttl) out.push(ttl);
      const w = b.rows[0].map((_,c) => Math.min(40, Math.max(...b.rows.map(r => r[c].length))));
      const line = r => r.map((c,i) => c.padEnd(w[i])).join(' | ').replace(/\s+$/,'');
      const lines = b.rows.map(line);
      if(b.header) lines.splice(1, 0, w.map(n => '-'.repeat(n)).join('-+-'));
      out.push(lines.join('\n'));
    }
  }
  return out.join('\n\n') + '\n';
}
function csvField(c){ c = String(c); return /[",\n\r]|^\s|\s$/.test(c) ? '"' + c.replace(/"/g,'""') + '"' : c; }
function toCSV(doc, choice){
  const tbs = tablesOf(doc);
  let rows;
  if(tbs.length){
    if(choice === 'all'){
      rows = [];
      tbs.forEach((t,i) => { if(i) rows.push([]); if(t.name && tbs.length > 1) rows.push([t.name]); rows.push(...t.rows); });
    } else rows = (tbs[Math.min(+choice || 0, tbs.length-1)]).rows;
  } else {
    rows = [];
    doc.blocks.forEach(b => {
      if(b.t === 'ul' || b.t === 'ol') b.items.forEach(it => rows.push([it.text]));
      else rows.push([b.text]);
    });
  }
  return '\uFEFF' + rows.map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
function colKeys(row){
  const seen = {};
  return row.map((h,i) => { let k = String(h || '').trim() || 'column_' + (i+1); if(seen[k]){ seen[k]++; k += '_' + seen[k]; } else seen[k] = 1; return k; });
}
function tableObjs(b){
  const keys = b.header ? colKeys(b.rows[0]) : b.rows[0].map((_,i) => 'column_' + (i+1));
  return bodyRows(b).map(r => Object.fromEntries(keys.map((k,i) => [k, coerce(r[i])])));
}
function toJSON(doc){
  const tbs = tablesOf(doc);
  let data;
  if(tbs.length && tbs.length === doc.blocks.length){
    if(tbs.length === 1) data = tableObjs(tbs[0]);
    else { data = {}; tbs.forEach((t,i) => { let k = t.name || 'table_' + (i+1); while(k in data) k += '_2'; data[k] = tableObjs(t); }); }
  } else {
    data = {blocks: doc.blocks.map(b => {
      if(b.t === 'h') return {type:'heading', level:b.level, text:b.text};
      if(b.t === 'p') return {type:'paragraph', text:b.text};
      if(b.t === 'ul' || b.t === 'ol') return {type:'list', ordered:b.t === 'ol', items:b.items.map(i => i.text)};
      if(b.t === 'code') return {type:'code', text:b.text};
      if(b.t === 'quote') return {type:'quote', text:b.text};
      return {type:'table', name:b.name || undefined, rows:tableObjs(b)};
    })};
  }
  return JSON.stringify(data, null, 2) + '\n';
}
function toXLSX(doc){
  if(!window.XLSX) throw new Error('The Excel writer did not load. Reload the page and try again.');
  const wb = XLSX.utils.book_new(), used = new Set();
  const sheetName = raw => {
    let n = String(raw || 'Sheet').replace(/[\\\/?*\[\]:]/g,'_').trim().slice(0,31) || 'Sheet', k = n, i = 2;
    while(used.has(k.toLowerCase())){ const suf = ' (' + i++ + ')'; k = n.slice(0, 31 - suf.length) + suf; }
    used.add(k.toLowerCase()); return k;
  };
  const addSheet = (aoa, name) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa.map(r => r.map(coerce)));
    const w = aoa[0].map((_,c) => Math.min(60, Math.max(8, ...aoa.slice(0,200).map(r => String(r[c] == null ? '' : r[c]).length + 2))));
    ws['!cols'] = w.map(x => ({wch:x}));
    XLSX.utils.book_append_sheet(wb, ws, sheetName(name));
  };
  let n = 0;
  tablesOf(doc).forEach(t => { n++; addSheet(t.rows, t.name || 'Table ' + n); });
  const text = [];
  doc.blocks.forEach(b => {
    if(b.t === 'table') return;
    if(b.t === 'ul' || b.t === 'ol'){ const l = numberItems(b); b.items.forEach((it,i) => text.push([l[i] + ' ' + it.text])); }
    else text.push([b.text]);
  });
  if(text.length) addSheet(text, 'Text');
  return XLSX.write(wb, {type:'array', bookType:'xlsx'});
}
async function toDOCX(doc){
  const D = window.docx;
  if(!D) throw new Error('The Word writer did not load. Reload the page and try again.');
  const H = [null, D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4, D.HeadingLevel.HEADING_5, D.HeadingLevel.HEADING_6];
  const kids = []; let inst = 0;
  const run = (t, o) => new D.TextRun(Object.assign({text:String(t)}, o || {}));
  for(const b of doc.blocks){
    if(b.t === 'h') kids.push(new D.Paragraph({heading:H[Math.min(6,b.level)], children:[run(b.text)]}));
    else if(b.t === 'p') kids.push(new D.Paragraph({spacing:{after:140}, children:[run(b.text)]}));
    else if(b.t === 'ul' || b.t === 'ol'){
      inst++;
      b.items.forEach(it => {
        const lvl = Math.min(it.level || 0, 5);
        kids.push(new D.Paragraph({children:[run(it.text)], ...(b.t === 'ul' ? {bullet:{level:lvl}} : {numbering:{reference:'ol', level:lvl, instance:inst}})}));
      });
    }
    else if(b.t === 'code') b.text.split('\n').forEach(l => kids.push(new D.Paragraph({children:[run(l, {font:'Consolas', size:19})]})));
    else if(b.t === 'quote') kids.push(new D.Paragraph({indent:{left:720}, spacing:{after:140}, children:[run(b.text, {italics:true})]}));
    else if(b.t === 'table'){
      const ttl = tableTitle(b, doc);
      if(ttl) kids.push(new D.Paragraph({heading:D.HeadingLevel.HEADING_3, children:[run(ttl)]}));
      const cols = b.rows[0].length, fs = cols > 8 ? 15 : cols > 6 ? 17 : 20;
      const edge = {style:D.BorderStyle.SINGLE, size:4, color:'C9D6CF'};
      kids.push(new D.Table({
        width:{size:100, type:D.WidthType.PERCENTAGE},
        borders:{top:edge, bottom:edge, left:edge, right:edge, insideHorizontal:edge, insideVertical:edge},
        rows:b.rows.map((r,ri) => new D.TableRow({
          tableHeader: b.header && ri === 0,
          children:r.map(c => new D.TableCell({
            margins:{top:60, bottom:60, left:100, right:100},
            shading:(b.header && ri === 0) ? {type:D.ShadingType.CLEAR, color:'auto', fill:'E1EBE6'} : undefined,
            children:[new D.Paragraph({children:[run(c, {bold:b.header && ri === 0, size:fs})]})]
          }))
        }))
      }));
      kids.push(new D.Paragraph({children:[]}));
    }
  }
  const wide = doc.blocks.some(b => b.t === 'table' && b.rows[0].length > 6);
  const d = new D.Document({
    creator:'File converter', title:doc.title,
    numbering:{config:[{reference:'ol', levels:[0,1,2,3,4,5].map(l => ({level:l, format:D.LevelFormat.DECIMAL, text:'%' + (l+1) + '.', alignment:D.AlignmentType.START,
      style:{paragraph:{indent:{left:720 + l*360, hanging:360}}}}))}]},
    sections:[{properties:{page:{size:{orientation: wide ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT}}}, children:kids}]
  });
  return await D.Packer.toBlob(d);
}
async function toPPTX(doc){
  if(!window.PptxGenJS) throw new Error('The PowerPoint writer did not load. Reload the page and try again.');
  const INK = '12261F', PRIMARY = '0F6B58', ACCENT = 'FFC93C';
  const P = new PptxGenJS(); P.layout = 'LAYOUT_WIDE';
  const W = 13.33, H = 7.5, M = 0.7;
  P.defineSlideMaster({title:'CONTENT', background:{color:'FFFFFF'}, objects:[
    {rect:{x:M, y:1.28, w:1.2, h:0.06, fill:{color:ACCENT}}},
    {placeholder:{options:{name:'title', type:'title', x:M, y:0.35, w:W - 2*M, h:0.9, fontFace:'Calibri', fontSize:28, bold:true, color:INK, valign:'middle', align:'left'}, text:''}}]});
  P.defineSlideMaster({title:'OPENER', background:{color:INK}, objects:[
    {rect:{x:M, y:4.35, w:1.6, h:0.08, fill:{color:ACCENT}}},
    {placeholder:{options:{name:'title', type:'title', x:M, y:2.4, w:W - 2*M, h:1.8, fontFace:'Calibri', fontSize:40, bold:true, color:'FFFFFF', valign:'middle', align:'left'}, text:''}}]});
  const slides = []; let cur = null;
  const start = (title, cont) => { cur = {title, cont:!!cont, items:[], chars:0}; slides.push(cur); };
  const add = (item, len) => {
    if(!cur) start(doc.title || 'Untitled');
    if(cur.items.length && cur.chars + len > 800) start(cur.title, true);
    cur.items.push(item); cur.chars += len;
  };
  for(const b of doc.blocks){
    if(b.t === 'h' && b.level <= 2){ start(b.text); continue; }
    if(b.t === 'h') add({k:'sub', text:b.text}, b.text.length + 40);
    else if(b.t === 'p') add({k:'p', text:b.text}, b.text.length + 40);
    else if(b.t === 'quote') add({k:'p', text:'\u201C' + b.text + '\u201D'}, b.text.length + 40);
    else if(b.t === 'ul' || b.t === 'ol'){ const l = numberItems(b); b.items.forEach((it,i) => add({k:'li', text:it.text, level:it.level || 0, ordered:b.t === 'ol'}, it.text.length + 30)); }
    else if(b.t === 'code') add({k:'code', text:b.text}, b.text.length + 60);
    else if(b.t === 'table'){
      const base = b.name || (cur && cur.title) || doc.title || 'Table';
      const head = b.header ? b.rows[0] : null, body = bodyRows(b), per = 10;
      for(let i = 0; i < Math.max(1, body.length); i += per){
        start(base, i > 0);
        cur.items.push({k:'table', head, rows:body.slice(i, i + per), cols:b.rows[0].length});
      }
    }
  }
  for(const s of slides){
    const sl = P.addSlide({masterName: s.items.length ? 'CONTENT' : 'OPENER'});
    sl.addText(s.title + (s.cont ? ' (cont.)' : ''), {placeholder:'title'});
    if(!s.items.length) continue;
    const tb = s.items.find(i => i.k === 'table');
    if(tb){
      const fs = tb.cols > 8 ? 9 : tb.cols > 6 ? 11 : tb.cols > 4 ? 13 : 15;
      const rows = [];
      if(tb.head) rows.push(tb.head.map(c => ({text:c, options:{bold:true, color:'FFFFFF', fill:{color:PRIMARY}, fontSize:fs, valign:'middle'}})));
      tb.rows.forEach((r,ri) => rows.push(r.map(c => ({text:c, options:{color:INK, fill:{color: ri % 2 ? 'F2F6F4' : 'FFFFFF'}, fontSize:fs, valign:'middle'}}))));
      sl.addTable(rows, {x:M, y:1.6, w:W - 2*M, border:{type:'solid', pt:0.5, color:'C9D6CF'}, margin:0.06, fontFace:'Calibri'});
    } else {
      const runs = [];
      s.items.forEach(it => {
        if(it.k === 'li') runs.push({text:it.text, options:{bullet: it.ordered ? {type:'number'} : true, indentLevel:Math.min(it.level, 4), breakLine:true, fontSize:20 - Math.min(it.level,3)*2, paraSpaceAfter:6}});
        else if(it.k === 'sub') runs.push({text:it.text, options:{bold:true, breakLine:true, fontSize:22, paraSpaceAfter:6}});
        else if(it.k === 'code') runs.push({text:it.text, options:{fontFace:'Courier New', fontSize:13, breakLine:true, paraSpaceAfter:6}});
        else runs.push({text:it.text, options:{breakLine:true, fontSize:20, paraSpaceAfter:10}});
      });
      sl.addText(runs, {x:M, y:1.6, w:W - 2*M, h:H - 2.2, fontFace:'Calibri', color:INK, valign:'top', fit:'shrink'});
    }
  }
  return await P.write({outputType:'arraybuffer'});
}
const PDF_MAP = {'\u2019':"'", '\u2018':"'", '\u201C':'"', '\u201D':'"', '\u2013':'-', '\u2014':'-', '\u2026':'...', '\u2022':'-', '\u00A0':' ', '\u2192':'->', '\u20AC':'EUR'};
function needsUnicode(doc){
  const re = /[^\u0000-\u00FF\u2019\u2018\u201C\u201D\u2013\u2014\u2026\u2022\u2192\u20AC]/;
  return doc.blocks.some(b => {
    if(b.t === 'table') return b.rows.some(r => r.some(c => re.test(c)));
    if(b.items) return b.items.some(i => re.test(i.text));
    return re.test(b.text || '');
  });
}
function toPDFText(doc){
  if(!window.jspdf) throw new Error('The PDF writer did not load. Reload the page and try again.');
  const {jsPDF} = window.jspdf;
  const safe = s => String(s).replace(/[\u2019\u2018\u201C\u201D\u2013\u2014\u2026\u2022\u00A0\u2192\u20AC]/g, ch => PDF_MAP[ch]);
  const wide = doc.blocks.some(b => b.t === 'table' && b.rows[0].length > 6);
  const pdf = new jsPDF({orientation: wide ? 'l' : 'p', unit:'pt', format:'a4'});
  const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight(), M = 48, maxW = pw - 2*M;
  let y = M;
  const INK = [18,38,31];
  const write = (text, o) => {
    o = Object.assign({size:10.5, bold:false, font:'helvetica', indent:0, hang:0, gap:7, label:''}, o || {});
    pdf.setFont(o.font, o.bold ? 'bold' : 'normal'); pdf.setFontSize(o.size); pdf.setTextColor(...INK);
    const lines = pdf.splitTextToSize(safe(text), maxW - o.indent - o.hang), lh = o.size * 1.4;
    lines.forEach((ln, i) => {
      if(y + lh > ph - M){ pdf.addPage(); y = M; }
      if(i === 0 && o.label) pdf.text(o.label, M + o.indent, y + o.size);
      pdf.text(ln, M + o.indent + o.hang, y + o.size);
      y += lh;
    });
    y += o.gap;
  };
  const sizes = [0, 22, 17, 14, 12, 11, 11];
  for(const b of doc.blocks){
    if(b.t === 'h'){ if(y + sizes[b.level] * 3 > ph - M){ pdf.addPage(); y = M; } y += 4; write(b.text, {size:sizes[Math.min(6,b.level)], bold:true, gap:6}); }
    else if(b.t === 'p') write(b.text);
    else if(b.t === 'quote') write(b.text, {indent:18});
    else if(b.t === 'code') write(b.text, {font:'courier', size:9});
    else if(b.t === 'ul' || b.t === 'ol'){
      const l = numberItems(b);
      b.items.forEach((it,i) => write(it.text, {indent:8 + (it.level || 0) * 16, hang:16, gap:3, label: b.t === 'ul' ? '-' : l[i]}));
      y += 5;
    }
    else if(b.t === 'table'){
      const ttl = tableTitle(b, doc); if(ttl) write(ttl, {size:13, bold:true, gap:4});
      const cols = b.rows[0].length;
      pdf.autoTable({
        startY:y, head:b.header ? [b.rows[0].map(safe)] : undefined, body:bodyRows(b).map(r => r.map(safe)),
        margin:{left:M, right:M, top:M, bottom:M},
        styles:{fontSize: cols > 9 ? 6.5 : cols > 6 ? 8 : 9.5, cellPadding:4, textColor:INK, lineColor:[201,214,207], lineWidth:0.4, overflow:'linebreak'},
        headStyles:{fillColor:[15,107,88], textColor:255},
        alternateRowStyles:{fillColor:[243,247,245]}
      });
      y = pdf.lastAutoTable.finalY + 16;
    }
  }
  const n = pdf.getNumberOfPages();
  for(let i = 1; i <= n; i++){ pdf.setPage(i); pdf.setFont('helvetica','normal'); pdf.setFontSize(8); pdf.setTextColor(120,130,125); pdf.text(i + ' / ' + n, pw/2, ph - 22, {align:'center'}); }
  return pdf.output('arraybuffer');
}
async function toPDFImage(doc){
  // Used when the text has characters the built-in PDF fonts cannot draw (Tamil, Hindi, Chinese, emoji...).
  if(!window.html2canvas || !window.jspdf) throw new Error('The PDF writer did not load. Reload the page and try again.');
  const {jsPDF} = window.jspdf;
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-99999px;top:0;width:740px;background:#fff;color:#1c2a25;box-sizing:border-box';
  host.innerHTML = '<style>' + DOC_CSS.replace(/body\{[^}]*\}/, '').replace('max-width:860px;margin:2rem auto;padding:0 1rem','') +
    ' .pdfroot{font:14px/1.55 system-ui,"Segoe UI","Noto Sans","Noto Sans Tamil","Nirmala UI",Arial,sans-serif;width:740px} .pdfroot table{font-size:11px} .pdfroot td,.pdfroot th{word-break:break-word}</style><div class="pdfroot">' + bodyHTML(doc) + '</div>';
  document.body.appendChild(host);
  try{
    if(document.fonts && document.fonts.ready) await document.fonts.ready;
    const SCALE = 2, top = host.getBoundingClientRect().top;
    const breaks = Array.from(host.querySelectorAll('.pdfroot > *, tr, li')).map(e => Math.round((e.getBoundingClientRect().bottom - top) * SCALE));
    const canvas = await html2canvas(host, {scale:SCALE, backgroundColor:'#ffffff', logging:false});
    const pdf = new jsPDF({unit:'pt', format:'a4'});
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight(), m = 34, cw = pw - 2*m;
    const sliceH = Math.floor(canvas.width * ((ph - 2*m) / cw));
    for(let start = 0, pg = 0; start < canvas.height; pg++){
      let end = Math.min(start + sliceH, canvas.height);
      if(end < canvas.height){
        const ok = breaks.filter(c => c <= end && c > start + sliceH * 0.5);
        if(ok.length) end = Math.max(...ok);
      }
      const h = end - start;
      const c = document.createElement('canvas'); c.width = canvas.width; c.height = h;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,h); ctx.drawImage(canvas, 0, start, canvas.width, h, 0, 0, c.width, h);
      if(pg) pdf.addPage();
      pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', m, m, cw, h * (cw / canvas.width));
      start = end;
    }
    return pdf.output('arraybuffer');
  } finally { host.remove(); }
}
async function toPDF(doc){
  if(needsUnicode(doc)) return {data: await toPDFImage(doc), notice:'This file contains characters the standard PDF fonts cannot draw, so the PDF was built from page images. Its text cannot be selected or searched.'};
  return {data: toPDFText(doc)};
}

const WRITERS = {
  docx: async d => ({data: await toDOCX(d)}),
  pdf: async d => await toPDF(d),
  xlsx: async d => ({data: toXLSX(d)}),
  pptx: async d => ({data: await toPPTX(d)}),
  csv: async d => ({data: toCSV(d, state.csvChoice)}),
  md: async d => ({data: toMD(d)}),
  html: async d => ({data: toHTML(d)}),
  txt: async d => ({data: toTXT(d)}),
  json: async d => ({data: toJSON(d)}),
};

/* ---------- saving ---------- */
async function saveBlob(filename, blob){
  let dl = null;
  try{ dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; }catch(e){ dl = null; }
  if(dl){ await dl.save({filename, data:blob}); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* =====================================================================
   UI
   ===================================================================== */
const els = {
  drop:$('#drop'), file:$('#file'), what:$('#dropWhat'), status:$('#status'), fmtPanel:$('#fmtPanel'), formats:$('#formats'),
  csvPick:$('#csvPick'), csvSel:$('#csvSel'), tblPanel:$('#tblPanel'), tblHint:$('#tblHint'), tables:$('#tables'),
  bar:$('#bar'), sum:$('#sum'), go:$('#go'), rFrom:$('#rFrom'), rTo:$('#rTo')
};
function setStatus(kind, html){
  if(!html){ els.status.hidden = true; return; }
  els.status.className = 'status ' + (kind || ''); els.status.innerHTML = html; els.status.hidden = false;
}
function renderFormats(){
  els.formats.innerHTML = FORMATS.map(f =>
    '<button type="button" class="fmt" data-f="' + f.id + '" aria-pressed="' + (f.id === state.target) + '"><span class="ext">.' + f.ext + '</span><span class="nm">' + f.name + '</span></button>').join('');
}
function renderRoute(){
  els.rFrom.textContent = state.doc ? '.' + state.srcExt : '.any';
  els.rFrom.classList.toggle('empty', !state.doc);
  els.rTo.textContent = state.doc ? '.' + fmtOf(state.target).ext : '.any';
  els.rTo.classList.toggle('empty', !state.doc);
}
function renderTables(){
  const tbs = state.doc.blocks.filter(b => b.t === 'table');
  els.tblPanel.hidden = false;
  if(!tbs.length){
    els.tblHint.textContent = '';
    els.tables.innerHTML = '<p class="empty-note">No tables found in this file. Headings, paragraphs and lists will be converted as they are.</p>';
    return;
  }
  els.tblHint.textContent = 'Remove any column or row you do not want in the result. Removed items are hatched and can be restored.';
  els.tables.innerHTML = tbs.map((b, ti) => {
    const cols = b.rows[0].length, dataStart = b.header ? 1 : 0, total = b.rows.length - dataStart;
    const limit = b.showAll ? total : Math.min(total, 8);
    const label = i => b.header ? (b.rows[0][i] || 'Column ' + letters(i)) : 'Column ' + letters(i);
    let h = '<article class="tbl' + (b.include ? '' : ' off') + '" data-t="' + ti + '">';
    h += '<div class="tbl-head"><label class="chk"><input type="checkbox" data-act="include"' + (b.include ? ' checked' : '') + '><input type="text" class="tname-input" data-act="rename-tbl" data-t="' + ti + '" value="' + esc(b.name || 'Table ' + (ti+1)) + '"></label>';
    h += '<span class="dims">' + total + ' row' + (total === 1 ? '' : 's') + ' &times; ' + cols + ' column' + (cols === 1 ? '' : 's') + '</span>';
    h += '<label class="chk"><input type="checkbox" data-act="header"' + (b.header ? ' checked' : '') + '><span>First row is the header</span></label></div>';
    h += '<div class="scroll"><table class="pv"><thead><tr><th class="rowctl"></th>';
    for(let c = 0; c < cols; c++){
      const off = b.hiddenCols.has(c);
      const lbl = label(c);
      h += '<th class="' + (off ? 'removed' : '') + '"><input type="text" class="cn-input" data-act="rename-col" data-c="' + c + '" value="' + esc(lbl) + '" aria-label="Column name"><button type="button" class="btn small" data-act="col" data-i="' + c + '" aria-pressed="' + off + '" aria-label="' + (off ? 'Restore' : 'Remove') + ' column ' + esc(lbl) + '">' + (off ? 'Restore' : 'Remove') + '</button></th>';
    }
    h += '</tr></thead><tbody>';
    for(let r = dataStart, shown = 0; r < b.rows.length && shown < limit; r++, shown++){
      const roff = b.hiddenRows.has(r);
      h += '<tr class="' + (roff ? 'rowoff' : '') + '"><td class="rowctl"><button type="button" class="xbtn" data-act="row" data-i="' + r + '" aria-label="' + (roff ? 'Restore' : 'Remove') + ' row ' + (r - dataStart + 1) + '" title="' + (roff ? 'Restore row' : 'Remove row') + '">' + (roff ? '&#8634;' : '&times;') + '</button></td>';
      for(let c = 0; c < cols; c++){
        const val = String(b.rows[r][c] || '');
        const lines = Math.min((val.match(/\n/g)||[]).length + 1, 5);
        h += '<td class="' + (b.hiddenCols.has(c) ? 'removed' : '') + '"><textarea class="cell-input" data-act="rename-cell" data-r="' + r + '" data-c="' + c + '" rows="' + lines + '">' + esc(val) + '</textarea></td>';
      }
      h += '</tr>';
    }
    h += '</tbody></table></div>';
    h += '<div class="tbl-foot">';
    if(total > 8) h += '<button type="button" class="btn small" data-act="more">' + (b.showAll ? 'Show fewer rows' : 'Show all ' + total + ' rows') + '</button>';
    const rc = b.hiddenCols.size, rr = b.hiddenRows.size;
    h += '<span>' + (rc || rr ? 'Removed: ' + (rc ? rc + ' column' + (rc === 1 ? '' : 's') : '') + (rc && rr ? ', ' : '') + (rr ? rr + ' row' + (rr === 1 ? '' : 's') : '') : 'Nothing removed') + '</span>';
    if(rc || rr) h += '<button type="button" class="linkbtn" data-act="restore">Restore all</button>';
    h += '</div></article>';
    return h;
  }).join('');
}
function renderCsvPick(){
  if(state.target !== 'csv' || !state.doc){ els.csvPick.hidden = true; return; }
  const tbs = tablesOf(effectiveDoc());
  if(tbs.length < 2){ els.csvPick.hidden = true; return; }
  const prev = state.csvChoice;
  els.csvSel.innerHTML = tbs.map((t,i) => '<option value="' + i + '">' + esc(t.name || 'Table ' + (i+1)) + '</option>').join('') + '<option value="all">All tables, one after another</option>';
  els.csvSel.value = (prev === 'all' || +prev < tbs.length) ? prev : '0';
  state.csvChoice = els.csvSel.value;
  els.csvPick.hidden = false;
}
function renderSummary(){
  const eff = effectiveDoc(), f = fmtOf(state.target);
  const all = state.doc.blocks.filter(b => b.t === 'table');
  const cols = all.reduce((a,b) => a + b.hiddenCols.size, 0), rows = all.reduce((a,b) => a + b.hiddenRows.size, 0);
  let s = '<b>' + esc(state.base) + '</b> to <b>' + f.name + ' (.' + f.ext + ')</b>';
  if(all.length) s += ' &middot; ' + tablesOf(eff).length + ' of ' + all.length + ' table' + (all.length === 1 ? '' : 's') + (cols ? ', ' + cols + ' column' + (cols === 1 ? '' : 's') + ' removed' : '') + (rows ? ', ' + rows + ' row' + (rows === 1 ? '' : 's') + ' removed' : '');
  els.sum.innerHTML = s;
}
function refresh(){
  renderRoute(); renderCsvPick(); renderSummary();
}
function showLoaded(){
  els.fmtPanel.hidden = false; els.bar.hidden = false;
  renderFormats(); renderTables(); refresh();
}
async function handleFile(file){
  setStatus('', '');
  els.what.innerHTML = '<strong>Reading ' + esc(file.name) + '&hellip;</strong><span>One moment</span>';
  try{
    const {blocks, ext} = await parseFile(file);
    state.doc = {blocks}; state.srcExt = ext; state.base = file.name.replace(/\.[^.]+$/, '') || 'converted'; state.last = null;
    state.target = ext === 'pdf' ? 'docx' : 'pdf'; state.csvChoice = '0';
    const nt = blocks.filter(b => b.t === 'table').length;
    const words = blocks.reduce((a,b) => a + (b.text ? b.text.split(/\s+/).length : 0) + (b.items ? b.items.reduce((x,i) => x + i.text.split(/\s+/).length, 0) : 0), 0);
    els.what.innerHTML = '<strong>' + esc(file.name) + '</strong><span>' + (nt ? nt + ' table' + (nt === 1 ? '' : 's') : 'No tables') + (words ? ' &middot; ' + words.toLocaleString() + ' words of text' : '') + '</span>';
    showLoaded();
    if(ext === 'pdf' && nt) setStatus('', 'Tables in PDFs are detected from the text layout, so check that the columns below line up before you convert.');
  }catch(err){
    console.error(err);
    state.doc = null;
    els.what.innerHTML = '<strong>Drop a file here</strong><span>or pick one from your device</span>';
    els.fmtPanel.hidden = true; els.tblPanel.hidden = true; els.bar.hidden = true; renderRoute();
    setStatus('err', esc(err.message || 'This file could not be read.'));
  }
}
async function convert(){
  if(state.busy || !state.doc) return;
  state.busy = true; els.go.disabled = true; els.go.textContent = 'Converting\u2026';
  setStatus('', 'Converting\u2026');
  try{
    const eff = effectiveDoc();
    if(!eff.blocks.length) throw new Error('Nothing is left to convert. Every table has been removed or unchecked.');
    const f = fmtOf(state.target);
    const res = await WRITERS[f.id](eff);
    const blob = res.data instanceof Blob ? res.data : new Blob([res.data], {type:MIME[f.id]});
    const name = state.base + (f.ext === state.srcExt ? '-edited' : '') + '.' + f.ext;
    state.last = {name, blob};
    const kb = blob.size > 1048576 ? (blob.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(blob.size / 1024)) + ' KB';
    setStatus('ok', '<b>' + esc(name) + '</b> is ready (' + kb + ').' + (res.notice ? '<p class="note">' + esc(res.notice) + '</p>' : '') +
      '<div class="actions"><button type="button" class="btn primary" id="saveAgain">Save file</button></div>');
    try{ await saveBlob(name, blob); }catch(e){ if(!(e && e.code === 'declined')) console.warn(e); }
  }catch(err){
    console.error(err);
    setStatus('err', esc(err.message || 'The conversion failed.'));
  }finally{
    state.busy = false; els.go.disabled = false; els.go.textContent = 'Convert';
  }
}

/* ---------- events ---------- */
$('#pick').addEventListener('click', () => els.file.click());
els.file.addEventListener('change', () => { if(els.file.files[0]) handleFile(els.file.files[0]); els.file.value = ''; });
['dragenter','dragover'].forEach(ev => els.drop.addEventListener(ev, e => { e.preventDefault(); els.drop.classList.add('over'); }));
['dragleave','drop'].forEach(ev => els.drop.addEventListener(ev, e => { e.preventDefault(); els.drop.classList.remove('over'); }));
els.drop.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if(f) handleFile(f); });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());
$('#sample').addEventListener('click', () => {
  const csv = 'Product,Category,Region,Units sold,Revenue,Internal notes\n' +
    'Desk lamp,Home,South,120,4800,Restock in May\nStanding desk,Office,North,45,31500,Supplier delay\nNotebook set,Stationery,East,860,6880,Bestseller\n' +
    'Water bottle,Outdoor,West,300,5400,Bundle with mug\nErgonomic chair,Office,North,60,27000,Check warranty\nCoffee mug,Home,South,510,4590,Seasonal\n' +
    'Backpack,Outdoor,East,150,9750,New colours\nDesk mat,Office,West,220,4400,Low stock\nPlanner,Stationery,South,410,5330,Bestseller\nPhone stand,Office,East,390,3120,Reprice\n';
  handleFile(new File([csv], 'sample-sales.csv', {type:'text/csv'}));
});
els.formats.addEventListener('click', e => {
  const b = e.target.closest('.fmt'); if(!b) return;
  state.target = b.dataset.f; state.last = null;
  els.formats.querySelectorAll('.fmt').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
  refresh();
});
els.csvSel.addEventListener('change', () => { state.csvChoice = els.csvSel.value; });
els.tables.addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]'); if(!btn) return;
  const art = btn.closest('.tbl'), b = state.doc.blocks.filter(x => x.t === 'table')[+art.dataset.t], i = +btn.dataset.i;
  const act = btn.dataset.act;
  if(act === 'col') b.hiddenCols.has(i) ? b.hiddenCols.delete(i) : b.hiddenCols.add(i);
  else if(act === 'row') b.hiddenRows.has(i) ? b.hiddenRows.delete(i) : b.hiddenRows.add(i);
  else if(act === 'more') b.showAll = !b.showAll;
  else if(act === 'restore'){ b.hiddenCols.clear(); b.hiddenRows.clear(); }
  const y = window.scrollY; renderTables(); refresh(); window.scrollTo(0, y);
  const again = els.tables.querySelector('[data-t="' + art.dataset.t + '"] button[data-act="' + act + '"]' + (act === 'col' || act === 'row' ? '[data-i="' + i + '"]' : ''));
  if(again) again.focus({preventScroll:true});
});
els.tables.addEventListener('change', e => {
  const inp = e.target.closest('input[data-act]'); if(!inp) return;
  const art = inp.closest('.tbl'), b = state.doc.blocks.filter(x => x.t === 'table')[+art.dataset.t];
  if(inp.dataset.act === 'include') b.include = inp.checked;
  if(inp.dataset.act === 'header'){ b.header = inp.checked; b.hiddenRows.delete(0); b.hiddenCols.clear(); }
  renderTables(); refresh();
});
els.tables.addEventListener('input', e => {
  if(!e.target.dataset.act || !e.target.dataset.act.startsWith('rename')) return;
  const art = e.target.closest('.tbl');
  const b = state.doc.blocks.filter(x => x.t === 'table')[+art.dataset.t];
  
  if(e.target.dataset.act === 'rename-tbl'){
    b.name = e.target.value;
    state.last = null;
    refresh();
  }
  else if(e.target.dataset.act === 'rename-col'){
    const c = +e.target.dataset.c;
    if(!b.header){
      const newRow = Array(b.rows[0].length).fill('').map((_,i) => 'Column ' + letters(i));
      b.rows.unshift(newRow);
      b.header = true;
      const newHiddenRows = new Set();
      for(let r of b.hiddenRows) newHiddenRows.add(r + 1);
      b.hiddenRows = newHiddenRows;
      
      const selStart = e.target.selectionStart;
      const selEnd = e.target.selectionEnd;
      b.rows[0][c] = e.target.value;
      
      renderTables(); refresh();
      
      const newInp = els.tables.querySelector('article[data-t="' + art.dataset.t + '"] input[data-c="' + c + '"]');
      if(newInp){ newInp.focus(); newInp.setSelectionRange(selStart, selEnd); }
      return;
    }
    b.rows[0][c] = e.target.value;
    state.last = null;
    refresh();
  }
  else if(e.target.dataset.act === 'rename-cell'){
    const r = +e.target.dataset.r;
    const c = +e.target.dataset.c;
    b.rows[r][c] = e.target.value;
    state.last = null;
  }
});
els.go.addEventListener('click', convert);
els.status.addEventListener('click', async e => {
  if(e.target.id !== 'saveAgain' || !state.last) return;
  try{ await saveBlob(state.last.name, state.last.blob); }catch(err){ if(!(err && err.code === 'declined')) console.warn(err); }
});
renderFormats(); renderRoute();

/* ---------- theme toggle ---------- */
(function(){
  const btn = document.getElementById('themeToggle');
  if(!btn) return;
  const root = document.documentElement;
  const saved = localStorage.getItem('theme');
  if(saved) root.setAttribute('data-theme', saved);
  btn.addEventListener('click', ()=>{
    const current = root.getAttribute('data-theme');
    const isDark = current === 'dark' || (!current && window.matchMedia('(prefers-color-scheme:dark)').matches);
    const next = isDark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });
})();
