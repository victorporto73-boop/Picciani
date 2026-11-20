// Componentes de interface: avisos, gaveta lateral, chips, gráficos e campos de formulário.

import { h, fmtPct, fmtNum, fmtData, diasAte, repor } from './util.js';
import { icone } from './icones.js';

// ───────── toasts ─────────
export function toast(msg, tom = 'info', ms = 4200, acao = null) {
  let pilha = document.getElementById('toasts');
  if (!pilha) { pilha = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(pilha); }
  const el = h('div', { class: `toast t-${tom}` },
    h('span', { class: 'toast-txt' }, msg),
    acao && h('button', { class: 'toast-acao', onclick: () => { acao.fn(); el.remove(); } }, acao.rotulo),
    h('button', { class: 'toast-x', 'aria-label': 'Fechar', onclick: () => el.remove() }, icone('fechar', 14)));
  pilha.append(el);
  setTimeout(() => el.classList.add('sai'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

// ───────── dica flutuante (hover) ─────────
let dica = null;
export function ativarDicas() {
  dica = h('div', { class: 'dica', role: 'tooltip' });
  document.body.append(dica);
  const mostrar = (e) => {
    const alvo = e.target.closest && e.target.closest('[data-dica]');
    if (!alvo) { dica.classList.remove('on'); return; }
    dica.textContent = alvo.dataset.dica;
    dica.classList.add('on');
    const r = alvo.getBoundingClientRect();
    const w = dica.offsetWidth;
    const x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    const y = r.top - dica.offsetHeight - 8;
    dica.style.left = `${x}px`;
    dica.style.top = `${y < 8 ? r.bottom + 8 : y}px`;
  };
  document.addEventListener('mouseover', mostrar);
  document.addEventListener('focusin', mostrar);
  document.addEventListener('scroll', () => dica.classList.remove('on'), true);
}

// ───────── gaveta lateral ─────────
let gavetaAtual = null;
export function abrirGaveta(conteudo, { aoFechar, largura } = {}) {
  fecharGaveta(true);
  const fundo = h('div', { class: 'gaveta-fundo', onclick: () => fecharGaveta() });
  const painel = h('aside', { class: 'gaveta', role: 'dialog', 'aria-modal': 'true', style: largura ? { maxWidth: largura } : null }, conteudo);
  document.body.append(fundo, painel);
  requestAnimationFrame(() => { fundo.classList.add('on'); painel.classList.add('on'); });
  gavetaAtual = { fundo, painel, aoFechar };
  document.body.classList.add('com-gaveta');
  return painel;
}
export function fecharGaveta(semCallback = false) {
  if (!gavetaAtual) return;
  const g = gavetaAtual;
  gavetaAtual = null;
  g.fundo.classList.remove('on');
  g.painel.classList.remove('on');
  setTimeout(() => { g.fundo.remove(); g.painel.remove(); }, 220);
  document.body.classList.remove('com-gaveta');
  if (!semCallback && g.aoFechar) g.aoFechar();
}
export const gavetaAberta = () => !!gavetaAtual;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && gavetaAtual) fecharGaveta(); });

export function confirmar(msg, rotulo = 'Confirmar', perigo = false) {
  return new Promise((ok) => {
    const fundo = h('div', { class: 'modal-fundo' });
    const fim = (v) => { fundo.remove(); ok(v); };
    fundo.append(h('div', { class: 'modal', role: 'alertdialog' },
      h('p', null, msg),
      h('div', { class: 'modal-acoes' },
        h('button', { class: 'btn', onclick: () => fim(false) }, 'Cancelar'),
        h('button', { class: `btn ${perigo ? 'btn-perigo' : 'btn-pri'}`, onclick: () => fim(true) }, rotulo))));
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fim(false); });
    document.body.append(fundo);
    fundo.querySelector('.btn-pri, .btn-perigo').focus();
  });
}

// ───────── chips de situação ─────────
export function chip(texto, tom = 'mute', extra = '') {
  if (texto == null || texto === '') return '';
  return h('span', { class: `chip t-${tom} ${extra}` }, String(texto));
}

export function chipPrazo(d) {
  if (d == null) return h('span', { class: 'muted' }, '—');
  if (d < 0) return chip(`vencido há ${-d} d`, 'crit');
  if (d === 0) return chip('vence hoje', 'crit');
  if (d <= 3) return chip(`${d} d`, 'crit');
  if (d <= 7) return chip(`${d} dias`, 'warn');
  return chip(`${d} dias`, 'mute');
}

export function chipNivel(nv) {
  return chip(nv, { Ruptura: 'crit', Crítico: 'crit', Atenção: 'warn', Adequado: 'ok' }[nv] || 'mute');
}

export function barraPct(v, { limites = [85, 100], neutro = false } = {}) {
  if (v == null || !isFinite(v)) return h('span', { class: 'muted' }, '—');
  const tom = neutro ? 'info' : v >= limites[1] ? 'crit' : v >= limites[0] ? 'warn' : 'ok';
  return h('span', { class: 'mini-barra', 'data-dica': fmtPct(v) },
    h('span', { class: 'mini-trilho' }, h('span', { class: `mini-valor b-${tom}`, style: { width: `${Math.min(100, v)}%` } })),
    h('span', { class: 'mini-num' }, fmtPct(v)));
}

export function selo(nivel, msg) {
  return h('span', { class: `selo s-${nivel}`, 'data-dica': msg }, icone(nivel === 'crit' ? 'alerta' : 'relogio', 15));
}

// ───────── gráficos simples (HTML/SVG, sem bibliotecas) ─────────

/** Barras horizontais de uma série. itens: [{l, v, dica?, aoClicar?}] */
export function barrasH(itens, { fmt = fmtNum, max } = {}) {
  const m = max || Math.max(1, ...itens.map((i) => i.v));
  return h('div', { class: 'barrasH' }, itens.map((i) => h('div', {
    class: `bh-linha ${i.aoClicar ? 'clicavel' : ''}`, onclick: i.aoClicar || null, 'data-dica': i.dica || `${i.l}: ${fmt(i.v)}`,
  },
  h('span', { class: 'bh-rot' }, i.l),
  h('span', { class: 'bh-trilho' }, h('span', { class: 'bh-valor', style: { width: `${(i.v / m) * 100}%` } })),
  h('span', { class: 'bh-num' }, fmt(i.v)))));
}

/**
 * Barra segmentada 100% com legenda. segmentos: [{l, v, cor}] — cor é uma
 * variável CSS (--seg-1 …) ou nome de status. Mostra rótulo e valor na legenda.
 */
export function barraSegmentada(segmentos, { fmt = fmtNum, total } = {}) {
  const t = total || segmentos.reduce((s, x) => s + x.v, 0) || 1;
  return h('div', { class: 'seg' },
    h('div', { class: 'seg-barra' }, segmentos.filter((s) => s.v > 0).map((s) => h('span', {
      class: 'seg-parte', style: { flexGrow: s.v, background: s.cor }, 'data-dica': `${s.l}: ${fmt(s.v)} (${fmtPct((s.v / t) * 100)})`,
    }))),
    h('div', { class: 'seg-legenda' }, segmentos.map((s) => h('span', { class: 'seg-item' },
      h('i', { style: { background: s.cor } }), `${s.l} `, h('b', null, fmt(s.v))))));
}

/** Colunas verticais (série única, eixo de tempo). itens: [{l, v}] */
export function colunas(itens, { altura = 150, fmt = fmtNum, rotulo = '' } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const W = Math.max(280, itens.length * 44);
  const H = altura;
  const topo = 18;
  const base = H - 22;
  const max = Math.max(1, ...itens.map((i) => i.v));
  const passo = W / itens.length;
  const larg = Math.min(26, passo * 0.56);
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'colunas');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', rotulo);
  const el = (tag, at, txt) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(at)) e.setAttribute(k, v); if (txt != null) e.textContent = txt; svg.append(e); return e; };
  [0.5, 1].forEach((f) => el('line', { x1: 0, x2: W, y1: base - (base - topo) * f, y2: base - (base - topo) * f, class: 'grade' }));
  el('line', { x1: 0, x2: W, y1: base, y2: base, class: 'eixo' });
  const iMax = itens.findIndex((i) => i.v === max);
  itens.forEach((it, i) => {
    const x = i * passo + (passo - larg) / 2;
    const alt = Math.max(it.v > 0 ? 2 : 0, ((base - topo) * it.v) / max);
    const r = Math.min(4, larg / 2, alt);
    const y = base - alt;
    // topo arredondado, base reta
    const d = alt > 0 ? `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + larg - r} Q${x + larg},${y} ${x + larg},${y + r} V${base} Z` : '';
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('data-dica', `${it.l}: ${fmt(it.v)}`);
    const alvo = document.createElementNS(ns, 'rect');
    Object.entries({ x: i * passo, y: topo - 10, width: passo, height: base - topo + 10, fill: 'transparent' }).forEach(([k, v]) => alvo.setAttribute(k, v));
    g.append(alvo);
    if (d) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.setAttribute('class', `col ${i === itens.length - 1 ? 'col-ultima' : ''}`); g.append(p); }
    svg.append(g);
    el('text', { x: i * passo + passo / 2, y: H - 6, class: 'rot-x', 'text-anchor': 'middle' }, it.l);
    if (i === iMax || i === itens.length - 1) el('text', { x: i * passo + passo / 2, y: y - 5, class: 'rot-v', 'text-anchor': 'middle' }, fmt(it.v));
  });
  return h('div', { class: 'colunas-caixa' }, svg);
}

// ───────── campos de formulário ─────────
export function campoForm(campo, valor, { opcoes = [], aoMudar, somenteLeitura = false }) {
  const id = `f-${campo.k}`;
  let ctrl;
  const muda = (v) => aoMudar && aoMudar(campo.k, v);
  const comum = { id, name: campo.k, disabled: somenteLeitura, required: !!campo.req };
  switch (campo.t) {
    case 'textarea':
      ctrl = h('textarea', { ...comum, rows: 3, oninput: (e) => muda(e.target.value) }, valor == null ? '' : String(valor));
      break;
    case 'number':
    case 'money':
      ctrl = h('input', { ...comum, type: 'number', inputmode: 'decimal', step: campo.t === 'money' ? '0.01' : 'any', min: campo.min, max: campo.max, value: valor == null ? '' : valor, oninput: (e) => muda(e.target.value === '' ? '' : Number(e.target.value)) });
      break;
    case 'date':
      ctrl = h('input', { ...comum, type: 'date', value: valor ? String(valor).slice(0, 10) : '', onchange: (e) => muda(e.target.value) });
      break;
    case 'datetime':
      ctrl = h('input', { ...comum, type: 'datetime-local', value: valor ? String(valor).slice(0, 16) : '', onchange: (e) => muda(e.target.value) });
      break;
    case 'bool':
      ctrl = h('label', { class: 'check' }, h('input', { ...comum, type: 'checkbox', checked: valor === true || valor === 'true' || valor === 'TRUE', onchange: (e) => muda(e.target.checked) }), h('span', null, 'Sim'));
      break;
    case 'select':
    case 'ref': {
      const ops = opcoes.slice();
      if (valor && !ops.some((o) => o.v === valor)) ops.unshift({ v: valor, l: campo.t === 'ref' ? '(registro indisponível)' : valor });
      ctrl = h('select', { ...comum, onchange: (e) => muda(e.target.value), value: valor || '' },
        h('option', { value: '' }, '—'),
        ops.map((o) => h('option', { value: o.v }, o.l)));
      break;
    }
    case 'url':
      ctrl = h('input', { ...comum, type: 'url', placeholder: 'https://', value: valor || '', oninput: (e) => muda(e.target.value) });
      break;
    default:
      ctrl = h('input', { ...comum, type: 'text', value: valor == null ? '' : String(valor), class: campo.mono ? 'mono' : null, oninput: (e) => muda(e.target.value) });
  }
  return h('div', { class: `campo ${campo.larg === 'full' || campo.t === 'textarea' ? 'larg' : ''}` },
    h('label', { for: id }, campo.l, campo.req && h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')),
    ctrl,
    campo.dica && h('small', { class: 'dica-campo' }, campo.dica));
}

export function vazio(texto, acao) {
  return h('div', { class: 'vazio' }, h('p', null, texto), acao);
}

export function cartaoKpi({ l, v, sub, tom, icone: ic, aoClicar, dica: d }) {
  return h(aoClicar ? 'button' : 'div', { class: `kpi ${tom ? `k-${tom}` : ''} ${aoClicar ? 'clicavel' : ''}`, onclick: aoClicar || null, 'data-dica': d || null, type: aoClicar ? 'button' : null },
    h('div', { class: 'kpi-topo' }, ic && icone(ic, 16), h('span', { class: 'kpi-rot' }, l)),
    h('div', { class: 'kpi-valor' }, v == null ? '—' : String(v)),
    sub && h('div', { class: 'kpi-sub' }, sub));
}

export function prazoTexto(data) {
  const d = diasAte(data);
  if (d == null) return '';
  if (d < 0) return `${fmtData(data)} · vencido há ${-d} d`;
  if (d === 0) return `${fmtData(data)} · hoje`;
  return `${fmtData(data)} · em ${d} d`;
}
