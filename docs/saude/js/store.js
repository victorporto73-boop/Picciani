// Estado da aplicação, cache local (IndexedDB), fila offline e sincronização
// em tempo quase real com o backend (Google Apps Script + Planilha).
//
// Modelo de sincronização:
//  - cada alteração no servidor recebe um número sequencial (seq) e entra no
//    registro de eventos (aba _Eventos);
//  - o app guarda o último seq conhecido e, a cada poucos segundos, pede
//    "o que mudou desde seq"; as mudanças chegam com o registro completo;
//  - gravações locais entram numa fila com id único e são enviadas como
//    "patch" (somente os campos alterados). O servidor mescla campo a campo,
//    então duas pessoas editando campos diferentes do mesmo registro não se
//    sobrescrevem. Reenviar a fila não duplica nada.

import { CONFIG } from './config.js';
import { MOD, TODAS_COLECOES, SETORES_PADRAO } from './modulos.js';
import { novoId, debounce } from './util.js';

// ───────── armazenamento local (IndexedDB com fallback para localStorage) ─────────
const kv = (() => {
  let dbp = null;
  const abrir = () => {
    if (!dbp) {
      dbp = new Promise((ok, falha) => {
        if (!('indexedDB' in window)) return falha(new Error('sem IndexedDB'));
        const r = indexedDB.open('gestao-saude', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => ok(r.result);
        r.onerror = () => falha(r.error);
      });
    }
    return dbp;
  };
  const op = async (modo, fn) => {
    const db = await abrir();
    return new Promise((ok, falha) => {
      const t = db.transaction('kv', modo);
      const req = fn(t.objectStore('kv'));
      t.oncomplete = () => ok(req && req.result);
      t.onerror = () => falha(t.error);
    });
  };
  const ls = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* cheio ou bloqueado */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch { /* */ } },
  };
  return {
    get: (k) => op('readonly', (s) => s.get(k)).catch(() => ls.get(k)),
    set: (k, v) => op('readwrite', (s) => s.put(v, k)).catch(() => ls.set(k, v)),
    del: (k) => op('readwrite', (s) => s.delete(k)).catch(() => ls.del(k)),
  };
})();

const pref = {
  get: (k) => { try { return localStorage.getItem('saude.' + k) || ''; } catch { return ''; } },
  set: (k, v) => { try { v ? localStorage.setItem('saude.' + k, v) : localStorage.removeItem('saude.' + k); } catch { /* */ } },
};

const PREFIXO = { unidades: 'un', agenda: 'ag', tarefas: 'tf', avisos: 'av', ocorrencias: 'oc', regulacao: 'rg', estoque: 'es', escalas: 'ec', vigilancia: 'vg', campanhas: 'cp', judicial: 'jd', ouvidoria: 'ov', protocolo: 'pt', contratos: 'ct', orcamento: 'or', planejamento: 'pl', comentarios: 'cm', config: 'cf' };
const RESERVADOS = new Set(['id', '_v', '_pend', 'criado_em', 'criado_por', 'atualizado_em', 'atualizado_por']);
const MAX_EVENTOS = 300;

export const PERFIS = {
  admin: 'Administrador (Secretário / TI)',
  gestor: 'Gestor — vê e edita todos os módulos',
  editor: 'Editor — edita os módulos autorizados',
  leitor: 'Consulta — somente leitura',
};

export class Store {
  constructor() {
    this.modo = null;          // 'demo' | 'servidor'
    this.url = '';
    this.token = '';
    this.usuario = null;       // { login, nome, perfil, modulos, setor }
    this.dados = {};           // colecao -> Map(id -> registro)
    this.seq = 0;
    this.fila = [];
    this.eventos = [];         // feed de atividade, mais recente primeiro
    this.online = [];
    this.conexao = { estado: 'iniciando', ultima: null, erro: '' };
    this.recentes = new Map(); // id -> instante da última alteração recebida de outra pessoa
    this.ouvintes = new Set();
    this.timer = null;
    this.ocupado = false;
    this.persistir = debounce(() => this.salvarCache(), 400);
    this.cicloLogo = debounce(() => this.ciclo(), 250);
    TODAS_COLECOES.forEach((c) => { this.dados[c] = new Map(); });
  }

  // ───────── leitura ─────────
  lista(c) {
    const m = this.dados[c];
    if (!m) return [];
    const out = [];
    for (const r of m.values()) if (!r.excluido) out.push(r);
    return out;
  }
  porId(c, id) {
    const r = this.dados[c] && this.dados[c].get(id);
    return r && !r.excluido ? r : null;
  }
  config() {
    const c = this.porId('config', 'geral') || {};
    const setores = String(c.setores || '').split('\n').map((s) => s.trim()).filter(Boolean);
    return {
      orgao: c.orgao || CONFIG.ORGAO,
      setores: setores.length ? setores : SETORES_PADRAO,
      receita_base: Number(c.receita_base) || 0,
      exercicio: Number(c.exercicio) || new Date().getFullYear(),
      bruto: c,
    };
  }
  ctx() {
    return { porId: (c, id) => this.porId(c, id), config: this.config(), lista: (c) => this.lista(c) };
  }

  // ───────── permissões (o servidor aplica as mesmas regras) ─────────
  modulosDoUsuario() {
    const m = String((this.usuario && this.usuario.modulos) || '').split(/[,\s]+/).filter(Boolean);
    return m.length ? m : ['*'];
  }
  podeVer(c) {
    const u = this.usuario;
    if (!u) return false;
    if (['comentarios', 'config', 'avisos'].includes(c)) return true;
    if (u.perfil === 'admin' || u.perfil === 'gestor') return true;
    const m = this.modulosDoUsuario();
    return m.includes('*') || m.includes(c);
  }
  podeEditar(c) {
    const u = this.usuario;
    if (!u) return false;
    if (c === 'config') return u.perfil === 'admin';
    if (c === 'comentarios') return true;
    if (u.perfil === 'leitor') return false;
    return this.podeVer(c);
  }
  ehAdmin() { return !!this.usuario && this.usuario.perfil === 'admin'; }

  // ───────── eventos para a interface ─────────
  on(fn) { this.ouvintes.add(fn); return () => this.ouvintes.delete(fn); }
  emitir(info) { for (const fn of this.ouvintes) { try { fn(info); } catch (e) { console.error(e); } } }
  setConexao(estado, erro = '') {
    const mudou = this.conexao.estado !== estado || this.conexao.erro !== erro;
    this.conexao = { estado, erro, ultima: estado === 'online' || estado === 'demo' ? new Date().toISOString() : this.conexao.ultima };
    if (mudou) this.emitir({ conexao: true });
  }

  registrarEvento(ev) {
    if (ev.s && this.eventos.some((e) => e.s === ev.s && e.u === ev.u && e.id === ev.id)) return;
    const mod = MOD[ev.c];
    const reg = this.dados[ev.c] && this.dados[ev.c].get(ev.id);
    if (!ev.t && mod && reg) ev.t = mod.titulo(reg);
    this.eventos.unshift(ev);
    this.eventos.sort((a, b) => String(b.q).localeCompare(String(a.q)) || (b.s || 0) - (a.s || 0));
    if (this.eventos.length > MAX_EVENTOS) this.eventos.length = MAX_EVENTOS;
  }

  // ───────── gravação ─────────
  patchPendente(c, id) {
    let p = null;
    for (const o of this.fila) if (o.c === c && o.id === id) p = { ...(p || {}), ...o.patch };
    return p;
  }

  salvar(c, dados) {
    if (!this.podeEditar(c)) throw new Error('Seu perfil não permite editar este módulo.');
    const agora = new Date().toISOString();
    const id = dados.id || novoId(PREFIXO[c] || 'r');
    const atual = this.dados[c].get(id);
    const patch = {};
    for (const [k, v] of Object.entries(dados)) {
      if (RESERVADOS.has(k) || k.startsWith('_')) continue;
      const val = typeof v === 'string' ? v.trim() : v;
      if (atual && igual(atual[k], val)) continue;
      patch[k] = val;
    }
    if (atual && !Object.keys(patch).length) return atual;
    const r = {
      ...(atual || { id, criado_em: agora, criado_por: this.usuario.nome }),
      ...patch, id, atualizado_em: agora, atualizado_por: this.usuario.nome,
    };
    const acao = !atual ? 'criar' : patch.excluido ? 'excluir' : 'atualizar';
    if (this.modo === 'demo') {
      r._v = ++this.seq;
      this.dados[c].set(id, r);
      this.registrarEvento({ s: this.seq, q: agora, u: this.usuario.login, n: this.usuario.nome, c, id, a: acao, f: Object.keys(patch), t: MOD[c] ? MOD[c].titulo(r) : '' });
    } else {
      r._pend = true;
      this.dados[c].set(id, r);
      this.fila.push({ op: novoId('op'), c, id, patch, em: agora });
      this.cicloLogo();
    }
    this.persistir();
    this.emitir({ colecoes: new Set([c]), local: true });
    return r;
  }

  excluir(c, id) { return this.salvar(c, { id, excluido: true }); }

  /** Usado pelo simulador do modo demonstração: alteração feita por "outra pessoa". */
  mudancaExterna(c, dados, autor) {
    const agora = new Date().toISOString();
    const atual = this.dados[c].get(dados.id);
    const r = { ...(atual || { criado_em: agora, criado_por: autor.nome }), ...dados, atualizado_em: agora, atualizado_por: autor.nome, _v: ++this.seq };
    this.dados[c].set(r.id, r);
    this.recentes.set(r.id, Date.now());
    const ev = { s: this.seq, q: agora, u: autor.login, n: autor.nome, c, id: r.id, a: atual ? 'atualizar' : 'criar', f: Object.keys(dados).filter((k) => k !== 'id'), t: MOD[c] ? MOD[c].titulo(r) : '' };
    this.registrarEvento(ev);
    this.persistir();
    this.emitir({ colecoes: new Set([c]), remoto: true, eventos: [ev] });
  }

  // ───────── servidor ─────────
  async chamar(acao, dados = {}, timeout = 25000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // requisição simples: sem preflight CORS
        body: JSON.stringify({ acao, token: this.token, ...dados }),
        signal: ctl.signal,
        redirect: 'follow',
      });
      if (!r.ok) throw new Error(`Servidor respondeu HTTP ${r.status}`);
      const j = await r.json();
      if (j.erro) { const e = new Error(j.erro); e.codigo = j.codigo; throw e; }
      if (j.token) { this.token = j.token; this.persistir(); }
      return j;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Tempo de resposta esgotado');
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  chaveCache() { return this.modo === 'demo' ? 'estado:demo' : 'estado:servidor'; }

  async salvarCache() {
    if (!this.modo) return;
    const dados = {};
    for (const c of TODAS_COLECOES) dados[c] = Array.from(this.dados[c].values());
    await kv.set(this.chaveCache(), {
      v: 1, url: this.url, token: this.token, usuario: this.usuario, seq: this.seq,
      dados, fila: this.fila, eventos: this.eventos.slice(0, 120), salvo_em: new Date().toISOString(),
    });
  }

  carregarSnapshot(s) {
    TODAS_COLECOES.forEach((c) => { this.dados[c] = new Map(((s.dados && s.dados[c]) || []).map((r) => [r.id, r])); });
    this.seq = s.seq || 0;
    this.fila = s.fila || [];
    this.eventos = s.eventos || [];
    this.carregado = true;
    // reaplica patches pendentes por cima
    for (const o of this.fila) {
      const r = this.dados[o.c] && this.dados[o.c].get(o.id);
      this.dados[o.c].set(o.id, { ...(r || { id: o.id }), ...o.patch, _pend: true });
    }
  }

  urlConfigurada() { return (CONFIG.WEBAPP_URL || pref.get('url')).trim(); }
  modoEscolhido() { return pref.get('modo'); }

  /** Decide o modo e restaura o cache. Retorna 'pronto' | 'login' | 'boas-vindas'. */
  async iniciar() {
    if (this.modoEscolhido() === 'demo') return this.iniciarDemo();
    const url = this.urlConfigurada();
    if (!url) return 'boas-vindas';
    this.modo = 'servidor';
    this.url = url;
    const s = await kv.get('estado:servidor');
    if (s && s.url === url && s.token && s.usuario) {
      this.token = s.token;
      this.usuario = s.usuario;
      this.carregarSnapshot(s);
      this.setConexao('conectando');
      this.iniciarCiclo();
      return 'pronto';
    }
    return 'login';
  }

  async iniciarDemo() {
    const { semear, iniciarSimulador, USUARIO_DEMO } = await import('./demo.js');
    this.modo = 'demo';
    pref.set('modo', 'demo');
    const s = await kv.get('estado:demo');
    if (s && s.dados && s.v === 1) this.carregarSnapshot(s);
    else semear(this);
    this.usuario = USUARIO_DEMO;
    this.setConexao('demo');
    this.persistir();
    this.pararSimulador = iniciarSimulador(this);
    return 'pronto';
  }

  async reiniciarDemo() {
    const { semear } = await import('./demo.js');
    TODAS_COLECOES.forEach((c) => { this.dados[c] = new Map(); });
    this.eventos = [];
    this.seq = 0;
    semear(this);
    await this.salvarCache();
    this.emitir({ colecoes: new Set(TODAS_COLECOES), recarga: true });
  }

  async entrar(url, login, senha) {
    this.modo = 'servidor';
    this.url = url.trim();
    const j = await this.chamar('login', { login, senha });
    this.token = j.token;
    this.usuario = j.usuario;
    if (!CONFIG.WEBAPP_URL) pref.set('url', this.url);
    pref.set('modo', '');
    await this.carregarTudo();
    this.iniciarCiclo();
  }

  async carregarTudo() {
    const j = await this.chamar('carregar', {}, 60000);
    TODAS_COLECOES.forEach((c) => { this.dados[c] = new Map(((j.colecoes && j.colecoes[c]) || []).map((r) => [r.id, r])); });
    for (const o of this.fila) {
      const r = this.dados[o.c].get(o.id);
      this.dados[o.c].set(o.id, { ...(r || { id: o.id }), ...o.patch, _pend: true });
    }
    this.seq = j.seq || 0;
    if (j.usuario) this.usuario = j.usuario;
    this.eventos = [];
    (j.eventos || []).forEach((e) => this.registrarEvento(e));
    this.online = j.online || [];
    this.carregado = true;
    this.setConexao('online');
    this.persistir();
    this.emitir({ colecoes: new Set(TODAS_COLECOES), recarga: true });
  }

  iniciarCiclo() {
    if (!this._ciclando) {
      this._ciclando = true;
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.ciclo(); else this.agendar(); });
      window.addEventListener('online', () => this.ciclo());
      window.addEventListener('offline', () => this.setConexao('offline'));
    }
    this.ciclo();
  }

  agendar() {
    clearTimeout(this.timer);
    if (this.modo !== 'servidor' || !this.token) return;
    this.timer = setTimeout(() => this.ciclo(), document.hidden ? CONFIG.POLL_OCULTO_MS : CONFIG.POLL_VISIVEL_MS);
  }

  async ciclo() {
    if (this.modo !== 'servidor' || !this.token) return;
    if (this.ocupado) { this._repetir = true; return; }
    this.ocupado = true;
    try {
      if (!this.carregado) await this.carregarTudo();
      await this.enviarFila();
      await this.puxar();
      this.setConexao(this.fila.length ? 'enviando' : 'online');
    } catch (e) {
      if (e.codigo === 'nao_autorizado') { this.sessaoExpirada(); return; }
      this.setConexao(navigator.onLine === false ? 'offline' : 'erro', e.message);
    } finally {
      this.ocupado = false;
      if (this._repetir) { this._repetir = false; setTimeout(() => this.ciclo(), 50); } else this.agendar();
    }
  }

  async enviarFila() {
    while (this.fila.length) {
      const lote = this.fila.slice(0, 40);
      this.setConexao('enviando');
      const j = await this.chamar('salvar', { ops: lote.map((o) => ({ op: o.op, c: o.c, id: o.id, patch: o.patch })) }, 45000);
      const resolvidos = new Set([...(j.aplicados || []).map((a) => a.op), ...(j.negados || []).map((n) => n.op)]);
      this.fila = this.fila.filter((o) => !resolvidos.has(o.op));
      const afetadas = new Set();
      for (const a of j.aplicados || []) {
        const pend = this.patchPendente(a.c, a.r.id);
        this.dados[a.c].set(a.r.id, pend ? { ...a.r, ...pend, _pend: true } : a.r);
        afetadas.add(a.c);
      }
      for (const n of j.negados || []) {
        const op = lote.find((o) => o.op === n.op);
        if (!op) continue;
        if (n.r) this.dados[op.c].set(n.r.id, n.r); else this.dados[op.c].delete(op.id);
        afetadas.add(op.c);
        this.emitir({ aviso: `Alteração não gravada (${MOD[op.c] ? MOD[op.c].nome : op.c}): ${n.motivo}` });
      }
      this.persistir();
      this.emitir({ colecoes: afetadas, local: true });
      if (resolvidos.size === 0) break; // nada resolvido: evita laço infinito
    }
  }

  async puxar() {
    const j = await this.chamar('sync', { desde: this.seq });
    this.online = j.online || this.online;
    if (j.recarregar) { await this.carregarTudo(); return; }
    const mud = j.mudancas || [];
    if (!mud.length) { if (j.seq != null && j.seq < this.seq) await this.carregarTudo(); this.emitir({ presenca: true }); return; }
    const afetadas = new Set();
    const novosEventos = [];
    for (const m of mud) {
      if (!m.r || !m.r.id || !this.dados[m.c]) continue;
      const atual = this.dados[m.c].get(m.r.id);
      if (!atual || (atual._v || 0) < (m.r._v || 0) || atual._pend) {
        const pend = this.patchPendente(m.c, m.r.id);
        this.dados[m.c].set(m.r.id, pend ? { ...m.r, ...pend, _pend: true } : m.r);
        afetadas.add(m.c);
      }
      const ev = { s: m.s, q: m.q, u: m.u, n: m.n, c: m.c, id: m.r.id, a: m.a, f: m.f || [] };
      this.registrarEvento(ev);
      if (m.u !== (this.usuario && this.usuario.login)) { this.recentes.set(m.r.id, Date.now()); novosEventos.push(ev); }
    }
    this.seq = Math.max(this.seq, j.seq || 0);
    this.persistir();
    this.emitir({ colecoes: afetadas, remoto: true, eventos: novosEventos });
  }

  sessaoExpirada() {
    this.token = '';
    this.persistir();
    clearTimeout(this.timer);
    this.emitir({ sessao: 'expirada' });
  }

  async sair() {
    clearTimeout(this.timer);
    if (this.pararSimulador) { this.pararSimulador(); this.pararSimulador = null; }
    if (this.modo === 'servidor') {
      try { if (this.token) await this.chamar('sair', {}, 5000); } catch { /* sem rede: o token expira sozinho */ }
      this.token = '';
      this.carregado = false;
      await kv.del('estado:servidor'); // não deixa dados de saúde no aparelho após sair
    }
    pref.set('modo', '');
  }

  esquecerServidor() { pref.set('url', ''); }
}

function igual(a, b) {
  if (a === b) return true;
  if ((a == null || a === '') && (b == null || b === '')) return true;
  return String(a) === String(b);
}

export const store = new Store();
