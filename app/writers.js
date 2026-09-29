import { state } from './state.js';
import { esc } from './utils.js';
import { numberItems, tableTitle, headerRow, bodyRows, tablesOf, coerce } from './editor.js';

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

export const WRITERS = {
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
export async function saveBlob(filename, blob){
  let dl = null;
  try{ dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; }catch(e){ dl = null; }
  if(dl){ await dl.save({filename, data:blob}); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

