// Aplicação: estrutura de telas, rotas, painel, módulos, gaveta de registro,
// agenda integrada, alertas, atividade, usuários e configurações.

import { CONFIG } from './config.js';
import { store, PERFIS } from './store.js';
import { MODULOS, MOD, GRUPOS, valorCampo, nivelEstoque, estaAberto, obrigacoesLegais, TODAS_COLECOES } from './modulos.js';
import {
  h, hoje, addDias, diasAte, fmtData, fmtDataHora, fmtHora, fmtNum, fmtPct, fmtMoedaCurta, tempoRelativo,
  normalizar, iniciais, csv, baixar, debounce, paraData, isoData, semanaEpi, repor,
} from './util.js';
import { icone } from './icones.js';
import {
  toast, ativarDicas, abrirGaveta, fecharGaveta, gavetaAberta, confirmar, chip, chipPrazo, chipNivel, barraPct, selo,
  barrasH, barraSegmentada, colunas, campoForm, vazio, cartaoKpi, prazoTexto,
} from './ui.js';

const raiz = document.getElementById('app');
const vis = {};               // estado de cada tela (filtros, busca, ordenação, visão)
let tela = null;              // { rota, depende:Set|'*', atualizar() }
let regAberto = null;         // { c, id, v, sujo, painel, render() }
let arrastando = false;
let elStatus; let elSino; let elPresenca; let elNav; let elMain; let elBusca;

const ROTULO_ACAO = { criar: 'criou', atualizar: 'atualizou', excluir: 'excluiu' };
const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const tomStatus = (m, r) => (m.cores && m.status && m.cores[r[m.status]]) || 'mute';

// ═════════════════════════ inicialização ═════════════════════════
async function iniciar() {
  ativarDicas();
  registrarSW();
  try {
    const r = await store.iniciar();
    if (r === 'pronto') montarApp();
    else if (r === 'login') telaLogin();
    else telaBoasVindas();
  } catch (e) {
    console.error(e);
    telaBoasVindas(`Não foi possível iniciar: ${e.message}`);
  }
}

function registrarSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* sem SW: o app funciona online normalmente */ });
}

// ═════════════════════════ boas-vindas e login ═════════════════════════
function marca() {
  return h('div', { class: 'marca' },
    h('div', { class: 'marca-logo', 'aria-hidden': 'true' }, icone('vigilancia', 22)),
    h('div', null, h('div', { class: 'marca-nome' }, CONFIG.NOME_SISTEMA), h('div', { class: 'marca-orgao' }, CONFIG.ORGAO)));
}

function telaBoasVindas(erro = '') {
  repor(raiz, h('div', { class: 'entrada' },
    h('div', { class: 'entrada-cartao' },
      marca(),
      h('h1', null, 'Painel de controle da Secretaria'),
      h('p', { class: 'muted' }, 'Rede, regulação, farmácia, vigilância, judicialização, ouvidoria, contratos, orçamento e metas em uma só tela, com atualização em tempo real entre todos os setores.'),
      erro && h('p', { class: 'erro' }, erro),
      formularioLogin(true),
      h('div', { class: 'divisor' }, h('span', null, 'ou')),
      h('button', { class: 'btn btn-bloco', onclick: async () => { await store.iniciarDemo(); montarApp(); } }, icone('olho', 16), 'Explorar em modo demonstração (dados fictícios)'),
      h('p', { class: 'nota' }, 'No modo demonstração os dados ficam só neste navegador e uma equipe simulada faz alterações a cada poucos segundos, para mostrar o painel ao vivo.'))));
}

function telaLogin(msg = '') {
  repor(raiz, h('div', { class: 'entrada' },
    h('div', { class: 'entrada-cartao' },
      marca(),
      h('h1', null, 'Entrar'),
      msg && h('p', { class: 'erro' }, msg),
      formularioLogin(false),
      h('div', { class: 'entrada-links' },
        !CONFIG.WEBAPP_URL && h('button', { class: 'link', onclick: () => { store.esquecerServidor(); telaBoasVindas(); } }, 'Trocar servidor'),
        h('button', { class: 'link', onclick: async () => { await store.iniciarDemo(); montarApp(); } }, 'Modo demonstração')))));
}

function formularioLogin(pedirUrl) {
  const url = h('input', { type: 'url', placeholder: 'https://script.google.com/macros/s/…/exec', value: store.urlConfigurada(), required: true, class: 'mono' });
  const login = h('input', { type: 'text', autocomplete: 'username', required: true, autocapitalize: 'none' });
  const senha = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const msg = h('p', { class: 'erro', hidden: true });
  const botao = h('button', { class: 'btn btn-pri btn-bloco', type: 'submit' }, 'Entrar');
  return h('form', {
    class: 'form-login',
    onsubmit: async (e) => {
      e.preventDefault();
      botao.disabled = true;
      botao.textContent = 'Conectando…';
      msg.hidden = true;
      try {
        await store.entrar(pedirUrl ? url.value : store.urlConfigurada(), login.value.trim().toLowerCase(), senha.value);
        montarApp();
      } catch (err) {
        msg.textContent = err.message === 'Failed to fetch' ? 'Não foi possível alcançar o servidor. Confira a URL e a conexão.' : err.message;
        msg.hidden = false;
        botao.disabled = false;
        botao.textContent = 'Entrar';
      }
    },
  },
  pedirUrl && !CONFIG.WEBAPP_URL && h('div', { class: 'campo' }, h('label', null, 'Endereço do servidor (URL /exec do Apps Script)'), url),
  h('div', { class: 'campo' }, h('label', null, 'Usuário'), login),
  h('div', { class: 'campo' }, h('label', null, 'Senha'), senha),
  msg, botao);
}

// ═════════════════════════ estrutura ═════════════════════════
function montarApp() {
  if (!montarApp.ok) {
    montarApp.ok = true;
    store.on(aoMudarStore);
    window.addEventListener('hashchange', rotear);
    setInterval(() => { atualizarStatus(); atualizarTemposRelativos(); }, 5000);
  }
  tela = null;
  regAberto = null;
  elNav = h('nav', { class: 'nav', 'aria-label': 'Módulos' });
  elStatus = h('div', { class: 'status-ao-vivo' });
  elPresenca = h('div', { class: 'presenca' });
  elSino = h('button', { class: 'icone-btn sino', 'aria-label': 'Alertas', onclick: alternarPainelAlertas }, icone('sino', 20), h('span', { class: 'badge', hidden: true }));
  elMain = h('main', { id: 'tela', tabindex: '-1' });
  elBusca = buscaGlobal();

  const lateral = h('aside', { class: 'lateral' },
    h('a', { href: '#/painel', class: 'lateral-marca' }, marca()),
    elNav,
    h('div', { class: 'lateral-rodape' }, usuarioBloco()));

  repor(raiz, h('div', { class: `shell ${store.modo === 'demo' ? 'modo-demo' : ''}` },
    lateral,
    h('div', { class: 'veu', onclick: () => document.body.classList.remove('menu-aberto') }),
    h('div', { class: 'principal' },
      h('header', { class: 'topo' },
        h('button', { class: 'icone-btn so-mobile', 'aria-label': 'Menu', onclick: () => document.body.classList.toggle('menu-aberto') }, icone('menu', 22)),
        elBusca, h('div', { class: 'topo-dir' }, elStatus, elPresenca, elSino)),
      store.modo === 'demo' && h('div', { class: 'faixa-demo' }, icone('info', 15), h('span', null, 'Modo demonstração — todos os dados são fictícios. Uma equipe simulada está trabalhando agora.'), h('button', { class: 'link', onclick: async () => { await store.sair(); location.hash = ''; location.reload(); } }, 'Conectar ao servidor')),
      elMain)));

  rotear();
  atualizarCromo();
}

function usuarioBloco() {
  const u = store.usuario || {};
  return h('div', { class: 'usuario' },
    h('span', { class: 'avatar' }, iniciais(u.nome)),
    h('div', { class: 'usuario-txt' }, h('b', null, u.nome || ''), h('small', null, PERFIS[u.perfil] ? PERFIS[u.perfil].split(' —')[0].split(' (')[0] : '')),
    h('a', { href: '#/config', class: 'icone-btn', 'aria-label': 'Configurações', 'data-dica': 'Configurações' }, icone('config', 18)),
    h('button', { class: 'icone-btn', 'aria-label': 'Sair', 'data-dica': 'Sair', onclick: sair }, icone('sair', 18)));
}

async function sair() {
  if (store.fila.length && !(await confirmar(`Há ${store.fila.length} alteração(ões) ainda não enviadas ao servidor. Sair agora as descarta neste aparelho.`, 'Sair mesmo assim', true))) return;
  await store.sair();
  location.hash = '';
  location.reload();
}

function montarNav() {
  const al = contarAlertasPorModulo();
  const rota = location.hash;
  const item = (href, ic, nome, badge, tomBadge) => h('a', { href, class: `nav-item ${rota === href || rota.startsWith(href + '/') ? 'ativo' : ''}`, onclick: () => document.body.classList.remove('menu-aberto') },
    icone(ic, 18), h('span', null, nome), badge ? h('span', { class: `nav-badge t-${tomBadge}` }, badge) : null);
  const blocos = [
    h('div', { class: 'nav-grupo' },
      item('#/painel', 'painel', 'Painel do Secretário'),
      item('#/alertas', 'alerta', 'Central de alertas', al.total.crit || al.total.warn || '', al.total.crit ? 'crit' : 'warn'),
      item('#/atividade', 'sync', 'Atividade ao vivo')),
  ];
  for (const g of GRUPOS) {
    const mods = MODULOS.filter((m) => m.grupo === g.id && store.podeVer(m.id));
    if (!mods.length) continue;
    blocos.push(h('div', { class: 'nav-grupo' }, h('div', { class: 'nav-titulo' }, g.nome),
      mods.map((m) => { const a = al[m.id] || { crit: 0, warn: 0 }; return item(`#/m/${m.id}`, m.icone, m.nome, a.crit || a.warn || '', a.crit ? 'crit' : 'warn'); })));
  }
  blocos.push(h('div', { class: 'nav-grupo' }, h('div', { class: 'nav-titulo' }, 'Administração'),
    store.ehAdmin() && item('#/usuarios', 'usuarios', 'Usuários e perfis'),
    item('#/config', 'config', 'Configurações')));
  repor(elNav, ...blocos);
}

// ═════════════════════════ alertas ═════════════════════════
function calcularAlertas() {
  const ctx = store.ctx();
  const out = [];
  for (const m of MODULOS) {
    if (!m.alertas || !store.podeVer(m.id)) continue;
    for (const r of store.lista(m.id)) {
      for (const a of m.alertas(r, m, ctx)) out.push({ ...a, c: m.id, id: r.id, titulo: m.titulo(r) });
    }
  }
  const peso = (c) => { const i = PRIORIDADE_ALERTA.indexOf(c); return i < 0 ? 99 : i; };
  return out.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'crit' ? -1 : 1) || peso(a.c) - peso(b.c));
}
// Ordem de exibição dos alertas de mesmo nível: o que expõe paciente ou o gestor primeiro.
const PRIORIDADE_ALERTA = ['judicial', 'escalas', 'regulacao', 'unidades', 'estoque', 'ocorrencias', 'vigilancia', 'ouvidoria', 'contratos', 'protocolo', 'tarefas', 'orcamento', 'campanhas', 'planejamento'];
function contarAlertasPorModulo() {
  const out = { total: { crit: 0, warn: 0 } };
  for (const a of calcularAlertas()) {
    out[a.c] = out[a.c] || { crit: 0, warn: 0 };
    out[a.c][a.nivel] += 1;
    out.total[a.nivel] += 1;
  }
  return out;
}
const alertasDe = (c, id) => {
  const m = MOD[c];
  const r = store.porId(c, id);
  return m && m.alertas && r ? m.alertas(r, m, store.ctx()) : [];
};

function alternarPainelAlertas() {
  const aberto = document.querySelector('.pop-alertas');
  if (aberto) { aberto.remove(); return; }
  const lista = calcularAlertas();
  const pop = h('div', { class: 'pop pop-alertas' },
    h('div', { class: 'pop-cab' }, h('b', null, 'Alertas'), h('a', { href: '#/alertas', onclick: () => pop.remove() }, 'Ver todos')),
    lista.length ? h('div', { class: 'pop-lista' }, lista.slice(0, 14).map((a) => linhaAlerta(a, () => pop.remove()))) : vazio('Nenhum alerta no momento.'),
    'Notification' in window && Notification.permission === 'default' && h('button', { class: 'btn btn-bloco', onclick: pedirNotificacoes }, icone('sino', 16), 'Receber avisos urgentes no navegador'));
  document.body.append(pop);
  const fora = (e) => { if (!pop.contains(e.target) && !elSino.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', fora); } };
  setTimeout(() => document.addEventListener('mousedown', fora), 0);
}

function linhaAlerta(a, depois) {
  const m = MOD[a.c];
  return h('a', { class: `alerta-linha n-${a.nivel}`, href: `#/m/${a.c}/${a.id}`, onclick: depois || null },
    selo(a.nivel, a.nivel === 'crit' ? 'Crítico' : 'Atenção'),
    h('span', { class: 'alerta-txt' }, h('b', null, a.msg), h('small', null, `${m.nome} · ${a.titulo}`)));
}

async function pedirNotificacoes() {
  if (!('Notification' in window)) return;
  const p = await Notification.requestPermission();
  toast(p === 'granted' ? 'Notificações ativadas neste navegador.' : 'Notificações não autorizadas.', p === 'granted' ? 'ok' : 'warn');
  document.querySelector('.pop-alertas')?.remove();
}

function notificar(titulo, corpo) {
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(titulo, { body: corpo, icon: 'icon.svg', tag: titulo });
  } catch { /* alguns navegadores só permitem via service worker */ }
}

// ═════════════════════════ cabeçalho: status, presença e busca ═════════════════════════
function atualizarStatus() {
  if (!elStatus) return;
  const { estado, ultima, erro } = store.conexao;
  const pend = store.fila.length;
  const mapa = {
    demo: ['ao-vivo', 'Ao vivo', 'Demonstração'],
    online: ['ao-vivo', 'Ao vivo', ultima ? `sincronizado ${tempoRelativo(ultima)}` : ''],
    enviando: ['enviando', 'Enviando', `${pend} alteração(ões)`],
    conectando: ['enviando', 'Conectando', ''],
    iniciando: ['enviando', 'Conectando', ''],
    offline: ['offline', 'Sem conexão', pend ? `${pend} na fila` : 'usando dados salvos'],
    erro: ['erro', 'Falha na sincronização', pend ? `${pend} na fila` : 'tentando novamente'],
  };
  const [cls, a, b] = mapa[estado] || mapa.conectando;
  elStatus.className = `status-ao-vivo st-${cls}`;
  elStatus.setAttribute('data-dica', erro || (estado === 'demo' ? 'Alterações simuladas a cada poucos segundos' : `Sincroniza a cada ${CONFIG.POLL_VISIVEL_MS / 1000}s`));
  repor(elStatus, h('i', { class: 'pulso' }), h('b', null, a), b && h('span', null, b),
    store.modo === 'servidor' && h('button', { class: 'icone-btn mini', 'aria-label': 'Sincronizar agora', onclick: () => store.ciclo() }, icone('sync', 14)));
}

function atualizarPresenca() {
  if (!elPresenca) return;
  const eu = store.usuario && store.usuario.login;
  const lim = Date.now() - 120000;
  const on = (store.online || []).filter((u) => u.login !== eu && (!u.t || new Date(u.t).getTime() > lim));
  repor(elPresenca, ...on.slice(0, 4).map((u) => h('span', { class: 'avatar mini', 'data-dica': `${u.nome} — conectado(a)` }, iniciais(u.nome))),
    on.length > 4 ? h('span', { class: 'avatar mini mais', 'data-dica': on.slice(4).map((u) => u.nome).join(', ') }, `+${on.length - 4}`) : null);
  elPresenca.setAttribute('aria-label', `${on.length} pessoa(s) conectada(s)`);
}

function atualizarSino() {
  if (!elSino) return;
  const c = contarAlertasPorModulo().total;
  const b = elSino.querySelector('.badge');
  b.hidden = !(c.crit || c.warn);
  b.textContent = c.crit || c.warn;
  b.className = `badge t-${c.crit ? 'crit' : 'warn'}`;
  elSino.setAttribute('aria-label', `Alertas: ${c.crit} críticos, ${c.warn} de atenção`);
}

function atualizarCromo() { montarNav(); atualizarStatus(); atualizarPresenca(); atualizarSino(); }

function buscaGlobal() {
  const input = h('input', { type: 'search', placeholder: 'Buscar em todos os módulos…', 'aria-label': 'Busca global' });
  const res = h('div', { class: 'busca-res', hidden: true });
  const fazer = debounce(() => {
    const q = normalizar(input.value.trim());
    if (q.length < 2) { res.hidden = true; return; }
    const termos = q.split(/\s+/);
    const achados = [];
    for (const m of MODULOS) {
      if (!store.podeVer(m.id)) continue;
      for (const r of store.lista(m.id)) {
        const txt = normalizar([m.titulo(r), m.sub && m.sub(r), ...m.campos.filter((f) => ['text', 'textarea', 'select'].includes(f.t)).map((f) => r[f.k])].join(' '));
        if (termos.every((t) => txt.includes(t))) achados.push({ m, r });
        if (achados.length >= 40) break;
      }
    }
    repor(res, ...(achados.length ? achados.slice(0, 25).map(({ m, r }) => h('a', { href: `#/m/${m.id}/${r.id}`, class: 'busca-item', onclick: () => { res.hidden = true; input.value = ''; } },
      icone(m.icone, 16), h('span', null, h('b', null, m.titulo(r)), h('small', null, `${m.singular} · ${m.sub ? m.sub(r) : ''}`)))) : [h('div', { class: 'busca-vazia' }, 'Nada encontrado.')]));
    res.hidden = false;
  }, 120);
  input.addEventListener('input', fazer);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { res.hidden = true; input.blur(); }
    if (e.key === 'Enter') { const p = res.querySelector('a'); if (p) { p.click(); location.hash = p.getAttribute('href'); } }
  });
  input.addEventListener('blur', () => setTimeout(() => { res.hidden = true; }, 200));
  document.addEventListener('keydown', (e) => { if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); input.focus(); } });
  return h('div', { class: 'busca' }, icone('busca', 18), input, res);
}

// ═════════════════════════ reatividade ═════════════════════════
const redesenhar = (() => {
  let pend = false;
  return () => {
    if (pend) return;
    pend = true;
    requestAnimationFrame(() => {
      pend = false;
      if (arrastando) { setTimeout(redesenhar, 300); return; }
      if (tela && tela.atualizar) {
        const y = elMain.scrollTop;
        tela.atualizar();
        elMain.scrollTop = y;
      }
      atualizarCromo();
    });
  };
})();

function aoMudarStore(info) {
  if (info.sessao === 'expirada') { telaLogin('Sua sessão expirou. Entre novamente.'); return; }
  if (info.aviso) toast(info.aviso, 'warn', 7000);
  if (info.conexao || info.presenca) { atualizarStatus(); atualizarPresenca(); }
  if (info.colecoes && info.colecoes.size) {
    if (!tela || tela.depende === '*' || [...info.colecoes].some((c) => tela.depende.has(c))) redesenhar();
    else atualizarCromo();
    if (regAberto && info.colecoes.has(regAberto.c)) regAberto.verificar();
    if (regAberto && (info.colecoes.has('comentarios') || info.remoto)) regAberto.atualizarAbas();
  }
  for (const ev of info.eventos || []) {
    if (ev.c === 'avisos' && ev.a === 'criar') {
      const av = store.porId('avisos', ev.id);
      if (av && av.prioridade !== 'Informativo') {
        toast(`${av.prioridade}: ${av.titulo}`, av.prioridade === 'Urgente' ? 'crit' : 'warn', 9000, { rotulo: 'Abrir', fn: () => { location.hash = `#/m/avisos/${av.id}`; } });
        notificar(`${av.prioridade}: ${av.titulo}`, av.mensagem || '');
      }
    }
  }
}

function atualizarTemposRelativos() {
  document.querySelectorAll('[data-quando]').forEach((el) => { el.textContent = tempoRelativo(el.dataset.quando); });
}

// ═════════════════════════ rotas ═════════════════════════
function rotear() {
  const partes = (location.hash || '#/painel').replace(/^#\/?/, '').split('/');
  const [r0, r1, r2] = partes;
  document.querySelector('.pop-alertas')?.remove();
  let rota = r0 || 'painel';
  if (rota === 'm' && !(MOD[r1] && store.podeVer(r1))) rota = 'painel';
  const chave = rota === 'm' ? `m/${r1}` : rota;
  if (!tela || tela.rota !== chave) {
    repor(elMain, );
    elMain.scrollTop = 0;
    if (rota === 'm') telaModulo(MOD[r1]);
    else if (rota === 'alertas') telaAlertas();
    else if (rota === 'atividade') telaAtividade();
    else if (rota === 'usuarios' && store.ehAdmin()) telaUsuarios();
    else if (rota === 'config') telaConfig();
    else telaPainel();
    elMain.focus({ preventScroll: true });
  }
  if (rota === 'm' && r2) {
    if (!regAberto || regAberto.c !== r1 || regAberto.id !== r2) abrirRegistro(r1, r2 === 'novo' ? null : r2);
  } else if (gavetaAberta() && regAberto) {
    fecharGaveta(true);
    regAberto = null;
  }
  montarNav();
}

function irPara(hash) { if (location.hash !== hash) location.hash = hash; else rotear(); }

// ═════════════════════════ PAINEL DO SECRETÁRIO ═════════════════════════
function telaPainel() {
  const corpo = h('div', { class: 'painel' });
  const saud = () => { const hr = new Date().getHours(); return hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite'; };
  const cab = h('div', { class: 'tela-cab' },
    h('div', null,
      h('h1', null, `${saud()}, ${(store.usuario.nome || '').split(' ')[0]}`),
      h('p', { class: 'muted' }, `${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${store.config().orgao}`)),
    h('div', { class: 'acoes' }, h('button', { class: 'btn', onclick: () => window.print() }, icone('imprimir', 16), 'Relatório')));
  elMain.append(cab, corpo);

  const desenhar = () => {
    const ctx = store.ctx();
    const L = (c) => (store.podeVer(c) ? store.lista(c) : []);
    const unid = L('unidades');
    const leitosT = unid.reduce((s, r) => s + (Number(r.leitos_total) || 0), 0);
    const leitosO = unid.reduce((s, r) => s + (Number(r.leitos_ocupados) || 0), 0);
    const ocup = leitosT ? (leitosO / leitosT) * 100 : null;
    const fila = L('regulacao').filter((r) => r.status === 'Aguardando');
    const urg = fila.filter((r) => /^(Vermelho|Amarelo)/.test(r.classificacao || ''));
    const est = L('estoque');
    const rupt = est.filter((r) => nivelEstoque(r) === 'Ruptura').length;
    const crit = est.filter((r) => nivelEstoque(r) === 'Crítico').length;
    const jud = L('judicial').filter((r) => estaAberto(MOD.judicial, r));
    const judVenc = jud.filter((r) => diasAte(r.prazo) < 0).length;
    const jud3 = jud.filter((r) => { const d = diasAte(r.prazo); return d >= 0 && d <= 3; }).length;
    const ouv = L('ouvidoria').filter((r) => estaAberto(MOD.ouvidoria, r));
    const ouvAtr = ouv.filter((r) => diasAte(r.prazo) < 0).length;
    const plant = L('escalas').filter((r) => ['Descoberto', 'Falta'].includes(r.situacao) && diasAte(r.data) >= 0 && diasAte(r.data) <= 2).length;
    const contr = L('contratos').filter((r) => r.fase === 'Vigente' && r.fim && diasAte(r.fim) <= 90);
    const tar = L('tarefas').filter((r) => estaAberto(MOD.tarefas, r));
    const tarAtr = tar.filter((r) => diasAte(r.prazo) < 0).length;
    const ir = (c) => (store.podeVer(c) ? () => irPara(`#/m/${c}`) : null);

    const kpis = h('div', { class: 'kpis' },
      store.podeVer('unidades') && cartaoKpi({ l: 'Ocupação de leitos', v: fmtPct(ocup), sub: `${leitosO} de ${leitosT} leitos · ${unid.filter((u) => u.status === 'Crítico').length} unidade(s) crítica(s)`, tom: ocup >= 95 ? 'crit' : ocup >= 85 ? 'warn' : 'ok', icone: 'unidades', aoClicar: ir('unidades') }),
      store.podeVer('regulacao') && cartaoKpi({ l: 'Fila da regulação', v: fmtNum(fila.length), sub: `${urg.length} vermelho/amarelo aguardando`, tom: urg.length ? 'crit' : null, icone: 'regulacao', aoClicar: ir('regulacao') }),
      store.podeVer('estoque') && cartaoKpi({ l: 'Farmácia e insumos', v: `${rupt + crit}`, sub: `${rupt} em ruptura · ${crit} abaixo do mínimo`, tom: rupt ? 'crit' : crit ? 'warn' : 'ok', icone: 'estoque', aoClicar: ir('estoque') }),
      store.podeVer('judicial') && cartaoKpi({ l: 'Mandados e requisições', v: `${judVenc + jud3}`, sub: `${judVenc} vencido(s) · ${jud3} vencem em 3 dias · ${jud.length} em aberto`, tom: judVenc ? 'crit' : jud3 ? 'warn' : 'ok', icone: 'judicial', aoClicar: ir('judicial') }),
      store.podeVer('escalas') && cartaoKpi({ l: 'Plantões descobertos (48h)', v: plant, sub: 'faltas e plantões sem profissional', tom: plant ? 'crit' : 'ok', icone: 'escalas', aoClicar: ir('escalas') }),
      store.podeVer('ouvidoria') && cartaoKpi({ l: 'Ouvidoria em aberto', v: ouv.length, sub: `${ouvAtr} fora do prazo legal`, tom: ouvAtr ? 'crit' : null, icone: 'ouvidoria', aoClicar: ir('ouvidoria') }),
      store.podeVer('contratos') && cartaoKpi({ l: 'Contratos a vencer (90 dias)', v: contr.length, sub: `${contr.filter((r) => diasAte(r.fim) <= 30).length} em até 30 dias`, tom: contr.some((r) => diasAte(r.fim) <= 30) ? 'crit' : contr.length ? 'warn' : 'ok', icone: 'contratos', aoClicar: ir('contratos') }),
      store.podeVer('tarefas') && cartaoKpi({ l: 'Demandas atrasadas', v: tarAtr, sub: `${tar.length} demandas em aberto`, tom: tarAtr ? 'crit' : null, icone: 'tarefas', aoClicar: ir('tarefas') }));

    const alertas = calcularAlertas();
    const blocoAlertas = secao('Alertas prioritários', `${alertas.filter((a) => a.nivel === 'crit').length} críticos · ${alertas.filter((a) => a.nivel === 'warn').length} de atenção`,
      alertas.length ? h('div', { class: 'lista-alertas' }, alertas.slice(0, 8).map((a) => linhaAlerta(a))) : vazio('Nenhum alerta. Tudo dentro dos prazos e limites.'),
      alertas.length > 8 && h('a', { class: 'ver-mais', href: '#/alertas' }, `Ver os ${alertas.length} alertas`));

    const redeOrd = unid.slice().sort((a, b) => ['Crítico', 'Atenção', 'Normal', 'Fechada'].indexOf(a.status) - ['Crítico', 'Atenção', 'Normal', 'Fechada'].indexOf(b.status));
    const blocoRede = store.podeVer('unidades') && secao('Situação da rede', `${unid.length} unidades`,
      h('div', { class: 'rede' }, redeOrd.map((u) => {
        const o = Number(u.leitos_total) ? (Number(u.leitos_ocupados) / Number(u.leitos_total)) * 100 : null;
        return h('a', { class: `rede-item ${flash(u.id)}`, href: `#/m/unidades/${u.id}` },
          h('span', { class: `ponto t-${MOD.unidades.cores[u.status] || 'mute'}` }),
          h('span', { class: 'rede-nome' }, h('b', null, u.nome), h('small', null, [u.tipo, u.bairro].filter(Boolean).join(' · '))),
          o != null ? barraPct(o) : chip(u.status, MOD.unidades.cores[u.status]));
      })));

    const porTipo = {};
    fila.forEach((r) => { porTipo[r.tipo] = (porTipo[r.tipo] || 0) + 1; });
    const blocoReg = store.podeVer('regulacao') && secao('Fila da regulação', `${fila.length} aguardando`,
      barraSegmentada(['Vermelho', 'Amarelo', 'Verde', 'Azul'].map((c, i) => ({ l: c, v: fila.filter((r) => String(r.classificacao || '').startsWith(c)).length, cor: ['var(--cr-vermelho)', 'var(--cr-amarelo)', 'var(--cr-verde)', 'var(--cr-azul)'][i] }))),
      barrasH(Object.entries(porTipo).sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ l, v, aoClicar: () => { const vr = lerVisao(MOD.regulacao); vr.f = { tipo: l, status: 'Aguardando' }; irPara('#/m/regulacao'); } }))));

    const { se, ano } = semanaEpi();
    const semanas = [];
    for (let k = 7; k >= 0; k -= 1) { const s = se - k > 0 ? se - k : se - k + 52; semanas.push({ s, a: se - k > 0 ? ano : ano - 1 }); }
    const vig = L('vigilancia');
    const agravoTop = (() => { const c = {}; vig.forEach((r) => { c[r.agravo] = (c[r.agravo] || 0) + (Number(r.notificados) || 0); }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]; })();
    const blocoVig = store.podeVer('vigilancia') && agravoTop && secao(`${agravoTop[0]} — casos notificados por semana`, `SE ${semanas[0].s} a ${semanas[7].s}`,
      colunas(semanas.map(({ s, a }) => ({ l: `SE${s}`, v: vig.filter((r) => r.agravo === agravoTop[0] && Number(r.semana) === s && Number(r.ano) === a).reduce((t, r) => t + (Number(r.notificados) || 0), 0) })), { rotulo: `${agravoTop[0]}: casos notificados por semana epidemiológica` }),
      h('div', { class: 'linha-chips' }, vig.filter((r) => ['Alerta', 'Surto / epidemia'].includes(r.situacao) && Number(r.semana) === se && Number(r.ano) === ano).map((r) => h('a', { href: `#/m/vigilancia/${r.id}` }, chip(`${r.bairro}: ${r.situacao}`, MOD.vigilancia.cores[r.situacao])))));

    const orc = L('orcamento');
    const s = (k) => orc.reduce((t, r) => t + (Number(r[k]) || 0), 0);
    const blocoOrc = store.podeVer('orcamento') && orc.length > 0 && secao('Execução orçamentária do Fundo', `${fmtMoedaCurta(s('dotacao'))} de dotação`,
      barraSegmentada([
        { l: 'Pago', v: s('pago'), cor: 'var(--seq-600)' },
        { l: 'Liquidado a pagar', v: Math.max(0, s('liquidado') - s('pago')), cor: 'var(--seq-400)' },
        { l: 'Empenhado a liquidar', v: Math.max(0, s('empenhado') - s('liquidado')), cor: 'var(--seq-250)' },
        { l: 'Saldo a empenhar', v: Math.max(0, s('dotacao') - s('empenhado')), cor: 'var(--trilho)' },
      ], { fmt: fmtMoedaCurta }),
      (() => { const base = store.config().receita_base; const pr = orc.filter((r) => r.fonte === 'Recursos próprios (ASPS)').reduce((t, r) => t + (Number(r.liquidado) || 0), 0); return base ? h('p', { class: 'nota' }, `Aplicação estimada em ASPS: `, h('b', null, fmtPct((pr / base) * 100)), ' da base informada (mínimo legal de 15% — LC 141/2012, art. 7º; apuração oficial no SIOPS).') : null; })());

    const ag = L('agenda').filter((r) => r.status !== 'Cancelado' && String(r.inicio).slice(0, 10) >= hoje()).sort(MOD.agenda.ordenar).slice(0, 6);
    const prazosHoje = prazosIntegrados(hoje(), addDias(hoje(), 2));
    const blocoAgenda = secao('Agenda e prazos', 'hoje e próximos dias',
      ag.length ? h('div', { class: 'agenda-lista' }, ag.map((r) => h('a', { class: `ag-item ${flash(r.id)}`, href: `#/m/agenda/${r.id}` },
        h('span', { class: 'ag-data' }, h('b', null, String(r.inicio).slice(0, 10) === hoje() ? 'Hoje' : fmtData(r.inicio).slice(0, 5)), h('small', null, fmtHora(r.inicio))),
        h('span', { class: 'ag-txt' }, h('b', null, r.titulo), h('small', null, [r.tipo, r.local].filter(Boolean).join(' · ')))))) : vazio('Sem compromissos nos próximos dias.'),
      prazosHoje.length > 0 && h('div', { class: 'sub-bloco' }, h('div', { class: 'rotulo' }, `Prazos até ${fmtData(addDias(hoje(), 2))}`),
        prazosHoje.slice(0, 6).map((p) => h('a', { class: 'prazo-item', href: p.href }, chipPrazo(diasAte(p.data)), h('span', null, p.titulo)))),
      h('a', { class: 'ver-mais', href: '#/m/agenda' }, 'Abrir agenda integrada'));

    const blocoFeed = secao('Atividade em tempo real', store.modo === 'demo' ? 'equipe simulada' : 'todos os setores', feed(store.eventos.slice(0, 12)), h('a', { class: 'ver-mais', href: '#/atividade' }, 'Ver toda a atividade'));

    const avisos = L('avisos').filter((a) => !a.validade || a.validade >= hoje()).sort(MOD.avisos.ordenar).slice(0, 3);
    const blocoMural = secao('Mural de avisos', '', avisos.length ? avisos.map((a) => h('a', { class: `aviso p-${MOD.avisos.cores[a.prioridade]} ${flash(a.id)}`, href: `#/m/avisos/${a.id}` },
      h('div', { class: 'aviso-cab' }, chip(a.prioridade, MOD.avisos.cores[a.prioridade]), h('small', { 'data-quando': a.criado_em }, tempoRelativo(a.criado_em))),
      h('b', null, a.titulo), h('p', null, a.mensagem))) : vazio('Nenhum aviso vigente.'),
    store.podeEditar('avisos') && h('a', { class: 'ver-mais', href: '#/m/avisos/novo' }, 'Publicar aviso'));

    repor(corpo, 
      h('div', { class: 'impressao-cab' }, `${store.config().orgao} — Relatório gerencial de ${new Date().toLocaleString('pt-BR')}`),
      kpis,
      h('div', { class: 'grade-painel' },
        h('div', { class: 'col-a' }, blocoAlertas, blocoRede, h('div', { class: 'duas' }, blocoReg, blocoVig), blocoOrc),
        h('div', { class: 'col-b' }, blocoAgenda, blocoMural, blocoFeed)));
  };
  tela = { rota: 'painel', depende: '*', atualizar: desenhar };
  desenhar();
}

function secao(titulo, sub, ...conteudo) {
  return h('section', { class: 'bloco' }, h('div', { class: 'bloco-cab' }, h('h2', null, titulo), sub && h('span', { class: 'muted' }, sub)), ...conteudo);
}

function flash(id) {
  const t = store.recentes.get(id);
  return t && Date.now() - t < 6000 ? 'flash' : '';
}

function feed(eventos) {
  if (!eventos.length) return vazio('As alterações feitas por qualquer usuário aparecem aqui na hora.');
  return h('ol', { class: 'feed' }, eventos.map((e) => {
    const m = MOD[e.c];
    const reg = store.dados[e.c] && store.dados[e.c].get(e.id);
    const titulo = e.t || (m && reg ? m.titulo(reg) : '');
    const campos = (e.f || []).map((k) => { const f = m && m.campos.find((x) => x.k === k); return f ? f.l.toLowerCase() : null; }).filter(Boolean);
    const eu = store.usuario && e.u === store.usuario.login;
    const nome = eu ? 'Você' : e.n || e.u;
    const visivel = m ? store.podeVer(e.c) : e.c === 'comentarios';
    if (!visivel) return null;
    const href = e.c === 'comentarios' && reg ? `#/m/${reg.colecao}/${reg.registro}` : m ? `#/m/${e.c}/${e.id}` : null;
    return h('li', { class: `feed-item ${Date.now() - new Date(e.q).getTime() < 8000 && !eu ? 'flash' : ''}` },
      h('span', { class: 'avatar mini' }, iniciais(nome)),
      h('div', null,
        h('p', null, h('b', null, nome), ' ', e.c === 'comentarios' ? 'comentou em' : ROTULO_ACAO[e.a] || e.a, ' ',
          href ? h('a', { href }, e.c === 'comentarios' && reg && MOD[reg.colecao] ? MOD[reg.colecao].titulo(store.porId(reg.colecao, reg.registro) || {}) || 'registro' : titulo || (m ? m.singular : '')) : titulo,
          campos.length && e.a === 'atualizar' ? h('span', { class: 'muted' }, ` — ${campos.slice(0, 3).join(', ')}`) : null),
        h('small', { class: 'muted' }, m ? `${m.nome} · ` : '', h('span', { 'data-quando': e.q }, tempoRelativo(e.q)))));
  }));
}

// ═════════════════════════ PRAZOS INTEGRADOS ═════════════════════════
function prazosIntegrados(de, ate) {
  const out = [];
  for (const m of MODULOS) {
    if (!m.prazo || !store.podeVer(m.id)) continue;
    for (const r of store.lista(m.id)) {
      const d = r[m.prazo];
      if (!d || !estaAberto(m, r)) continue;
      if (m.id === 'contratos' && r.fase !== 'Vigente') continue;
      if (m.id === 'campanhas' && r.status !== 'Em andamento') continue;
      const dia = String(d).slice(0, 10);
      if ((de && dia < de) || (ate && dia > ate)) continue;
      out.push({ data: dia, titulo: `${m.id === 'contratos' ? 'Fim da vigência' : 'Prazo'}: ${m.titulo(r)}`, mod: m, href: `#/m/${m.id}/${r.id}`, r });
    }
  }
  const anos = [Number((de || hoje()).slice(0, 4)), Number((ate || hoje()).slice(0, 4))];
  obrigacoesLegais([...new Set(anos)]).forEach((o) => {
    if ((!de || o.data >= de) && (!ate || o.data <= ate)) out.push({ data: o.data, titulo: `${o.titulo} (${o.base})`, legal: true, href: '#/m/planejamento' });
  });
  return out.sort((a, b) => a.data.localeCompare(b.data));
}

// ═════════════════════════ TELA DE MÓDULO ═════════════════════════
function lerVisao(m) {
  const k = `m/${m.id}`;
  if (!vis[k]) {
    let visao = m.visoes[0];
    try { const salvo = localStorage.getItem(`saude.visao.${m.id}`); if (salvo && m.visoes.includes(salvo)) visao = salvo; } catch { /* */ }
    vis[k] = { busca: '', f: {}, ocultarFechados: !!m.fechados, soAlertas: false, ordem: null, visao, limite: 150, mes: hoje().slice(0, 7), dia: hoje(), prazos: true };
  }
  return vis[k];
}

function opcoesCampo(campo) {
  if (campo.t === 'select') return (campo.op === 'setores' ? store.config().setores : campo.op).map((o) => ({ v: o, l: o }));
  if (campo.t === 'ref') {
    if (!store.podeVer(campo.ref)) return [];
    const m2 = MOD[campo.ref];
    return store.lista(campo.ref).map((r) => ({ v: r.id, l: m2.titulo(r) })).sort((a, b) => a.l.localeCompare(b.l, 'pt-BR'));
  }
  return [];
}

function telaModulo(m) {
  const v = lerVisao(m);
  const podeEd = store.podeEditar(m.id);

  const botoesVisao = m.visoes.length > 1 && h('div', { class: 'seg-ctrl', role: 'tablist' }, m.visoes.map((x) => h('button', {
    class: v.visao === x ? 'on' : '', role: 'tab', 'aria-selected': String(v.visao === x),
    onclick: () => { v.visao = x; try { localStorage.setItem(`saude.visao.${m.id}`, x); } catch { /* */ } repor(elMain, ); tela = null; telaModulo(m); },
  }, icone(x, 15), { tabela: 'Tabela', kanban: 'Quadro', calendario: 'Calendário' }[x])));

  const cab = h('div', { class: 'tela-cab' },
    h('div', { class: 'tela-titulo' }, h('span', { class: 'tela-icone' }, icone(m.icone, 22)), h('div', null, h('h1', null, m.nome), h('p', { class: 'muted' }, m.desc))),
    h('div', { class: 'acoes' },
      botoesVisao,
      m.info && h('button', { class: 'btn', onclick: () => toast(m.info, 'info', 16000) }, icone('info', 16), 'Base legal'),
      h('button', { class: 'btn', onclick: () => exportarCSV(m) }, icone('baixar', 16), 'CSV'),
      podeEd && h('a', { class: 'btn btn-pri', href: `#/m/${m.id}/novo` }, icone('mais', 16), `Novo`)));

  const resumo = h('div', { class: 'kpis kpis-mod' });
  const conteudo = h('div', { class: 'conteudo' });
  const filtros = v.visao === 'calendario' ? barraCalendario(m, v) : barraFiltros(m, v);
  elMain.append(cab, resumo, filtros, conteudo);
  if (m.id === 'planejamento') elMain.insertBefore(blocoObrigacoes(), filtros);

  const desenhar = () => {
    const ctx = store.ctx();
    const todos = store.lista(m.id);
    if (m.resumo) repor(resumo, ...m.resumo(todos, m, ctx).map((k) => cartaoKpi(k)));
    if (v.visao === 'calendario') { repor(conteudo, calendario(m, v)); return; }
    const lista = filtrar(m, v, todos);
    if (v.visao === 'kanban') repor(conteudo, kanban(m, lista));
    else repor(conteudo, tabela(m, v, lista, todos.length));
  };
  const depende = new Set([m.id, 'config', ...m.campos.filter((f) => f.t === 'ref').map((f) => f.ref)]);
  if (v.visao === 'calendario') MODULOS.forEach((x) => x.prazo && depende.add(x.id));
  tela = { rota: `m/${m.id}`, depende, atualizar: desenhar };
  desenhar();
}

function blocoObrigacoes() {
  const prox = obrigacoesLegais([new Date().getFullYear(), new Date().getFullYear() + 1]).filter((o) => o.data >= hoje()).slice(0, 3);
  return h('div', { class: 'faixa-info' }, icone('calendario', 16), h('span', null, h('b', null, 'Próximas obrigações legais: '),
    prox.map((o, i) => [i ? ' · ' : '', `${fmtData(o.data)} — ${o.titulo} (${o.base})`])));
}

function barraFiltros(m, v) {
  const busca = h('input', { type: 'search', placeholder: `Filtrar ${m.nome.toLowerCase()}…`, value: v.busca, 'aria-label': 'Filtrar' });
  busca.addEventListener('input', debounce(() => { v.busca = busca.value; v.limite = 150; tela && tela.atualizar(); }, 150));
  const selects = m.campos.filter((f) => f.filtro && (f.t === 'select' || f.t === 'ref' || f.t === 'bool' || f.t === 'text' || f.t === 'number')).map((f) => {
    let ops;
    if (f.t === 'bool') ops = [{ v: 'true', l: 'Sim' }, { v: 'false', l: 'Não' }];
    else if (f.t === 'text' || f.t === 'number') ops = [...new Set(store.lista(m.id).map((r) => r[f.k]).filter((x) => x !== '' && x != null).map(String))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })).map((x) => ({ v: x, l: x }));
    else ops = opcoesCampo(f);
    const s = h('select', { 'aria-label': f.l, class: v.f[f.k] ? 'ativo' : '', value: v.f[f.k] || '', onchange: (e) => { v.f[f.k] = e.target.value; e.target.classList.toggle('ativo', !!e.target.value); v.limite = 150; tela && tela.atualizar(); } },
      h('option', { value: '' }, `${f.l}: todos`), ops.map((o) => h('option', { value: o.v }, o.l)));
    return s;
  });
  return h('div', { class: 'filtros' },
    h('div', { class: 'filtro-busca' }, icone('busca', 16), busca),
    ...selects,
    m.fechados && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: v.ocultarFechados, onchange: (e) => { v.ocultarFechados = e.target.checked; tela && tela.atualizar(); } }), h('span', null, 'Ocultar encerrados')),
    m.alertas && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: v.soAlertas, onchange: (e) => { v.soAlertas = e.target.checked; tela && tela.atualizar(); } }), h('span', null, 'Só com alerta')));
}

function filtrar(m, v, todos) {
  const ctx = store.ctx();
  const termos = normalizar(v.busca.trim()).split(/\s+/).filter(Boolean);
  let l = todos.filter((r) => {
    for (const [k, val] of Object.entries(v.f)) {
      if (!val) continue;
      const rv = r[k];
      if (val === 'true' || val === 'false') { if (String(rv === true || rv === 'true' || rv === 'TRUE') !== val) return false; } else if (String(rv) !== val) return false;
    }
    if (v.ocultarFechados && m.fechados && m.fechados.includes(r[m.status]) && !v.f[m.status]) return false;
    if (v.soAlertas && !(m.alertas && m.alertas(r, m, ctx).length)) return false;
    if (termos.length) {
      const txt = normalizar([m.titulo(r), m.sub && m.sub(r), ...m.campos.map((f) => valorCampo(f, r, ctx))].join(' '));
      if (!termos.every((t) => txt.includes(t))) return false;
    }
    return true;
  });
  if (v.ordem) {
    const { k, dir } = v.ordem;
    const calc = (m.calc || []).find((c) => c.k === k);
    const campo = m.campos.find((f) => f.k === k);
    const val = (r) => { const x = calc ? calc.v(r, m, ctx) : campo && campo.t === 'ref' ? valorCampo(campo, r, ctx) : r[k]; return x == null || x === '' ? null : x; };
    l.sort((a, b) => {
      const x = val(a); const y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true })) * dir;
    });
  } else if (m.ordenar) l.sort(m.ordenar);
  return l;
}

function celulaCalc(c, r, m, ctx) {
  const val = c.v(r, m, ctx);
  switch (c.fmt) {
    case 'pct': return c.k === 'ocupacao' ? barraPct(val) : barraPct(val, { neutro: true });
    case 'dias': return val == null ? h('span', { class: 'muted' }, '—') : `${fmtNum(val)} d`;
    case 'prazo': return chipPrazo(val);
    case 'nivel': return chipNivel(val);
    default: return val == null ? '' : String(val);
  }
}

function tabela(m, v, lista, total) {
  const ctx = store.ctx();
  if (!lista.length) {
    return vazio(total ? 'Nenhum registro com esses filtros.' : `Nenhum registro em ${m.nome}.`,
      !total && store.podeEditar(m.id) ? h('a', { class: 'btn btn-pri', href: `#/m/${m.id}/novo` }, icone('mais', 16), `Cadastrar ${m.singular.toLowerCase()}`) : null);
  }
  const cols = [
    ...m.campos.filter((f) => f.col).map((f) => ({ k: f.k, l: f.l, campo: f })),
    ...(m.calc || []).filter((c) => c.col).map((c) => ({ k: c.k, l: c.l, calc: c })),
  ];
  const th = (c) => {
    const ativo = v.ordem && v.ordem.k === c.k;
    return h('th', { scope: 'col', 'aria-sort': ativo ? (v.ordem.dir > 0 ? 'ascending' : 'descending') : null },
      h('button', { class: 'th-btn', onclick: () => { v.ordem = ativo ? (v.ordem.dir > 0 ? { k: c.k, dir: -1 } : null) : { k: c.k, dir: 1 }; tela.atualizar(); } }, c.l, ativo ? (v.ordem.dir > 0 ? ' ↑' : ' ↓') : ''));
  };
  const linhas = lista.slice(0, v.limite).map((r) => {
    const al = m.alertas ? m.alertas(r, m, ctx) : [];
    const pior = al.find((a) => a.nivel === 'crit') || al[0];
    return h('tr', { class: `${flash(r.id)} ${r._pend ? 'pendente' : ''}`, tabindex: '0', onclick: () => irPara(`#/m/${m.id}/${r.id}`), onkeydown: (e) => { if (e.key === 'Enter') irPara(`#/m/${m.id}/${r.id}`); } },
      h('td', { class: 'td-alerta' }, pior ? selo(pior.nivel, al.map((a) => a.msg).join(' · ')) : (r._pend ? h('span', { 'data-dica': 'Aguardando envio ao servidor' }, icone('nuvem', 15, 'muted')) : null)),
      cols.map((c, i) => {
        if (c.calc) return h('td', { class: 'td-calc' }, celulaCalc(c.calc, r, m, ctx));
        if (c.k === m.status) return h('td', null, chip(r[c.k], tomStatus(m, r)));
        const txt = valorCampo(c.campo, r, ctx);
        return h('td', { class: `${i === 0 ? 'td-pri' : ''} ${c.campo.mono ? 'mono' : ''} ${['money', 'number'].includes(c.campo.t) ? 'num' : ''}` }, txt);
      }));
  });
  return h('div', { class: 'tabela-caixa' },
    h('table', { class: 'tabela' }, h('thead', null, h('tr', null, h('th', { class: 'td-alerta', 'aria-label': 'Alerta' }), cols.map(th))), h('tbody', null, linhas)),
    h('div', { class: 'tabela-rodape' }, h('span', { class: 'muted' }, `${lista.length} de ${total} registro(s)`),
      lista.length > v.limite && h('button', { class: 'btn', onclick: () => { v.limite += 300; tela.atualizar(); } }, 'Mostrar mais')));
}

function kanban(m, lista) {
  const campo = m.campos.find((f) => f.k === m.kanban);
  const ctx = store.ctx();
  const podeEd = store.podeEditar(m.id);
  const colunasK = (campo.op === 'setores' ? store.config().setores : campo.op);
  const quadro = h('div', { class: 'kanban' }, colunasK.map((op) => {
    const itens = lista.filter((r) => (r[campo.k] || '') === op);
    const col = h('div', { class: 'k-col', dataset: { valor: op } },
      h('div', { class: 'k-cab' }, chip(op, (m.cores && m.cores[op]) || 'mute'), h('span', { class: 'muted' }, itens.length)),
      h('div', { class: 'k-itens' }, itens.slice(0, 80).map((r) => {
        const al = m.alertas ? m.alertas(r, m, ctx) : [];
        const prazoK = m.prazo && r[m.prazo];
        return h('a', {
          class: `k-card ${flash(r.id)} ${r._pend ? 'pendente' : ''}`, href: `#/m/${m.id}/${r.id}`, draggable: podeEd ? 'true' : null,
          ondragstart: (e) => { arrastando = true; e.dataTransfer.setData('text/plain', r.id); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('arrastando'); },
          ondragend: (e) => { arrastando = false; e.currentTarget.classList.remove('arrastando'); },
        },
        h('b', null, m.titulo(r)),
        m.sub && h('small', null, m.sub(r)),
        h('div', { class: 'k-rodape' },
          r.prioridade && chip(r.prioridade, { Urgente: 'crit', Alta: 'warn', Média: 'info', Baixa: 'mute' }[r.prioridade]),
          prazoK && chipPrazo(estaAberto(m, r) ? diasAte(prazoK) : null),
          al.length ? selo(al.some((a) => a.nivel === 'crit') ? 'crit' : 'warn', al.map((a) => a.msg).join(' · ')) : null));
      }), itens.length > 80 && h('small', { class: 'muted' }, `+${itens.length - 80} registros — use a tabela`)));
    if (podeEd) {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('alvo'); });
      col.addEventListener('dragleave', () => col.classList.remove('alvo'));
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('alvo');
        arrastando = false;
        const id = e.dataTransfer.getData('text/plain');
        const r = store.porId(m.id, id);
        if (r && r[campo.k] !== op) {
          try { store.salvar(m.id, { id, [campo.k]: op }); toast(`${m.titulo(r)} → ${op}`, 'ok', 2500); } catch (err) { toast(err.message, 'crit'); }
        }
      });
    }
    return col;
  }));
  return h('div', null, podeEd && h('p', { class: 'nota' }, 'Arraste os cartões entre as colunas para mudar a situação.'), quadro);
}

// ───────── calendário integrado (agenda + prazos de todos os módulos) ─────────
function barraCalendario(m, v) {
  const rot = h('b', { class: 'cal-mes' });
  const att = () => { rot.textContent = maiuscula(paraData(`${v.mes}-01`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })); tela && tela.atualizar(); };
  const mover = (n) => { const d = paraData(`${v.mes}-01`); d.setMonth(d.getMonth() + n); v.mes = isoData(d).slice(0, 7); att(); };
  rot.textContent = maiuscula(paraData(`${v.mes}-01`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
  return h('div', { class: 'filtros' },
    h('button', { class: 'icone-btn', 'aria-label': 'Mês anterior', onclick: () => mover(-1) }, icone('voltar', 18)),
    rot,
    h('button', { class: 'icone-btn', 'aria-label': 'Próximo mês', onclick: () => mover(1) }, icone('seta', 18)),
    h('button', { class: 'btn', onclick: () => { v.mes = hoje().slice(0, 7); v.dia = hoje(); att(); } }, 'Hoje'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: v.prazos, onchange: (e) => { v.prazos = e.target.checked; tela.atualizar(); } }), h('span', null, 'Mostrar prazos de todos os módulos e obrigações legais')));
}

function calendario(m, v) {
  const ini = paraData(`${v.mes}-01`);
  const primeiro = new Date(ini.getFullYear(), ini.getMonth(), 1 - ini.getDay());
  const fimMes = new Date(ini.getFullYear(), ini.getMonth() + 1, 0);
  const dias = [];
  for (let d = new Date(primeiro); d <= fimMes || d.getDay() !== 0; d.setDate(d.getDate() + 1)) dias.push(isoData(d));
  const eventos = store.lista('agenda').filter((r) => r.inicio);
  const prazos = v.prazos ? prazosIntegrados(dias[0], dias[dias.length - 1]) : [];
  const doDia = (dia) => [
    ...eventos.filter((r) => String(r.inicio).slice(0, 10) === dia).sort(MOD.agenda.ordenar).map((r) => ({ tipo: 'ag', r, titulo: r.titulo, hora: fmtHora(r.inicio), href: `#/m/agenda/${r.id}`, tom: MOD.agenda.cores[r.status] })),
    ...prazos.filter((p) => p.data === dia).map((p) => ({ tipo: 'pz', titulo: p.titulo, href: p.href, tom: p.legal ? 'pri' : 'warn', legal: p.legal })),
  ];
  const grade = h('div', { class: 'cal' },
    ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => h('div', { class: 'cal-sem' }, d)),
    dias.map((dia) => {
      const it = doDia(dia);
      const fora = dia.slice(0, 7) !== v.mes;
      return h('button', { class: `cal-dia ${fora ? 'fora' : ''} ${dia === hoje() ? 'hoje' : ''} ${dia === v.dia ? 'sel' : ''}`, onclick: () => { v.dia = dia; tela.atualizar(); } },
        h('span', { class: 'cal-num' }, Number(dia.slice(8))),
        it.slice(0, 3).map((x) => h('span', { class: `cal-ev e-${x.tipo} t-${x.tom || 'mute'}` }, x.hora ? `${x.hora} ` : '', x.titulo)),
        it.length > 3 && h('span', { class: 'cal-mais' }, `+${it.length - 3}`));
    }));
  const sel = doDia(v.dia);
  const lado = h('div', { class: 'cal-lado bloco' },
    h('div', { class: 'bloco-cab' }, h('h2', null, maiuscula(paraData(v.dia).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))),
      store.podeEditar('agenda') && h('button', { class: 'btn btn-pri', onclick: () => { novoComPadrao.agenda = { inicio: `${v.dia}T09:00` }; irPara('#/m/agenda/novo'); } }, icone('mais', 15), 'Compromisso')),
    sel.length ? sel.map((x) => h('a', { class: `ag-item ${x.r ? flash(x.r.id) : ''}`, href: x.href },
      h('span', { class: 'ag-data' }, x.tipo === 'ag' ? h('b', null, x.hora) : chip(x.legal ? 'Legal' : 'Prazo', x.tom)),
      h('span', { class: 'ag-txt' }, h('b', null, x.titulo), x.r && h('small', null, [x.r.tipo, x.r.local, x.r.status].filter(Boolean).join(' · '))))) : vazio('Nada marcado para este dia.'));
  return h('div', { class: 'cal-caixa' }, grade, lado);
}

// ═════════════════════════ REGISTRO (gaveta) ═════════════════════════
const novoComPadrao = {};

function abrirRegistro(c, id) {
  const m = MOD[c];
  const ctx = store.ctx();
  let r = id ? store.porId(c, id) : null;
  if (id && !r) { toast('Registro não encontrado (pode ter sido excluído).', 'warn'); irPara(`#/m/${c}`); return; }
  const novo = !r;
  const podeEd = store.podeEditar(c);
  const valores = {};
  if (novo) {
    m.campos.forEach((f) => { if (f.padrao != null) valores[f.k] = typeof f.padrao === 'function' ? f.padrao() : f.padrao; });
    Object.assign(valores, novoComPadrao[c] || {});
    delete novoComPadrao[c];
  } else Object.assign(valores, r);
  let aba = 'dados';
  const estado = { c, id, v: r ? r._v : 0, sujo: false };

  const corpo = h('div', { class: 'reg-corpo' });
  const abasEl = h('div', { class: 'abas', role: 'tablist' });
  const banner = h('div', { class: 'banner', hidden: true });
  const cabTitulo = h('div', { class: 'reg-titulo' });

  const desenharCab = () => {
    const atual = r ? store.porId(c, r.id) || r : null;
    repor(cabTitulo, 
      h('small', { class: 'muted' }, icone(m.icone, 14), ` ${m.singular}`),
      h('h2', null, atual ? m.titulo(atual) : `Novo(a): ${m.singular.toLowerCase()}`),
      atual && h('div', { class: 'linha-chips' }, m.status && chip(atual[m.status], tomStatus(m, atual)), atual._pend && chip('aguardando envio', 'info'),
        h('small', { class: 'muted' }, `Atualizado por ${atual.atualizado_por || '—'} · `, h('span', { 'data-quando': atual.atualizado_em }, tempoRelativo(atual.atualizado_em)))));
  };

  const formulario = () => {
    const form = h('form', { class: 'form-reg', novalidate: true });
    const grade = h('div', { class: 'grade-form' });
    const aoMudar = (k, val) => {
      valores[k] = val;
      estado.sujo = true;
      const extra = m.aoMudar && m.aoMudar(k, val, valores);
      if (extra) for (const [k2, v2] of Object.entries(extra)) { valores[k2] = v2; const el = form.querySelector(`[name="${k2}"]`); if (el) el.value = v2; }
    };
    m.campos.forEach((f) => {
      if (f.t === 'vinculo') {
        const [vc, vid] = String(valores[f.k] || '').split(':');
        const alvo = vc && MOD[vc] && store.porId(vc, vid);
        if (alvo || valores[f.k]) grade.append(h('div', { class: 'campo larg' }, h('label', null, f.l),
          h('div', { class: 'vinculo' }, alvo ? h('a', { href: `#/m/${vc}/${vid}` }, icone('link', 14), ` ${MOD[vc].singular}: ${MOD[vc].titulo(alvo)}`) : h('span', { class: 'muted' }, 'Registro vinculado indisponível'),
            podeEd && h('button', { type: 'button', class: 'link', onclick: (e) => { valores[f.k] = ''; estado.sujo = true; e.target.closest('.campo').remove(); } }, 'remover vínculo'))));
        return;
      }
      grade.append(campoForm(f, valores[f.k], { opcoes: opcoesCampo(f), aoMudar, somenteLeitura: !podeEd }));
    });
    // campos calculados (somente leitura)
    if (!novo && m.calc) {
      grade.append(h('div', { class: 'campo larg calc-lista' }, m.calc.map((cc) => h('span', null, h('small', { class: 'muted' }, cc.l), celulaCalc(cc, { ...valores }, m, ctx)))));
    }
    form.append(grade);
    if (podeEd) {
      form.append(h('div', { class: 'reg-acoes' },
        h('button', { class: 'btn btn-pri', type: 'submit' }, novo ? `Cadastrar` : 'Salvar alterações'),
        h('button', { class: 'btn', type: 'button', onclick: () => fecharRegistro() }, 'Cancelar'),
        !novo && h('button', { class: 'btn btn-perigo-txt', type: 'button', onclick: excluir }, icone('lixo', 15), 'Excluir')));
    } else form.append(h('p', { class: 'nota' }, 'Seu perfil permite apenas consultar este módulo.'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const faltando = m.campos.filter((f) => f.req && (valores[f.k] == null || valores[f.k] === ''));
      if (faltando.length) {
        toast(`Preencha: ${faltando.map((f) => f.l).join(', ')}`, 'warn');
        form.querySelector(`[name="${faltando[0].k}"]`)?.focus();
        return;
      }
      try {
        const dados = {};
        m.campos.forEach((f) => { if (f.k in valores) dados[f.k] = valores[f.k]; });
        if (!novo) dados.id = r.id;
        estado.sujo = false; // antes de salvar: a notificação local não deve abrir o aviso de conflito
        const salvo = store.salvar(c, dados);
        toast(novo ? `${m.singular} cadastrado(a).` : 'Alterações salvas.', 'ok', 2500);
        if (store.modo === 'servidor' && store.conexao.estado !== 'online') toast('Sem conexão agora: a alteração fica na fila e será enviada automaticamente.', 'info', 5000);
        if (novo) { regAberto = null; irPara(`#/m/${c}/${salvo.id}`); } else fecharRegistro();
      } catch (err) { toast(err.message, 'crit'); }
    });
    return form;
  };

  async function excluir() {
    if (!(await confirmar(`Excluir "${m.titulo(r)}"? O registro sai das telas, mas a exclusão fica registrada no histórico de auditoria.`, 'Excluir', true))) return;
    try { store.excluir(c, r.id); toast('Registro excluído.', 'ok'); estado.sujo = false; fecharRegistro(); } catch (err) { toast(err.message, 'crit'); }
  }

  const vinculos = () => {
    if (!r) return [];
    const out = [];
    for (const m2 of MODULOS) {
      if (!store.podeVer(m2.id)) continue;
      const refs = m2.campos.filter((f) => f.t === 'ref' && f.ref === c);
      const temVinculo = m2.campos.some((f) => f.t === 'vinculo');
      if (!refs.length && !temVinculo) continue;
      const lst = store.lista(m2.id).filter((x) => refs.some((f) => x[f.k] === r.id) || (temVinculo && x.vinculo === `${c}:${r.id}`));
      if (lst.length) out.push({ m: m2, lista: lst });
    }
    // referências de saída
    const saida = m.campos.filter((f) => f.t === 'ref' && r[f.k] && store.podeVer(f.ref)).map((f) => ({ f, alvo: store.porId(f.ref, r[f.k]) })).filter((x) => x.alvo);
    if (r.vinculo) { const [vc, vid] = String(r.vinculo).split(':'); const alvo = MOD[vc] && store.porId(vc, vid); if (alvo) saida.push({ f: { l: 'Origem', ref: vc }, alvo }); }
    return { entrada: out, saida };
  };

  const abaVinculos = () => {
    const { entrada, saida } = vinculos();
    const total = entrada.reduce((s, x) => s + x.lista.length, 0);
    return h('div', { class: 'vinculos' },
      saida.length > 0 && h('div', { class: 'sub-bloco' }, h('div', { class: 'rotulo' }, 'Este registro se refere a'),
        saida.map(({ f, alvo }) => h('a', { class: 'vinc-item', href: `#/m/${f.ref}/${alvo.id}` }, icone(MOD[f.ref].icone, 16), h('span', null, h('small', { class: 'muted' }, f.l), h('b', null, MOD[f.ref].titulo(alvo)))))),
      c === 'unidades' && h('div', { class: 'kpis kpis-mini' }, entrada.map(({ m: m2, lista }) => {
        const al = m2.alertas ? lista.reduce((s, x) => s + m2.alertas(x, m2, ctx).length, 0) : 0;
        const ab = lista.filter((x) => estaAberto(m2, x)).length;
        return cartaoKpi({ l: m2.nome, v: ab, sub: al ? `${al} alerta(s)` : 'em aberto', tom: al ? 'warn' : null, icone: m2.icone });
      })),
      entrada.length ? entrada.map(({ m: m2, lista }) => h('div', { class: 'sub-bloco' },
        h('div', { class: 'rotulo' }, `${m2.nome} (${lista.length})`),
        lista.sort(m2.ordenar || (() => 0)).slice(0, 30).map((x) => h('a', { class: `vinc-item ${flash(x.id)}`, href: `#/m/${m2.id}/${x.id}` },
          icone(m2.icone, 16), h('span', null, h('b', null, m2.titulo(x)), m2.sub && h('small', { class: 'muted' }, m2.sub(x))), m2.status && chip(x[m2.status], tomStatus(m2, x)))))) : (!saida.length && vazio('Nenhum registro de outros módulos aponta para este.')),
    );
  };

  const comentarios = () => (r ? store.lista('comentarios').filter((x) => x.colecao === c && x.registro === r.id).sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em))) : []);
  const abaComentarios = () => {
    const lista = comentarios();
    const txt = h('textarea', { rows: 2, placeholder: 'Escreva um comentário para a equipe…', 'aria-label': 'Comentário' });
    const enviar = () => {
      const t = txt.value.trim();
      if (!t) return;
      try { store.salvar('comentarios', { colecao: c, registro: r.id, texto: t, autor: store.usuario.nome }); txt.value = ''; } catch (err) { toast(err.message, 'crit'); }
    };
    txt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) enviar(); });
    return h('div', { class: 'comentarios' },
      lista.length ? lista.map((x) => h('div', { class: `coment ${flash(x.id)}` }, h('span', { class: 'avatar mini' }, iniciais(x.autor || x.criado_por)),
        h('div', null, h('p', null, h('b', null, x.autor || x.criado_por), ' ', h('small', { class: 'muted', 'data-quando': x.criado_em }, tempoRelativo(x.criado_em)), x._pend ? h('small', { class: 'muted' }, ' · enviando') : null), h('p', { class: 'coment-txt' }, x.texto)))) : vazio('Sem comentários ainda.'),
      h('div', { class: 'coment-novo' }, txt, h('button', { class: 'btn btn-pri', onclick: enviar, 'aria-label': 'Enviar comentário' }, icone('enviar', 16))));
  };

  let historicoServidor = null;
  const abaHistorico = () => {
    const caixa = h('div', { class: 'historico' });
    const desenharH = (evs) => repor(caixa, 
      h('p', { class: 'nota' }, `Criado por ${r.criado_por || '—'} em ${fmtDataHora(r.criado_em ? new Date(r.criado_em) : '')}.`),
      evs.length ? h('ol', { class: 'feed' }, evs.map((e) => h('li', { class: 'feed-item' }, h('span', { class: 'avatar mini' }, iniciais(e.n || e.u)),
        h('div', null, h('p', null, h('b', null, e.n || e.u), ` ${ROTULO_ACAO[e.a] || e.a}`, (e.f || []).length ? h('span', { class: 'muted' }, ` — ${(e.f || []).map((k) => (m.campos.find((x) => x.k === k) || { l: k }).l).join(', ')}`) : ''),
          h('small', { class: 'muted' }, fmtDataHora(new Date(e.q))))))) : vazio('Sem eventos registrados nesta sessão.'));
    const locais = store.eventos.filter((e) => e.c === c && e.id === r.id);
    desenharH(historicoServidor || locais);
    if (store.modo === 'servidor' && !historicoServidor) {
      store.chamar('historico', { c, id: r.id }).then((j) => { historicoServidor = j.eventos || []; if (aba === 'historico') desenharH(historicoServidor); }).catch(() => { /* mantém o local */ });
    }
    return caixa;
  };

  const desenharAbas = () => {
    const nV = r ? (() => { const v2 = vinculos(); return v2.entrada.reduce((s, x) => s + x.lista.length, 0) + v2.saida.length; })() : 0;
    const nC = comentarios().length;
    const defs = [['dados', 'Dados'], ...(r ? [['vinculos', c === 'unidades' ? `Visão integrada (${nV})` : `Vínculos (${nV})`], ['comentarios', `Comentários (${nC})`], ['historico', 'Histórico']] : [])];
    repor(abasEl, ...defs.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(aba === k), class: aba === k ? 'on' : '', onclick: () => { aba = k; desenharAbas(); desenharCorpo(); } }, l)));
  };
  const desenharCorpo = () => {
    const al = r ? alertasDe(c, r.id) : [];
    repor(corpo, 
      al.length ? h('div', { class: 'reg-alertas' }, al.map((a) => h('div', { class: `alerta-linha n-${a.nivel}` }, selo(a.nivel, ''), h('b', null, a.msg)))) : '',
      aba === 'dados' ? formulario() : aba === 'vinculos' ? abaVinculos() : aba === 'comentarios' ? abaComentarios() : abaHistorico());
  };

  const acoesTopo = h('div', { class: 'reg-topo-acoes' },
    r && c !== 'tarefas' && store.podeEditar('tarefas') && h('button', {
      class: 'btn', 'data-dica': 'Cria uma demanda já vinculada a este registro',
      onclick: () => { novoComPadrao.tarefas = { titulo: `Providenciar: ${m.titulo(r)}`, vinculo: `${c}:${r.id}`, origem: `${m.singular} ${m.titulo(r)}`, prazo: m.prazo && r[m.prazo] ? String(r[m.prazo]).slice(0, 10) : addDias(hoje(), 3) }; regAberto = null; irPara('#/m/tarefas/novo'); },
    }, icone('tarefas', 15), 'Gerar demanda'),
    r && h('button', { class: 'icone-btn', 'aria-label': 'Copiar link', 'data-dica': 'Copiar link deste registro', onclick: () => { navigator.clipboard?.writeText(location.href.split('#')[0] + `#/m/${c}/${r.id}`); toast('Link copiado.', 'ok', 2000); } }, icone('link', 18)),
    h('button', { class: 'icone-btn', 'aria-label': 'Fechar', onclick: () => fecharRegistro() }, icone('fechar', 20)));

  const painel = abrirGaveta(h('div', { class: 'reg' }, h('div', { class: 'reg-cab' }, cabTitulo, acoesTopo), banner, abasEl, corpo), {
    aoFechar: () => { regAberto = null; if (location.hash.split('/').length > 3) history.replaceState(null, '', `#/m/${c}`); montarNav(); },
  });

  regAberto = {
    c, id: r ? r.id : null, painel,
    verificar: () => {
      if (!r) return;
      const atual = store.dados[c].get(r.id);
      if (!atual || atual.excluido) { banner.hidden = false; repor(banner, icone('alerta', 16), ' Este registro foi excluído por outro usuário.'); return; }
      if ((atual._v || 0) === estado.v || atual._pend) { desenharCab(); return; }
      estado.v = atual._v;
      if (estado.sujo && aba === 'dados') {
        banner.hidden = false;
        repor(banner, icone('sync', 16), h('span', null, ` ${atual.atualizado_por} alterou este registro agora. `),
          h('button', { class: 'link', onclick: () => { r = atual; Object.keys(valores).forEach((k) => delete valores[k]); Object.assign(valores, atual); estado.sujo = false; banner.hidden = true; desenharCab(); desenharCorpo(); } }, 'Carregar a versão atual'),
          h('span', { class: 'muted' }, ' (suas alterações não salvas serão descartadas; campos diferentes dos que você editou são mesclados ao salvar)'));
      } else {
        r = atual;
        Object.keys(valores).forEach((k) => delete valores[k]);
        Object.assign(valores, atual);
        desenharCab();
        if (aba !== 'comentarios') desenharCorpo();
        painel.querySelector('.reg')?.classList.add('flash');
        setTimeout(() => painel.querySelector('.reg')?.classList.remove('flash'), 1500);
      }
    },
    atualizarAbas: () => { if (!r) return; desenharAbas(); if (aba === 'comentarios' || aba === 'vinculos') desenharCorpo(); },
  };
  desenharCab();
  desenharAbas();
  desenharCorpo();
  if (novo) setTimeout(() => painel.querySelector('input:not([type=checkbox]), select, textarea')?.focus({ preventScroll: true }), 250);

  function fecharRegistro() {
    if (estado.sujo && podeEd) {
      confirmar('Descartar as alterações não salvas?', 'Descartar', true).then((ok) => { if (ok) { estado.sujo = false; fecharGaveta(); } });
      return;
    }
    fecharGaveta();
  }
}

// ═════════════════════════ ALERTAS ═════════════════════════
function telaAlertas() {
  const v = vis.alertas || (vis.alertas = { nivel: '' });
  const corpo = h('div');
  elMain.append(h('div', { class: 'tela-cab' }, h('div', { class: 'tela-titulo' }, h('span', { class: 'tela-icone' }, icone('alerta', 22)),
    h('div', null, h('h1', null, 'Central de alertas'), h('p', { class: 'muted' }, 'Gerados automaticamente a partir de prazos, estoques, leitos, escalas e contratos de todos os módulos.')))),
  h('div', { class: 'filtros' }, h('div', { class: 'seg-ctrl' }, [['', 'Todos'], ['crit', 'Críticos'], ['warn', 'Atenção']].map(([k, l]) => h('button', { class: v.nivel === k ? 'on' : '', onclick: (e) => { v.nivel = k; e.target.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)); tela.atualizar(); } }, l)))),
  corpo);
  const desenhar = () => {
    const lista = calcularAlertas().filter((a) => !v.nivel || a.nivel === v.nivel);
    if (!lista.length) { repor(corpo, vazio('Nenhum alerta neste filtro.')); return; }
    const grupos = {};
    lista.forEach((a) => { (grupos[a.c] = grupos[a.c] || []).push(a); });
    repor(corpo, ...MODULOS.filter((m) => grupos[m.id]).map((m) => secao(m.nome, `${grupos[m.id].length} alerta(s)`, h('div', { class: 'lista-alertas' }, grupos[m.id].map((a) => linhaAlerta(a))))));
  };
  tela = { rota: 'alertas', depende: '*', atualizar: desenhar };
  desenhar();
}

// ═════════════════════════ ATIVIDADE ═════════════════════════
function telaAtividade() {
  const v = vis.atividade || (vis.atividade = { c: '' });
  const corpo = h('div', { class: 'bloco' });
  elMain.append(h('div', { class: 'tela-cab' }, h('div', { class: 'tela-titulo' }, h('span', { class: 'tela-icone' }, icone('sync', 22)),
    h('div', null, h('h1', null, 'Atividade ao vivo'), h('p', { class: 'muted' }, 'Tudo o que foi criado, alterado ou excluído, por quem e quando. O registro completo de auditoria fica na aba _Eventos da planilha.')))),
  h('div', { class: 'filtros' }, h('select', { value: v.c, onchange: (e) => { v.c = e.target.value; tela.atualizar(); } }, h('option', { value: '' }, 'Todos os módulos'), MODULOS.filter((m) => store.podeVer(m.id)).map((m) => h('option', { value: m.id }, m.nome)), h('option', { value: 'comentarios' }, 'Comentários'))),
  corpo);
  tela = { rota: 'atividade', depende: '*', atualizar: () => repor(corpo, feed(store.eventos.filter((e) => !v.c || e.c === v.c).slice(0, 200))) };
  tela.atualizar();
}

// ═════════════════════════ USUÁRIOS ═════════════════════════
function telaUsuarios() {
  const corpo = h('div');
  elMain.append(h('div', { class: 'tela-cab' }, h('div', { class: 'tela-titulo' }, h('span', { class: 'tela-icone' }, icone('usuarios', 22)),
    h('div', null, h('h1', null, 'Usuários e perfis'), h('p', { class: 'muted' }, 'Quem acessa o sistema, com qual perfil e em quais módulos. As permissões são verificadas no servidor a cada operação.'))),
  store.modo === 'servidor' && h('div', { class: 'acoes' }, h('button', { class: 'btn btn-pri', onclick: () => formUsuario(null, carregar) }, icone('mais', 16), 'Novo usuário'))), corpo);
  tela = { rota: 'usuarios', depende: new Set(), atualizar: () => {} };

  const perfisTabela = h('div', { class: 'bloco' }, h('div', { class: 'bloco-cab' }, h('h2', null, 'Perfis de acesso')),
    h('table', { class: 'tabela' }, h('tbody', null, Object.entries(PERFIS).map(([k, l]) => h('tr', null, h('td', { class: 'mono' }, k), h('td', null, l))))));

  async function carregar() {
    if (store.modo === 'demo') {
      repor(corpo, h('div', { class: 'faixa-info' }, icone('info', 16), 'No modo demonstração os usuários são simulados. Conectado ao servidor, esta tela cria e edita usuários, redefine senhas e desativa acessos.'), perfisTabela);
      return;
    }
    repor(corpo, h('p', { class: 'muted' }, 'Carregando…'));
    try {
      const j = await store.chamar('usuarios');
      repor(corpo, h('div', { class: 'tabela-caixa' }, h('table', { class: 'tabela' },
        h('thead', null, h('tr', null, ['Usuário', 'Nome', 'Perfil', 'Setor', 'Módulos', 'Situação', 'Último acesso'].map((t) => h('th', null, t)))),
        h('tbody', null, (j.usuarios || []).map((u) => h('tr', { tabindex: '0', onclick: () => formUsuario(u, carregar) },
          h('td', { class: 'mono td-pri' }, u.login), h('td', null, u.nome), h('td', null, u.perfil), h('td', null, u.setor || ''),
          h('td', null, !u.modulos || u.modulos === '*' ? 'Todos' : String(u.modulos).split(',').map((x) => (MOD[x.trim()] ? MOD[x.trim()].nome : x)).join(', ')),
          h('td', null, chip(u.ativo === false || u.ativo === 'FALSE' ? 'Inativo' : 'Ativo', u.ativo === false || u.ativo === 'FALSE' ? 'mute' : 'ok')),
          h('td', null, u.ultimo_acesso ? fmtDataHora(new Date(u.ultimo_acesso)) : '—')))))), perfisTabela);
    } catch (e) { repor(corpo, vazio(`Não foi possível carregar os usuários: ${e.message}`)); }
  }
  carregar();
}

function formUsuario(u, depois) {
  const novo = !u;
  const val = { login: '', nome: '', perfil: 'editor', setor: '', modulos: '*', ativo: true, senha: '', ...(u || {}) };
  const mods = new Set(String(val.modulos || '*').split(',').map((x) => x.trim()).filter(Boolean));
  const campos = [
    { k: 'login', l: 'Usuário (login)', t: 'text', req: true, mono: true, dica: 'Minúsculas, sem espaços. Ex.: maria.silva' },
    { k: 'nome', l: 'Nome completo', t: 'text', req: true },
    { k: 'perfil', l: 'Perfil', t: 'select', req: true },
    { k: 'setor', l: 'Setor', t: 'select' },
    { k: 'ativo', l: 'Acesso ativo', t: 'bool' },
    { k: 'senha', l: novo ? 'Senha inicial' : 'Nova senha (deixe em branco para manter)', t: 'text', req: novo, dica: 'Mínimo de 8 caracteres. Entregue ao usuário por canal seguro.' },
  ];
  const opc = { perfil: Object.entries(PERFIS).map(([v, l]) => ({ v, l })), setor: store.config().setores.map((s) => ({ v: s, l: s })) };
  const form = h('form', { class: 'form-reg' });
  const grade = h('div', { class: 'grade-form' }, campos.map((f) => {
    const el = campoForm(f, f.k === 'senha' ? '' : val[f.k], { opcoes: opc[f.k] || [], aoMudar: (k, v) => { val[k] = v; } });
    if (f.k === 'login' && !novo) el.querySelector('input').disabled = true;
    if (f.k === 'senha') el.querySelector('input').type = 'password';
    return el;
  }));
  const todos = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: mods.has('*'), onchange: (e) => { lista.hidden = e.target.checked; } }), h('span', null, 'Todos os módulos'));
  const lista = h('div', { class: 'grade-checks', hidden: mods.has('*') }, MODULOS.map((m) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: m.id, checked: mods.has(m.id) }), h('span', null, m.nome))));
  form.append(grade, h('div', { class: 'campo larg' }, h('label', null, 'Módulos autorizados (perfis Editor e Consulta)'), todos, lista),
    h('div', { class: 'reg-acoes' }, h('button', { class: 'btn btn-pri', type: 'submit' }, novo ? 'Criar usuário' : 'Salvar'), h('button', { class: 'btn', type: 'button', onclick: () => fecharGaveta() }, 'Cancelar')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const modulos = todos.querySelector('input').checked ? '*' : [...lista.querySelectorAll('input:checked')].map((x) => x.value).join(',');
    if (!val.login || !val.nome || (novo && String(val.senha).length < 8) || (val.senha && String(val.senha).length < 8)) { toast('Preencha usuário, nome e uma senha com pelo menos 8 caracteres.', 'warn'); return; }
    try {
      await store.chamar('salvarUsuario', { usuario: { login: String(val.login).trim().toLowerCase(), nome: val.nome, perfil: val.perfil, setor: val.setor, ativo: val.ativo !== false, modulos, senha: val.senha || '' }, novo });
      toast(novo ? 'Usuário criado.' : 'Usuário atualizado.', 'ok');
      fecharGaveta();
      depois();
    } catch (err) { toast(err.message, 'crit'); }
  });
  abrirGaveta(h('div', { class: 'reg' }, h('div', { class: 'reg-cab' }, h('div', { class: 'reg-titulo' }, h('small', { class: 'muted' }, 'Usuário'), h('h2', null, novo ? 'Novo usuário' : val.nome)),
    h('button', { class: 'icone-btn', 'aria-label': 'Fechar', onclick: () => fecharGaveta() }, icone('fechar', 20))), h('div', { class: 'reg-corpo' }, form)));
}

// ═════════════════════════ CONFIGURAÇÕES ═════════════════════════
function telaConfig() {
  const cfg = store.config();
  const corpo = h('div', { class: 'config' });
  elMain.append(h('div', { class: 'tela-cab' }, h('div', { class: 'tela-titulo' }, h('span', { class: 'tela-icone' }, icone('config', 22)),
    h('div', null, h('h1', null, 'Configurações'), h('p', { class: 'muted' }, 'Conexão, dados da Secretaria, sua conta e privacidade.')))), corpo);
  tela = { rota: 'config', depende: new Set(), atualizar: () => {} };

  const conexao = secao('Conexão', store.modo === 'demo' ? 'modo demonstração' : 'servidor da Secretaria',
    h('dl', { class: 'dl' },
      h('dt', null, 'Modo'), h('dd', null, store.modo === 'demo' ? 'Demonstração (dados fictícios, só neste navegador)' : 'Servidor — Google Apps Script + Planilha'),
      store.modo === 'servidor' && [h('dt', null, 'Servidor'), h('dd', { class: 'mono quebra' }, store.url)],
      h('dt', null, 'Usuário'), h('dd', null, `${store.usuario.nome} (${store.usuario.login}) — ${PERFIS[store.usuario.perfil] || store.usuario.perfil}`),
      h('dt', null, 'Alterações na fila'), h('dd', null, String(store.fila.length)),
      h('dt', null, 'Versão dos dados'), h('dd', { class: 'mono' }, `seq ${store.seq}`)),
    h('div', { class: 'acoes' },
      store.modo === 'servidor' && h('button', { class: 'btn', onclick: () => { store.ciclo(); toast('Sincronizando…', 'info', 1500); } }, icone('sync', 16), 'Sincronizar agora'),
      store.modo === 'servidor' && h('button', { class: 'btn', onclick: async () => { try { await store.carregarTudo(); toast('Dados recarregados do servidor.', 'ok'); } catch (e) { toast(e.message, 'crit'); } } }, 'Recarregar tudo'),
      store.modo === 'demo' && h('button', { class: 'btn', onclick: async () => { if (await confirmar('Restaurar os dados de demonstração originais?', 'Restaurar')) { await store.reiniciarDemo(); toast('Demonstração restaurada.', 'ok'); } } }, 'Restaurar demonstração'),
      store.modo === 'demo' && h('button', { class: 'btn btn-pri', onclick: async () => { await store.sair(); location.hash = ''; location.reload(); } }, 'Conectar ao servidor'),
      h('button', { class: 'btn', onclick: exportarBackup }, icone('baixar', 16), 'Exportar cópia (JSON)')));

  const val = { ...cfg.bruto, orgao: cfg.orgao, setores: cfg.setores.join('\n'), receita_base: cfg.receita_base || '', exercicio: cfg.exercicio };
  const podeCfg = store.podeEditar('config');
  const camposCfg = [
    { k: 'orgao', l: 'Nome do órgão', t: 'text', larg: 'full' },
    { k: 'exercicio', l: 'Exercício', t: 'number' },
    { k: 'receita_base', l: 'Base de cálculo ASPS — impostos e transferências (R$)', t: 'money', dica: 'Usada para estimar o percentual aplicado (LC 141/2012, art. 7º).' },
    { k: 'setores', l: 'Setores da Secretaria (um por linha)', t: 'textarea', larg: 'full' },
  ];
  const fCfg = h('form', { class: 'form-reg' }, h('div', { class: 'grade-form' }, camposCfg.map((f) => campoForm(f, val[f.k], { aoMudar: (k, v) => { val[k] = v; }, somenteLeitura: !podeCfg }))),
    podeCfg ? h('div', { class: 'reg-acoes' }, h('button', { class: 'btn btn-pri', type: 'submit' }, 'Salvar dados da Secretaria')) : h('p', { class: 'nota' }, 'Somente administradores alteram estes dados.'));
  fCfg.addEventListener('submit', (e) => {
    e.preventDefault();
    try { store.salvar('config', { id: 'geral', orgao: val.orgao, exercicio: val.exercicio, receita_base: val.receita_base, setores: val.setores }); toast('Dados da Secretaria salvos.', 'ok'); } catch (err) { toast(err.message, 'crit'); }
  });

  const tema = secao('Aparência', '', h('div', { class: 'seg-ctrl' }, [['', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([k, l]) => h('button', {
    class: (document.documentElement.dataset.theme || '') === k ? 'on' : '',
    onclick: (e) => { if (k) document.documentElement.dataset.theme = k; else delete document.documentElement.dataset.theme; try { localStorage.setItem('saude.tema', k); } catch { /* */ } e.target.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)); },
  }, l))));

  const notif = secao('Notificações', '', h('p', { class: 'muted' }, 'Avisos urgentes e importantes do mural aparecem na tela de todos os usuários conectados. Com a permissão do navegador, aparecem também quando a aba está em segundo plano.'),
    'Notification' in window ? h('button', { class: 'btn', onclick: pedirNotificacoes }, icone('sino', 16), Notification.permission === 'granted' ? 'Notificações ativas' : 'Ativar notificações') : h('p', { class: 'nota' }, 'Este navegador não oferece notificações.'));

  let senha = null;
  if (store.modo === 'servidor') {
    const s = { atual: '', nova: '', conf: '' };
    const fS = h('form', { class: 'form-reg' }, h('div', { class: 'grade-form' },
      [['atual', 'Senha atual'], ['nova', 'Nova senha (mín. 8)'], ['conf', 'Confirmar nova senha']].map(([k, l]) => { const c2 = campoForm({ k, l, t: 'text' }, '', { aoMudar: (kk, v) => { s[kk] = v; } }); c2.querySelector('input').type = 'password'; return c2; })),
    h('div', { class: 'reg-acoes' }, h('button', { class: 'btn', type: 'submit' }, 'Alterar senha')));
    fS.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (s.nova.length < 8 || s.nova !== s.conf) { toast('A nova senha precisa ter 8+ caracteres e coincidir com a confirmação.', 'warn'); return; }
      try { await store.chamar('alterarSenha', { atual: s.atual, nova: s.nova }); toast('Senha alterada.', 'ok'); fS.reset(); } catch (err) { toast(err.message, 'crit'); }
    });
    senha = secao('Minha senha', '', fS);
  }

  const lgpd = secao('Privacidade e proteção de dados', 'LGPD — Lei nº 13.709/2018',
    h('ul', { class: 'lista-texto' },
      h('li', null, 'Este é um sistema gerencial: não substitui prontuário, sistema de regulação nem sistemas oficiais do SUS. Para pacientes, registre só protocolo e iniciais (art. 6º, III — necessidade). Dados de saúde são dados pessoais sensíveis (art. 5º, II, e art. 11).'),
      h('li', null, 'Cada operação fica registrada com usuário, data e campos alterados na aba _Eventos (art. 37 — registro das operações de tratamento).'),
      h('li', null, 'Ao sair, os dados guardados neste aparelho são apagados. Em computador compartilhado, sempre use "Sair".'),
      h('li', null, 'Restrinja o compartilhamento da planilha aos administradores. Os demais usuários acessam só pelo sistema, com perfil e módulos definidos.')));

  corpo.append(conexao, secao('Dados da Secretaria', '', fCfg), senha, notif, tema, lgpd);
}

function exportarCSV(m) {
  const ctx = store.ctx();
  const lista = filtrar(m, lerVisao(m), store.lista(m.id));
  const cab = [...m.campos.map((f) => f.l), ...(m.calc || []).map((c) => c.l), 'Atualizado por', 'Atualizado em'];
  const linhas = lista.map((r) => [
    ...m.campos.map((f) => valorCampo(f, r, ctx)),
    ...(m.calc || []).map((c) => { const x = c.v(r, m, ctx); return x == null ? '' : typeof x === 'number' ? fmtNum(x) : x; }),
    r.atualizado_por || '', r.atualizado_em ? fmtDataHora(new Date(r.atualizado_em)) : '',
  ]);
  baixar(`${m.id}-${hoje()}.csv`, csv([cab, ...linhas]));
  toast(`${linhas.length} registro(s) exportado(s).`, 'ok', 2500);
}

function exportarBackup() {
  const dados = {};
  TODAS_COLECOES.forEach((c) => { if (store.podeVer(c)) dados[c] = store.lista(c); });
  baixar(`gestao-saude-${hoje()}.json`, JSON.stringify({ exportado_em: new Date().toISOString(), por: store.usuario.login, seq: store.seq, dados }, null, 1), 'application/json');
}

try { const t = localStorage.getItem('saude.tema'); if (t) document.documentElement.dataset.theme = t; } catch { /* */ }
iniciar();
