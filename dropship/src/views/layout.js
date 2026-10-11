'use strict';

const { html, raw } = require('../http');
const { brl } = require('../util');
const { STATUS } = require('../servicos');
const config = require('../config');

function head(titulo, extra = '') {
  return html`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo ? `${titulo} · ${config.APP_NOME}` : config.APP_NOME}</title>
<meta name="description" content="${config.APP_NOME}: dropshipping nacional. Venda sem estoque, nós enviamos para o seu cliente.">
<link rel="icon" href="/static/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/style.css">
${extra}
</head>`;
}

function flashHtml(ctx) {
  const f = ctx.flashLido;
  if (!f) return '';
  return html`<div class="flash flash-${f.tipo}" role="status">${f.msg}</div>`;
}

const csrfInput = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;

function logo() {
  return html`<a class="logo" href="/"><span class="logo-mark">◆</span> ${config.APP_NOME}</a>`;
}

function paginaPublica(ctx, titulo, conteudo) {
  const u = ctx.user;
  return html`${head(titulo)}
<body class="publico">
<header class="topo">
  <div class="container topo-inner">
    ${logo()}
    <input type="checkbox" id="menu-toggle" class="menu-toggle" aria-label="Abrir menu">
    <label for="menu-toggle" class="menu-btn" aria-hidden="true">☰</label>
    <nav class="menu">
      <a href="/#como-funciona">Como funciona</a>
      <a href="/catalogo">Catálogo</a>
      <a href="/planos">Planos</a>
      <a href="/rastreio">Rastrear pedido</a>
      ${u
        ? html`<a class="btn btn-primario btn-sm" href="${u.role === 'admin' ? '/admin' : '/painel'}">Meu painel</a>`
        : html`<a href="/entrar">Entrar</a><a class="btn btn-primario btn-sm" href="/cadastro">Começar agora</a>`}
    </nav>
  </div>
</header>
<main>
  ${ctx.flashLido ? html`<div class="container">${flashHtml(ctx)}</div>` : ''}
  ${conteudo}
</main>
<footer class="rodape">
  <div class="container rodape-grid">
    <div>
      ${logo()}
      <p class="muted">Dropshipping nacional: você vende, nós estocamos, embalamos e enviamos para o seu cliente em todo o Brasil.</p>
    </div>
    <div><h4>Plataforma</h4><a href="/catalogo">Catálogo</a><a href="/planos">Planos</a><a href="/#faq">Dúvidas frequentes</a></div>
    <div><h4>Institucional</h4><a href="/termos">Termos de uso</a><a href="/privacidade">Política de privacidade</a><a href="/rastreio">Rastreio</a></div>
    <div><h4>Contato</h4><a href="mailto:${config.CONTATO_EMAIL}">${config.CONTATO_EMAIL}</a>${config.CONTATO_WHATSAPP ? html`<a href="https://wa.me/${config.CONTATO_WHATSAPP}">WhatsApp</a>` : ''}</div>
  </div>
  <div class="container rodape-base muted">© ${new Date().getFullYear()} ${config.APP_NOME}${config.EMPRESA_CNPJ ? html` · CNPJ ${config.EMPRESA_CNPJ}` : ''}</div>
</footer>
</body></html>`;
}

const MENU_PAINEL = [
  ['/painel', 'Início', '🏠'],
  ['/painel/catalogo', 'Catálogo', '🛍️'],
  ['/painel/loja', 'Minha loja', '🏪'],
  ['/painel/pedidos', 'Pedidos', '📦'],
  ['/painel/carteira', 'Carteira', '💳'],
  ['/painel/plano', 'Plano', '⭐'],
  ['/painel/integracoes', 'Integrações', '🔌'],
  ['/painel/configuracoes', 'Configurações', '⚙️'],
];
const MENU_ADMIN = [
  ['/admin', 'Visão geral', '📊'],
  ['/admin/pedidos', 'Pedidos', '📦'],
  ['/admin/produtos', 'Produtos', '🏷️'],
  ['/admin/lojistas', 'Lojistas', '👥'],
  ['/admin/recargas', 'Recargas', '💳'],
];

function paginaPainel(ctx, titulo, conteudo, { admin = false } = {}) {
  const menu = admin ? MENU_ADMIN : MENU_PAINEL;
  const u = ctx.user;
  const ativo = (href) => (href === '/painel' || href === '/admin' ? ctx.path === href : ctx.path.startsWith(href));
  return html`${head(titulo)}
<body class="painel">
<input type="checkbox" id="menu-toggle" class="menu-toggle" aria-label="Abrir menu">
<aside class="lateral">
  ${logo()}
  <nav>
    ${menu.map(([href, rot, ic]) => html`<a href="${href}" class="${ativo(href) ? 'ativo' : ''}"><span class="ic">${ic}</span>${rot}</a>`)}
  </nav>
  <div class="lateral-rodape">
    ${!admin && u.loja_slug ? html`<a href="/loja/${u.loja_slug}" target="_blank" rel="noopener">Ver minha vitrine ↗</a>` : ''}
    <form method="post" action="/sair">${csrfInput(ctx)}<button class="link">Sair</button></form>
  </div>
</aside>
<div class="conteudo">
  <header class="barra">
    <label for="menu-toggle" class="menu-btn" aria-hidden="true">☰</label>
    <h1>${titulo}</h1>
    <div class="barra-dir">
      ${!admin ? html`<a class="saldo" href="/painel/carteira" title="Saldo da carteira">Saldo <strong>${brl(u.saldo_centavos)}</strong></a>` : html`<span class="tag">Administrador</span>`}
      <span class="avatar" title="${u.nome}">${u.nome.trim()[0].toUpperCase()}</span>
    </div>
  </header>
  <main class="conteudo-main">
    ${flashHtml(ctx)}
    ${conteudo}
  </main>
</div>
</body></html>`;
}

function badgeStatus(status) {
  const s = STATUS[status] || { rotulo: status, cor: 'gray' };
  return html`<span class="badge badge-${s.cor}">${s.rotulo}</span>`;
}

function thumb(p, tamanho = '') {
  return html`<div class="thumb ${tamanho}" style="background:${raw(/^#[0-9a-fA-F]{3,8}$/.test(p.cor) ? p.cor : '#e0e7ff')}" aria-hidden="true"><span>${p.emoji}</span></div>`;
}

function vazio(msg, acao = '') {
  return html`<div class="vazio"><p>${msg}</p>${acao}</div>`;
}

function paginacao(ctx, total, porPagina, pagina) {
  const paginas = Math.ceil(total / porPagina);
  if (paginas <= 1) return '';
  const link = (n) => {
    const q = new URLSearchParams({ ...ctx.query, pagina: n });
    return `${ctx.path}?${q}`;
  };
  return html`<nav class="paginacao">
    ${pagina > 1 ? html`<a href="${link(pagina - 1)}">← Anterior</a>` : html`<span></span>`}
    <span class="muted">Página ${pagina} de ${paginas}</span>
    ${pagina < paginas ? html`<a href="${link(pagina + 1)}">Próxima →</a>` : html`<span></span>`}
  </nav>`;
}

function paginaErro(ctx, status, msg) {
  return paginaPublica(ctx, 'Erro', html`<section class="container secao centro">
    <h1 class="erro-codigo">${status}</h1><p>${msg}</p><p><a class="btn" href="/">Voltar ao início</a></p></section>`);
}

module.exports = { head, paginaPublica, paginaPainel, badgeStatus, thumb, vazio, paginacao, csrfInput, flashHtml, paginaErro, logo };
