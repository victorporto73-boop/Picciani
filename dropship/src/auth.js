// Senhas (scrypt), sessões em banco e proteção CSRF.
'use strict';

const crypto = require('node:crypto');
const { cookie } = require('./http');
const { token } = require('./util');

const SESSAO_DIAS = 14;

function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(senha), salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verificarSenha(senha, armazenado) {
  const [alg, saltB64, hashB64] = String(armazenado).split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const esperado = Buffer.from(hashB64, 'base64');
  const obtido = crypto.scryptSync(String(senha), Buffer.from(saltB64, 'base64'), esperado.length);
  return crypto.timingSafeEqual(esperado, obtido);
}

function criarSessao(db, ctx, userId, secure) {
  const t = token(32);
  const csrf = token(24);
  const expira = Date.now() + SESSAO_DIAS * 86400e3;
  db.prepare('INSERT INTO sessions (token, user_id, csrf, expira_em) VALUES (?,?,?,?)').run(t, userId, csrf, expira);
  ctx.setCookies.push(cookie('sid', t, { maxAge: SESSAO_DIAS * 86400, secure }));
}

function carregarSessao(db, ctx) {
  const t = ctx.cookies.sid;
  if (t) {
    const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(t);
    if (s && s.expira_em > Date.now()) {
      const user = db.prepare('SELECT * FROM users WHERE id = ? AND ativo = 1').get(s.user_id);
      if (user) { ctx.session = s; ctx.user = user; ctx.csrf = s.csrf; return; }
    }
  }
  // Visitante: CSRF em cookie próprio (double-submit) para os formulários públicos.
  let c = ctx.cookies.csrf;
  if (!c || c.length < 20) {
    c = token(24);
    ctx.setCookies.push(cookie('csrf', c));
  }
  ctx.csrf = c;
}

function encerrarSessao(db, ctx) {
  if (ctx.cookies.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(ctx.cookies.sid);
  ctx.setCookies.push(cookie('sid', '', { maxAge: 0 }));
}

function csrfOk(ctx) {
  const enviado = String(ctx.body._csrf || ctx.req.headers['x-csrf-token'] || '');
  const a = Buffer.from(enviado);
  const b = Buffer.from(String(ctx.csrf || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

// Limite simples de tentativas de login por IP+e-mail (memória).
const tentativas = new Map();
function limiteLogin(chave) {
  const agora = Date.now();
  const t = tentativas.get(chave) || { n: 0, desde: agora };
  if (agora - t.desde > 15 * 60e3) { t.n = 0; t.desde = agora; }
  t.n++;
  tentativas.set(chave, t);
  return t.n <= 10;
}
const limparLimite = (chave) => tentativas.delete(chave);

module.exports = { hashSenha, verificarSenha, criarSessao, carregarSessao, encerrarSessao, csrfOk, limiteLogin, limparLimite };
