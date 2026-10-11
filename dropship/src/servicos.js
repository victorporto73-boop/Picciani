// Regras de negócio: frete, assinatura, carteira e ciclo de vida dos pedidos.
'use strict';

const crypto = require('node:crypto');
const { tx } = require('./db');
const { soDigitos, codigoPedido, token, UFS, brl } = require('./util');

class ErroNegocio extends Error {
  constructor(msg, status = 422) { super(msg); this.status = status; this.negocio = true; }
}

// ---------- frete ----------
// Tabela simplificada por faixa de CEP (1º dígito). Substitua por cotação real
// (Correios, Melhor Envio, Frenet etc.) em calcularFrete() quando integrar.
const FAIXAS_FRETE = {
  0: { regiao: 'São Paulo (capital/RM)', base: 1590, prazo: '2 a 4' },
  1: { regiao: 'São Paulo (interior)', base: 1790, prazo: '3 a 5' },
  2: { regiao: 'Rio de Janeiro / Espírito Santo', base: 1990, prazo: '3 a 6' },
  3: { regiao: 'Minas Gerais', base: 1990, prazo: '3 a 6' },
  4: { regiao: 'Bahia / Sergipe', base: 2490, prazo: '5 a 9' },
  5: { regiao: 'PE / AL / PB / RN', base: 2690, prazo: '6 a 10' },
  6: { regiao: 'Norte e CE / PI / MA', base: 2990, prazo: '7 a 12' },
  7: { regiao: 'Centro-Oeste / TO / RO', base: 2490, prazo: '5 a 9' },
  8: { regiao: 'Paraná / Santa Catarina', base: 1990, prazo: '3 a 6' },
  9: { regiao: 'Rio Grande do Sul', base: 2190, prazo: '4 a 7' },
};
const ADICIONAL_KG = 450;

function calcularFrete(cep, pesoG) {
  const c = soDigitos(cep);
  if (c.length !== 8) throw new ErroNegocio('CEP inválido.');
  const f = FAIXAS_FRETE[c[0]];
  const kgExtra = Math.max(0, Math.ceil((pesoG - 1000) / 1000));
  return { centavos: f.base + kgExtra * ADICIONAL_KG, regiao: f.regiao, prazo: `${f.prazo} dias úteis` };
}

// ---------- plano / assinatura ----------
function planoAtivo(db, user) {
  if (!user.plano_id || !user.plano_valido_ate) return null;
  if (new Date(user.plano_valido_ate + 'Z') < new Date()) return null;
  return db.prepare('SELECT * FROM planos WHERE id = ?').get(user.plano_id);
}

function exigirPlano(db, user) {
  const p = planoAtivo(db, user);
  if (!p) throw new ErroNegocio('Seu plano está inativo. Assine ou renove um plano para continuar.', 402);
  return p;
}

const sqlDate = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

function iniciarTeste(db, userId, dias = 7) {
  const ate = new Date(Date.now() + dias * 86400e3);
  db.prepare('UPDATE users SET plano_id = 1, plano_valido_ate = ? WHERE id = ?').run(sqlDate(ate), userId);
}

function assinar(db, userId, planoId) {
  return tx(db, () => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const plano = db.prepare('SELECT * FROM planos WHERE id = ?').get(planoId);
    if (!plano) throw new ErroNegocio('Plano inexistente.', 404);
    if (user.saldo_centavos < plano.preco_centavos) {
      throw new ErroNegocio(`Saldo insuficiente. A assinatura custa ${brl(plano.preco_centavos)} e seu saldo é ${brl(user.saldo_centavos)}. Faça uma recarga.`, 402);
    }
    // Troca de plano começa a valer agora; renovação do mesmo plano soma 30 dias.
    const atual = planoAtivo(db, user);
    const base = atual && atual.id === plano.id ? new Date(user.plano_valido_ate + 'Z') : new Date();
    const ate = new Date(base.getTime() + 30 * 86400e3);
    db.prepare('UPDATE users SET plano_id = ?, plano_valido_ate = ?, saldo_centavos = saldo_centavos - ? WHERE id = ?')
      .run(plano.id, sqlDate(ate), plano.preco_centavos, userId);
    db.prepare("INSERT INTO transacoes (user_id, tipo, valor_centavos, descricao) VALUES (?, 'assinatura', ?, ?)")
      .run(userId, -plano.preco_centavos, `Assinatura plano ${plano.nome} (30 dias)`);
    return { plano, ate };
  });
}

// ---------- carteira ----------
function gerarPixCopiaECola(valor, txid) {
  // Código ilustrativo no modo simulado. Em produção, use o "copia e cola"
  // devolvido pelo PSP (Mercado Pago, Asaas, Efí, PagSeguro etc.).
  return `00020126SIMULADO0014BR.GOV.BCB.PIX0136${txid}5204000053039865406${(valor / 100).toFixed(2)}5802BR6009SAO PAULO62070503***6304`;
}

function criarRecarga(db, userId, valor) {
  if (!Number.isInteger(valor) || valor < 1000) throw new ErroNegocio('Valor mínimo de recarga: R$ 10,00.');
  if (valor > 5_000_000) throw new ErroNegocio('Valor máximo por recarga: R$ 50.000,00.');
  const txid = token(18).replace(/[^a-zA-Z0-9]/g, '').slice(0, 25).padEnd(25, '0');
  const r = db.prepare("INSERT INTO transacoes (user_id, tipo, valor_centavos, descricao, status, pix_codigo) VALUES (?, 'recarga', ?, 'Recarga via Pix', 'pendente', ?)")
    .run(userId, valor, gerarPixCopiaECola(valor, txid));
  return Number(r.lastInsertRowid);
}

function confirmarRecarga(db, transacaoId) {
  const t = tx(db, () => {
    const t = db.prepare("SELECT * FROM transacoes WHERE id = ? AND tipo = 'recarga'").get(transacaoId);
    if (!t) throw new ErroNegocio('Recarga não encontrada.', 404);
    if (t.status !== 'pendente') return t; // idempotente: confirmar duas vezes não credita duas vezes
    db.prepare("UPDATE transacoes SET status = 'confirmada' WHERE id = ?").run(t.id);
    db.prepare('UPDATE users SET saldo_centavos = saldo_centavos + ? WHERE id = ?').run(t.valor_centavos, t.user_id);
    return t;
  });
  pagarPendentes(db, t.user_id);
  return t;
}

// ---------- pedidos ----------
const STATUS = {
  aguardando_pagamento: { rotulo: 'Aguardando pagamento', cor: 'amber' },
  pago: { rotulo: 'Pago', cor: 'blue' },
  em_separacao: { rotulo: 'Em separação', cor: 'indigo' },
  enviado: { rotulo: 'Enviado', cor: 'violet' },
  entregue: { rotulo: 'Entregue', cor: 'green' },
  cancelado: { rotulo: 'Cancelado', cor: 'gray' },
};
const PROXIMO_STATUS = { pago: 'em_separacao', em_separacao: 'enviado', enviado: 'entregue' };

function validarEndereco(d) {
  const req = { cliente_nome: 'nome do cliente', cep: 'CEP', logradouro: 'endereço', numero: 'número', bairro: 'bairro', cidade: 'cidade', uf: 'UF' };
  for (const [k, rot] of Object.entries(req)) {
    if (!String(d[k] ?? '').trim()) throw new ErroNegocio(`Informe o ${rot}.`);
  }
  if (soDigitos(d.cep).length !== 8) throw new ErroNegocio('CEP inválido.');
  if (!UFS.includes(String(d.uf).toUpperCase())) throw new ErroNegocio('UF inválida.');
  if (d.cliente_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.cliente_email)) throw new ErroNegocio('E-mail do cliente inválido.');
}

function cotarItens(db, user, itens, { exigirNaLoja = false } = {}) {
  if (!Array.isArray(itens) || !itens.length) throw new ErroNegocio('Inclua ao menos um produto.');
  const agrupados = new Map();
  for (const it of itens) {
    const id = Number(it.produto_id);
    const qtd = Number(it.qtd);
    if (!Number.isInteger(id) || !Number.isInteger(qtd) || qtd < 1 || qtd > 999) throw new ErroNegocio('Item de pedido inválido.');
    const prev = agrupados.get(id);
    agrupados.set(id, { produto_id: id, qtd: (prev?.qtd || 0) + qtd, preco: it.preco_unit_centavos ?? prev?.preco });
  }
  const linhas = [];
  for (const it of agrupados.values()) {
    const p = db.prepare(`SELECT p.*, lp.preco_venda_centavos, lp.ativo AS na_loja_ativo FROM produtos p
      LEFT JOIN loja_produtos lp ON lp.produto_id = p.id AND lp.user_id = ? WHERE p.id = ?`).get(user.id, it.produto_id);
    if (!p || !p.ativo) throw new ErroNegocio('Produto indisponível.');
    if (exigirNaLoja && !p.na_loja_ativo) throw new ErroNegocio(`"${p.nome}" não está à venda nesta loja.`);
    if (p.estoque < it.qtd) throw new ErroNegocio(`Estoque insuficiente para "${p.nome}" (disponível: ${p.estoque}).`);
    let preco = Number.isInteger(it.preco) && it.preco >= 0 ? it.preco : (p.preco_venda_centavos ?? p.preco_sugerido_centavos);
    if (exigirNaLoja) preco = p.preco_venda_centavos; // na vitrine o preço nunca vem do navegador
    linhas.push({ produto: p, qtd: it.qtd, custo: p.custo_centavos, preco });
  }
  const custo = linhas.reduce((s, l) => s + l.custo * l.qtd, 0);
  const venda = linhas.reduce((s, l) => s + l.preco * l.qtd, 0);
  const peso = linhas.reduce((s, l) => s + l.produto.peso_g * l.qtd, 0);
  return { linhas, custo, venda, peso };
}

function criarPedido(db, userId, dados, origem) {
  const pedidoId = tx(db, () => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const plano = exigirPlano(db, user);
    validarEndereco(dados);
    const { linhas, custo, venda, peso } = cotarItens(db, user, dados.itens, { exigirNaLoja: origem === 'vitrine' });
    const frete = calcularFrete(dados.cep, peso).centavos;
    const taxa = plano.taxa_pedido_centavos;
    const r = db.prepare(`INSERT INTO pedidos (codigo, user_id, origem, referencia_externa, cliente_nome, cliente_email, cliente_telefone, cliente_documento,
        cep, logradouro, numero, complemento, bairro, cidade, uf, venda_centavos, custo_produtos_centavos, frete_centavos, taxa_centavos, total_custo_centavos, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'aguardando_pagamento')`).run(
      codigoPedido(), userId, origem, String(dados.referencia_externa || '').slice(0, 80),
      String(dados.cliente_nome).trim().slice(0, 120), String(dados.cliente_email || '').trim().slice(0, 120),
      String(dados.cliente_telefone || '').trim().slice(0, 30), soDigitos(dados.cliente_documento).slice(0, 14),
      soDigitos(dados.cep), String(dados.logradouro).trim().slice(0, 160), String(dados.numero).trim().slice(0, 20),
      String(dados.complemento || '').trim().slice(0, 80), String(dados.bairro).trim().slice(0, 80),
      String(dados.cidade).trim().slice(0, 80), String(dados.uf).toUpperCase(),
      venda, custo, frete, taxa, custo + frete + taxa);
    const id = Number(r.lastInsertRowid);
    const insItem = db.prepare('INSERT INTO pedido_itens (pedido_id, produto_id, sku, nome, qtd, custo_unit_centavos, preco_unit_centavos) VALUES (?,?,?,?,?,?,?)');
    for (const l of linhas) insItem.run(id, l.produto.id, l.produto.sku, l.produto.nome, l.qtd, l.custo, l.preco);
    db.prepare("INSERT INTO pedido_eventos (pedido_id, status, nota) VALUES (?, 'aguardando_pagamento', ?)")
      .run(id, `Pedido criado (${origem}).`);
    return id;
  });
  pagarPedido(db, pedidoId, { silencioso: true });
  return db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
}

// Debita o custo da carteira e reserva o estoque. Com silencioso, falta de saldo não é erro.
function pagarPedido(db, pedidoId, { silencioso = false } = {}) {
  let pago = false;
  try {
    tx(db, () => {
      const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
      if (!p) throw new ErroNegocio('Pedido não encontrado.', 404);
      if (p.status !== 'aguardando_pagamento') throw new ErroNegocio('Este pedido não está aguardando pagamento.');
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(p.user_id);
      if (user.saldo_centavos < p.total_custo_centavos) {
        throw new ErroNegocio(`Saldo insuficiente: o pedido custa ${brl(p.total_custo_centavos)} e seu saldo é ${brl(user.saldo_centavos)}.`, 402);
      }
      const itens = db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(p.id);
      for (const it of itens) {
        const r = db.prepare('UPDATE produtos SET estoque = estoque - ? WHERE id = ? AND estoque >= ?').run(it.qtd, it.produto_id, it.qtd);
        if (r.changes !== 1) throw new ErroNegocio(`Estoque insuficiente para "${it.nome}".`);
      }
      db.prepare('UPDATE users SET saldo_centavos = saldo_centavos - ? WHERE id = ?').run(p.total_custo_centavos, p.user_id);
      db.prepare("INSERT INTO transacoes (user_id, tipo, valor_centavos, descricao, pedido_id) VALUES (?, 'pedido', ?, ?, ?)")
        .run(p.user_id, -p.total_custo_centavos, `Pedido ${p.codigo}`, p.id);
      mudarStatusInterno(db, p, 'pago', 'Pagamento debitado da carteira.');
      pago = true;
    });
  } catch (e) {
    if (!(silencioso && e.negocio)) throw e;
  }
  if (pago) notificarWebhook(db, pedidoId);
  return pago;
}

function pagarPendentes(db, userId) {
  const pend = db.prepare("SELECT id FROM pedidos WHERE user_id = ? AND status = 'aguardando_pagamento' ORDER BY id").all(userId);
  for (const p of pend) pagarPedido(db, p.id, { silencioso: true });
}

function mudarStatusInterno(db, pedido, status, nota = '', rastreio) {
  if (rastreio !== undefined) {
    db.prepare("UPDATE pedidos SET status = ?, rastreio = ?, atualizado_em = datetime('now') WHERE id = ?").run(status, rastreio, pedido.id);
  } else {
    db.prepare("UPDATE pedidos SET status = ?, atualizado_em = datetime('now') WHERE id = ?").run(status, pedido.id);
  }
  db.prepare('INSERT INTO pedido_eventos (pedido_id, status, nota) VALUES (?,?,?)').run(pedido.id, status, nota);
}

function avancarPedido(db, pedidoId, { rastreio } = {}) {
  tx(db, () => {
    const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
    if (!p) throw new ErroNegocio('Pedido não encontrado.', 404);
    const prox = PROXIMO_STATUS[p.status];
    if (!prox) throw new ErroNegocio('Não há próxima etapa para este pedido.');
    if (prox === 'enviado') {
      const r = String(rastreio || '').trim().toUpperCase();
      if (r.length < 6) throw new ErroNegocio('Informe o código de rastreio para marcar como enviado.');
      mudarStatusInterno(db, p, prox, `Código de rastreio: ${r}`, r);
    } else {
      mudarStatusInterno(db, p, prox, STATUS[prox].rotulo);
    }
  });
  notificarWebhook(db, pedidoId);
}

function cancelarPedido(db, pedidoId, { porAdmin = false, motivo = '' } = {}) {
  tx(db, () => {
    const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
    if (!p) throw new ErroNegocio('Pedido não encontrado.', 404);
    const permitidos = porAdmin ? ['aguardando_pagamento', 'pago', 'em_separacao'] : ['aguardando_pagamento', 'pago'];
    if (!permitidos.includes(p.status)) throw new ErroNegocio('Este pedido não pode mais ser cancelado.');
    if (p.status !== 'aguardando_pagamento') {
      const itens = db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(p.id);
      for (const it of itens) db.prepare('UPDATE produtos SET estoque = estoque + ? WHERE id = ?').run(it.qtd, it.produto_id);
      db.prepare('UPDATE users SET saldo_centavos = saldo_centavos + ? WHERE id = ?').run(p.total_custo_centavos, p.user_id);
      db.prepare("INSERT INTO transacoes (user_id, tipo, valor_centavos, descricao, pedido_id) VALUES (?, 'estorno', ?, ?, ?)")
        .run(p.user_id, p.total_custo_centavos, `Estorno do pedido ${p.codigo}`, p.id);
    }
    mudarStatusInterno(db, p, 'cancelado', motivo || (porAdmin ? 'Cancelado pela plataforma.' : 'Cancelado pelo lojista.'));
  });
  notificarWebhook(db, pedidoId);
}

// ---------- webhooks ----------
function pedidoParaApi(db, p) {
  const itens = db.prepare('SELECT sku, nome, qtd, preco_unit_centavos, custo_unit_centavos FROM pedido_itens WHERE pedido_id = ?').all(p.id);
  return {
    codigo: p.codigo, status: p.status, origem: p.origem, referencia_externa: p.referencia_externa,
    rastreio: p.rastreio || null,
    cliente: { nome: p.cliente_nome, email: p.cliente_email, telefone: p.cliente_telefone },
    endereco: { cep: p.cep, logradouro: p.logradouro, numero: p.numero, complemento: p.complemento, bairro: p.bairro, cidade: p.cidade, uf: p.uf },
    itens: itens.map((i) => ({ ...i })),
    valores: { venda_centavos: p.venda_centavos, custo_produtos_centavos: p.custo_produtos_centavos, frete_centavos: p.frete_centavos, taxa_centavos: p.taxa_centavos, total_custo_centavos: p.total_custo_centavos },
    criado_em: p.criado_em, atualizado_em: p.atualizado_em,
  };
}

function notificarWebhook(db, pedidoId) {
  const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  const u = p && db.prepare('SELECT * FROM users WHERE id = ?').get(p.user_id);
  if (!u || !/^https:\/\//.test(u.webhook_url) || !u.api_key) return;
  const plano = planoAtivo(db, u);
  if (!plano || !plano.acesso_api) return;
  const corpo = JSON.stringify({ evento: 'pedido.atualizado', pedido: pedidoParaApi(db, p) });
  const assinatura = crypto.createHmac('sha256', u.api_key).update(corpo).digest('hex');
  fetch(u.webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Assinatura': `sha256=${assinatura}` },
    body: corpo,
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

module.exports = {
  ErroNegocio, calcularFrete, FAIXAS_FRETE, planoAtivo, exigirPlano, iniciarTeste, assinar,
  criarRecarga, confirmarRecarga, STATUS, criarPedido, pagarPedido, avancarPedido, cancelarPedido,
  cotarItens, pedidoParaApi,
};
