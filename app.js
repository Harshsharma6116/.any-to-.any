import { state, MIME, fmtOf } from './app/state.js';
import { $, esc, letters } from './app/utils.js';
import { effectiveDoc } from './app/editor.js';
import { parseFile } from './app/readers.js';
import { WRITERS, saveBlob } from './app/writers.js';
import { els, setStatus, renderRoute, renderTables, refresh, showLoaded, renderFormats } from './app/ui.js';

async function handleFile(file){
  state.currentFile = file;
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
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'table'));
  state.editorMode = 'table';
  renderFormats(); renderRoute();
  const csv = 'Product,Category,Region,Units sold,Revenue,Internal notes\n' +
    'Desk lamp,Home,South,120,4800,Restock in May\nStanding desk,Office,North,45,31500,Supplier delay\nNotebook set,Stationery,East,860,6880,Bestseller\n' +
    'Water bottle,Outdoor,West,300,5400,Bundle with mug\nErgonomic chair,Office,North,60,27000,Check warranty\nCoffee mug,Home,South,510,4590,Seasonal\n' +
    'Backpack,Outdoor,East,150,9750,New colours\nDesk mat,Office,West,220,4400,Low stock\nPlanner,Stationery,South,410,5330,Bestseller\nPhone stand,Office,East,390,3120,Reprice\n';
  handleFile(new File([csv], 'sample-sales.csv', {type:'text/csv'}));
});
$('#sampleDoc').addEventListener('click', () => {
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'full'));
  state.editorMode = 'full';
  renderFormats(); renderRoute();
  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = 300;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e6eeea'; ctx.fillRect(0,0,600,300);
  ctx.fillStyle = '#0f6b58'; ctx.font = 'bold 32px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Mars Surface Rover Schematic', 300, 150);
  const b64 = canvas.toDataURL('image/png');

  const html = `
    <h1>Mars Exploration Plan</h1>
    <p>This document outlines the high-level plan for establishing a permanent presence on Mars.</p>
    <h2>Key Objectives</h2>
    <ul>
      <li>Establish automated supply chain</li>
      <li>Build pressurized habitats</li>
      <li>Begin local resource utilization</li>
    </ul>
    <h2>Surface Vehicles</h2>
    <img src="${b64}" alt="Rover Schematic">
    <h2>Budget Breakdown</h2>
    <table>
      <tr><th>Phase</th><th>Cost (B)</th><th>Timeline</th></tr>
      <tr><td>Uncrewed Supply</td><td>4.2</td><td>2028-2032</td></tr>
      <tr><td>Habitat Construction</td><td>8.5</td><td>2032-2035</td></tr>
      <tr><td>Crewed Arrival</td><td>12.0</td><td>2036-2040</td></tr>
    </table>
  `;
  handleFile(new File([html], 'sample-document.html', {type:'text/html'}));
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
els.tables.addEventListener('input', e => {
  if (e.target.dataset.act === 'edit-text') {
    const b = state.doc.blocks[+e.target.dataset.b];
    if (b.t === 'ul' || b.t === 'ol') {
      b.items[+e.target.dataset.i].text = e.target.value;
    } else {
      b.text = e.target.value;
    }
    state.last = null;
  }
});

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    state.editorMode = e.target.dataset.mode;
    renderFormats();
    renderRoute();
    if (state.currentFile) handleFile(state.currentFile);
  });
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
