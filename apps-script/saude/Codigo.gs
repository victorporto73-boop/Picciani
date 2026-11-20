/**
 * Gestão Integrada da Saúde — backend (Google Apps Script + Planilha)
 * Secretaria Municipal de Saúde de Rio das Ostras
 *
 * O que este script faz:
 *  - autentica usuários (senha com sal e hash SHA-256 iterado; token assinado com HMAC);
 *  - aplica perfis e módulos autorizados em TODA leitura e gravação;
 *  - grava cada módulo numa aba da planilha (uma linha por registro, colunas legíveis);
 *  - registra toda alteração na aba _Eventos (número sequencial, usuário, data,
 *    campos alterados e cópia do registro) — é a trilha de auditoria e também
 *    o canal de sincronização em tempo real: os aplicativos perguntam
 *    "o que mudou desde o evento N" a cada poucos segundos.
 *
 * Instalação: veja LEIA-ME.md nesta pasta. Resumo:
 *  1. Crie uma planilha nova → Extensões → Apps Script → cole este arquivo.
 *  2. Execute prepararSistema() uma vez e autorize. A senha inicial do
 *     usuário "admin" aparece no registro de execução.
 *  3. Implantar → Nova implantação → App da Web
 *     (Executar como: eu · Quem tem acesso: qualquer pessoa).
 *  4. Use a URL /exec no aplicativo.
 *
 * NÃO apague nem reordene linhas da aba _Eventos: o número da linha é o
 * número sequencial usado na sincronização.
 */

// Deixe vazio para usar a planilha à qual o script está vinculado.
var PLANILHA_ID = '';

var VERSAO = '1.0.0';
var COLECOES = ['unidades', 'agenda', 'tarefas', 'avisos', 'ocorrencias', 'regulacao', 'estoque', 'escalas',
  'vigilancia', 'campanhas', 'judicial', 'ouvidoria', 'protocolo', 'contratos', 'orcamento', 'planejamento',
  'comentarios', 'config'];
var LIVRES_LEITURA = ['comentarios', 'config', 'avisos'];
var BASE = ['id', '_v', 'criado_em', 'criado_por', 'atualizado_em', 'atualizado_por', 'excluido'];
var RESERVADOS = { id: 1, _v: 1, _pend: 1, criado_em: 1, criado_por: 1, atualizado_em: 1, atualizado_por: 1 };
var ABA_EVENTOS = '_Eventos';
var COL_EVENTOS = ['seq', 'quando', 'login', 'nome', 'colecao', 'id', 'acao', 'campos', 'registro'];
var ABA_USUARIOS = '_Usuarios';
var COL_USUARIOS = ['login', 'nome', 'perfil', 'modulos', 'setor', 'ativo', 'sal', 'hash', 'versao_token', 'criado_em', 'atualizado_em', 'ultimo_acesso'];
var ABA_ACESSOS = '_Acessos';
var PERFIS = ['admin', 'gestor', 'editor', 'leitor'];
var TOKEN_HORAS = 12;
var ITERACOES_HASH = 600;
var MAX_TEXTO = 20000;
var MAX_SYNC = 3000;

// ═════════════════════════ entrada HTTP ═════════════════════════

function doGet() {
  return json_({ ok: true, sistema: 'gestao-saude', versao: VERSAO, mensagem: 'Servidor ativo. Use o aplicativo para acessar.' });
}

function doPost(e) {
  var resp;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    resp = rotear_(req);
  } catch (err) {
    resp = { erro: err && err.publico ? err.message : 'Erro interno no servidor.', codigo: err && err.codigo };
    if (!(err && err.publico)) console.error(err && err.stack || err);
  }
  return json_(resp);
}

function rotear_(req) {
  var acao = String(req.acao || '');
  if (acao === 'login') return login_(req.login, req.senha);
  if (acao === 'ping') return { ok: true, versao: VERSAO };

  var u = autenticar_(req.token);
  var r;
  switch (acao) {
    case 'carregar': r = carregar_(u); break;
    case 'sync': r = sync_(u, Number(req.desde) || 0); break;
    case 'salvar': r = salvar_(u, req.ops || []); break;
    case 'historico': r = historico_(u, String(req.c || ''), String(req.id || '')); break;
    case 'usuarios': exigirAdmin_(u); r = { usuarios: listarUsuarios_() }; break;
    case 'salvarUsuario': exigirAdmin_(u); r = salvarUsuario_(u, req.usuario || {}, !!req.novo); break;
    case 'alterarSenha': r = alterarSenha_(u, String(req.atual || ''), String(req.nova || '')); break;
    case 'sair': r = { ok: true }; break;
    default: throw erro_('Ação desconhecida.', 'acao');
  }
  // renova o token quando faltam menos de 4 horas
  if (u.exp - Date.now() < 4 * 3600 * 1000) r.token = emitirToken_(u);
  return r;
}

// ═════════════════════════ planilha ═════════════════════════

function planilha_() {
  return PLANILHA_ID ? SpreadsheetApp.openById(PLANILHA_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function aba_(nome, cabecalho) {
  var ss = planilha_();
  var a = ss.getSheetByName(nome);
  if (!a) a = ss.insertSheet(nome);
  if (a.getLastRow() === 0 && cabecalho) {
    a.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold');
    a.setFrozenRows(1);
  }
  return a;
}

/** Converte valor para a célula: textos entram como texto literal (sem virar data, número ou fórmula). */
function paraCelula_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  if (v.length > MAX_TEXTO) v = v.slice(0, MAX_TEXTO);
  return v === '' ? '' : "'" + v;
}

function daCelula_(v) {
  if (v instanceof Date) {
    var fuso = Session.getScriptTimeZone();
    var hm = Utilities.formatDate(v, fuso, 'HH:mm');
    return Utilities.formatDate(v, fuso, hm === '00:00' ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm");
  }
  return v;
}

function lerColecao_(c) {
  var a = aba_(c, BASE);
  var n = a.getLastRow();
  if (n < 2) return [];
  var dados = a.getRange(1, 1, n, a.getLastColumn()).getValues();
  var cab = dados[0];
  var out = [];
  for (var i = 1; i < dados.length; i++) {
    var r = linhaParaObj_(cab, dados[i]);
    if (r.id) out.push(r);
  }
  return out;
}

function linhaParaObj_(cab, linha) {
  var o = {};
  for (var j = 0; j < cab.length; j++) {
    if (!cab[j]) continue;
    var v = daCelula_(linha[j]);
    if (v === '' || v === null) continue;
    o[cab[j]] = v;
  }
  if (o.excluido === 'TRUE' || o.excluido === 'true') o.excluido = true;
  return o;
}

/** Contexto de escrita de uma coleção: cabeçalho + índice id→linha (lido uma vez por requisição). */
function contextoEscrita_(c, cache) {
  if (cache[c]) return cache[c];
  var a = aba_(c, BASE);
  var ultCol = Math.max(a.getLastColumn(), BASE.length);
  var cab = a.getRange(1, 1, 1, ultCol).getValues()[0].map(String);
  var n = a.getLastRow();
  var idx = {};
  if (n >= 2) {
    var ids = a.getRange(2, 1, n - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (ids[i][0]) idx[String(ids[i][0])] = i + 2;
  }
  cache[c] = { aba: a, cab: cab, idx: idx, prox: Math.max(n, 1) + 1 };
  return cache[c];
}

function garantirColunas_(ctx, chaves) {
  var novas = chaves.filter(function (k) { return ctx.cab.indexOf(k) < 0; });
  if (!novas.length) return;
  var ini = ctx.cab.length + 1;
  ctx.aba.getRange(1, ini, 1, novas.length).setValues([novas]).setFontWeight('bold');
  ctx.cab = ctx.cab.concat(novas);
}

// ═════════════════════════ autenticação ═════════════════════════

function segredo_() {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty('SEGREDO_TOKEN');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    p.setProperty('SEGREDO_TOKEN', s);
  }
  return s;
}

function b64_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }

function hashSenha_(senha, sal) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sal + '|' + senha, Utilities.Charset.UTF_8);
  for (var i = 0; i < ITERACOES_HASH; i++) {
    d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b64_(d) + '|' + sal + '|' + senha, Utilities.Charset.UTF_8);
  }
  return b64_(d);
}

function iguaisSeguro_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function emitirToken_(u) {
  var corpo = b64_(Utilities.newBlob(JSON.stringify({ u: u.login, tv: Number(u.versao_token) || 0, exp: Date.now() + TOKEN_HORAS * 3600 * 1000 })).getBytes());
  var sig = b64_(Utilities.computeHmacSha256Signature(corpo, segredo_()));
  return corpo + '.' + sig;
}

function autenticar_(token) {
  var partes = String(token || '').split('.');
  if (partes.length !== 2) throw erro_('Sessão inválida. Entre novamente.', 'nao_autorizado');
  var sig = b64_(Utilities.computeHmacSha256Signature(partes[0], segredo_()));
  if (!iguaisSeguro_(sig, partes[1])) throw erro_('Sessão inválida. Entre novamente.', 'nao_autorizado');
  var dados;
  var corpo = partes[0];
  while (corpo.length % 4) corpo += '='; // repõe o preenchimento retirado na emissão
  try { dados = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(corpo)).getDataAsString()); } catch (e) { throw erro_('Sessão inválida.', 'nao_autorizado'); }
  if (!dados.exp || dados.exp < Date.now()) throw erro_('Sessão expirada. Entre novamente.', 'nao_autorizado');
  var u = usuariosMapa_()[dados.u];
  if (!u || !ativo_(u) || (Number(u.versao_token) || 0) !== (Number(dados.tv) || 0)) throw erro_('Acesso revogado ou alterado. Entre novamente.', 'nao_autorizado');
  u.exp = dados.exp;
  marcarPresenca_(u);
  return u;
}

function login_(login, senha) {
  login = String(login || '').trim().toLowerCase();
  senha = String(senha || '');
  var cache = CacheService.getScriptCache();
  var chave = 'falhas:' + login;
  var falhas = Number(cache.get(chave)) || 0;
  if (falhas >= 5) {
    registrarAcesso_(login, 'bloqueado');
    throw erro_('Muitas tentativas. Aguarde 10 minutos e tente de novo.', 'bloqueado');
  }
  var u = usuariosMapa_(true)[login];
  if (!u || !ativo_(u) || !u.sal || !iguaisSeguro_(hashSenha_(senha, u.sal), u.hash)) {
    cache.put(chave, String(falhas + 1), 600);
    registrarAcesso_(login, 'falha');
    throw erro_('Usuário ou senha incorretos.', 'login');
  }
  cache.remove(chave);
  registrarAcesso_(login, 'ok');
  atualizarUsuario_(login, { ultimo_acesso: new Date().toISOString() });
  return { token: emitirToken_(u), usuario: publico_(u) };
}

function registrarAcesso_(login, resultado) {
  try { aba_(ABA_ACESSOS, ['quando', 'login', 'resultado']).appendRow([new Date().toISOString(), paraCelula_(login), resultado]); } catch (e) { /* não impede o login */ }
}

function ativo_(u) { return !(u.ativo === false || u.ativo === 'FALSE' || u.ativo === 'false'); }

function publico_(u) {
  return { login: u.login, nome: u.nome, perfil: u.perfil, modulos: u.modulos || '*', setor: u.setor || '' };
}

function usuariosMapa_(semCache) {
  var cache = CacheService.getScriptCache();
  if (!semCache) {
    var c = cache.get('usuarios');
    if (c) return JSON.parse(c);
  }
  var a = aba_(ABA_USUARIOS, COL_USUARIOS);
  var n = a.getLastRow();
  var mapa = {};
  if (n >= 2) {
    var dados = a.getRange(1, 1, n, a.getLastColumn()).getValues();
    for (var i = 1; i < dados.length; i++) {
      var o = linhaParaObj_(dados[0].map(String), dados[i]);
      if (o.login) { o.login = String(o.login).toLowerCase(); mapa[o.login] = o; }
    }
  }
  cache.put('usuarios', JSON.stringify(mapa), 60);
  return mapa;
}

function atualizarUsuario_(login, campos) {
  var a = aba_(ABA_USUARIOS, COL_USUARIOS);
  var n = a.getLastRow();
  var cab = a.getRange(1, 1, 1, a.getLastColumn()).getValues()[0].map(String);
  var linha = -1;
  if (n >= 2) {
    var logins = a.getRange(2, 1, n - 1, 1).getValues();
    for (var i = 0; i < logins.length; i++) if (String(logins[i][0]).toLowerCase() === login) { linha = i + 2; break; }
  }
  if (linha < 0) {
    linha = Math.max(n, 1) + 1;
    a.getRange(linha, 1, 1, cab.length).setValues([cab.map(function () { return ''; })]);
  }
  Object.keys(campos).forEach(function (k) {
    var col = cab.indexOf(k);
    if (col < 0) { cab.push(k); col = cab.length - 1; a.getRange(1, col + 1).setValue(k).setFontWeight('bold'); }
    a.getRange(linha, col + 1).setValue(paraCelula_(campos[k]));
  });
  CacheService.getScriptCache().remove('usuarios');
}

// ═════════════════════════ permissões ═════════════════════════

function modulosDe_(u) {
  var m = String(u.modulos || '*').split(/[,\s]+/).filter(String);
  return m.length ? m : ['*'];
}

function podeVer_(u, c) {
  if (COLECOES.indexOf(c) < 0) return false;
  if (LIVRES_LEITURA.indexOf(c) >= 0) return true;
  if (u.perfil === 'admin' || u.perfil === 'gestor') return true;
  var m = modulosDe_(u);
  return m.indexOf('*') >= 0 || m.indexOf(c) >= 0;
}

function podeEditar_(u, c) {
  if (c === 'config') return u.perfil === 'admin';
  if (c === 'comentarios') return COLECOES.indexOf(c) >= 0;
  if (u.perfil === 'leitor') return false;
  return podeVer_(u, c);
}

/** Comentários só aparecem para quem pode ver o registro comentado. */
function podeVerRegistro_(u, c, r) {
  if (!podeVer_(u, c)) return false;
  if (c === 'comentarios') return !!(r && podeVer_(u, String(r.colecao || '')));
  return true;
}

function exigirAdmin_(u) { if (u.perfil !== 'admin') throw erro_('Somente administradores.', 'proibido'); }

// ═════════════════════════ leitura e sincronização ═════════════════════════

function seqAtual_() {
  var c = CacheService.getScriptCache().get('seq');
  if (c !== null && c !== undefined && c !== '') return Number(c);
  var s = Math.max(aba_(ABA_EVENTOS, COL_EVENTOS).getLastRow() - 1, 0);
  CacheService.getScriptCache().put('seq', String(s), 21600);
  return s;
}

function carregar_(u) {
  var seq = seqAtual_();
  var col = {};
  COLECOES.forEach(function (c) {
    if (!podeVer_(u, c)) return;
    col[c] = lerColecao_(c).filter(function (r) { return !r.excluido && podeVerRegistro_(u, c, r); });
  });
  return { seq: seq, usuario: publico_(u), colecoes: col, eventos: eventosRecentes_(u, 60), online: online_(), servidor_em: new Date().toISOString() };
}

function lerEventos_(desde, ate) {
  // seq N está na linha N + 1
  if (ate <= desde) return [];
  var a = aba_(ABA_EVENTOS, COL_EVENTOS);
  var linhas = a.getRange(desde + 2, 1, ate - desde, COL_EVENTOS.length).getValues();
  return linhas.map(function (l) {
    return { s: Number(l[0]), q: l[1] instanceof Date ? l[1].toISOString() : String(l[1]), u: String(l[2]), n: String(l[3]), c: String(l[4]), id: String(l[5]), a: String(l[6]), f: String(l[7] || '').split(',').filter(String), r: l[8] ? JSON.parse(l[8]) : null };
  });
}

function sync_(u, desde) {
  var seq = seqAtual_();
  if (desde > seq) return { recarregar: true, seq: seq, online: online_() };
  if (desde === seq) return { seq: seq, mudancas: [], online: online_() };
  if (seq - desde > MAX_SYNC) return { recarregar: true, seq: seq, online: online_() };
  var evs = lerEventos_(desde, seq);
  if (evs.length && evs[0].s !== desde + 1) return { recarregar: true, seq: seq, online: online_() }; // aba alterada à mão
  var mud = [];
  evs.forEach(function (e) {
    if (!e.r || !podeVerRegistro_(u, e.c, e.r)) return;
    mud.push({ s: e.s, q: e.q, u: e.u, n: e.n, c: e.c, a: e.a, f: e.f, r: e.r });
  });
  return { seq: seq, mudancas: mud, online: online_() };
}

function eventosRecentes_(u, qtd) {
  var seq = seqAtual_();
  var desde = Math.max(0, seq - qtd * 3);
  return lerEventos_(desde, seq).filter(function (e) { return e.r && podeVerRegistro_(u, e.c, e.r); })
    .slice(-qtd).map(function (e) { return { s: e.s, q: e.q, u: e.u, n: e.n, c: e.c, id: e.id, a: e.a, f: e.f }; });
}

function historico_(u, c, id) {
  if (!podeVer_(u, c)) throw erro_('Sem permissão para este módulo.', 'proibido');
  var seq = seqAtual_();
  if (!seq) return { eventos: [] };
  var a = aba_(ABA_EVENTOS, COL_EVENTOS);
  var cols = a.getRange(2, 1, seq, 8).getValues();
  var out = [];
  for (var i = cols.length - 1; i >= 0 && out.length < 200; i--) {
    var l = cols[i];
    if (String(l[4]) === c && String(l[5]) === id) {
      out.push({ s: Number(l[0]), q: l[1] instanceof Date ? l[1].toISOString() : String(l[1]), u: String(l[2]), n: String(l[3]), a: String(l[6]), f: String(l[7] || '').split(',').filter(String) });
    }
  }
  return { eventos: out };
}

// ═════════════════════════ gravação ═════════════════════════

function salvar_(u, ops) {
  if (!ops || !ops.length) return { seq: seqAtual_(), aplicados: [], negados: [] };
  if (ops.length > 100) throw erro_('Lote grande demais.', 'lote');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw erro_('Servidor ocupado. Tentando de novo em instantes.', 'ocupado');
  try {
    var abaEv = aba_(ABA_EVENTOS, COL_EVENTOS);
    var seq = Math.max(abaEv.getLastRow() - 1, 0);
    var agora = new Date().toISOString();
    var ctxs = {};
    var eventos = [];
    var aplicados = [];
    var negados = [];

    ops.forEach(function (op) {
      var c = String(op.c || '');
      var id = String(op.id || '').slice(0, 80);
      try {
        if (COLECOES.indexOf(c) < 0) throw erro_('Módulo inválido.');
        if (!id || !/^[\w.-]+$/.test(id)) throw erro_('Identificador inválido.');
        if (!podeEditar_(u, c)) throw erro_('Seu perfil não permite editar este módulo.');
        if (c === 'config' && id !== 'geral') throw erro_('Configuração inválida.');
        var ctx = contextoEscrita_(c, ctxs);
        var linha = ctx.idx[id];
        var atual = linha ? linhaParaObj_(ctx.cab, ctx.aba.getRange(linha, 1, 1, ctx.cab.length).getValues()[0]) : null;
        var patch = {};
        Object.keys(op.patch || {}).forEach(function (k) {
          if (RESERVADOS[k] || k.charAt(0) === '_' || !/^[a-z][a-z0-9_]{0,40}$/.test(k)) return;
          var v = op.patch[k];
          if (typeof v === 'object' && v !== null) v = JSON.stringify(v);
          patch[k] = v;
        });
        if (c === 'comentarios') {
          if (atual && atual.autor_login !== u.login && u.perfil !== 'admin') throw erro_('Só o autor pode alterar o comentário.');
          if (!atual && !podeVer_(u, String(patch.colecao || ''))) throw erro_('Sem acesso ao registro comentado.');
          if (atual) { delete patch.colecao; delete patch.registro; }
          patch.autor = atual ? atual.autor : u.nome;
          patch.autor_login = atual ? atual.autor_login : u.login;
        }
        if (atual && atual.excluido && !patch.excluido) throw erro_('Registro já excluído.');
        var reg = {};
        Object.keys(atual || {}).forEach(function (k) { reg[k] = atual[k]; });
        Object.keys(patch).forEach(function (k) { reg[k] = patch[k]; });
        seq += 1;
        reg.id = id;
        reg._v = seq;
        if (!atual) { reg.criado_em = agora; reg.criado_por = u.nome; }
        reg.atualizado_em = agora;
        reg.atualizado_por = u.nome;
        if (patch.excluido) reg.excluido = true;

        garantirColunas_(ctx, Object.keys(reg));
        var valores = ctx.cab.map(function (k) { return k ? paraCelula_(reg[k]) : ''; });
        if (!linha) { linha = ctx.prox; ctx.prox += 1; ctx.idx[id] = linha; }
        ctx.aba.getRange(linha, 1, 1, valores.length).setValues([valores]);

        var acao = !atual ? 'criar' : patch.excluido ? 'excluir' : 'atualizar';
        eventos.push([seq, paraCelula_(agora), paraCelula_(u.login), paraCelula_(u.nome), c, paraCelula_(id), acao, paraCelula_(Object.keys(patch).join(',')), paraCelula_(JSON.stringify(reg))]);
        aplicados.push({ op: op.op, c: c, r: reg });
      } catch (err) {
        var r = null;
        try { var cx = contextoEscrita_(c, ctxs); if (cx.idx[id]) r = linhaParaObj_(cx.cab, cx.aba.getRange(cx.idx[id], 1, 1, cx.cab.length).getValues()[0]); } catch (e2) { /* módulo inválido */ }
        negados.push({ op: op.op, motivo: err.publico ? err.message : 'Falha ao gravar.', r: r });
      }
    });

    if (eventos.length) {
      abaEv.getRange(abaEv.getLastRow() + 1, 1, eventos.length, COL_EVENTOS.length).setValues(eventos);
      SpreadsheetApp.flush();
      CacheService.getScriptCache().put('seq', String(seq), 21600);
    }
    return { seq: seq, aplicados: aplicados, negados: negados };
  } finally {
    lock.releaseLock();
  }
}

// ═════════════════════════ presença ═════════════════════════

function marcarPresenca_(u) {
  try { CacheService.getScriptCache().put('on:' + u.login, JSON.stringify({ login: u.login, nome: u.nome, t: new Date().toISOString() }), 180); } catch (e) { /* opcional */ }
}

function online_() {
  var logins = Object.keys(usuariosMapa_());
  if (!logins.length) return [];
  var vals = CacheService.getScriptCache().getAll(logins.map(function (l) { return 'on:' + l; }));
  return Object.keys(vals).map(function (k) { return JSON.parse(vals[k]); });
}

// ═════════════════════════ usuários ═════════════════════════

function listarUsuarios_() {
  var m = usuariosMapa_(true);
  return Object.keys(m).sort().map(function (k) {
    var u = m[k];
    return { login: u.login, nome: u.nome, perfil: u.perfil, modulos: u.modulos || '*', setor: u.setor || '', ativo: ativo_(u), ultimo_acesso: u.ultimo_acesso || '' };
  });
}

function salvarUsuario_(admin, dados, novo) {
  var login = String(dados.login || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(login)) throw erro_('Login inválido: use 3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado.');
  if (PERFIS.indexOf(dados.perfil) < 0) throw erro_('Perfil inválido.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var mapa = usuariosMapa_(true);
    var existe = mapa[login];
    if (novo && existe) throw erro_('Já existe um usuário com esse login.');
    if (!novo && !existe) throw erro_('Usuário não encontrado.');
    if (!novo && login === admin.login && (dados.perfil !== 'admin' || dados.ativo === false)) throw erro_('Você não pode remover o seu próprio acesso de administrador.');
    var campos = {
      login: login,
      nome: String(dados.nome || '').slice(0, 120),
      perfil: dados.perfil,
      modulos: String(dados.modulos || '*').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x === '*' || COLECOES.indexOf(x) >= 0; }).join(',') || '*',
      setor: String(dados.setor || '').slice(0, 120),
      ativo: dados.ativo !== false,
      atualizado_em: new Date().toISOString(),
    };
    var senha = String(dados.senha || '');
    if (novo && senha.length < 8) throw erro_('A senha inicial precisa ter pelo menos 8 caracteres.');
    var revogar = false;
    if (senha) {
      if (senha.length < 8) throw erro_('A senha precisa ter pelo menos 8 caracteres.');
      campos.sal = Utilities.getUuid();
      campos.hash = hashSenha_(senha, campos.sal);
      revogar = !novo;
    }
    if (existe && (existe.perfil !== campos.perfil || String(existe.modulos || '*') !== campos.modulos || ativo_(existe) !== campos.ativo)) revogar = true;
    if (novo) { campos.criado_em = campos.atualizado_em; campos.versao_token = 0; }
    if (revogar) campos.versao_token = (Number(existe && existe.versao_token) || 0) + 1; // derruba sessões abertas
    atualizarUsuario_(login, campos);
    registrarAcesso_(login, (novo ? 'criado' : 'alterado') + ' por ' + admin.login);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function alterarSenha_(u, atual, nova) {
  var reg = usuariosMapa_(true)[u.login];
  if (!reg || !iguaisSeguro_(hashSenha_(atual, reg.sal), reg.hash)) throw erro_('Senha atual incorreta.');
  if (nova.length < 8) throw erro_('A nova senha precisa ter pelo menos 8 caracteres.');
  var sal = Utilities.getUuid();
  var tv = (Number(reg.versao_token) || 0) + 1;
  atualizarUsuario_(u.login, { sal: sal, hash: hashSenha_(nova, sal), versao_token: tv, atualizado_em: new Date().toISOString() });
  registrarAcesso_(u.login, 'senha alterada');
  reg.versao_token = tv;
  return { ok: true, token: emitirToken_(reg) };
}

// ═════════════════════════ instalação e manutenção (rodar no editor) ═════════════════════════

/** Rode uma vez. Cria as abas, o segredo dos tokens e o usuário "admin" (senha no registro de execução). */
function prepararSistema() {
  aba_(ABA_EVENTOS, COL_EVENTOS);
  aba_(ABA_USUARIOS, COL_USUARIOS);
  aba_(ABA_ACESSOS, ['quando', 'login', 'resultado']);
  COLECOES.forEach(function (c) { aba_(c, BASE); });
  segredo_();
  var mapa = usuariosMapa_(true);
  if (!mapa.admin) {
    var senha = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    var sal = Utilities.getUuid();
    atualizarUsuario_('admin', { login: 'admin', nome: 'Administrador do Sistema', perfil: 'admin', modulos: '*', setor: 'Gabinete do Secretário', ativo: true, sal: sal, hash: hashSenha_(senha, sal), versao_token: 0, criado_em: new Date().toISOString() });
    console.log('Usuário: admin  ·  Senha inicial: ' + senha + '  →  entre no aplicativo e troque em Configurações > Minha senha.');
  } else {
    console.log('Sistema já preparado. Usuário admin existente mantido.');
  }
  CacheService.getScriptCache().remove('seq');
}

/** Redefine a senha de um usuário pelo editor (útil se o admin esquecer a própria senha). */
function redefinirSenha(login, novaSenha) {
  login = String(login || '').toLowerCase();
  if (!usuariosMapa_(true)[login]) throw new Error('Usuário não encontrado: ' + login);
  if (String(novaSenha || '').length < 8) throw new Error('Use pelo menos 8 caracteres.');
  var sal = Utilities.getUuid();
  var tv = (Number(usuariosMapa_(true)[login].versao_token) || 0) + 1;
  atualizarUsuario_(login, { sal: sal, hash: hashSenha_(novaSenha, sal), versao_token: tv, ativo: true });
  console.log('Senha redefinida para ' + login);
}

/** Invalida todas as sessões abertas (troca o segredo dos tokens). */
function encerrarTodasAsSessoes() {
  PropertiesService.getScriptProperties().setProperty('SEGREDO_TOKEN', Utilities.getUuid() + Utilities.getUuid());
  console.log('Todas as sessões foram encerradas.');
}

// ═════════════════════════ utilidades ═════════════════════════

function erro_(msg, codigo) {
  var e = new Error(msg);
  e.publico = true;
  e.codigo = codigo || 'erro';
  return e;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
