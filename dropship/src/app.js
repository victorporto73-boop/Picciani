'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Router, parseBody, createContext, cookie } = require('./http');
const { carregarSessao, csrfOk, hashSenha } = require('./auth');
const { openDb, seed } = require('./db');
const { paginaErro } = require('./views/layout');
const config = require('./config');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function servirEstatico(ctx) {
  const rel = ctx.path.slice('/static/'.length);
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  ctx.headers['Cache-Control'] = 'public, max-age=3600';
  ctx.send(200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
  return true;
}

function createApp({ db = openDb() } = {}) {
  seed(db, { hashSenha, adminEmail: config.ADMIN_EMAIL, adminSenha: config.ADMIN_SENHA });

  const r = new Router();
  require('./rotas/publico')(r, db);
  require('./rotas/painel')(r, db);
  require('./rotas/admin')(r, db);
  require('./rotas/vitrine')(r, db);
  require('./rotas/api')(r, db);

  // Limpeza periódica de sessões expiradas.
  const limpar = () => db.prepare('DELETE FROM sessions WHERE expira_em < ?').run(Date.now());
  limpar();
  setInterval(limpar, 6 * 3600e3).unref();

  async function handler(req, res) {
    const ctx = createContext(req, res);
    ctx.ip = req.socket.remoteAddress || '';
    const api = ctx.path.startsWith('/api/');
    try {
      if (ctx.path.startsWith('/static/') && (req.method === 'GET' || req.method === 'HEAD')) {
        if (servirEstatico(ctx)) return;
      }
      if (!api) {
        carregarSessao(db, ctx);
        if (ctx.cookies.flash) {
          try { ctx.flashLido = JSON.parse(ctx.cookies.flash); } catch { /* ignora */ }
          ctx.setCookies.push(cookie('flash', '', { maxAge: 0 }));
        }
        ctx.flash = (tipo, msg) => {
          // Uma nova mensagem substitui a que acabou de ser lida.
          ctx.setCookies = ctx.setCookies.filter((c) => !c.startsWith('flash='));
          ctx.setCookies.push(cookie('flash', JSON.stringify({ tipo, msg: String(msg).slice(0, 400) })));
        };
      }
      ctx.notFound = () => (api ? ctx.json({ erro: 'Não encontrado.' }, 404) : ctx.html(paginaErro(ctx, 404, 'Página não encontrada.'), 404));

      const m = r.match(req.method, ctx.path);
      if (!m) return ctx.notFound();
      ctx.params = m.params;
      ctx.body = await parseBody(req);
      if (!api && req.method === 'POST' && !csrfOk(ctx)) {
        return ctx.html(paginaErro(ctx, 403, 'Sessão expirada ou formulário inválido. Volte, recarregue a página e tente novamente.'), 403);
      }
      for (const h of m.route.handlers) {
        const ok = await h(ctx);
        if (ok === false || res.headersSent) break;
      }
      if (!res.headersSent) ctx.notFound();
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      const msg = status >= 500 ? 'Erro interno. Tente novamente em instantes.' : e.message;
      if (api) ctx.json({ erro: msg }, status);
      else ctx.html(paginaErro(ctx, status, msg), status);
    }
  }

  return { handler, db };
}

module.exports = { createApp };
