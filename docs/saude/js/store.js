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
//
// Modo "claude": quando o app roda como artefato dentro do Claude, os dados
// ficam no armazenamento compartilhado do próprio artefato (capability `db`),
// a identidade é a conta Claude de quem abre (capability `user`) e a presença
// vem da capability `room`. As atualizações chegam por assinatura (push).

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
const RETENCAO_EVENTOS_DIAS = 60; // modo claude: o artefato guarda no máximo 25 mil documentos

/** O app está aberto como artefato dentro do Claude? */
export const EM_ARTEFATO = typeof window !== 'undefined' && !!(window.claude && typeof window.claude.use === 'function');

export const PERFIS = {
  admin: 'Administrador (Secretário / TI)',
  gestor: 'Gestor — vê e edita todos os módulos',
  editor: 'Editor — edita os módulos autorizados',
  leitor: 'Consulta — somente leitura',
};

export class Store {
  constructor() {
    this.modo = null;          // 'demo' | 'servidor' | 'claude'
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
    this.nomes = new Map();    // modo claude: id da conta -> nome exibido
    this.cadeias = new Map();  // modo claude: uma gravação por documento de cada vez
    TODAS_COLECOES.forEach((c) => { this.dados[c] = new Map(); });
  }

  /** Quem grava: no modo claude, o id da conta (nunca o nome); nos demais, o nome. */
  autorAtual() { return this.modo === 'claude' ? this.usuario.login : this.usuario.nome; }

  /** Nome para exibir de quem gravou (resolve ids no modo claude). */
  nome(v, reserva = '') {
    if (this.modo !== 'claude') return v || reserva;
    if (!v) return reserva;
    if (v === (this.usuario && this.usuario.login)) return this.usuario.nome || 'Você';
    if (!this.nomes.has(v)) { this.resolverNomes([v]); return 'Alguém'; }
    return this.nomes.get(v) || 'Alguém';
  }

  resolverNomes(ids) {
    if (!this.user) return;
    const faltam = [...new Set(ids.filter((x) => x && !this.nomes.has(x)))];
    if (!faltam.length) return;
    faltam.forEach((x) => this.nomes.set(x, ''));
    this.user.profiles(faltam).then((ps) => {
      for (const x of faltam) this.nomes.set(x, (ps[x] && ps[x].name) || '');
      this.emitir({ nomes: true });
    });
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
    if (c === 'comentarios') return !(this.modo === 'claude' && u.perfil === 'leitor');
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
    if (estado === 'online' && !mudou) return;
    if (mudou) this.emitir({ conexao: true });
  }

  registrarEvento(ev) {
    const chave = (e) => e.k || (e.s ? `${e.s}|${e.u}|${e.id}` : '');
    if (chave(ev) && this.eventos.some((e) => chave(e) === chave(ev))) return;
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
      ...(atual || { id, criado_em: agora, criado_por: this.autorAtual() }),
      ...patch, id, atualizado_em: agora, atualizado_por: this.autorAtual(),
    };
    const acao = !atual ? 'criar' : patch.excluido ? 'excluir' : 'atualizar';
    if (this.modo === 'claude') {
      r._v = Date.now();
      r._pend = true;
      this.dados[c].set(id, r);
      const corpo = atual ? { ...patch, atualizado_em: agora, atualizado_por: r.atualizado_por, _v: r._v } : { ...r };
      this.gravarClaude(c, id, corpo, !atual, acao, Object.keys(patch));
    } else if (this.modo === 'demo') {
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
    if (!this.modo || this.modo === 'claude') return; // o armazenamento do artefato já guarda tudo
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
    if (EM_ARTEFATO) return (await this.iniciarClaude()) ? 'pronto' : 'boas-vindas';
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
    if (this.modo === 'claude') { (this.desassinar || []).forEach((f) => { try { f(); } catch { /* */ } }); }
    if (this.modo === 'servidor') {
      try { if (this.token) await this.chamar('sair', {}, 5000); } catch { /* sem rede: o token expira sozinho */ }
      this.token = '';
      this.carregado = false;
      await kv.del('estado:servidor'); // não deixa dados de saúde no aparelho após sair
    }
    pref.set('modo', '');
  }

  esquecerServidor() { pref.set('url', ''); }

  /** Liga/desliga o modo demonstração e recarrega (usado dentro do Claude). */
  escolherModo(modo) { pref.set('modo', modo); }

  // ───────── modo claude (artefato) ─────────
  async iniciarClaude() {
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (!db || !user) return false;
    const me = await user.me();
    if (!me.id) return false; // sem identidade (fora da conta): não há dados compartilhados
    const [dono, admin, escrita] = await Promise.all([user.isOwner(), user.canEdit(), user.can('data.write')]);
    this.db = db;
    this.user = user;
    this.modo = 'claude';
    this.usuario = {
      login: me.id,
      nome: me.name || 'Você',
      perfil: dono || admin ? 'admin' : escrita === false ? 'leitor' : 'editor',
      modulos: '*',
      setor: '',
    };
    this.setConexao('conectando');
    this.assinarClaude();
    this.iniciarPresenca();
    window.addEventListener('offline', () => this.setConexao('offline'));
    window.addEventListener('online', () => this.setConexao('online'));
    return true;
  }

  assinarClaude() {
    const pendentes = new Set(TODAS_COLECOES);
    const carregadas = new Set();
    this.desassinar = [];
    this.timerCarga = setTimeout(() => {
      if (!this.carregado) this.setConexao('erro', 'Os dados ainda não responderam. Confira a conexão; a página continua tentando.');
    }, 10000);
    const erro = (e) => {
      if (e && e.code === 'revoked') { this.setConexao('erro', 'O acesso a este aplicativo foi alterado.'); return; }
      this.setConexao('erro', (e && e.message) || 'Falha ao receber dados.');
    };
    for (const c of TODAS_COLECOES) {
      this.desassinar.push(this.db.collection(c).onSnapshot((snap) => {
        const eventos = [];
        const ids = [];
        for (const ch of snap.docChanges()) {
          const d = ch.doc;
          if (ch.type === 'removed') { this.dados[c].delete(d.id); continue; }
          const r = { ...d.data(), id: d.id };
          const antes = this.dados[c].get(d.id);
          this.dados[c].set(d.id, r);
          ids.push(r.atualizado_por, r.criado_por, r.autor);
          const deOutro = carregadas.has(c) && !d.metadata.hasPendingWrites && r.atualizado_por !== this.usuario.login;
          if (deOutro && (!antes || antes._v !== r._v)) {
            this.recentes.set(d.id, Date.now());
            if (c === 'avisos' && ch.type === 'added') eventos.push({ c, id: d.id, a: 'criar', u: r.criado_por });
          }
        }
        if (!snap.metadata.fromCache) { pendentes.delete(c); carregadas.add(c); }
        if (!pendentes.size && !this.carregado) {
          this.carregado = true;
          clearTimeout(this.timerCarga);
          this.setConexao(navigator.onLine === false ? 'offline' : 'online');
        }
        this.resolverNomes(ids);
        this.emitir({ colecoes: new Set([c]), remoto: true, eventos, recarga: !carregadas.has(c) });
      }, erro));
    }
    // feed de atividade: as alterações mais recentes de todos
    this.desassinar.push(this.db.collection('eventos').orderBy('q', 'desc').limit(MAX_EVENTOS).onSnapshot((snap) => {
      const ids = [];
      for (const ch of snap.docChanges()) {
        if (ch.type !== 'added') continue;
        const e = ch.doc.data();
        this.registrarEvento({ k: ch.doc.id, q: e.q, u: e.u, c: e.c, id: e.id, a: e.a, f: e.f || [], t: e.t });
        ids.push(e.u);
      }
      this.resolverNomes(ids);
      this.emitir({ colecoes: new Set(['_eventos']) });
    }, erro));
  }

  async iniciarPresenca() {
    const room = await window.claude.use('room');
    if (!room) return;
    try {
      room.presence({ ativo: true }).catch(() => { /* presença é opcional */ });
      this.desassinar.push(room.onPeers(({ peers }) => {
        const vistos = new Map();
        const t = new Date().toISOString();
        for (const p of peers) if (p.kind === 'viewer' && p.by && !p.isMe) vistos.set(p.by, { login: p.by, t });
        this.online = [...vistos.values()];
        this.resolverNomes(this.online.map((o) => o.login));
        this.emitir({ presenca: true });
      }, () => { /* sala indisponível: o app funciona sem presença */ }));
    } catch { /* idem */ }
  }

  /** Grava no armazenamento do artefato, um documento de cada vez, e registra o evento. */
  gravarClaude(c, id, corpo, criar, acao, campos) {
    const caminho = `${c}/${id}`;
    const limpo = {};
    for (const [k, v] of Object.entries(corpo)) if (v !== undefined && k !== '_pend') limpo[k] = v;
    const anterior = this.cadeias.get(caminho) || Promise.resolve();
    const atual = anterior.catch(() => {}).then(async () => {
      const ref = this.db.doc(caminho);
      if (criar) await ref.set(limpo); else await ref.update(limpo);
    }).then(() => {
      const r = this.dados[c].get(id);
      if (r && r._pend) { const { _pend, ...resto } = r; this.dados[c].set(id, resto); }
      this.registrarEventoClaude(c, id, acao, campos);
      this.emitir({ colecoes: new Set([c]), local: true });
    }).catch(async (e) => {
      try {
        const s2 = await this.db.doc(caminho).get();
        if (s2.exists) this.dados[c].set(id, { ...s2.data(), id }); else this.dados[c].delete(id);
      } catch { /* mantém o que há */ }
      const msg = e && e.code === 'quota_exceeded'
        ? 'O armazenamento deste aplicativo chegou ao limite. Exclua registros antigos ou migre para o servidor da Secretaria.'
        : e && e.code === 'invalid_argument' ? 'Seu nível de acesso não permite esta alteração.' : 'Não foi possível gravar. Tente de novo.';
      this.emitir({ colecoes: new Set([c]), aviso: `${MOD[c] ? MOD[c].nome : c}: ${msg}` });
    });
    this.cadeias.set(caminho, atual);
    atual.finally(() => { if (this.cadeias.get(caminho) === atual) this.cadeias.delete(caminho); });
  }

  registrarEventoClaude(c, id, a, f) {
    const r = this.dados[c].get(id);
    const ev = { q: new Date().toISOString(), u: this.usuario.login, c, id, a, f, t: MOD[c] && r ? String(MOD[c].titulo(r)).slice(0, 200) : '' };
    this.db.collection('eventos').doc(novoId('ev')).set(ev).catch(() => { /* o registro já foi gravado */ });
    if (Math.random() < 0.05) this.podarEventos();
  }

  /** Apaga eventos mais antigos que a retenção (o artefato tem limite de documentos). */
  async podarEventos() {
    try {
      const limite = new Date(Date.now() - RETENCAO_EVENTOS_DIAS * 86400000).toISOString();
      const velhos = await this.db.collection('eventos').where('q', '<', limite).limit(100).get();
      for (const d of velhos.docs) await this.db.doc(`eventos/${d.id}`).delete();
    } catch { /* tenta de novo numa próxima gravação */ }
  }

  /** Histórico completo de um registro (servidor ou armazenamento do artefato). */
  async historico(c, id) {
    if (this.modo === 'servidor') return (await this.chamar('historico', { c, id })).eventos || [];
    if (this.modo === 'claude') {
      const snap = await this.db.collection('eventos').where('c', '==', c).where('id', '==', id).limit(500).get();
      const evs = snap.docs.map((d) => d.data()).sort((a, b) => String(b.q).localeCompare(String(a.q)));
      this.resolverNomes(evs.map((e) => e.u));
      return evs;
    }
    return null;
  }
}

function igual(a, b) {
  if (a === b) return true;
  if ((a == null || a === '') && (b == null || b === '')) return true;
  return String(a) === String(b);
}

export const store = new Store();
