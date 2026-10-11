'use strict';

process.env.ADMIN_EMAIL = 'admin@teste.com';
process.env.ADMIN_SENHA = 'senha-admin-123';
process.env.PAGAMENTO_MODO = 'simulado';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');
const { openDb } = require('../src/db');
const util = require('../src/util');
const S = require('../src/servicos');

let server, base, db;

test.before(async () => {
  const app = createApp({ db: openDb(':memory:') });
  db = app.db;
  server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

// Cliente HTTP com cookies e extração automática do token CSRF.
function cliente() {
  const jar = {};
  let csrf = '';
  async function req(method, path, form, extra = {}) {
    const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...extra.headers };
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams({ _csrf: csrf, ...form }).toString();
    }
    const res = await fetch(base + path, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(';');
      const [k, ...v] = kv.split('=');
      if (attrs.some((a) => a.trim() === 'Max-Age=0')) delete jar[k.trim()];
      else jar[k.trim()] = v.join('=');
    }
    const text = await res.text();
    const m = /name="_csrf" value="([^"]+)"/.exec(text);
    if (m) csrf = m[1];
    return { status: res.status, text, location: res.headers.get('location') };
  }
  return {
    get: (p) => req('GET', p),
    post: (p, f) => req('POST', p, f || {}),
    jar,
  };
}

async function criarLojista(email = 'ana@teste.com', loja = 'Casa da Ana') {
  const c = cliente();
  await c.get('/cadastro');
  const r = await c.post('/cadastro', {
    nome: 'Ana Souza', email, documento: '529.982.247-25', telefone: '(22) 99999-0000',
    loja_nome: loja, senha: 'senha-forte-1', aceite: '1',
  });
  assert.equal(r.status, 303, r.text.slice(0, 500));
  assert.equal(r.location, '/painel');
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  return { c, u };
}

async function recarregar(c, valor) {
  await c.get('/painel/carteira');
  const r = await c.post('/painel/carteira/recarga', { valor });
  assert.equal(r.status, 303);
  await c.get(r.location);
  const r2 = await c.post(r.location + '/simular');
  assert.equal(r2.status, 303);
}

const ENDERECO = { cliente_nome: 'João Cliente', cep: '28890-000', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Rio das Ostras', uf: 'RJ' };

test('utilitários', () => {
  assert.equal(util.cpfValido('529.982.247-25'), true);
  assert.equal(util.cpfValido('111.111.111-11'), false);
  assert.equal(util.cnpjValido('11.222.333/0001-81'), true);
  assert.equal(util.toCentavos('1.234,56'), 123456);
  assert.equal(util.toCentavos('89,9'), 8990);
  assert.equal(util.toCentavos('10.5'), 1050);
  assert.equal(S.calcularFrete('01001-000', 800).centavos, 1590);
  assert.equal(S.calcularFrete('28890000', 2500).centavos, 1990 + 2 * 450);
  assert.throws(() => S.calcularFrete('123', 100));
});

test('páginas públicas respondem', async () => {
  const c = cliente();
  for (const p of ['/', '/catalogo', '/planos', '/cadastro', '/entrar', '/termos', '/privacidade', '/rastreio']) {
    assert.equal((await c.get(p)).status, 200, p);
  }
  assert.equal((await c.get('/inexistente')).status, 404);
  assert.equal((await c.get('/painel')).location, '/entrar');
  assert.equal((await c.get('/static/../package.json')).status, 404);
});

test('POST sem CSRF é recusado', async () => {
  const res = await fetch(base + '/entrar', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=a@b.c&senha=x', redirect: 'manual' });
  assert.equal(res.status, 403);
});

test('cadastro valida documento e e-mail duplicado', async () => {
  const c = cliente();
  await c.get('/cadastro');
  const r = await c.post('/cadastro', { nome: 'Fulano', email: 'f@t.com', documento: '123', telefone: '22999990000', loja_nome: 'X', senha: '12345678', aceite: '1' });
  assert.equal(r.status, 422);
  assert.match(r.text, /CPF ou CNPJ inválido/);
});

test('fluxo completo do lojista: loja, carteira, pedido, expedição e estorno', async () => {
  const { c, u } = await criarLojista();
  assert.equal(u.plano_id, 1, 'teste grátis no plano Start');

  // escapa HTML no nome da loja na vitrine
  const prod = db.prepare("SELECT * FROM produtos WHERE sku = 'ELE-001'").get();
  await c.get('/painel/catalogo');
  let r = await c.post('/painel/loja/adicionar', { produto_id: String(prod.id), preco: '50,00' });
  assert.equal(r.status, 303);
  assert.equal(db.prepare('SELECT preco_venda_centavos p FROM loja_produtos WHERE user_id = ?').get(u.id).p, 5000);

  // preço abaixo do custo é recusado
  await c.get(`/painel/produto/${prod.id}`);
  await c.post('/painel/loja/adicionar', { produto_id: String(prod.id), preco: '1,00' });
  assert.equal(db.prepare('SELECT preco_venda_centavos p FROM loja_produtos WHERE user_id = ?').get(u.id).p, 5000);

  // pedido sem saldo fica aguardando pagamento e não mexe no estoque
  await c.get('/painel/pedidos/novo');
  r = await c.post('/painel/pedidos', { ...ENDERECO, [`qtd_${prod.id}`]: '2' });
  assert.equal(r.status, 303, r.text.slice(0, 300));
  let ped = db.prepare('SELECT * FROM pedidos WHERE user_id = ? ORDER BY id DESC').get(u.id);
  assert.equal(ped.status, 'aguardando_pagamento');
  assert.equal(ped.venda_centavos, 10000);
  assert.equal(ped.custo_produtos_centavos, 2 * prod.custo_centavos);
  assert.equal(ped.frete_centavos, 1990);
  assert.equal(ped.taxa_centavos, 200);
  assert.equal(db.prepare('SELECT estoque FROM produtos WHERE id = ?').get(prod.id).estoque, prod.estoque);

  // recarga confirma e paga automaticamente o pedido pendente
  await recarregar(c, '200,00');
  ped = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(ped.id);
  assert.equal(ped.status, 'pago');
  assert.equal(db.prepare('SELECT saldo_centavos s FROM users WHERE id = ?').get(u.id).s, 20000 - ped.total_custo_centavos);
  assert.equal(db.prepare('SELECT estoque FROM produtos WHERE id = ?').get(prod.id).estoque, prod.estoque - 2);

  // confirmar a mesma recarga de novo não credita em dobro
  const rec = db.prepare("SELECT id FROM transacoes WHERE user_id = ? AND tipo = 'recarga'").get(u.id);
  S.confirmarRecarga(db, rec.id);
  assert.equal(db.prepare('SELECT saldo_centavos s FROM users WHERE id = ?').get(u.id).s, 20000 - ped.total_custo_centavos);

  // admin avança: separação → enviado (exige rastreio) → entregue
  const adm = cliente();
  await adm.get('/entrar');
  r = await adm.post('/entrar', { email: 'admin@teste.com', senha: 'senha-admin-123' });
  assert.equal(r.location, '/admin');
  assert.equal((await adm.get('/admin')).status, 200);
  await adm.get(`/admin/pedidos/${ped.codigo}`);
  await adm.post(`/admin/pedidos/${ped.codigo}/avancar`);
  assert.equal(db.prepare('SELECT status FROM pedidos WHERE id = ?').get(ped.id).status, 'em_separacao');
  await adm.get(`/admin/pedidos/${ped.codigo}`);
  await adm.post(`/admin/pedidos/${ped.codigo}/avancar`, { rastreio: '' });
  assert.equal(db.prepare('SELECT status FROM pedidos WHERE id = ?').get(ped.id).status, 'em_separacao');
  await adm.get(`/admin/pedidos/${ped.codigo}`);
  await adm.post(`/admin/pedidos/${ped.codigo}/avancar`, { rastreio: 'aa123456789br' });
  const enviado = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(ped.id);
  assert.equal(enviado.status, 'enviado');
  assert.equal(enviado.rastreio, 'AA123456789BR');

  // lojista não pode cancelar pedido já enviado
  await c.get(`/painel/pedidos/${ped.codigo}`);
  await c.post(`/painel/pedidos/${ped.codigo}/cancelar`);
  assert.equal(db.prepare('SELECT status FROM pedidos WHERE id = ?').get(ped.id).status, 'enviado');

  // rastreio público não expõe dados pessoais
  const pub = await cliente().get(`/rastreio?codigo=${ped.codigo}`);
  assert.match(pub.text, /AA123456789BR/);
  assert.doesNotMatch(pub.text, /João Cliente/);

  // novo pedido pago e cancelado pelo lojista → estorno e devolução de estoque
  const saldoAntes = db.prepare('SELECT saldo_centavos s FROM users WHERE id = ?').get(u.id).s;
  await c.get('/painel/pedidos/novo');
  await c.post('/painel/pedidos', { ...ENDERECO, [`qtd_${prod.id}`]: '1' });
  const p2 = db.prepare('SELECT * FROM pedidos WHERE user_id = ? ORDER BY id DESC').get(u.id);
  assert.equal(p2.status, 'pago');
  await c.get(`/painel/pedidos/${p2.codigo}`);
  await c.post(`/painel/pedidos/${p2.codigo}/cancelar`);
  assert.equal(db.prepare('SELECT status FROM pedidos WHERE id = ?').get(p2.id).status, 'cancelado');
  assert.equal(db.prepare('SELECT saldo_centavos s FROM users WHERE id = ?').get(u.id).s, saldoAntes);
  assert.equal(db.prepare('SELECT estoque FROM produtos WHERE id = ?').get(prod.id).estoque, prod.estoque - 2);

  // outro lojista não acessa o pedido
  const { c: c2 } = await criarLojista('bia@teste.com', 'Loja da Bia');
  assert.equal((await c2.get(`/painel/pedidos/${p2.codigo}`)).status, 404);
  // lojista não acessa o admin
  assert.equal((await c2.get('/admin')).status, 404);
});

test('vitrine: carrinho e checkout criam pedido com preço do servidor', async () => {
  const { c, u } = await criarLojista('carla@teste.com', 'Carla <Store>');
  const prod = db.prepare("SELECT * FROM produtos WHERE sku = 'CAS-004'").get();
  await c.get('/painel/catalogo');
  await c.post('/painel/loja/adicionar', { produto_id: String(prod.id), preco: '39,90' });
  await recarregar(c, '100,00');

  const loja = db.prepare('SELECT loja_slug FROM users WHERE id = ?').get(u.id).loja_slug;
  const cli = cliente();
  const home = await cli.get(`/loja/${loja}`);
  assert.equal(home.status, 200);
  assert.match(home.text, /Carla &lt;Store&gt;/);
  assert.doesNotMatch(home.text, /Carla <Store>/);

  await cli.post(`/loja/${loja}/carrinho`, { produto_id: String(prod.id), acao: 'add', qtd: '3' });
  await cli.get(`/loja/${loja}/carrinho`);
  const r = await cli.post(`/loja/${loja}/checkout`, {
    ...ENDERECO, cliente_email: 'joao@email.com', cliente_telefone: '22988887777', cliente_documento: '529.982.247-25', aceite: '1',
    preco_unit_centavos: '1', // tentativa de manipular preço: deve ser ignorada
  });
  assert.equal(r.status, 303, r.text.slice(0, 400));
  const p = db.prepare('SELECT * FROM pedidos WHERE user_id = ?').get(u.id);
  assert.equal(p.origem, 'vitrine');
  assert.equal(p.venda_centavos, 3 * 3990);
  assert.equal(p.status, 'pago');
  const conf = await cli.get(r.location);
  assert.match(conf.text, /Obrigado pela compra/);
});

test('API: exige plano com API, cria pedido, é idempotente e cancela', async () => {
  const { c, u } = await criarLojista('dani@teste.com', 'Dani Shop');
  const auth = { authorization: `Bearer ${u.api_key}`, 'content-type': 'application/json' };

  let res = await fetch(base + '/api/v1/produtos', { headers: auth });
  assert.equal(res.status, 403, 'plano Start não tem API');

  await recarregar(c, '300,00');
  await c.get('/painel/plano');
  const r = await c.post('/painel/plano/assinar', { plano_id: '2' });
  assert.equal(r.status, 303);
  assert.equal(db.prepare('SELECT plano_id FROM users WHERE id = ?').get(u.id).plano_id, 2);

  res = await fetch(base + '/api/v1/produtos', { headers: auth });
  assert.equal(res.status, 200);
  assert.ok((await res.json()).produtos.length >= 20);

  res = await fetch(base + '/api/v1/frete?cep=01001000&itens=ELE-001:2', { headers: auth });
  assert.equal((await res.json()).frete_centavos, 1590);

  const corpo = {
    referencia_externa: 'LOJA-1', cliente: { nome: 'Maria' },
    endereco: { cep: '01001000', logradouro: 'Praça da Sé', numero: '1', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' },
    itens: [{ sku: 'ele-004', qtd: 2, preco_unit_centavos: 4490 }],
  };
  res = await fetch(base + '/api/v1/pedidos', { method: 'POST', headers: auth, body: JSON.stringify(corpo) });
  assert.equal(res.status, 201);
  const { pedido } = await res.json();
  assert.equal(pedido.status, 'pago');
  assert.equal(pedido.valores.taxa_centavos, 100);

  res = await fetch(base + '/api/v1/pedidos', { method: 'POST', headers: auth, body: JSON.stringify(corpo) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).duplicado, true);

  res = await fetch(base + `/api/v1/pedidos/${pedido.codigo}/cancelar`, { method: 'POST', headers: auth });
  assert.equal((await res.json()).pedido.status, 'cancelado');

  res = await fetch(base + '/api/v1/pedidos', { headers: { authorization: 'Bearer chave-errada' } });
  assert.equal(res.status, 401);

  res = await fetch(base + '/api/v1/pedidos', { method: 'POST', headers: auth, body: JSON.stringify({ ...corpo, referencia_externa: 'X', itens: [{ sku: 'NAO-EXISTE', qtd: 1 }] }) });
  assert.equal(res.status, 404);
});

test('limite de produtos do plano é respeitado', async () => {
  const { c, u } = await criarLojista('eva@teste.com', 'Eva');
  db.prepare('UPDATE planos SET limite_produtos = 2 WHERE id = 1').run();
  try {
    const ids = db.prepare('SELECT id FROM produtos LIMIT 3').all().map((p) => p.id);
    for (const id of ids) {
      await c.get('/painel/catalogo');
      await c.post('/painel/loja/adicionar', { produto_id: String(id) });
    }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM loja_produtos WHERE user_id = ?').get(u.id).n, 2);
  } finally {
    db.prepare('UPDATE planos SET limite_produtos = 50 WHERE id = 1').run();
  }
});
