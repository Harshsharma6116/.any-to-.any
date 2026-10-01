export const PDF_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

export const FORMATS = [
  {id:'docx', ext:'docx', name:'Word'},
  {id:'pdf',  ext:'pdf',  name:'PDF'},
  {id:'xlsx', ext:'xlsx', name:'Excel'},
  {id:'pptx', ext:'pptx', name:'PowerPoint'},
  {id:'csv',  ext:'csv',  name:'CSV'},
  {id:'md',   ext:'md',   name:'Markdown'},
  {id:'html', ext:'html', name:'HTML'},
  {id:'txt',  ext:'txt',  name:'Plain text'},
  {id:'json', ext:'json', name:'JSON'},
  {id:'jpg',  ext:'jpg',  name:'JPEG Image'},
  {id:'png',  ext:'png',  name:'PNG Image'}
];

export const MIME = {
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf:'application/pdf', 
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv:'text/csv', 
  md:'text/markdown', 
  html:'text/html', 
  txt:'text/plain', 
  json:'application/json',
  jpg:'image/jpeg',
  png:'image/png'
};

export const state = {
  doc:null, 
  base:'', 
  srcExt:'', 
  target:'pdf', 
  csvChoice:'0', 
  last:null, 
  busy:false,
  editorMode: 'table',
  currentFile: null
};

export const fmtOf = id => FORMATS.find(f => f.id === id);
