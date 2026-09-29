import { state, FORMATS, fmtOf } from './state.js';
import { $, esc, letters } from './utils.js';
import { effectiveDoc, tablesOf } from './editor.js';

export const els = {
  drop:$('#drop'), file:$('#file'), what:$('#dropWhat'), status:$('#status'), fmtPanel:$('#fmtPanel'), formats:$('#formats'),
  csvPick:$('#csvPick'), csvSel:$('#csvSel'), tblPanel:$('#tblPanel'), tblHint:$('#tblHint'), tables:$('#tables'),
  bar:$('#bar'), sum:$('#sum'), go:$('#go'), rFrom:$('#rFrom'), rTo:$('#rTo')
};
export function setStatus(kind, html){
  if(!html){ els.status.hidden = true; return; }
  els.status.className = 'status ' + (kind || ''); els.status.innerHTML = html; els.status.hidden = false;
}
export function renderFormats(){
  const isFull = state.editorMode === 'full';
  const isSnapshot = state.editorMode === 'snapshot';
  const allowed = isSnapshot ? ['pptx', 'docx', 'pdf'] : isFull ? ['docx', 'pdf', 'pptx', 'md', 'html', 'txt'] : FORMATS.map(f => f.id);
  const visibleFormats = FORMATS.filter(f => allowed.includes(f.id));
  
  if ((isFull || isSnapshot) && !allowed.includes(state.target)) {
    state.target = 'docx';
  }
  
  els.formats.innerHTML = visibleFormats.map(f =>
    '<button type="button" class="fmt" data-f="' + f.id + '" aria-pressed="' + (f.id === state.target) + '"><span class="ext">.' + f.ext + '</span><span class="nm">' + f.name + '</span></button>').join('');
}
export function renderRoute(){
  els.rFrom.textContent = state.doc ? '.' + state.srcExt : '.any';
  els.rFrom.classList.toggle('empty', !state.doc);
  els.rTo.textContent = state.doc ? '.' + fmtOf(state.target).ext : '.any';
  els.rTo.classList.toggle('empty', !state.doc);
}
export function renderTables(){
  els.tblPanel.hidden = false;
  const isFull = state.editorMode === 'full';
  const isSnapshot = state.editorMode === 'snapshot';
  
  if (isSnapshot) {
    els.tblHint.textContent = 'Each page of the PDF has been perfectly captured as an image. Text editing is disabled in this mode.';
    els.tables.innerHTML = state.doc.blocks.map(b => {
      if (b.t === 'snapshot') return '<img class="img-preview" src="' + b.src + '" alt="Snapshot preview" style="width:100%; max-width:800px; border:1px solid var(--line); margin-bottom:16px;">';
      return '';
    }).join('');
    return;
  }
  
  if (!isFull) {
    const tbs = state.doc.blocks.filter(b => b.t === 'table');
    if(!tbs.length){
      els.tblHint.textContent = '';
      els.tables.innerHTML = '<p class="empty-note">No tables found in this file. Headings, paragraphs and lists will be converted as they are.</p>';
      return;
    }
    els.tblHint.textContent = 'Remove any column or row you do not want in the result. Removed items are hatched and can be restored.';
    els.tables.innerHTML = renderTableBlocks(tbs, state.doc.blocks);
    return;
  }

  els.tblHint.textContent = 'Edit the text directly. Read-only images and tables are shown below.';
  els.tables.innerHTML = state.doc.blocks.map((b, bi) => {
    if (b.t === 'p') return '<textarea class="text-edit p-edit" data-act="edit-text" data-b="' + bi + '" rows="' + Math.min((b.text.match(/\n/g)||[]).length+2, 10) + '">' + esc(b.text) + '</textarea>';
    if (b.t === 'h') return '<input type="text" class="text-edit h-edit h' + b.level + '" data-act="edit-text" data-b="' + bi + '" value="' + esc(b.text) + '">';
    if (b.t === 'image') return '<img class="img-preview" src="' + b.src + '" alt="Image preview">';
    if (b.t === 'ul' || b.t === 'ol') {
      return '<div class="list-wrap">' + b.items.map((it, i) => 
        '<div class="list-item-wrap"><span class="bullet">' + (b.t === 'ul' ? '&bull;' : (i+1)+'.') + '</span><input type="text" class="text-edit li-edit" data-act="edit-text" data-b="' + bi + '" data-i="' + i + '" value="' + esc(it.text) + '"></div>'
      ).join('') + '</div>';
    }
    if (b.t === 'table') {
      return renderTableBlocks([b], state.doc.blocks, true);
    }
    if (b.t === 'quote') return '<textarea class="text-edit p-edit" data-act="edit-text" data-b="' + bi + '" style="border-left:4px solid var(--line); padding-left:12px;">' + esc(b.text) + '</textarea>';
    if (b.t === 'code') return '<textarea class="text-edit p-edit" data-act="edit-text" data-b="' + bi + '" style="font-family:monospace; background:var(--bg)">' + esc(b.text) + '</textarea>';
    return '';
  }).join('');
}

function renderTableBlocks(tbs, allBlocks, isSingle = false) {
  return tbs.map(b => {
    const ti = allBlocks.indexOf(b);
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
export function renderCsvPick(){
  if(state.target !== 'csv' || !state.doc){ els.csvPick.hidden = true; return; }
  const tbs = tablesOf(effectiveDoc());
  if(tbs.length < 2){ els.csvPick.hidden = true; return; }
  const prev = state.csvChoice;
  els.csvSel.innerHTML = tbs.map((t,i) => '<option value="' + i + '">' + esc(t.name || 'Table ' + (i+1)) + '</option>').join('') + '<option value="all">All tables, one after another</option>';
  els.csvSel.value = (prev === 'all' || +prev < tbs.length) ? prev : '0';
  state.csvChoice = els.csvSel.value;
  els.csvPick.hidden = false;
}
export function renderSummary(){
  const eff = effectiveDoc(), f = fmtOf(state.target);
  const all = state.doc.blocks.filter(b => b.t === 'table');
  const cols = all.reduce((a,b) => a + b.hiddenCols.size, 0), rows = all.reduce((a,b) => a + b.hiddenRows.size, 0);
  let s = '<b>' + esc(state.base) + '</b> to <b>' + f.name + ' (.' + f.ext + ')</b>';
  if(all.length) s += ' &middot; ' + tablesOf(eff).length + ' of ' + all.length + ' table' + (all.length === 1 ? '' : 's') + (cols ? ', ' + cols + ' column' + (cols === 1 ? '' : 's') + ' removed' : '') + (rows ? ', ' + rows + ' row' + (rows === 1 ? '' : 's') + ' removed' : '');
  els.sum.innerHTML = s;
}
export function refresh(){
  renderRoute(); renderCsvPick(); renderSummary();
}
export function showLoaded(){
  els.fmtPanel.hidden = false; els.bar.hidden = false;
  renderFormats(); renderTables(); refresh();
}
