// Infraestrutura HTTP mínima: roteador, cookies, corpo da requisição e templates com escape.
'use strict';

const { URL } = require('node:url');

// ---------- templates HTML com escape automático ----------
class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Safe(out);
}

const raw = (s) => new Safe(String(s));

// ---------- cookies ----------
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = ''; }
  }
  return out;
}

function cookie(name, value, { maxAge, secure } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  if (secure) c += '; Secure';
  return c;
}

// ---------- corpo ----------
const MAX_BODY = 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Corpo muito grande'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseForm(text) {
  const out = {};
  for (const [k, v] of new URLSearchParams(text)) {
    if (k.endsWith('[]')) (out[k.slice(0, -2)] ||= []).push(v);
    else out[k] = v;
  }
  return out;
}

async function parseBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const text = await readBody(req);
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  if (type === 'application/json') {
    try { return JSON.parse(text || '{}'); } catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
  }
  return parseForm(text);
}

// ---------- roteador ----------
class Router {
  constructor() { this.routes = []; }
  add(method, path, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
  }
  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return null;
  }
}

// ---------- contexto de resposta ----------
function createContext(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const ctx = {
    req, res, url,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    cookies: parseCookies(req.headers.cookie),
    params: {},
    body: {},
    headers: {},
    setCookies: [],
    send(status, body, type = 'text/html; charset=utf-8') {
      if (res.headersSent) return;
      const headers = {
        'Content-Type': type,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        ...ctx.headers,
      };
      if (ctx.setCookies.length) headers['Set-Cookie'] = ctx.setCookies;
      res.writeHead(status, headers);
      res.end(req.method === 'HEAD' ? undefined : String(body));
    },
    html(body, status = 200) { ctx.send(status, body); },
    json(obj, status = 200) { ctx.send(status, JSON.stringify(obj), 'application/json; charset=utf-8'); },
    redirect(to, status = 303) { ctx.headers.Location = to; ctx.send(status, ''); },
  };
  return ctx;
}

module.exports = { html, raw, esc, Safe, Router, parseBody, parseForm, cookie, createContext };
