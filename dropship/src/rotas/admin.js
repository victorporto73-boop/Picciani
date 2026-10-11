// Painel administrativo da plataforma (operação, catálogo, lojistas e recargas).
'use strict';

const { html } = require('../http');
const { paginaPainel, thumb, vazio, paginacao, csrfInput } = require('../views/layout');
const { brl, toCentavos, centsToInput, dataBR } = require('../util');
const S = require('../servicos');
const { detalhePedido, tabelaPedidos } = require('./painel');

const POR_PAGINA = 30;

function exigirAdmin(ctx) {
  if (!ctx.user) { ctx.redirect('/entrar'); return false; }
  if (ctx.user.role !== 'admin') { ctx.notFound(); return false; }
  return true;
}

const pagAdmin = (ctx, titulo, conteudo) => paginaPainel(ctx, titulo, conteudo, { admin: true });

module.exports = function rotasAdmin(r, db) {
  r.get('/admin', exigirAdmin, (ctx) => {
    const k = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status = 'pago' THEN 1 END),0) a_separar,
      COALESCE(SUM(CASE WHEN status = 'em_separacao' THEN 1 END),0) separando,
      COALESCE(SUM(CASE WHEN status = 'enviado' THEN 1 END),0) em_transito,
      COALESCE(SUM(CASE WHEN status NOT IN ('cancelado','aguardando_pagamento') AND criado_em >= datetime('now','-30 days') THEN total_custo_centavos END),0) receita30
      FROM pedidos`).get();
    const lojistas = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(saldo_centavos),0) saldo FROM users WHERE role = 'lojista'").get();
    const assinantes = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'lojista' AND plano_valido_ate > datetime('now')").get().n;
    const baixo = db.prepare('SELECT * FROM produtos WHERE ativo = 1 AND estoque < 30 ORDER BY estoque LIMIT 8').all();
    const fila = db.prepare("SELECT * FROM pedidos WHERE status IN ('pago','em_separacao') ORDER BY id LIMIT 10").all();
    const recPend = db.prepare("SELECT COUNT(*) n FROM transacoes WHERE tipo = 'recarga' AND status = 'pendente'").get().n;
    ctx.html(pagAdmin(ctx, 'Visão geral', html`
      <div class="kpis">
        <div class="card kpi"><span>A separar</span><strong>${k.a_separar}</strong></div>
        <div class="card kpi"><span>Em separação</span><strong>${k.separando}</strong></div>
        <div class="card kpi"><span>Em trânsito</span><strong>${k.em_transito}</strong></div>
        <div class="card kpi"><span>Faturamento 30 dias</span><strong>${brl(k.receita30)}</strong></div>
        <div class="card kpi"><span>Lojistas (com plano ativo)</span><strong>${lojistas.n} <small>(${assinantes})</small></strong></div>
        <div class="card kpi"><span>Saldo em carteiras</span><strong>${brl(lojistas.saldo)}</strong></div>
      </div>
      ${recPend ? html`<div class="aviso">${recPend} recarga(s) Pix pendente(s). <a href="/admin/recargas">Conferir →</a></div>` : ''}
      <div class="card"><div class="linha-entre"><h3>Fila de expedição</h3><a href="/admin/pedidos?status=pago">Ver todos</a></div>
        ${fila.length ? tabelaPedidos(fila, '/admin/pedidos') : vazio('Nenhum pedido aguardando expedição. 🎉')}</div>
      <div class="card"><h3>Estoque baixo</h3>
        ${baixo.length ? html`<div class="tabela-wrap"><table class="tabela"><tbody>${baixo.map((p) => html`<tr><td><a href="/admin/produtos/${p.id}">${p.nome}</a></td><td class="muted">${p.sku}</td><td class="vermelho">${p.estoque} un.</td></tr>`)}</tbody></table></div>` : vazio('Nenhum produto com estoque baixo.')}</div>`));
  });

  // ---------- pedidos ----------
  r.get('/admin/pedidos', exigirAdmin, (ctx) => {
    const st = S.STATUS[ctx.query.status] ? ctx.query.status : '';
    const q = (ctx.query.q || '').trim();
    const pagina = Math.max(1, Number(ctx.query.pagina) || 1);
    const where = `(? = '' OR status = ?) AND (? = '' OR codigo LIKE ? OR cliente_nome LIKE ?)`;
    const args = [st, st, q, `%${q}%`, `%${q}%`];
    const total = db.prepare(`SELECT COUNT(*) n FROM pedidos WHERE ${where}`).get(...args).n;
    const pedidos = db.prepare(`SELECT * FROM pedidos WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, POR_PAGINA, (pagina - 1) * POR_PAGINA);
    ctx.html(pagAdmin(ctx, 'Pedidos', html`
      <form class="filtros" method="get">
        <input type="search" name="q" value="${q}" placeholder="Código ou cliente…">
        <select name="status"><option value="">Todos os status</option>${Object.entries(S.STATUS).map(([k, v]) => html`<option value="${k}" ${k === st ? 'selected' : ''}>${v.rotulo}</option>`)}</select>
        <button class="btn">Filtrar</button>
      </form>
      ${pedidos.length ? tabelaPedidos(pedidos, '/admin/pedidos') : vazio('Nenhum pedido encontrado.')}
      ${paginacao(ctx, total, POR_PAGINA, pagina)}`));
  });

  const pedido = (ctx) => db.prepare('SELECT * FROM pedidos WHERE codigo = ?').get(ctx.params.codigo);

  r.get('/admin/pedidos/:codigo', exigirAdmin, (ctx) => {
    const p = pedido(ctx);
    if (!p) return ctx.notFound();
    ctx.html(pagAdmin(ctx, `Pedido ${p.codigo}`, detalhePedido(db, ctx, p, { base: '/admin/pedidos', admin: true })));
  });

  r.post('/admin/pedidos/:codigo/avancar', exigirAdmin, (ctx) => {
    const p = pedido(ctx);
    if (!p) return ctx.notFound();
    try { S.avancarPedido(db, p.id, { rastreio: ctx.body.rastreio }); ctx.flash('ok', 'Status atualizado.'); } catch (e) { if (!e.negocio) throw e; ctx.flash('erro', e.message); }
    ctx.redirect(`/admin/pedidos/${p.codigo}`);
  });

  r.post('/admin/pedidos/:codigo/cancelar', exigirAdmin, (ctx) => {
    const p = pedido(ctx);
    if (!p) return ctx.notFound();
    try { S.cancelarPedido(db, p.id, { porAdmin: true }); ctx.flash('ok', 'Pedido cancelado.'); } catch (e) { if (!e.negocio) throw e; ctx.flash('erro', e.message); }
    ctx.redirect(`/admin/pedidos/${p.codigo}`);
  });

  // ---------- produtos ----------
  r.get('/admin/produtos', exigirAdmin, (ctx) => {
    const q = (ctx.query.q || '').trim();
    const produtos = db.prepare(`SELECT p.*, c.nome categoria,
        (SELECT COUNT(*) FROM loja_produtos lp WHERE lp.produto_id = p.id) lojas
      FROM produtos p LEFT JOIN categorias c ON c.id = p.categoria_id
      WHERE (? = '' OR p.nome LIKE ? OR p.sku LIKE ?) ORDER BY p.nome`).all(q, `%${q}%`, `%${q}%`);
    ctx.html(pagAdmin(ctx, 'Produtos', html`
      <div class="linha-entre">
        <form class="filtros" method="get"><input type="search" name="q" value="${q}" placeholder="Nome ou SKU…"><button class="btn">Buscar</button></form>
        <a class="btn btn-primario" href="/admin/produtos/novo">+ Novo produto</a>
      </div>
      <div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Produto</th><th>Categoria</th><th>Custo</th><th>Sugerido</th><th>Estoque</th><th>Lojas</th><th>Status</th></tr></thead>
        <tbody>${produtos.map((p) => html`<tr class="${p.ativo ? '' : 'inativo'}">
          <td><div class="produto-mini">${thumb(p, 'mini')}<div><a href="/admin/produtos/${p.id}"><strong>${p.nome}</strong></a><div class="muted pequeno">${p.sku}</div></div></div></td>
          <td>${p.categoria}</td><td>${brl(p.custo_centavos)}</td><td>${brl(p.preco_sugerido_centavos)}</td>
          <td class="${p.estoque < 30 ? 'vermelho' : ''}">${p.estoque}</td><td>${p.lojas}</td>
          <td>${p.ativo ? html`<span class="badge badge-green">Ativo</span>` : html`<span class="badge badge-gray">Inativo</span>`}</td>
        </tr>`)}</tbody></table></div>`));
  });

  function formProduto(ctx, p, erro = '') {
    const cats = db.prepare('SELECT * FROM categorias ORDER BY nome').all();
    const novo = !p.id;
    return pagAdmin(ctx, novo ? 'Novo produto' : `Editar ${p.nome}`, html`
      <p><a href="/admin/produtos">← Produtos</a></p>
      ${erro ? html`<div class="flash flash-erro">${erro}</div>` : ''}
      <form method="post" action="${novo ? '/admin/produtos/novo' : `/admin/produtos/${p.id}`}" class="form card">
        ${csrfInput(ctx)}
        <div class="form-duplo">
          <label>Nome<input name="nome" required maxlength="120" value="${p.nome || ''}"></label>
          <label>SKU<input name="sku" required maxlength="30" value="${p.sku || ''}" pattern="[A-Za-z0-9\\-_]+"></label>
          <label>Categoria<select name="categoria_id" required>${cats.map((c) => html`<option value="${c.id}" ${c.id === p.categoria_id ? 'selected' : ''}>${c.nome}</option>`)}</select></label>
          <label>Peso (g)<input type="number" name="peso_g" min="1" required value="${p.peso_g || 500}"></label>
          <label>Custo para o lojista (R$)<input name="custo" required inputmode="decimal" value="${p.custo_centavos !== undefined ? centsToInput(p.custo_centavos) : ''}"></label>
          <label>Preço sugerido (R$)<input name="sugerido" required inputmode="decimal" value="${p.preco_sugerido_centavos !== undefined ? centsToInput(p.preco_sugerido_centavos) : ''}"></label>
          <label>Estoque<input type="number" name="estoque" min="0" required value="${p.estoque ?? 0}"></label>
          <label>Ícone (emoji)<input name="emoji" maxlength="8" value="${p.emoji || '📦'}"></label>
          <label>Cor de fundo<input type="color" name="cor" value="${p.cor || '#e0e7ff'}"></label>
          <label class="check"><input type="checkbox" name="ativo" value="1" ${p.ativo === 0 ? '' : 'checked'}> Ativo no catálogo</label>
        </div>
        <label>Descrição<textarea name="descricao" rows="4" maxlength="2000">${p.descricao || ''}</textarea></label>
        <button class="btn btn-primario">Salvar</button>
      </form>`);
  }

  function lerProduto(b) {
    return {
      nome: String(b.nome || '').trim(), sku: String(b.sku || '').trim().toUpperCase(), categoria_id: Number(b.categoria_id),
      peso_g: Number(b.peso_g), custo_centavos: toCentavos(b.custo), preco_sugerido_centavos: toCentavos(b.sugerido),
      estoque: Number(b.estoque), emoji: String(b.emoji || '📦').slice(0, 8), cor: /^#[0-9a-fA-F]{6}$/.test(b.cor || '') ? b.cor : '#e0e7ff',
      ativo: b.ativo === '1' ? 1 : 0, descricao: String(b.descricao || '').trim().slice(0, 2000),
    };
  }
  function validarProduto(p, id) {
    if (!p.nome || !/^[A-Z0-9\-_]+$/.test(p.sku)) return 'Informe nome e SKU válidos.';
    if (!Number.isInteger(p.custo_centavos) || p.custo_centavos < 0 || !Number.isInteger(p.preco_sugerido_centavos)) return 'Valores inválidos.';
    if (p.preco_sugerido_centavos < p.custo_centavos) return 'O preço sugerido não pode ser menor que o custo.';
    if (!Number.isInteger(p.estoque) || p.estoque < 0 || !Number.isInteger(p.peso_g) || p.peso_g < 1) return 'Estoque ou peso inválido.';
    if (!db.prepare('SELECT 1 FROM categorias WHERE id = ?').get(p.categoria_id)) return 'Categoria inválida.';
    if (db.prepare('SELECT 1 FROM produtos WHERE sku = ? AND id <> ?').get(p.sku, id || 0)) return 'Já existe produto com este SKU.';
    return '';
  }

  r.get('/admin/produtos/novo', exigirAdmin, (ctx) => ctx.html(formProduto(ctx, {})));
  r.post('/admin/produtos/novo', exigirAdmin, (ctx) => {
    const p = lerProduto(ctx.body);
    const erro = validarProduto(p);
    if (erro) return ctx.html(formProduto(ctx, p, erro), 422);
    const r2 = db.prepare(`INSERT INTO produtos (nome, sku, categoria_id, peso_g, custo_centavos, preco_sugerido_centavos, estoque, emoji, cor, ativo, descricao)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(p.nome, p.sku, p.categoria_id, p.peso_g, p.custo_centavos, p.preco_sugerido_centavos, p.estoque, p.emoji, p.cor, p.ativo, p.descricao);
    ctx.flash('ok', 'Produto criado.');
    ctx.redirect(`/admin/produtos/${r2.lastInsertRowid}`);
  });

  r.get('/admin/produtos/:id', exigirAdmin, (ctx) => {
    const p = db.prepare('SELECT * FROM produtos WHERE id = ?').get(Number(ctx.params.id));
    if (!p) return ctx.notFound();
    ctx.html(formProduto(ctx, p));
  });
  r.post('/admin/produtos/:id', exigirAdmin, (ctx) => {
    const id = Number(ctx.params.id);
    if (!db.prepare('SELECT 1 FROM produtos WHERE id = ?').get(id)) return ctx.notFound();
    const p = lerProduto(ctx.body);
    const erro = validarProduto(p, id);
    if (erro) return ctx.html(formProduto(ctx, { ...p, id }, erro), 422);
    db.prepare(`UPDATE produtos SET nome=?, sku=?, categoria_id=?, peso_g=?, custo_centavos=?, preco_sugerido_centavos=?, estoque=?, emoji=?, cor=?, ativo=?, descricao=? WHERE id=?`)
      .run(p.nome, p.sku, p.categoria_id, p.peso_g, p.custo_centavos, p.preco_sugerido_centavos, p.estoque, p.emoji, p.cor, p.ativo, p.descricao, id);
    // Mantém a regra "preço de venda ≥ custo" nas lojas quando o custo sobe.
    db.prepare('UPDATE loja_produtos SET preco_venda_centavos = ? WHERE produto_id = ? AND preco_venda_centavos < ?').run(p.custo_centavos, id, p.custo_centavos);
    ctx.flash('ok', 'Produto atualizado.');
    ctx.redirect(`/admin/produtos/${id}`);
  });

  // ---------- lojistas ----------
  r.get('/admin/lojistas', exigirAdmin, (ctx) => {
    const q = (ctx.query.q || '').trim();
    const lojistas = db.prepare(`SELECT u.*, pl.nome plano_nome,
        (SELECT COUNT(*) FROM pedidos p WHERE p.user_id = u.id) pedidos,
        (SELECT COUNT(*) FROM loja_produtos lp WHERE lp.user_id = u.id) produtos
      FROM users u LEFT JOIN planos pl ON pl.id = u.plano_id
      WHERE u.role = 'lojista' AND (? = '' OR u.nome LIKE ? OR u.email LIKE ? OR u.loja_nome LIKE ?) ORDER BY u.id DESC`).all(q, `%${q}%`, `%${q}%`, `%${q}%`);
    ctx.html(pagAdmin(ctx, 'Lojistas', html`
      <form class="filtros" method="get"><input type="search" name="q" value="${q}" placeholder="Nome, e-mail ou loja…"><button class="btn">Buscar</button></form>
      ${lojistas.length ? html`<div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Lojista</th><th>Plano</th><th>Saldo</th><th>Produtos</th><th>Pedidos</th><th>Desde</th><th>Ações</th></tr></thead>
        <tbody>${lojistas.map((u) => {
          const ativo = u.plano_valido_ate && new Date(u.plano_valido_ate + 'Z') > new Date();
          return html`<tr class="${u.ativo ? '' : 'inativo'}">
            <td><strong>${u.loja_nome}</strong> <a class="pequeno" href="/loja/${u.loja_slug}" target="_blank" rel="noopener">↗</a><div class="muted pequeno">${u.nome} · ${u.email} · ${u.telefone}</div></td>
            <td>${u.plano_nome || '—'} ${ativo ? html`<span class="badge badge-green">até ${dataBR(u.plano_valido_ate).slice(0, 10)}</span>` : html`<span class="badge badge-gray">inativo</span>`}</td>
            <td>${brl(u.saldo_centavos)}</td><td>${u.produtos}</td><td>${u.pedidos}</td><td class="pequeno">${dataBR(u.criado_em).slice(0, 10)}</td>
            <td>
              <form method="post" action="/admin/lojistas/${u.id}/ajuste" class="inline">${csrfInput(ctx)}
                <input name="valor" placeholder="± R$" class="input-preco" required title="Ajuste de saldo (use - para debitar)"><button class="btn btn-sm">Ajustar</button></form>
              <form method="post" action="/admin/lojistas/${u.id}/alternar" class="inline" data-confirmar="${u.ativo ? 'Desativar' : 'Reativar'} esta conta?">${csrfInput(ctx)}<button class="btn btn-sm ${u.ativo ? 'btn-perigo' : ''}">${u.ativo ? 'Desativar' : 'Reativar'}</button></form>
            </td></tr>`;
        })}</tbody></table></div>` : vazio('Nenhum lojista encontrado.')}
      <script src="/static/app.js" defer></script>`));
  });

  r.post('/admin/lojistas/:id/ajuste', exigirAdmin, (ctx) => {
    const id = Number(ctx.params.id);
    const valor = toCentavos(ctx.body.valor);
    const u = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'lojista'").get(id);
    if (!u) return ctx.notFound();
    if (!Number.isInteger(valor) || valor === 0) { ctx.flash('erro', 'Valor inválido.'); return ctx.redirect('/admin/lojistas'); }
    if (u.saldo_centavos + valor < 0) { ctx.flash('erro', 'O ajuste deixaria o saldo negativo.'); return ctx.redirect('/admin/lojistas'); }
    require('../db').tx(db, () => {
      db.prepare('UPDATE users SET saldo_centavos = saldo_centavos + ? WHERE id = ?').run(valor, id);
      db.prepare("INSERT INTO transacoes (user_id, tipo, valor_centavos, descricao) VALUES (?, 'ajuste', ?, ?)").run(id, valor, `Ajuste manual pela plataforma (${ctx.user.email})`);
    });
    ctx.flash('ok', `Saldo de ${u.loja_nome} ajustado em ${brl(valor)}.`);
    ctx.redirect('/admin/lojistas');
  });

  r.post('/admin/lojistas/:id/alternar', exigirAdmin, (ctx) => {
    const id = Number(ctx.params.id);
    const u = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'lojista'").get(id);
    if (!u) return ctx.notFound();
    db.prepare('UPDATE users SET ativo = 1 - ativo WHERE id = ?').run(id);
    if (u.ativo) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    ctx.flash('ok', `Conta ${u.ativo ? 'desativada' : 'reativada'}.`);
    ctx.redirect('/admin/lojistas');
  });

  // ---------- recargas ----------
  r.get('/admin/recargas', exigirAdmin, (ctx) => {
    const recargas = db.prepare(`SELECT t.*, u.loja_nome, u.email FROM transacoes t JOIN users u ON u.id = t.user_id
      WHERE t.tipo = 'recarga' ORDER BY (t.status = 'pendente') DESC, t.id DESC LIMIT 100`).all();
    ctx.html(pagAdmin(ctx, 'Recargas', html`
      <p class="muted">Confirme manualmente as recargas cujo Pix foi recebido na conta da empresa (modo de pagamento "manual"). Com um PSP integrado, a confirmação ocorre automaticamente via webhook.</p>
      ${recargas.length ? html`<div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>#</th><th>Lojista</th><th>Valor</th><th>Data</th><th>Status</th><th></th></tr></thead>
        <tbody>${recargas.map((t) => html`<tr>
          <td>${t.id}</td><td>${t.loja_nome}<div class="muted pequeno">${t.email}</div></td><td>${brl(t.valor_centavos)}</td><td class="pequeno">${dataBR(t.criado_em)}</td>
          <td><span class="badge badge-${t.status === 'confirmada' ? 'green' : t.status === 'pendente' ? 'amber' : 'gray'}">${t.status}</span></td>
          <td>${t.status === 'pendente' ? html`<form method="post" action="/admin/recargas/${t.id}/confirmar" data-confirmar="Confirmar o recebimento de ${brl(t.valor_centavos)}?">${csrfInput(ctx)}<button class="btn btn-sm btn-primario">Confirmar</button></form>` : ''}</td>
        </tr>`)}</tbody></table></div>` : vazio('Nenhuma recarga.')}
      <script src="/static/app.js" defer></script>`));
  });

  r.post('/admin/recargas/:id/confirmar', exigirAdmin, (ctx) => {
    try { S.confirmarRecarga(db, Number(ctx.params.id)); ctx.flash('ok', 'Recarga confirmada e saldo creditado.'); } catch (e) { if (!e.negocio) throw e; ctx.flash('erro', e.message); }
    ctx.redirect('/admin/recargas');
  });
};
