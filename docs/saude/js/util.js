// Utilitários: datas, formatação e construção de DOM.

const pad = (n) => String(n).padStart(2, '0');

/** Data local no formato AAAA-MM-DD. */
export function isoData(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Data e hora local no formato AAAA-MM-DDTHH:MM (o mesmo do input datetime-local). */
export function isoDataHora(d = new Date()) {
  return `${isoData(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const hoje = () => isoData();

export function addDias(base, n) {
  const d = base ? paraData(base) : new Date();
  d.setDate(d.getDate() + n);
  return isoData(d);
}

/** Converte 'AAAA-MM-DD' ou 'AAAA-MM-DDTHH:MM' em Date local (sem deslocamento de fuso). */
export function paraData(v) {
  if (v instanceof Date) return new Date(v.getTime());
  if (!v) return null;
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) { const d = new Date(s); return isNaN(d) ? null : d; }
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

/** Dias corridos de hoje até a data (negativo = já passou). */
export function diasAte(v) {
  const d = paraData(v);
  if (!d) return null;
  const a = paraData(hoje());
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((b - a) / 86400000);
}

/**
 * Semana epidemiológica (domingo a sábado). A SE 1 é a primeira semana do ano
 * com pelo menos quatro dias em janeiro.
 */
export function semanaEpi(v = new Date()) {
  const d = paraData(v);
  const dia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const inicio = (ano) => {
    const dow = new Date(ano, 0, 1).getDay();
    return new Date(ano, 0, 1 - dow + (dow >= 4 ? 7 : 0));
  };
  let ano = dia.getFullYear();
  if (dia >= inicio(ano + 1)) ano += 1;
  else if (dia < inicio(ano)) ano -= 1;
  const se = Math.floor(Math.round((dia - inicio(ano)) / 86400000) / 7) + 1;
  return { ano, se };
}

export function diasDesde(v) {
  const n = diasAte(v);
  return n == null ? null : -n;
}

export function fmtData(v) {
  const d = paraData(v);
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : '';
}

export function fmtDataHora(v) {
  const d = paraData(v);
  if (!d) return '';
  const temHora = /T\d{2}:\d{2}/.test(String(v)) || v instanceof Date;
  return temHora ? `${fmtData(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : fmtData(d);
}

export function fmtHora(v) {
  const d = paraData(v);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
const moedaCurta = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const numero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export const fmtMoeda = (v) => (v == null || v === '' ? '' : moeda.format(Number(v) || 0));
export const fmtNum = (v) => (v == null || v === '' ? '' : numero.format(Number(v) || 0));
export const fmtPct = (v) => (v == null || !isFinite(v) ? '—' : `${numero.format(v)}%`);

/** R$ 12,3 mi / R$ 450 mil — para cartões de indicador. */
export function fmtMoedaCurta(v) {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  if (a >= 1e9) return `R$ ${moedaCurta.format(n / 1e9)} bi`;
  if (a >= 1e6) return `R$ ${moedaCurta.format(n / 1e6)} mi`;
  if (a >= 1e3) return `R$ ${moedaCurta.format(n / 1e3)} mil`;
  return moeda.format(n);
}

export function tempoRelativo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return 'agora';
  if (s < 60) return `há ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

/** Texto sem acentos e em minúsculas, para busca. */
export const normalizar = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function iniciais(nome) {
  const p = String(nome || '?').trim().split(/\s+/).filter((x) => /^\p{L}/u.test(x) && !/^(de|da|do|dos|das|e)$/i.test(x));
  if (!p.length) return '?';
  return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

export function novoId(prefixo = 'r') {
  const r = (crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(2)) : [Math.random() * 2 ** 32, Math.random() * 2 ** 32]);
  return `${prefixo}-${Date.now().toString(36)}${Array.from(r, (x) => (x >>> 0).toString(36)).join('').slice(0, 8)}`;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/**
 * Cria elementos: h('div', {class:'x', onclick: fn}, 'texto', outroNo, [lista]).
 * Atributos com valor false/null são omitidos; filhos falsy são ignorados.
 */
export function h(tag, attrs, ...filhos) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false || k === 'value') continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  anexar(el, filhos);
  if (attrs && attrs.value != null) el.value = attrs.value; // depois dos filhos (select precisa das opções)
  return el;
}

/** Substitui os filhos de um elemento, ignorando valores falsy (como h()). */
export function repor(el, ...filhos) {
  el.replaceChildren();
  anexar(el, filhos);
  return el;
}

function anexar(el, filhos) {
  for (const f of filhos) {
    if (f == null || f === false || f === '') continue;
    if (Array.isArray(f)) anexar(el, f);
    else el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
}

/** Escapa texto para CSV (separador ';', compatível com Excel em pt-BR). */
export function csv(linhas) {
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // evita injeção de fórmula
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + linhas.map((l) => l.map(esc).join(';')).join('\r\n');
}

export function baixar(nome, conteudo, tipo = 'text/csv;charset=utf-8') {
  const blob = new Blob([conteudo], { type: tipo });
  const a = h('a', { href: URL.createObjectURL(blob), download: nome });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Gerador pseudoaleatório determinístico (dados de demonstração reproduzíveis). */
export function prng(semente = 42) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
