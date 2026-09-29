import { PDF_WORKER } from './state.js';
import { clean, makeTable } from './utils.js';

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
export async function parseFile(file){
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

