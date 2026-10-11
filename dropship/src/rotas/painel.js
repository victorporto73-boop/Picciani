// Painel do lojista.
'use strict';

const { html, raw } = require('../http');
const { paginaPainel, badgeStatus, thumb, vazio, paginacao, csrfInput } = require('../views/layout');
const { brl, toCentavos, centsToInput, dataBR, slugify, token, UFS } = require('../util');
const S = require('../servicos');
const { cardsPlanos } = require('./publico');
const config = require('../config');

const POR_PAGINA = 20;

function exigirLojista(ctx) {
  if (!ctx.user) { ctx.redirect('/entrar'); return false; }
  if (ctx.user.role !== 'lojista') { ctx.redirect('/admin'); return false; }
  return true;
}

function margem(custo, preco) {
  if (!preco) return 0;
  return Math.round(((preco - custo) / preco) * 100);
}

function avisoPlano(db, u) {
  const p = S.planoAtivo(db, u);
  if (!p) return html`<div class="aviso aviso-erro">Seu plano está inativo: não é possível adicionar produtos nem lançar pedidos. <a href="/painel/plano">Assinar um plano →</a></div>`;
  const dias = Math.ceil((new Date(u.plano_valido_ate + 'Z') - Date.now()) / 86400e3);
  if (dias <= 3) return html`<div class="aviso">Seu plano ${p.nome} vence em ${dias} dia(s). <a href="/painel/plano">Renovar →</a></div>`;
  return '';
}

function tabelaPedidos(pedidos, base = '/painel/pedidos') {
  return html`<div class="tabela-wrap"><table class="tabela">
    <thead><tr><th>Pedido</th><th>Cliente</th><th>Origem</th><th>Venda</th><th>Custo total</th><th>Status</th><th>Data</th></tr></thead>
    <tbody>${pedidos.map((p) => html`<tr>
      <td><a href="${base}/${p.codigo}"><strong>${p.codigo}</strong></a></td>
      <td>${p.cliente_nome}<div class="muted pequeno">${p.cidade}/${p.uf}</div></td>
      <td><span class="tag">${p.origem}</span></td>
      <td>${brl(p.venda_centavos)}</td>
      <td>${brl(p.total_custo_centavos)}</td>
      <td>${badgeStatus(p.status)}</td>
      <td class="pequeno">${dataBR(p.criado_em)}</td>
    </tr>`)}</tbody></table></div>`;
}

module.exports = function rotasPainel(r, db) {
  const recarregarUser = (ctx) => { ctx.user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id); };

  // ---------- início ----------
  r.get('/painel', exigirLojista, (ctx) => {
    const u = ctx.user;
    const k = db.prepare(`SELECT
        COUNT(*) total,
        COALESCE(SUM(CASE WHEN status NOT IN ('cancelado','aguardando_pagamento') THEN venda_centavos END),0) vendas,
        COALESCE(SUM(CASE WHEN status NOT IN ('cancelado','aguardando_pagamento') THEN venda_centavos - total_custo_centavos END),0) lucro,
        COALESCE(SUM(CASE WHEN status = 'aguardando_pagamento' THEN 1 END),0) pendentes,
        COALESCE(SUM(CASE WHEN status IN ('pago','em_separacao','enviado') THEN 1 END),0) andamento
      FROM pedidos WHERE user_id = ? AND criado_em >= datetime('now','-30 days')`).get(u.id);
    const nLoja = db.prepare('SELECT COUNT(*) n FROM loja_produtos WHERE user_id = ?').get(u.id).n;
    const ultimos = db.prepare('SELECT * FROM pedidos WHERE user_id = ? ORDER BY id DESC LIMIT 6').all(u.id);
    const plano = S.planoAtivo(db, u);
    const passos = [
      [nLoja > 0, 'Adicione produtos à sua loja', '/painel/catalogo'],
      [u.saldo_centavos > 0 || k.total > 0, 'Faça a primeira recarga da carteira', '/painel/carteira'],
      [k.total > 0, 'Lance ou receba seu primeiro pedido', '/painel/pedidos/novo'],
    ];
    ctx.html(paginaPainel(ctx, `Olá, ${u.nome.split(' ')[0]}!`, html`
      ${avisoPlano(db, u)}
      ${k.pendentes ? html`<div class="aviso">Você tem ${k.pendentes} pedido(s) aguardando pagamento. <a href="/painel/carteira">Recarregue a carteira</a> para liberá-los.</div>` : ''}
      <div class="kpis">
        <div class="card kpi"><span>Vendas (30 dias)</span><strong>${brl(k.vendas)}</strong></div>
        <div class="card kpi"><span>Lucro estimado (30 dias)</span><strong class="verde">${brl(k.lucro)}</strong></div>
        <div class="card kpi"><span>Pedidos em andamento</span><strong>${k.andamento}</strong></div>
        <div class="card kpi"><span>Produtos na loja</span><strong>${nLoja}${plano?.limite_produtos ? html`<small> / ${plano.limite_produtos}</small>` : ''}</strong></div>
      </div>
      ${passos.some((p) => !p[0]) ? html`<div class="card">
        <h3>Primeiros passos</h3>
        <ol class="checklist">${passos.map(([feito, txt, href]) => html`<li class="${feito ? 'feito' : ''}">${feito ? '✅' : '⬜'} <a href="${href}">${txt}</a></li>`)}</ol>
      </div>` : ''}
      <div class="card">
        <div class="linha-entre"><h3>Últimos pedidos</h3><a class="btn btn-sm btn-primario" href="/painel/pedidos/novo">+ Novo pedido</a></div>
        ${ultimos.length ? tabelaPedidos(ultimos) : vazio('Nenhum pedido ainda.')}
      </div>
      <div class="card">
        <h3>Sua vitrine</h3>
        <p>Divulgue o link da sua loja nas redes sociais e no WhatsApp:</p>
        <div class="copiar"><input readonly value="${config.BASE_URL}/loja/${u.loja_slug}" id="link-loja"><button class="btn btn-sm" data-copiar="link-loja">Copiar</button></div>
      </div>
      <script src="/static/app.js" defer></script>`));
  });

  // ---------- catálogo ----------
  r.get('/painel/catalogo', exigirLojista, (ctx) => {
    const u = ctx.user;
    const cat = ctx.query.categoria || '';
    const q = (ctx.query.q || '').trim();
    const ordem = { margem: '(p.preco_sugerido_centavos - p.custo_centavos) DESC', menor: 'p.custo_centavos ASC', maior: 'p.custo_centavos DESC', novos: 'p.id DESC' }[ctx.query.ordem] || 'p.nome';
    const pagina = Math.max(1, Number(ctx.query.pagina) || 1);
    const where = `p.ativo = 1 AND (? = '' OR c.slug = ?) AND (? = '' OR p.nome LIKE ? OR p.sku LIKE ?)`;
    const args = [cat, cat, q, `%${q}%`, `%${q}%`];
    const total = db.prepare(`SELECT COUNT(*) n FROM produtos p JOIN categorias c ON c.id = p.categoria_id WHERE ${where}`).get(...args).n;
    const produtos = db.prepare(`SELECT p.*, c.nome categoria, lp.id na_loja FROM produtos p JOIN categorias c ON c.id = p.categoria_id
      LEFT JOIN loja_produtos lp ON lp.produto_id = p.id AND lp.user_id = ?
      WHERE ${where} ORDER BY ${ordem} LIMIT ? OFFSET ?`).all(u.id, ...args, POR_PAGINA, (pagina - 1) * POR_PAGINA);
    const categorias = db.prepare('SELECT * FROM categorias ORDER BY nome').all();
    ctx.html(paginaPainel(ctx, 'Catálogo', html`
      ${avisoPlano(db, u)}
      <form class="filtros" method="get">
        <input type="search" name="q" value="${q}" placeholder="Buscar por nome ou SKU…">
        <select name="categoria"><option value="">Todas as categorias</option>${categorias.map((c) => html`<option value="${c.slug}" ${c.slug === cat ? 'selected' : ''}>${c.icone} ${c.nome}</option>`)}</select>
        <select name="ordem">
          ${[['', 'Nome'], ['margem', 'Maior lucro'], ['menor', 'Menor custo'], ['maior', 'Maior custo'], ['novos', 'Lançamentos']].map(([v, l]) => html`<option value="${v}" ${ctx.query.ordem === v ? 'selected' : ''}>Ordenar: ${l}</option>`)}
        </select>
        <button class="btn">Filtrar</button>
      </form>
      <p class="muted pequeno">${total} produto(s)</p>
      ${produtos.length ? html`<div class="grade-produtos">${produtos.map((p) => html`<article class="card produto">
        <a href="/painel/produto/${p.id}">${thumb(p)}</a>
        <div class="produto-corpo">
          <span class="muted pequeno">${p.categoria} · ${p.sku}</span>
          <h3><a href="/painel/produto/${p.id}">${p.nome}</a></h3>
          <dl class="valores">
            <div><dt>Custo</dt><dd>${brl(p.custo_centavos)}</dd></div>
            <div><dt>Sugerido</dt><dd>${brl(p.preco_sugerido_centavos)}</dd></div>
            <div><dt>Lucro</dt><dd class="verde">${brl(p.preco_sugerido_centavos - p.custo_centavos)}</dd></div>
          </dl>
          <div class="linha-entre pequeno"><span class="${p.estoque < 20 ? 'vermelho' : 'muted'}">Estoque: ${p.estoque}</span><span class="muted">Margem ${margem(p.custo_centavos, p.preco_sugerido_centavos)}%</span></div>
          ${p.na_loja
            ? html`<a class="btn btn-sm btn-bloco" href="/painel/loja">✓ Na sua loja</a>`
            : html`<form method="post" action="/painel/loja/adicionar">${csrfInput(ctx)}<input type="hidden" name="produto_id" value="${p.id}"><button class="btn btn-sm btn-primario btn-bloco">+ Adicionar à loja</button></form>`}
        </div>
      </article>`)}</div>` : vazio('Nenhum produto encontrado com esses filtros.')}
      ${paginacao(ctx, total, POR_PAGINA, pagina)}`));
  });

  r.get('/painel/produto/:id', exigirLojista, (ctx) => {
    const p = db.prepare(`SELECT p.*, c.nome categoria, lp.id na_loja, lp.preco_venda_centavos FROM produtos p JOIN categorias c ON c.id = p.categoria_id
      LEFT JOIN loja_produtos lp ON lp.produto_id = p.id AND lp.user_id = ? WHERE p.id = ? AND p.ativo = 1`).get(ctx.user.id, Number(ctx.params.id));
    if (!p) return ctx.notFound();
    const plano = S.planoAtivo(db, ctx.user);
    const preco = p.preco_venda_centavos ?? p.preco_sugerido_centavos;
    ctx.html(paginaPainel(ctx, p.nome, html`
      <p><a href="/painel/catalogo">← Voltar ao catálogo</a></p>
      <div class="produto-detalhe">
        <div>${thumb(p, 'grande')}</div>
        <div class="card">
          <span class="muted pequeno">${p.categoria} · SKU ${p.sku} · ${p.peso_g} g</span>
          <h2>${p.nome}</h2>
          <p>${p.descricao}</p>
          <dl class="valores grande">
            <div><dt>Seu custo</dt><dd>${brl(p.custo_centavos)}</dd></div>
            <div><dt>Preço sugerido</dt><dd>${brl(p.preco_sugerido_centavos)}</dd></div>
            <div><dt>Estoque</dt><dd>${p.estoque} un.</dd></div>
          </dl>
          <form method="post" action="/painel/loja/adicionar" class="form calc" data-custo="${p.custo_centavos}" data-taxa="${plano?.taxa_pedido_centavos || 0}">
            ${csrfInput(ctx)}<input type="hidden" name="produto_id" value="${p.id}">
            <label>Seu preço de venda (R$)<input name="preco" value="${centsToInput(preco)}" inputmode="decimal" data-calc-preco required></label>
            <div class="calc-res">Lucro por unidade (antes do frete): <strong data-calc-lucro>—</strong> · Margem: <strong data-calc-margem>—</strong></div>
            <button class="btn btn-primario">${p.na_loja ? 'Atualizar preço na minha loja' : 'Adicionar à minha loja'}</button>
          </form>
          <p class="muted pequeno">O frete é cobrado à parte, conforme o CEP de destino${plano?.taxa_pedido_centavos ? `, e há taxa de ${brl(plano.taxa_pedido_centavos)} por pedido no seu plano` : ''}.</p>
        </div>
      </div>
      <script src="/static/app.js" defer></script>`));
  });

  // ---------- minha loja ----------
  r.post('/painel/loja/adicionar', exigirLojista, (ctx) => {
    const u = ctx.user;
    const plano = S.planoAtivo(db, u);
    if (!plano) { ctx.flash('erro', 'Assine um plano para adicionar produtos.'); return ctx.redirect('/painel/plano'); }
    const p = db.prepare('SELECT * FROM produtos WHERE id = ? AND ativo = 1').get(Number(ctx.body.produto_id));
    if (!p) return ctx.notFound();
    const preco = ctx.body.preco !== undefined ? toCentavos(ctx.body.preco) : p.preco_sugerido_centavos;
    if (!Number.isInteger(preco) || preco < p.custo_centavos) {
      ctx.flash('erro', `O preço de venda não pode ser menor que o custo (${brl(p.custo_centavos)}).`);
      return ctx.redirect(`/painel/produto/${p.id}`);
    }
    const existe = db.prepare('SELECT id FROM loja_produtos WHERE user_id = ? AND produto_id = ?').get(u.id, p.id);
    if (existe) {
      db.prepare('UPDATE loja_produtos SET preco_venda_centavos = ? WHERE id = ?').run(preco, existe.id);
      ctx.flash('ok', `Preço de "${p.nome}" atualizado para ${brl(preco)}.`);
    } else {
      const n = db.prepare('SELECT COUNT(*) n FROM loja_produtos WHERE user_id = ?').get(u.id).n;
      if (plano.limite_produtos && n >= plano.limite_produtos) {
        ctx.flash('erro', `Seu plano ${plano.nome} permite até ${plano.limite_produtos} produtos na loja. Faça upgrade para adicionar mais.`);
        return ctx.redirect('/painel/plano');
      }
      db.prepare('INSERT INTO loja_produtos (user_id, produto_id, preco_venda_centavos) VALUES (?,?,?)').run(u.id, p.id, preco);
      ctx.flash('ok', `"${p.nome}" adicionado à sua loja por ${brl(preco)}.`);
    }
    // Volta para a página de origem (apenas caminhos internos do catálogo).
    let volta = '/painel/catalogo';
    try {
      const ref = new URL(ctx.req.headers.referer || '', 'http://x');
      if (ref.pathname.startsWith('/painel/produto/')) volta = '/painel/loja';
      else if (ref.pathname === '/painel/catalogo') volta = ref.pathname + ref.search;
    } catch { /* referer ausente ou inválido */ }
    ctx.redirect(volta);
  });

  r.get('/painel/loja', exigirLojista, (ctx) => {
    const itens = db.prepare(`SELECT lp.*, p.nome, p.sku, p.emoji, p.cor, p.custo_centavos, p.preco_sugerido_centavos, p.estoque, p.ativo prod_ativo
      FROM loja_produtos lp JOIN produtos p ON p.id = lp.produto_id WHERE lp.user_id = ? ORDER BY p.nome`).all(ctx.user.id);
    ctx.html(paginaPainel(ctx, 'Minha loja', html`
      ${avisoPlano(db, ctx.user)}
      <div class="linha-entre"><p class="muted">${itens.length} produto(s) na sua loja. Eles aparecem na sua vitrine e podem ser usados nos pedidos.</p>
        <a class="btn btn-sm" href="/loja/${ctx.user.loja_slug}" target="_blank" rel="noopener">Ver vitrine ↗</a></div>
      ${itens.length ? html`<div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Produto</th><th>Custo</th><th>Seu preço</th><th>Lucro</th><th>Estoque</th><th>Vitrine</th><th></th></tr></thead>
        <tbody>${itens.map((i) => html`<tr class="${i.prod_ativo ? '' : 'inativo'}">
          <td><div class="produto-mini">${thumb(i, 'mini')}<div><strong>${i.nome}</strong><div class="muted pequeno">${i.sku}${i.prod_ativo ? '' : ' · indisponível no catálogo'}</div></div></div></td>
          <td>${brl(i.custo_centavos)}</td>
          <td><form method="post" action="/painel/loja/${i.id}/editar" class="inline">${csrfInput(ctx)}<input name="preco" value="${centsToInput(i.preco_venda_centavos)}" class="input-preco" inputmode="decimal"><button class="btn btn-sm">Salvar</button></form></td>
          <td class="verde">${brl(i.preco_venda_centavos - i.custo_centavos)} <span class="muted pequeno">(${margem(i.custo_centavos, i.preco_venda_centavos)}%)</span></td>
          <td class="${i.estoque < 20 ? 'vermelho' : ''}">${i.estoque}</td>
          <td><form method="post" action="/painel/loja/${i.id}/alternar">${csrfInput(ctx)}<button class="btn btn-sm ${i.ativo ? '' : 'btn-fantasma'}">${i.ativo ? 'Visível' : 'Oculto'}</button></form></td>
          <td><form method="post" action="/painel/loja/${i.id}/remover" data-confirmar="Remover este produto da sua loja?">${csrfInput(ctx)}<button class="btn btn-sm btn-perigo" title="Remover">✕</button></form></td>
        </tr>`)}</tbody></table></div>` : vazio('Sua loja ainda não tem produtos.', html`<a class="btn btn-primario" href="/painel/catalogo">Escolher produtos no catálogo</a>`)}
      <script src="/static/app.js" defer></script>`));
  });

  const itemDaLoja = (ctx) => db.prepare(`SELECT lp.*, p.custo_centavos, p.nome FROM loja_produtos lp JOIN produtos p ON p.id = lp.produto_id
    WHERE lp.id = ? AND lp.user_id = ?`).get(Number(ctx.params.id), ctx.user.id);

  r.post('/painel/loja/:id/editar', exigirLojista, (ctx) => {
    const i = itemDaLoja(ctx);
    if (!i) return ctx.notFound();
    const preco = toCentavos(ctx.body.preco);
    if (!Number.isInteger(preco) || preco < i.custo_centavos) ctx.flash('erro', `O preço não pode ser menor que o custo (${brl(i.custo_centavos)}).`);
    else { db.prepare('UPDATE loja_produtos SET preco_venda_centavos = ? WHERE id = ?').run(preco, i.id); ctx.flash('ok', `Preço de "${i.nome}" atualizado.`); }
    ctx.redirect('/painel/loja');
  });
  r.post('/painel/loja/:id/alternar', exigirLojista, (ctx) => {
    const i = itemDaLoja(ctx);
    if (!i) return ctx.notFound();
    db.prepare('UPDATE loja_produtos SET ativo = 1 - ativo WHERE id = ?').run(i.id);
    ctx.redirect('/painel/loja');
  });
  r.post('/painel/loja/:id/remover', exigirLojista, (ctx) => {
    const i = itemDaLoja(ctx);
    if (!i) return ctx.notFound();
    db.prepare('DELETE FROM loja_produtos WHERE id = ?').run(i.id);
    ctx.flash('ok', `"${i.nome}" removido da sua loja.`);
    ctx.redirect('/painel/loja');
  });

  // ---------- pedidos ----------
  r.get('/painel/pedidos', exigirLojista, (ctx) => {
    const st = S.STATUS[ctx.query.status] ? ctx.query.status : '';
    const q = (ctx.query.q || '').trim();
    const pagina = Math.max(1, Number(ctx.query.pagina) || 1);
    const where = `user_id = ? AND (? = '' OR status = ?) AND (? = '' OR codigo LIKE ? OR cliente_nome LIKE ?)`;
    const args = [ctx.user.id, st, st, q, `%${q}%`, `%${q}%`];
    const total = db.prepare(`SELECT COUNT(*) n FROM pedidos WHERE ${where}`).get(...args).n;
    const pedidos = db.prepare(`SELECT * FROM pedidos WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, POR_PAGINA, (pagina - 1) * POR_PAGINA);
    ctx.html(paginaPainel(ctx, 'Pedidos', html`
      <div class="linha-entre">
        <form class="filtros" method="get">
          <input type="search" name="q" value="${q}" placeholder="Código ou cliente…">
          <select name="status"><option value="">Todos os status</option>${Object.entries(S.STATUS).map(([k, v]) => html`<option value="${k}" ${k === st ? 'selected' : ''}>${v.rotulo}</option>`)}</select>
          <button class="btn">Filtrar</button>
        </form>
        <a class="btn btn-primario" href="/painel/pedidos/novo">+ Novo pedido</a>
      </div>
      ${pedidos.length ? tabelaPedidos(pedidos) : vazio('Nenhum pedido encontrado.')}
      ${paginacao(ctx, total, POR_PAGINA, pagina)}`));
  });

  function formNovoPedido(ctx, v = {}, erro = '') {
    const itensLoja = db.prepare(`SELECT p.id, p.nome, p.sku, p.estoque, p.custo_centavos, p.peso_g, lp.preco_venda_centavos FROM loja_produtos lp
      JOIN produtos p ON p.id = lp.produto_id WHERE lp.user_id = ? AND p.ativo = 1 ORDER BY p.nome`).all(ctx.user.id);
    const sel = new Map((v.itens || []).map((i) => [Number(i.produto_id), i.qtd]));
    return paginaPainel(ctx, 'Novo pedido', html`
      ${avisoPlano(db, ctx.user)}
      <p class="muted">Use para pedidos vindos de marketplaces, redes sociais ou WhatsApp. O custo (produtos + frete + taxa) é debitado da sua carteira.</p>
      ${erro ? html`<div class="flash flash-erro">${erro}</div>` : ''}
      ${!itensLoja.length ? vazio('Adicione produtos à sua loja antes de lançar pedidos.', html`<a class="btn btn-primario" href="/painel/catalogo">Ir ao catálogo</a>`) : html`
      <form method="post" action="/painel/pedidos" class="form" id="form-pedido">
        ${csrfInput(ctx)}
        <div class="card">
          <h3>1. Produtos</h3>
          <div class="tabela-wrap"><table class="tabela">
            <thead><tr><th>Produto</th><th>Preço de venda</th><th>Custo</th><th>Estoque</th><th style="width:110px">Qtd.</th></tr></thead>
            <tbody>${itensLoja.map((p) => html`<tr>
              <td><strong>${p.nome}</strong><div class="muted pequeno">${p.sku}</div></td>
              <td>${brl(p.preco_venda_centavos)}</td><td>${brl(p.custo_centavos)}</td><td>${p.estoque}</td>
              <td><input type="number" min="0" max="${p.estoque}" name="qtd_${p.id}" value="${sel.get(p.id) || 0}" class="input-qtd"
                data-preco="${p.preco_venda_centavos}" data-custo="${p.custo_centavos}" data-peso="${p.peso_g}"></td>
            </tr>`)}</tbody></table></div>
        </div>
        <div class="card">
          <h3>2. Cliente e endereço de entrega</h3>
          <div class="form-duplo">
            <label>Nome do cliente<input name="cliente_nome" required value="${v.cliente_nome || ''}"></label>
            <label>CPF do cliente (opcional)<input name="cliente_documento" value="${v.cliente_documento || ''}" data-mascara="documento"></label>
            <label>E-mail (opcional)<input type="email" name="cliente_email" value="${v.cliente_email || ''}"></label>
            <label>Telefone (opcional)<input name="cliente_telefone" value="${v.cliente_telefone || ''}" data-mascara="telefone"></label>
          </div>
          ${camposEndereco(v)}
          <label>Referência externa (opcional)<input name="referencia_externa" value="${v.referencia_externa || ''}" placeholder="Nº do pedido no marketplace"></label>
        </div>
        <div class="card resumo-pedido" data-resumo>
          <h3>3. Resumo</h3>
          <dl class="resumo">
            <div><dt>Venda ao cliente</dt><dd data-r-venda>—</dd></div>
            <div><dt>Custo dos produtos</dt><dd data-r-custo>—</dd></div>
            <div><dt>Frete (estimado pelo CEP)</dt><dd data-r-frete>informe o CEP</dd></div>
            <div><dt>Taxa do plano</dt><dd data-r-taxa data-taxa="${S.planoAtivo(db, ctx.user)?.taxa_pedido_centavos || 0}">—</dd></div>
            <div class="total"><dt>Débito na carteira</dt><dd data-r-total>—</dd></div>
            <div class="total"><dt>Seu lucro</dt><dd data-r-lucro class="verde">—</dd></div>
          </dl>
          <p class="muted pequeno">Saldo atual: ${brl(ctx.user.saldo_centavos)}. Sem saldo suficiente, o pedido fica aguardando pagamento.</p>
          <button class="btn btn-primario btn-grande">Criar pedido</button>
        </div>
      </form>`}
      <script>window.FRETE = ${raw(JSON.stringify(Object.fromEntries(Object.entries(S.FAIXAS_FRETE).map(([k, f]) => [k, f.base]))).replace(/</g, '\\u003c'))};</script>
      <script src="/static/app.js" defer></script>`);
  }

  r.get('/painel/pedidos/novo', exigirLojista, (ctx) => ctx.html(formNovoPedido(ctx)));

  r.post('/painel/pedidos', exigirLojista, (ctx) => {
    const b = ctx.body;
    const itens = Object.entries(b).filter(([k, v]) => k.startsWith('qtd_') && Number(v) > 0)
      .map(([k, v]) => ({ produto_id: Number(k.slice(4)), qtd: Number(v) }));
    const dados = { ...b, itens };
    try {
      const p = S.criarPedido(db, ctx.user.id, dados, 'manual');
      ctx.flash(p.status === 'pago' ? 'ok' : 'aviso', p.status === 'pago'
        ? `Pedido ${p.codigo} criado e pago. ${brl(p.total_custo_centavos)} debitados da carteira.`
        : `Pedido ${p.codigo} criado, aguardando pagamento: recarregue ${brl(p.total_custo_centavos - db.prepare('SELECT saldo_centavos s FROM users WHERE id = ?').get(ctx.user.id).s)} ou mais para liberá-lo.`);
      ctx.redirect(`/painel/pedidos/${p.codigo}`);
    } catch (e) {
      if (!e.negocio) throw e;
      ctx.html(formNovoPedido(ctx, dados, e.message), e.status);
    }
  });

  const pedidoDoUser = (ctx) => db.prepare('SELECT * FROM pedidos WHERE codigo = ? AND user_id = ?').get(ctx.params.codigo, ctx.user.id);

  r.get('/painel/pedidos/:codigo', exigirLojista, (ctx) => {
    const p = pedidoDoUser(ctx);
    if (!p) return ctx.notFound();
    ctx.html(paginaPainel(ctx, `Pedido ${p.codigo}`, detalhePedido(db, ctx, p, { base: '/painel/pedidos' })));
  });

  r.post('/painel/pedidos/:codigo/pagar', exigirLojista, (ctx) => {
    const p = pedidoDoUser(ctx);
    if (!p) return ctx.notFound();
    try { S.pagarPedido(db, p.id); ctx.flash('ok', 'Pedido pago com o saldo da carteira.'); } catch (e) { if (!e.negocio) throw e; ctx.flash('erro', e.message); }
    ctx.redirect(`/painel/pedidos/${p.codigo}`);
  });

  r.post('/painel/pedidos/:codigo/cancelar', exigirLojista, (ctx) => {
    const p = pedidoDoUser(ctx);
    if (!p) return ctx.notFound();
    try { S.cancelarPedido(db, p.id); ctx.flash('ok', p.status === 'pago' ? 'Pedido cancelado e valor estornado à carteira.' : 'Pedido cancelado.'); } catch (e) { if (!e.negocio) throw e; ctx.flash('erro', e.message); }
    ctx.redirect(`/painel/pedidos/${p.codigo}`);
  });

  // ---------- carteira ----------
  r.get('/painel/carteira', exigirLojista, (ctx) => {
    const pagina = Math.max(1, Number(ctx.query.pagina) || 1);
    const total = db.prepare('SELECT COUNT(*) n FROM transacoes WHERE user_id = ?').get(ctx.user.id).n;
    const trans = db.prepare('SELECT * FROM transacoes WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?').all(ctx.user.id, POR_PAGINA, (pagina - 1) * POR_PAGINA);
    const pend = db.prepare("SELECT COALESCE(SUM(total_custo_centavos),0) s, COUNT(*) n FROM pedidos WHERE user_id = ? AND status = 'aguardando_pagamento'").get(ctx.user.id);
    ctx.html(paginaPainel(ctx, 'Carteira', html`
      <div class="kpis">
        <div class="card kpi"><span>Saldo disponível</span><strong>${brl(ctx.user.saldo_centavos)}</strong></div>
        <div class="card kpi"><span>Pedidos aguardando pagamento</span><strong>${pend.n} · ${brl(pend.s)}</strong></div>
      </div>
      <div class="card">
        <h3>Adicionar saldo via Pix</h3>
        <form method="post" action="/painel/carteira/recarga" class="form inline-form">
          ${csrfInput(ctx)}
          <div class="atalhos">${[5000, 10000, 20000, 50000].map((v) => html`<button type="button" class="btn btn-sm" data-valor="${centsToInput(v)}">${brl(v)}</button>`)}</div>
          <label>Valor (R$)<input name="valor" inputmode="decimal" required placeholder="100,00" value="${pend.s > ctx.user.saldo_centavos ? centsToInput(Math.max(1000, pend.s - ctx.user.saldo_centavos)) : ''}" id="valor-recarga"></label>
          <button class="btn btn-primario">Gerar Pix</button>
        </form>
        <p class="muted pequeno">O saldo é creditado assim que o pagamento for confirmado. Pedidos aguardando pagamento são liberados automaticamente.</p>
      </div>
      <div class="card">
        <h3>Extrato</h3>
        ${trans.length ? html`<div class="tabela-wrap"><table class="tabela">
          <thead><tr><th>Data</th><th>Descrição</th><th>Status</th><th class="dir">Valor</th></tr></thead>
          <tbody>${trans.map((t) => html`<tr>
            <td class="pequeno">${dataBR(t.criado_em)}</td>
            <td>${t.descricao}${t.tipo === 'recarga' && t.status === 'pendente' ? html` · <a href="/painel/carteira/recarga/${t.id}">ver Pix</a>` : ''}</td>
            <td><span class="badge badge-${t.status === 'confirmada' ? 'green' : t.status === 'pendente' ? 'amber' : 'gray'}">${t.status}</span></td>
            <td class="dir ${t.valor_centavos >= 0 ? 'verde' : 'vermelho'}">${t.valor_centavos >= 0 ? '+' : '−'} ${brl(Math.abs(t.valor_centavos))}</td>
          </tr>`)}</tbody></table></div>` : vazio('Nenhuma movimentação ainda.')}
        ${paginacao(ctx, total, POR_PAGINA, pagina)}
      </div>
      <script src="/static/app.js" defer></script>`));
  });

  r.post('/painel/carteira/recarga', exigirLojista, (ctx) => {
    try {
      const id = S.criarRecarga(db, ctx.user.id, toCentavos(ctx.body.valor));
      ctx.redirect(`/painel/carteira/recarga/${id}`);
    } catch (e) {
      if (!e.negocio) throw e;
      ctx.flash('erro', e.message);
      ctx.redirect('/painel/carteira');
    }
  });

  r.get('/painel/carteira/recarga/:id', exigirLojista, (ctx) => {
    const t = db.prepare("SELECT * FROM transacoes WHERE id = ? AND user_id = ? AND tipo = 'recarga'").get(Number(ctx.params.id), ctx.user.id);
    if (!t) return ctx.notFound();
    ctx.html(paginaPainel(ctx, 'Pagamento via Pix', html`<div class="card estreito centro">
      <h2>${brl(t.valor_centavos)}</h2>
      ${t.status === 'confirmada' ? html`<div class="flash flash-ok">Pagamento confirmado. Saldo creditado!</div><a class="btn" href="/painel/carteira">Voltar à carteira</a>` : html`
        <div class="qr-falso" aria-label="QR Code ilustrativo">▦</div>
        <p>Copie o código Pix abaixo e pague no app do seu banco:</p>
        <div class="copiar"><input readonly value="${t.pix_codigo}" id="pix"><button class="btn btn-sm" data-copiar="pix">Copiar</button></div>
        ${config.PAGAMENTO_MODO === 'simulado' ? html`<div class="aviso">Ambiente de demonstração: nenhum valor real é cobrado.</div>
          <form method="post" action="/painel/carteira/recarga/${t.id}/simular">${csrfInput(ctx)}<button class="btn btn-primario">Simular pagamento confirmado</button></form>`
          : html`<p class="muted pequeno">Após o pagamento, a confirmação pode levar alguns minutos. Atualize esta página.</p>`}`}
    </div><script src="/static/app.js" defer></script>`));
  });

  r.post('/painel/carteira/recarga/:id/simular', exigirLojista, (ctx) => {
    if (config.PAGAMENTO_MODO !== 'simulado') return ctx.notFound();
    const t = db.prepare("SELECT * FROM transacoes WHERE id = ? AND user_id = ? AND tipo = 'recarga'").get(Number(ctx.params.id), ctx.user.id);
    if (!t) return ctx.notFound();
    S.confirmarRecarga(db, t.id);
    recarregarUser(ctx);
    const pend = db.prepare("SELECT COUNT(*) n FROM pedidos WHERE user_id = ? AND status = 'aguardando_pagamento'").get(ctx.user.id).n;
    ctx.flash('ok', `Recarga de ${brl(t.valor_centavos)} confirmada.${pend ? ` Ainda há ${pend} pedido(s) aguardando saldo.` : ''}`);
    ctx.redirect('/painel/carteira');
  });

  // ---------- plano ----------
  r.get('/painel/plano', exigirLojista, (ctx) => {
    const u = ctx.user;
    const atual = S.planoAtivo(db, u);
    const planos = db.prepare('SELECT * FROM planos ORDER BY preco_centavos').all();
    ctx.html(paginaPainel(ctx, 'Plano', html`
      <div class="card">
        ${atual ? html`<p>Plano atual: <strong>${atual.nome}</strong> · válido até <strong>${dataBR(u.plano_valido_ate)}</strong></p>`
          : html`<p><strong>Nenhum plano ativo.</strong> Escolha um plano abaixo para continuar vendendo.</p>`}
        <p class="muted pequeno">A assinatura é paga com o saldo da carteira (${brl(u.saldo_centavos)}). Renovar o mesmo plano soma 30 dias; trocar de plano começa a valer imediatamente.</p>
      </div>
      ${cardsPlanos(planos, { acao: (p) => html`<form method="post" action="/painel/plano/assinar">${csrfInput(ctx)}<input type="hidden" name="plano_id" value="${p.id}">
        <button class="btn btn-bloco ${p.nome === 'Pro' ? 'btn-primario' : ''}">${atual?.id === p.id ? 'Renovar por 30 dias' : `Assinar ${p.nome}`}</button></form>` })}`));
  });

  r.post('/painel/plano/assinar', exigirLojista, (ctx) => {
    try {
      const { plano, ate } = S.assinar(db, ctx.user.id, Number(ctx.body.plano_id));
      ctx.flash('ok', `Plano ${plano.nome} ativo até ${ate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`);
      ctx.redirect('/painel/plano');
    } catch (e) {
      if (!e.negocio) throw e;
      ctx.flash('erro', e.message);
      ctx.redirect(e.status === 402 ? '/painel/carteira' : '/painel/plano');
    }
  });

  // ---------- integrações ----------
  r.get('/painel/integracoes', exigirLojista, (ctx) => {
    const u = ctx.user;
    const plano = S.planoAtivo(db, u);
    const base = config.BASE_URL;
    ctx.html(paginaPainel(ctx, 'Integrações', html`
      ${!plano?.acesso_api ? html`<div class="aviso">A API e os webhooks estão disponíveis nos planos Pro e Premium. <a href="/painel/plano">Fazer upgrade →</a></div>` : ''}
      <div class="card">
        <h3>Chave de API</h3>
        <div class="copiar"><input readonly value="${u.api_key}" id="api-key" type="password" data-revelar><button class="btn btn-sm" data-copiar="api-key">Copiar</button></div>
        <form method="post" action="/painel/integracoes/nova-chave" data-confirmar="Gerar nova chave? A chave atual deixará de funcionar imediatamente.">${csrfInput(ctx)}<button class="btn btn-sm btn-perigo">Gerar nova chave</button></form>
      </div>
      <div class="card">
        <h3>Webhook</h3>
        <p class="muted">Enviaremos um <code>POST</code> para esta URL (HTTPS) a cada mudança de status de pedido, com o cabeçalho <code>X-Assinatura: sha256=HMAC(corpo, sua_chave_api)</code>.</p>
        <form method="post" action="/painel/integracoes/webhook" class="form inline-form">${csrfInput(ctx)}
          <label>URL<input type="url" name="webhook_url" value="${u.webhook_url}" placeholder="https://sualoja.com.br/webhooks/dropship" pattern="https://.*"></label>
          <button class="btn">Salvar</button></form>
      </div>
      <div class="card documento">
        <h3>API REST — referência rápida</h3>
        <p>Autentique com o cabeçalho <code>Authorization: Bearer SUA_CHAVE</code>. Valores monetários em centavos.</p>
        <table class="tabela"><tbody>
          <tr><td><code>GET /api/v1/produtos</code></td><td>Catálogo com custo, preço sugerido e estoque</td></tr>
          <tr><td><code>GET /api/v1/frete?cep=01001000&amp;itens=ELE-001:2</code></td><td>Cotação de frete</td></tr>
          <tr><td><code>POST /api/v1/pedidos</code></td><td>Cria pedido (debita a carteira)</td></tr>
          <tr><td><code>GET /api/v1/pedidos</code></td><td>Lista seus pedidos (<code>?status=</code>)</td></tr>
          <tr><td><code>GET /api/v1/pedidos/{codigo}</code></td><td>Consulta pedido e rastreio</td></tr>
          <tr><td><code>POST /api/v1/pedidos/{codigo}/cancelar</code></td><td>Cancela (antes da separação) com estorno</td></tr>
        </tbody></table>
        <h4>Exemplo — criar pedido</h4>
<pre><code>curl -X POST ${base}/api/v1/pedidos \\
  -H "Authorization: Bearer SUA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "referencia_externa": "LOJA-1001",
    "cliente": { "nome": "Maria Silva", "email": "maria@email.com", "telefone": "21999990000" },
    "endereco": { "cep": "28890000", "logradouro": "Rua das Flores", "numero": "10",
                  "bairro": "Centro", "cidade": "Rio das Ostras", "uf": "RJ" },
    "itens": [ { "sku": "ELE-001", "qtd": 1, "preco_unit_centavos": 8990 } ]
  }'</code></pre>
      </div>
      <script src="/static/app.js" defer></script>`));
  });

  r.post('/painel/integracoes/nova-chave', exigirLojista, (ctx) => {
    db.prepare('UPDATE users SET api_key = ? WHERE id = ?').run('dk_' + token(24), ctx.user.id);
    ctx.flash('ok', 'Nova chave de API gerada.');
    ctx.redirect('/painel/integracoes');
  });

  r.post('/painel/integracoes/webhook', exigirLojista, (ctx) => {
    const url = String(ctx.body.webhook_url || '').trim();
    if (url && !/^https:\/\/[^\s]+$/.test(url)) { ctx.flash('erro', 'A URL do webhook deve começar com https://'); return ctx.redirect('/painel/integracoes'); }
    db.prepare('UPDATE users SET webhook_url = ? WHERE id = ?').run(url.slice(0, 300), ctx.user.id);
    ctx.flash('ok', url ? 'Webhook salvo.' : 'Webhook removido.');
    ctx.redirect('/painel/integracoes');
  });

  // ---------- configurações ----------
  r.get('/painel/configuracoes', exigirLojista, (ctx) => {
    const u = ctx.user;
    ctx.html(paginaPainel(ctx, 'Configurações', html`
      <form method="post" action="/painel/configuracoes" class="form card">
        ${csrfInput(ctx)}
        <h3>Sua loja</h3>
        <div class="form-duplo">
          <label>Nome da loja<input name="loja_nome" required maxlength="60" value="${u.loja_nome}"></label>
          <label>Endereço da vitrine<div class="prefixo"><span>/loja/</span><input name="loja_slug" required maxlength="40" pattern="[a-z0-9-]+" value="${u.loja_slug}"></div></label>
          <label>Cor principal<input type="color" name="loja_cor" value="${u.loja_cor}"></label>
        </div>
        <h3>Seus dados</h3>
        <div class="form-duplo">
          <label>Nome<input name="nome" required value="${u.nome}"></label>
          <label>Telefone<input name="telefone" value="${u.telefone}" data-mascara="telefone"></label>
          <label>E-mail<input value="${u.email}" disabled></label>
          <label>CPF/CNPJ<input value="${u.documento}" disabled></label>
        </div>
        <button class="btn btn-primario">Salvar</button>
      </form>
      <form method="post" action="/painel/configuracoes/senha" class="form card">
        ${csrfInput(ctx)}
        <h3>Alterar senha</h3>
        <div class="form-duplo">
          <label>Senha atual<input type="password" name="atual" required autocomplete="current-password"></label>
          <label>Nova senha<input type="password" name="nova" required minlength="8" autocomplete="new-password"></label>
        </div>
        <button class="btn">Alterar senha</button>
      </form>
      <script src="/static/app.js" defer></script>`));
  });

  r.post('/painel/configuracoes', exigirLojista, (ctx) => {
    const b = ctx.body;
    const slug = slugify(b.loja_slug || '');
    const cor = /^#[0-9a-fA-F]{6}$/.test(b.loja_cor || '') ? b.loja_cor : ctx.user.loja_cor;
    if (!slug || !String(b.loja_nome || '').trim() || !String(b.nome || '').trim()) { ctx.flash('erro', 'Preencha os campos obrigatórios.'); return ctx.redirect('/painel/configuracoes'); }
    if (db.prepare('SELECT 1 FROM users WHERE loja_slug = ? AND id <> ?').get(slug, ctx.user.id)) { ctx.flash('erro', 'Este endereço de vitrine já está em uso.'); return ctx.redirect('/painel/configuracoes'); }
    db.prepare('UPDATE users SET loja_nome = ?, loja_slug = ?, loja_cor = ?, nome = ?, telefone = ? WHERE id = ?')
      .run(String(b.loja_nome).trim().slice(0, 60), slug, cor, String(b.nome).trim().slice(0, 120), String(b.telefone || '').replace(/\D/g, '').slice(0, 13), ctx.user.id);
    ctx.flash('ok', 'Configurações salvas.');
    ctx.redirect('/painel/configuracoes');
  });

  r.post('/painel/configuracoes/senha', exigirLojista, (ctx) => {
    const { verificarSenha, hashSenha } = require('../auth');
    if (!verificarSenha(ctx.body.atual || '', ctx.user.senha_hash)) ctx.flash('erro', 'Senha atual incorreta.');
    else if (String(ctx.body.nova || '').length < 8) ctx.flash('erro', 'A nova senha deve ter pelo menos 8 caracteres.');
    else {
      db.prepare('UPDATE users SET senha_hash = ? WHERE id = ?').run(hashSenha(ctx.body.nova), ctx.user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(ctx.user.id, ctx.session.token);
      ctx.flash('ok', 'Senha alterada. Outras sessões foram encerradas.');
    }
    ctx.redirect('/painel/configuracoes');
  });
};

function camposEndereco(v = {}) {
  return html`<div class="form-endereco">
    <label>CEP<input name="cep" required value="${v.cep || ''}" inputmode="numeric" data-mascara="cep" data-cep></label>
    <label class="span2">Endereço<input name="logradouro" required value="${v.logradouro || ''}" data-cep-campo="logradouro"></label>
    <label>Número<input name="numero" required value="${v.numero || ''}"></label>
    <label>Complemento<input name="complemento" value="${v.complemento || ''}"></label>
    <label>Bairro<input name="bairro" required value="${v.bairro || ''}" data-cep-campo="bairro"></label>
    <label>Cidade<input name="cidade" required value="${v.cidade || ''}" data-cep-campo="localidade"></label>
    <label>UF<select name="uf" required data-cep-campo="uf"><option value="">—</option>${UFS.map((uf) => html`<option ${String(v.uf || '').toUpperCase() === uf ? 'selected' : ''}>${uf}</option>`)}</select></label>
  </div>`;
}

function detalhePedido(db, ctx, p, { base, admin = false } = {}) {
  const itens = db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(p.id);
  const eventos = db.prepare('SELECT * FROM pedido_eventos WHERE pedido_id = ? ORDER BY id DESC').all(p.id);
  const lojista = admin ? db.prepare('SELECT nome, loja_nome, email, saldo_centavos FROM users WHERE id = ?').get(p.user_id) : null;
  return html`
    <p><a href="${base}">← Voltar aos pedidos</a></p>
    <div class="pedido-grid">
      <div>
        <div class="card">
          <div class="linha-entre"><h3>Itens</h3>${badgeStatus(p.status)}</div>
          <div class="tabela-wrap"><table class="tabela">
            <thead><tr><th>Produto</th><th>Qtd.</th><th>Preço de venda</th><th>Custo</th></tr></thead>
            <tbody>${itens.map((i) => html`<tr><td>${i.nome}<div class="muted pequeno">${i.sku}</div></td><td>${i.qtd}</td><td>${brl(i.preco_unit_centavos)}</td><td>${brl(i.custo_unit_centavos)}</td></tr>`)}</tbody>
          </table></div>
          <dl class="resumo">
            <div><dt>Venda ao cliente</dt><dd>${brl(p.venda_centavos)}</dd></div>
            <div><dt>Custo dos produtos</dt><dd>${brl(p.custo_produtos_centavos)}</dd></div>
            <div><dt>Frete</dt><dd>${brl(p.frete_centavos)}</dd></div>
            <div><dt>Taxa do plano</dt><dd>${brl(p.taxa_centavos)}</dd></div>
            <div class="total"><dt>Total debitado</dt><dd>${brl(p.total_custo_centavos)}</dd></div>
            ${!admin ? html`<div class="total"><dt>Lucro</dt><dd class="${p.venda_centavos - p.total_custo_centavos >= 0 ? 'verde' : 'vermelho'}">${brl(p.venda_centavos - p.total_custo_centavos)}</dd></div>` : ''}
          </dl>
        </div>
        <div class="card">
          <h3>Histórico</h3>
          <ol class="linha-tempo">${eventos.map((e) => html`<li>${badgeStatus(e.status)} <span class="muted pequeno">${dataBR(e.criado_em)}</span>${e.nota ? html`<div class="pequeno">${e.nota}</div>` : ''}</li>`)}</ol>
        </div>
      </div>
      <div>
        <div class="card">
          <h3>Ações</h3>
          ${p.rastreio ? html`<p>Rastreio: <strong>${p.rastreio}</strong></p>` : ''}
          ${!admin && p.status === 'aguardando_pagamento' ? html`<form method="post" action="${base}/${p.codigo}/pagar">${csrfInput(ctx)}<button class="btn btn-primario btn-bloco">Pagar com saldo (${brl(ctx.user.saldo_centavos)})</button></form>
            <p class="pequeno"><a href="/painel/carteira">Recarregar carteira</a></p>` : ''}
          ${admin && ['pago', 'em_separacao', 'enviado'].includes(p.status) ? html`<form method="post" action="${base}/${p.codigo}/avancar" class="form">${csrfInput(ctx)}
            ${p.status === 'em_separacao' ? html`<label>Código de rastreio<input name="rastreio" required minlength="6" placeholder="AA123456789BR"></label>` : ''}
            <button class="btn btn-primario btn-bloco">Avançar para: ${S.STATUS[{ pago: 'em_separacao', em_separacao: 'enviado', enviado: 'entregue' }[p.status]].rotulo}</button></form>` : ''}
          ${(admin ? ['aguardando_pagamento', 'pago', 'em_separacao'] : ['aguardando_pagamento', 'pago']).includes(p.status)
            ? html`<form method="post" action="${base}/${p.codigo}/cancelar" data-confirmar="Cancelar este pedido?${p.status !== 'aguardando_pagamento' ? ' O valor será estornado à carteira.' : ''}">${csrfInput(ctx)}<button class="btn btn-perigo btn-bloco">Cancelar pedido</button></form>` : ''}
          <p class="pequeno"><a href="/rastreio?codigo=${p.codigo}" target="_blank" rel="noopener">Página pública de rastreio ↗</a></p>
        </div>
        ${lojista ? html`<div class="card"><h3>Lojista</h3><p>${lojista.loja_nome}<br><span class="muted pequeno">${lojista.nome} · ${lojista.email}</span><br>Saldo: ${brl(lojista.saldo_centavos)}</p></div>` : ''}
        <div class="card">
          <h3>Entrega</h3>
          <p><strong>${p.cliente_nome}</strong>${p.cliente_documento ? html`<br><span class="muted pequeno">CPF/CNPJ ${p.cliente_documento}</span>` : ''}</p>
          <p>${p.logradouro}, ${p.numero}${p.complemento ? ` — ${p.complemento}` : ''}<br>${p.bairro} · ${p.cidade}/${p.uf}<br>CEP ${p.cep.replace(/(\d{5})(\d{3})/, '$1-$2')}</p>
          ${p.cliente_telefone || p.cliente_email ? html`<p class="pequeno">${p.cliente_telefone} ${p.cliente_email}</p>` : ''}
          <p class="muted pequeno">Origem: ${p.origem}${p.referencia_externa ? ` · Ref.: ${p.referencia_externa}` : ''} · Criado em ${dataBR(p.criado_em)}</p>
        </div>
      </div>
    </div>
    <script src="/static/app.js" defer></script>`;
}

module.exports.detalhePedido = detalhePedido;
module.exports.camposEndereco = camposEndereco;
module.exports.tabelaPedidos = tabelaPedidos;
