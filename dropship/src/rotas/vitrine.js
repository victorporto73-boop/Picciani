// Vitrine pública de cada lojista: /loja/:slug — catálogo, carrinho (cookie) e checkout.
'use strict';

const { html, raw, cookie } = require('../http');
const { head, thumb, csrfInput, vazio, flashHtml, badgeStatus } = require('../views/layout');
const { brl, soDigitos, dataBR } = require('../util');
const S = require('../servicos');
const { camposEndereco } = require('./painel');
const config = require('../config');

function formatarDocumento(d) {
  d = soDigitos(d);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d;
}

function paginaLoja(ctx, loja, titulo, conteudo, nCarrinho = 0) {
  const cor = /^#[0-9a-fA-F]{6}$/.test(loja.loja_cor) ? loja.loja_cor : '#4f46e5';
  const base = `/loja/${loja.loja_slug}`;
  return html`${head(titulo ? `${titulo} · ${loja.loja_nome}` : loja.loja_nome, html`<style>:root{--primaria:${raw(cor)}}</style>`)}
<body class="vitrine">
<header class="topo">
  <div class="container topo-inner">
    <a class="logo" href="${base}">${loja.loja_nome}</a>
    <a class="btn btn-sm carrinho-btn" href="${base}/carrinho">🛒 Carrinho${nCarrinho ? html` <span class="contador">${nCarrinho}</span>` : ''}</a>
  </div>
</header>
<main class="container secao-curta">
  ${flashHtml(ctx)}
  ${conteudo}
</main>
<footer class="rodape rodape-loja">
  <div class="container">
    <p><strong>${loja.loja_nome}</strong> · ${loja.nome} · CPF/CNPJ ${formatarDocumento(loja.documento)}</p>
    <p class="muted pequeno">Atendimento: ${loja.email}${loja.telefone ? ` · ${loja.telefone}` : ''}. Você pode desistir da compra em até 7 dias do recebimento (art. 49 do CDC).</p>
    <p class="muted pequeno">Loja criada com ${config.APP_NOME} · <a href="/rastreio">Rastrear pedido</a> · <a href="/privacidade">Privacidade</a></p>
  </div>
</footer>
</body></html>`;
}

module.exports = function rotasVitrine(r, db) {
  const carregarLoja = (ctx) => {
    const loja = db.prepare("SELECT * FROM users WHERE loja_slug = ? AND role = 'lojista' AND ativo = 1").get(ctx.params.slug);
    if (!loja) { ctx.notFound(); return false; }
    ctx.loja = loja;
    ctx.lojaAberta = !!S.planoAtivo(db, loja);
    return true;
  };

  const nomeCookie = (loja) => `car_${loja.id}`;
  function lerCarrinho(ctx) {
    try {
      const obj = JSON.parse(ctx.cookies[nomeCookie(ctx.loja)] || '{}');
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        const id = Number(k); const q = Number(v);
        if (Number.isInteger(id) && Number.isInteger(q) && q > 0 && q <= 99) out[id] = q;
      }
      return out;
    } catch { return {}; }
  }
  function salvarCarrinho(ctx, car) {
    ctx.setCookies.push(cookie(nomeCookie(ctx.loja), JSON.stringify(car), { maxAge: Object.keys(car).length ? 7 * 86400 : 0, secure: config.COOKIE_SEGURO }));
  }
  const contar = (car) => Object.values(car).reduce((s, q) => s + q, 0);

  function itensCarrinho(ctx, car) {
    const ids = Object.keys(car).map(Number);
    if (!ids.length) return [];
    return db.prepare(`SELECT p.id, p.nome, p.emoji, p.cor, p.estoque, p.peso_g, lp.preco_venda_centavos preco FROM loja_produtos lp
      JOIN produtos p ON p.id = lp.produto_id WHERE lp.user_id = ? AND lp.ativo = 1 AND p.ativo = 1 AND p.id IN (${ids.map(() => '?').join(',')})`)
      .all(ctx.loja.id, ...ids).map((p) => ({ ...p, qtd: Math.min(car[p.id], p.estoque) })).filter((p) => p.qtd > 0);
  }

  const fechada = (ctx) => paginaLoja(ctx, ctx.loja, '', vazio('Esta loja está temporariamente indisponível. Volte em breve!'));

  r.get('/loja/:slug', carregarLoja, (ctx) => {
    if (!ctx.lojaAberta) return ctx.html(fechada(ctx));
    const q = (ctx.query.q || '').trim();
    const produtos = db.prepare(`SELECT p.*, lp.preco_venda_centavos preco FROM loja_produtos lp JOIN produtos p ON p.id = lp.produto_id
      WHERE lp.user_id = ? AND lp.ativo = 1 AND p.ativo = 1 AND (? = '' OR p.nome LIKE ?) ORDER BY p.nome`).all(ctx.loja.id, q, `%${q}%`);
    const base = `/loja/${ctx.loja.loja_slug}`;
    ctx.html(paginaLoja(ctx, ctx.loja, '', html`
      <section class="banner-loja"><h1>${ctx.loja.loja_nome}</h1><p>Frete para todo o Brasil · Compra segura · Envio com rastreio</p></section>
      <form class="filtros" method="get"><input type="search" name="q" value="${q}" placeholder="O que você procura?"><button class="btn">Buscar</button></form>
      ${produtos.length ? html`<div class="grade-produtos">${produtos.map((p) => html`<article class="card produto">
        <a href="${base}/p/${p.id}">${thumb(p)}</a>
        <div class="produto-corpo">
          <h3><a href="${base}/p/${p.id}">${p.nome}</a></h3>
          <div class="preco-loja">${brl(p.preco)}</div>
          ${p.estoque > 0 ? html`<form method="post" action="${base}/carrinho">${csrfInput(ctx)}<input type="hidden" name="produto_id" value="${p.id}"><input type="hidden" name="acao" value="add">
            <button class="btn btn-primario btn-sm btn-bloco">Adicionar ao carrinho</button></form>` : html`<span class="muted">Esgotado</span>`}
        </div></article>`)}</div>` : vazio('Nenhum produto disponível no momento.')}`, contar(lerCarrinho(ctx))));
  });

  r.get('/loja/:slug/p/:id', carregarLoja, (ctx) => {
    if (!ctx.lojaAberta) return ctx.html(fechada(ctx));
    const p = db.prepare(`SELECT p.*, lp.preco_venda_centavos preco FROM loja_produtos lp JOIN produtos p ON p.id = lp.produto_id
      WHERE lp.user_id = ? AND lp.ativo = 1 AND p.ativo = 1 AND p.id = ?`).get(ctx.loja.id, Number(ctx.params.id));
    if (!p) return ctx.notFound();
    const base = `/loja/${ctx.loja.loja_slug}`;
    ctx.html(paginaLoja(ctx, ctx.loja, p.nome, html`
      <p><a href="${base}">← Continuar comprando</a></p>
      <div class="produto-detalhe">
        <div>${thumb(p, 'grande')}</div>
        <div class="card">
          <h1>${p.nome}</h1>
          <div class="preco-loja grande">${brl(p.preco)}</div>
          <p class="muted pequeno">ou em até 3x de ${brl(Math.ceil(p.preco / 3))} sem juros*</p>
          <p>${p.descricao}</p>
          ${p.estoque > 0 ? html`<form method="post" action="${base}/carrinho" class="form inline-form">${csrfInput(ctx)}
            <input type="hidden" name="produto_id" value="${p.id}"><input type="hidden" name="acao" value="add">
            <label>Quantidade<input type="number" name="qtd" value="1" min="1" max="${Math.min(99, p.estoque)}" class="input-qtd"></label>
            <button class="btn btn-primario btn-grande">Adicionar ao carrinho</button></form>` : html`<p class="vermelho">Produto esgotado.</p>`}
          <ul class="lista-check pequeno"><li>Envio em até 24h úteis após a confirmação</li><li>Entrega com código de rastreio</li><li>7 dias para desistir da compra</li></ul>
          <p class="muted pequeno">*Parcelamento sujeito às condições do meio de pagamento da loja.</p>
        </div>
      </div>`, contar(lerCarrinho(ctx))));
  });

  r.post('/loja/:slug/carrinho', carregarLoja, (ctx) => {
    const car = lerCarrinho(ctx);
    const id = Number(ctx.body.produto_id);
    const qtd = Math.max(0, Math.min(99, Number(ctx.body.qtd ?? 1) || 0));
    if (Number.isInteger(id)) {
      if (ctx.body.acao === 'add') car[id] = Math.min(99, (car[id] || 0) + Math.max(1, qtd));
      else if (ctx.body.acao === 'set') { if (qtd > 0) car[id] = qtd; else delete car[id]; }
      else if (ctx.body.acao === 'remover') delete car[id];
    }
    salvarCarrinho(ctx, car);
    ctx.redirect(`/loja/${ctx.loja.loja_slug}/carrinho`);
  });

  function telaCarrinho(ctx, v = {}, erro = '') {
    const car = lerCarrinho(ctx);
    const itens = itensCarrinho(ctx, car);
    const base = `/loja/${ctx.loja.loja_slug}`;
    const subtotal = itens.reduce((s, i) => s + i.preco * i.qtd, 0);
    const peso = itens.reduce((s, i) => s + i.peso_g * i.qtd, 0);
    return paginaLoja(ctx, ctx.loja, 'Carrinho', html`
      <h1>Carrinho</h1>
      ${erro ? html`<div class="flash flash-erro">${erro}</div>` : ''}
      ${!itens.length ? vazio('Seu carrinho está vazio.', html`<a class="btn btn-primario" href="${base}">Ver produtos</a>`) : html`
      <div class="pedido-grid">
        <div class="card">
          ${itens.map((i) => html`<div class="item-carrinho">
            ${thumb(i, 'mini')}
            <div class="cresce"><strong>${i.nome}</strong><div class="muted pequeno">${brl(i.preco)} cada</div></div>
            <form method="post" action="${base}/carrinho" class="inline">${csrfInput(ctx)}<input type="hidden" name="produto_id" value="${i.id}"><input type="hidden" name="acao" value="set">
              <input type="number" name="qtd" value="${i.qtd}" min="0" max="${Math.min(99, i.estoque)}" class="input-qtd"><button class="btn btn-sm">Atualizar</button></form>
            <strong>${brl(i.preco * i.qtd)}</strong>
            <form method="post" action="${base}/carrinho" class="inline">${csrfInput(ctx)}<input type="hidden" name="produto_id" value="${i.id}"><input type="hidden" name="acao" value="remover"><button class="btn btn-sm btn-fantasma" title="Remover">✕</button></form>
          </div>`)}
        </div>
        <form method="post" action="${base}/checkout" class="form card" id="form-checkout">
          ${csrfInput(ctx)}
          <h3>Entrega</h3>
          <label>Nome completo<input name="cliente_nome" required value="${v.cliente_nome || ''}" autocomplete="name"></label>
          <div class="form-duplo">
            <label>E-mail<input type="email" name="cliente_email" required value="${v.cliente_email || ''}" autocomplete="email"></label>
            <label>Celular<input name="cliente_telefone" required value="${v.cliente_telefone || ''}" data-mascara="telefone" autocomplete="tel"></label>
          </div>
          <label>CPF<input name="cliente_documento" required value="${v.cliente_documento || ''}" data-mascara="documento"></label>
          ${camposEndereco(v)}
          <dl class="resumo" data-resumo-loja data-subtotal="${subtotal}" data-peso="${peso}">
            <div><dt>Subtotal</dt><dd>${brl(subtotal)}</dd></div>
            <div><dt>Frete</dt><dd data-r-frete-loja>Grátis</dd></div>
            <div class="total"><dt>Total</dt><dd>${brl(subtotal)}</dd></div>
          </dl>
          <fieldset class="pagamento"><legend>Pagamento</legend>
            <label class="check"><input type="radio" name="pagamento" value="pix" checked> Pix (aprovação imediata)</label>
          </fieldset>
          ${config.PAGAMENTO_MODO === 'simulado' ? html`<div class="aviso pequeno">Loja de demonstração: o pagamento é simulado e nenhum valor será cobrado.</div>` : ''}
          <label class="check pequeno"><input type="checkbox" name="aceite" value="1" required> Concordo com o tratamento dos meus dados para entrega do pedido, conforme a <a href="/privacidade" target="_blank">Política de privacidade</a>.</label>
          <button class="btn btn-primario btn-grande btn-bloco">Finalizar compra</button>
        </form>
      </div>`}
      <script src="/static/app.js" defer></script>`, contar(car));
  }

  r.get('/loja/:slug/carrinho', carregarLoja, (ctx) => {
    if (!ctx.lojaAberta) return ctx.html(fechada(ctx));
    ctx.html(telaCarrinho(ctx));
  });

  r.post('/loja/:slug/checkout', carregarLoja, (ctx) => {
    if (!ctx.lojaAberta) return ctx.html(fechada(ctx));
    const b = ctx.body;
    const car = lerCarrinho(ctx);
    if (b.aceite !== '1') return ctx.html(telaCarrinho(ctx, b, 'É preciso concordar com o tratamento dos dados para a entrega.'), 422);
    if (soDigitos(b.cliente_documento).length !== 11 || !require('../util').cpfValido(b.cliente_documento)) return ctx.html(telaCarrinho(ctx, b, 'CPF inválido.'), 422);
    const itens = Object.entries(car).map(([id, qtd]) => ({ produto_id: Number(id), qtd }));
    try {
      // Na vitrine o frete é absorvido pelo lojista (sai do lucro); o cliente paga só os produtos.
      const p = S.criarPedido(db, ctx.loja.id, { ...b, itens }, 'vitrine');
      salvarCarrinho(ctx, {});
      ctx.redirect(`/loja/${ctx.loja.loja_slug}/pedido/${p.codigo}`);
    } catch (e) {
      if (!e.negocio) throw e;
      const msg = e.status === 402 ? 'Não foi possível concluir a compra nesta loja agora. Tente mais tarde.' : e.message;
      ctx.html(telaCarrinho(ctx, b, msg), 422);
    }
  });

  r.get('/loja/:slug/pedido/:codigo', carregarLoja, (ctx) => {
    const p = db.prepare('SELECT * FROM pedidos WHERE codigo = ? AND user_id = ?').get(ctx.params.codigo, ctx.loja.id);
    if (!p) return ctx.notFound();
    const itens = db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(p.id);
    ctx.html(paginaLoja(ctx, ctx.loja, 'Pedido recebido', html`<div class="card estreito centro">
      <div class="ic-grande">🎉</div>
      <h1>Obrigado pela compra!</h1>
      <p>Seu pedido <strong>${p.codigo}</strong> foi recebido em ${dataBR(p.criado_em)}.</p>
      <p>${badgeStatus(p.status === 'aguardando_pagamento' ? 'pago' : p.status)}</p>
      <table class="tabela"><tbody>${itens.map((i) => html`<tr><td>${i.qtd}× ${i.nome}</td><td class="dir">${brl(i.preco_unit_centavos * i.qtd)}</td></tr>`)}
        <tr><td><strong>Total</strong></td><td class="dir"><strong>${brl(p.venda_centavos)}</strong></td></tr></tbody></table>
      <p class="muted">Guarde o código do pedido. Você poderá acompanhar a entrega em <a href="/rastreio?codigo=${p.codigo}">Rastrear pedido</a>.</p>
      <a class="btn" href="/loja/${ctx.loja.loja_slug}">Voltar à loja</a>
    </div>`));
  });
};
