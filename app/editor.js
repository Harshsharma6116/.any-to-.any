import { state } from './state.js';
import { letters } from './utils.js';

export function effectiveDoc() {
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

export const tablesOf = doc => doc.blocks.filter(b => b.t === 'table');
export const tableTitle = (b, doc) => (b.name && tablesOf(doc).length > 1) ? b.name : '';

export function numberItems(list) {
  const cnt = [];
  return list.items.map(it => {
    const l = it.level || 0;
    if(list.t === 'ul') return '\u2022';
    cnt.length = l + 1; cnt[l] = (cnt[l] || 0) + 1;
    return cnt[l] + '.';
  });
}

export function coerce(v) {
  if(typeof v !== 'string') return v;
  const s = v.trim();
  if(/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(s)) return Number(s);
  return v;
}

export function headerRow(b) { 
  return b.header ? b.rows[0] : b.rows[0].map((_,i) => 'Column ' + letters(i)); 
}

export function bodyRows(b) { 
  return b.header ? b.rows.slice(1) : b.rows; 
}
