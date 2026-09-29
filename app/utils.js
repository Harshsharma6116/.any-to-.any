export const $ = (s, r=document) => r.querySelector(s);
export const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export const clean = s => String(s == null ? '' : s).replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/\s*\n\s*/g,' ').trim();

export function letters(i) {
  let s='';
  i++;
  while(i>0) {
    const m=(i-1)%26;
    s=String.fromCharCode(65+m)+s;
    i=Math.floor((i-1)/26);
  }
  return s;
}

export function normRows(rows) {
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

export function makeTable(rows, name) {
  rows = normRows(rows);
  if(!rows.length) return null;
  return {
    t:'table', 
    rows, 
    name:name||'', 
    header:true, 
    include:true, 
    hiddenCols:new Set(), 
    hiddenRows:new Set(), 
    showAll:false
  };
}
