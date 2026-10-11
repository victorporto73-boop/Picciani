// Site institucional, cadastro, login, catálogo público, rastreio e documentos legais.
'use strict';

const { html } = require('../http');
const { paginaPublica, thumb, csrfInput, badgeStatus, vazio } = require('../views/layout');
const { brl, slugify, soDigitos, documentoValido, dataBR, token } = require('../util');
const { hashSenha, verificarSenha, criarSessao, encerrarSessao, limiteLogin, limparLimite } = require('../auth');
const { iniciarTeste, FAIXAS_FRETE } = require('../servicos');
const legal = require('../views/legal');
const config = require('../config');

function cardProdutoPublico(p) {
  return html`<article class="card produto">
    ${thumb(p)}
    <div class="produto-corpo">
      <span class="muted pequeno">${p.categoria}</span>
      <h3>${p.nome}</h3>
      <div class="precos"><span class="muted pequeno">Preço sugerido</span><strong>${brl(p.preco_sugerido_centavos)}</strong></div>
      <div class="custo-bloqueado">🔒 Custo para lojista: <a href="/cadastro">cadastre-se</a></div>
    </div>
  </article>`;
}

function cardsPlanos(planos, { acao } = {}) {
  return html`<div class="planos">
    ${planos.map((p) => html`<div class="card plano ${p.nome === 'Pro' ? 'destaque' : ''}">
      ${p.nome === 'Pro' ? html`<span class="selo">Mais escolhido</span>` : ''}
      <h3>${p.nome}</h3>
      <div class="preco-plano"><strong>${brl(p.preco_centavos)}</strong><span>/mês</span></div>
      <p class="muted pequeno">${p.taxa_pedido_centavos ? `Taxa de ${brl(p.taxa_pedido_centavos)} por pedido` : 'Sem taxa por pedido'}</p>
      <ul class="lista-check">${p.recursos.split('|').map((r) => html`<li>${r}</li>`)}</ul>
      ${acao ? acao(p) : html`<a class="btn ${p.nome === 'Pro' ? 'btn-primario' : ''} btn-bloco" href="/cadastro?plano=${p.id}">Testar 7 dias grátis</a>`}
    </div>`)}
  </div>`;
}

const FAQ = [
  ['Preciso ter estoque ou CNPJ para começar?', 'Não é necessário ter estoque: os produtos ficam no nosso centro de distribuição. Você pode começar com CPF; para emitir notas e escalar as vendas, recomendamos formalizar-se (MEI, ME etc.) — consulte seu contador.'],
  ['Como funciona o pagamento dos pedidos?', 'Você mantém saldo na carteira (recarga via Pix). Quando um pedido entra, debitamos apenas o custo do produto, o frete e a taxa do plano. A diferença para o preço que você cobrou do seu cliente é o seu lucro.'],
  ['O cliente vai saber que o produto saiu de vocês?', 'Não. O envio é feito em embalagem neutra, sem materiais promocionais nem preços da plataforma, com os dados da sua loja como referência.'],
  ['Em quanto tempo o pedido é enviado?', 'Pedidos pagos até as 14h em dias úteis são separados e postados em até 24 horas úteis. O código de rastreio aparece no seu painel e é enviado via webhook, se você usar integração.'],
  ['Posso vender em marketplaces e na minha própria loja?', 'Sim. Você pode lançar pedidos manualmente, usar a vitrine pronta que a plataforma cria para você ou integrar sua loja virtual pela nossa API.'],
  ['E se o cliente quiser devolver?', 'O consumidor tem direito de arrependimento em até 7 dias do recebimento nas compras fora do estabelecimento (art. 49 do CDC). Abra a solicitação no painel e orientamos a logística reversa.'],
];

module.exports = function rotasPublicas(r, db) {
  const planos = () => db.prepare('SELECT * FROM planos ORDER BY preco_centavos').all();

  r.get('/', (ctx) => {
    const destaques = db.prepare(`SELECT p.*, c.nome categoria FROM produtos p JOIN categorias c ON c.id = p.categoria_id
      WHERE p.ativo = 1 AND p.estoque > 0 ORDER BY (p.preco_sugerido_centavos - p.custo_centavos) DESC LIMIT 8`).all();
    const categorias = db.prepare(`SELECT c.*, COUNT(p.id) n FROM categorias c LEFT JOIN produtos p ON p.categoria_id = c.id AND p.ativo = 1
      GROUP BY c.id ORDER BY c.nome`).all();
    const nProdutos = db.prepare('SELECT COUNT(*) n FROM produtos WHERE ativo = 1').get().n;
    ctx.html(paginaPublica(ctx, '', html`
<section class="hero">
  <div class="container hero-grid">
    <div>
      <span class="tag">Dropshipping 100% nacional</span>
      <h1>Venda sem estoque.<br><span class="destaque-texto">Nós enviamos por você.</span></h1>
      <p class="lead">Escolha produtos do nosso catálogo, venda na sua loja, redes sociais ou marketplaces e deixe o estoque, a embalagem e o envio com a gente. Você cuida das vendas e fica com o lucro.</p>
      <div class="hero-cta">
        <a class="btn btn-primario btn-grande" href="/cadastro">Criar minha conta grátis</a>
        <a class="btn btn-grande" href="/catalogo">Ver catálogo</a>
      </div>
      <p class="muted pequeno">7 dias de teste grátis · Sem fidelidade · Cancele quando quiser</p>
    </div>
    <div class="hero-visual" aria-hidden="true">
      <div class="mock-card">
        <div class="mock-linha"><span>Pedido #PD8F21</span>${badgeStatus('enviado')}</div>
        <div class="mock-linha"><span>Venda ao cliente</span><strong>${brl(17990)}</strong></div>
        <div class="mock-linha"><span>Custo + frete</span><span>− ${brl(9180)}</span></div>
        <div class="mock-linha lucro"><span>Seu lucro</span><strong>${brl(8810)}</strong></div>
      </div>
      <div class="mock-flutuante">🚚 Postado em 24h</div>
    </div>
  </div>
</section>

<section class="numeros">
  <div class="container numeros-grid">
    <div><strong>${nProdutos}+</strong><span>produtos no catálogo</span></div>
    <div><strong>24h</strong><span>para postagem*</span></div>
    <div><strong>27</strong><span>estados atendidos</span></div>
    <div><strong>R$ 0</strong><span>investimento em estoque</span></div>
  </div>
</section>

<section class="secao" id="como-funciona">
  <div class="container">
    <h2 class="titulo-secao">Como funciona</h2>
    <p class="subtitulo">Do cadastro à primeira venda em poucos minutos.</p>
    <div class="passos">
      <div class="passo"><span class="num">1</span><h3>Crie sua conta</h3><p>Cadastre-se e ganhe 7 dias para testar a plataforma completa.</p></div>
      <div class="passo"><span class="num">2</span><h3>Escolha os produtos</h3><p>Navegue pelo catálogo, veja o custo e a margem e adicione à sua loja com o seu preço.</p></div>
      <div class="passo"><span class="num">3</span><h3>Venda onde quiser</h3><p>Use a vitrine pronta, integre sua loja via API ou lance pedidos de marketplaces e WhatsApp.</p></div>
      <div class="passo"><span class="num">4</span><h3>Nós enviamos</h3><p>Separamos, embalamos sem identificação de fornecedor e enviamos com rastreio.</p></div>
    </div>
  </div>
</section>

<section class="secao secao-alt">
  <div class="container">
    <h2 class="titulo-secao">Por que vender com a gente</h2>
    <div class="beneficios">
      <div class="card beneficio"><span class="ic-grande">🏭</span><h3>Estoque no Brasil</h3><p>Produtos em centro de distribuição nacional: prazos curtos e sem surpresas com importação.</p></div>
      <div class="card beneficio"><span class="ic-grande">📦</span><h3>Embalagem neutra</h3><p>Seu cliente recebe o pedido sem material promocional ou preços da plataforma.</p></div>
      <div class="card beneficio"><span class="ic-grande">🏪</span><h3>Vitrine pronta</h3><p>Uma loja on-line com o nome da sua marca, criada automaticamente e pronta para divulgar.</p></div>
      <div class="card beneficio"><span class="ic-grande">🔌</span><h3>API e webhooks</h3><p>Integre sua loja virtual e receba atualizações de status e rastreio automaticamente.</p></div>
      <div class="card beneficio"><span class="ic-grande">💳</span><h3>Carteira pré-paga</h3><p>Recarregue via Pix e pague só o custo de cada pedido. Controle total do seu caixa.</p></div>
      <div class="card beneficio"><span class="ic-grande">📈</span><h3>Margem transparente</h3><p>Custo, preço sugerido e lucro estimado visíveis em cada produto.</p></div>
    </div>
  </div>
</section>

<section class="secao">
  <div class="container">
    <h2 class="titulo-secao">Categorias</h2>
    <div class="categorias">
      ${categorias.map((c) => html`<a class="categoria" href="/catalogo?categoria=${c.slug}"><span>${c.icone}</span>${c.nome}<small>${c.n} produtos</small></a>`)}
    </div>
    <h2 class="titulo-secao" style="margin-top:3rem">Produtos com maior margem</h2>
    <div class="grade-produtos">${destaques.map(cardProdutoPublico)}</div>
    <p class="centro"><a class="btn" href="/catalogo">Ver catálogo completo →</a></p>
  </div>
</section>

<section class="secao secao-alt" id="planos">
  <div class="container">
    <h2 class="titulo-secao">Planos</h2>
    <p class="subtitulo">Comece grátis por 7 dias. Depois, escolha o plano ideal para o seu volume.</p>
    ${cardsPlanos(planos())}
  </div>
</section>

<section class="secao" id="faq">
  <div class="container estreito">
    <h2 class="titulo-secao">Dúvidas frequentes</h2>
    ${FAQ.map(([q, a]) => html`<details class="faq"><summary>${q}</summary><p>${a}</p></details>`)}
  </div>
</section>

<section class="cta-final">
  <div class="container centro">
    <h2>Pronto para começar a vender?</h2>
    <p>Crie sua conta em menos de 2 minutos.</p>
    <a class="btn btn-claro btn-grande" href="/cadastro">Quero vender sem estoque</a>
    <p class="pequeno" style="opacity:.8;margin-top:1rem">*Pedidos pagos até as 14h em dias úteis.</p>
  </div>
</section>`));
  });

  r.get('/catalogo', (ctx) => {
    const cat = ctx.query.categoria || '';
    const q = (ctx.query.q || '').trim();
    const produtos = db.prepare(`SELECT p.*, c.nome categoria FROM produtos p JOIN categorias c ON c.id = p.categoria_id
      WHERE p.ativo = 1 AND (? = '' OR c.slug = ?) AND (? = '' OR p.nome LIKE ?) ORDER BY p.nome`).all(cat, cat, q, `%${q}%`);
    const categorias = db.prepare('SELECT * FROM categorias ORDER BY nome').all();
    ctx.html(paginaPublica(ctx, 'Catálogo', html`<section class="secao"><div class="container">
      <h1 class="titulo-secao">Catálogo de produtos</h1>
      <p class="subtitulo">Cadastre-se para ver o preço de custo, a margem e adicionar produtos à sua loja.</p>
      <form class="filtros" method="get">
        <input type="search" name="q" value="${q}" placeholder="Buscar produto…">
        <select name="categoria"><option value="">Todas as categorias</option>
          ${categorias.map((c) => html`<option value="${c.slug}" ${c.slug === cat ? 'selected' : ''}>${c.nome}</option>`)}</select>
        <button class="btn">Filtrar</button>
      </form>
      ${produtos.length ? html`<div class="grade-produtos">${produtos.map(cardProdutoPublico)}</div>` : vazio('Nenhum produto encontrado.')}
    </div></section>`));
  });

  r.get('/planos', (ctx) => {
    ctx.html(paginaPublica(ctx, 'Planos', html`<section class="secao"><div class="container">
      <h1 class="titulo-secao">Planos e preços</h1>
      <p class="subtitulo">Todos os planos incluem catálogo completo, vitrine própria, carteira pré-paga e envio com rastreio.</p>
      ${cardsPlanos(planos())}
      <div class="card estreito" style="margin-top:2rem">
        <h3>O que você paga em cada pedido</h3>
        <p>Custo do produto + frete + taxa do plano (quando houver). O valor é debitado do saldo da sua carteira no momento do pedido. A tabela de frete parte de ${brl(Math.min(...Object.values(FAIXAS_FRETE).map((f) => f.base)))} até 1 kg.</p>
      </div>
    </div></section>`));
  });

  // ---------- cadastro ----------
  function formCadastro(ctx, v = {}, erro = '') {
    return paginaPublica(ctx, 'Criar conta', html`<section class="secao"><div class="container auth">
      <div class="card auth-card">
        <h1>Crie sua conta</h1>
        <p class="muted">7 dias grátis para testar. Sem cartão de crédito.</p>
        ${erro ? html`<div class="flash flash-erro">${erro}</div>` : ''}
        <form method="post" action="/cadastro" class="form">
          ${csrfInput(ctx)}
          <label>Nome completo<input name="nome" required maxlength="120" value="${v.nome || ''}" autocomplete="name"></label>
          <label>E-mail<input type="email" name="email" required maxlength="120" value="${v.email || ''}" autocomplete="email"></label>
          <div class="form-duplo">
            <label>CPF ou CNPJ<input name="documento" required inputmode="numeric" value="${v.documento || ''}" data-mascara="documento"></label>
            <label>WhatsApp<input name="telefone" required inputmode="tel" value="${v.telefone || ''}" data-mascara="telefone"></label>
          </div>
          <label>Nome da sua loja<input name="loja_nome" required maxlength="60" value="${v.loja_nome || ''}" placeholder="Ex.: Casa da Ana"></label>
          <label>Senha<input type="password" name="senha" required minlength="8" autocomplete="new-password"><small class="muted">Mínimo de 8 caracteres.</small></label>
          <label class="check"><input type="checkbox" name="aceite" value="1" required> Li e aceito os <a href="/termos" target="_blank">Termos de uso</a> e a <a href="/privacidade" target="_blank">Política de privacidade</a>.</label>
          <button class="btn btn-primario btn-bloco">Criar conta e começar o teste</button>
        </form>
        <p class="centro muted pequeno">Já tem conta? <a href="/entrar">Entrar</a></p>
      </div>
    </div></section><script src="/static/app.js" defer></script>`);
  }

  r.get('/cadastro', (ctx) => ctx.html(formCadastro(ctx)));

  r.post('/cadastro', (ctx) => {
    const b = ctx.body;
    const v = { nome: String(b.nome || '').trim(), email: String(b.email || '').trim().toLowerCase(), documento: String(b.documento || ''), telefone: String(b.telefone || ''), loja_nome: String(b.loja_nome || '').trim() };
    const erro =
      (!v.nome || v.nome.length < 3) ? 'Informe seu nome completo.' :
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email) ? 'E-mail inválido.' :
      !documentoValido(v.documento) ? 'CPF ou CNPJ inválido.' :
      soDigitos(v.telefone).length < 10 ? 'Telefone inválido.' :
      !v.loja_nome ? 'Informe o nome da sua loja.' :
      String(b.senha || '').length < 8 ? 'A senha deve ter pelo menos 8 caracteres.' :
      b.aceite !== '1' ? 'É necessário aceitar os Termos de uso e a Política de privacidade.' :
      db.prepare('SELECT 1 FROM users WHERE email = ?').get(v.email) ? 'Já existe uma conta com este e-mail.' : '';
    if (erro) return ctx.html(formCadastro(ctx, v, erro), 422);

    let slug = slugify(v.loja_nome) || 'loja';
    while (db.prepare('SELECT 1 FROM users WHERE loja_slug = ?').get(slug)) slug = `${slugify(v.loja_nome).slice(0, 33) || 'loja'}-${token(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
    const res = db.prepare(`INSERT INTO users (nome, email, senha_hash, documento, telefone, loja_nome, loja_slug, api_key, aceite_termos_em)
      VALUES (?,?,?,?,?,?,?,?, datetime('now'))`).run(v.nome, v.email, hashSenha(b.senha), soDigitos(v.documento), soDigitos(v.telefone), v.loja_nome, slug, 'dk_' + token(24));
    const id = Number(res.lastInsertRowid);
    iniciarTeste(db, id);
    criarSessao(db, ctx, id, config.COOKIE_SEGURO);
    ctx.flash('ok', 'Conta criada! Seu teste grátis de 7 dias já está ativo. Comece escolhendo produtos no catálogo.');
    ctx.redirect('/painel');
  });

  // ---------- login ----------
  function formLogin(ctx, email = '', erro = '') {
    return paginaPublica(ctx, 'Entrar', html`<section class="secao"><div class="container auth">
      <div class="card auth-card">
        <h1>Entrar</h1>
        ${erro ? html`<div class="flash flash-erro">${erro}</div>` : ''}
        <form method="post" action="/entrar" class="form">
          ${csrfInput(ctx)}
          <label>E-mail<input type="email" name="email" required value="${email}" autocomplete="email"></label>
          <label>Senha<input type="password" name="senha" required autocomplete="current-password"></label>
          <button class="btn btn-primario btn-bloco">Entrar</button>
        </form>
        <p class="centro muted pequeno">Ainda não tem conta? <a href="/cadastro">Cadastre-se grátis</a></p>
      </div>
    </div></section>`);
  }

  r.get('/entrar', (ctx) => (ctx.user ? ctx.redirect(ctx.user.role === 'admin' ? '/admin' : '/painel') : ctx.html(formLogin(ctx))));

  r.post('/entrar', (ctx) => {
    const email = String(ctx.body.email || '').trim().toLowerCase();
    const chave = `${ctx.ip}|${email}`;
    if (!limiteLogin(chave)) return ctx.html(formLogin(ctx, email, 'Muitas tentativas. Aguarde 15 minutos e tente novamente.'), 429);
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!u || !verificarSenha(ctx.body.senha || '', u.senha_hash)) return ctx.html(formLogin(ctx, email, 'E-mail ou senha incorretos.'), 401);
    if (!u.ativo) return ctx.html(formLogin(ctx, email, 'Conta desativada. Fale com o suporte.'), 403);
    limparLimite(chave);
    criarSessao(db, ctx, u.id, config.COOKIE_SEGURO);
    ctx.redirect(u.role === 'admin' ? '/admin' : '/painel');
  });

  r.post('/sair', (ctx) => {
    encerrarSessao(db, ctx);
    ctx.redirect('/');
  });

  // ---------- rastreio público (sem dados pessoais) ----------
  r.get('/rastreio', (ctx) => {
    const codigo = String(ctx.query.codigo || '').trim().toUpperCase();
    const p = codigo ? db.prepare('SELECT * FROM pedidos WHERE codigo = ?').get(codigo) : null;
    const eventos = p ? db.prepare('SELECT * FROM pedido_eventos WHERE pedido_id = ? ORDER BY id DESC').all(p.id) : [];
    ctx.html(paginaPublica(ctx, 'Rastrear pedido', html`<section class="secao"><div class="container estreito">
      <h1 class="titulo-secao">Rastrear pedido</h1>
      <form class="filtros" method="get"><input name="codigo" value="${codigo}" placeholder="Código do pedido (ex.: PD8F21A3C4)" required><button class="btn btn-primario">Consultar</button></form>
      ${codigo && !p ? html`<div class="flash flash-erro">Pedido não encontrado. Confira o código informado pela loja.</div>` : ''}
      ${p ? html`<div class="card">
        <div class="linha-entre"><h3>Pedido ${p.codigo}</h3>${badgeStatus(p.status)}</div>
        <p class="muted">Destino: ${p.cidade}/${p.uf}</p>
        ${p.rastreio ? html`<p>Código de rastreio da transportadora: <strong>${p.rastreio}</strong> · <a href="https://rastreamento.correios.com.br/app/index.php" target="_blank" rel="noopener">consultar nos Correios ↗</a></p>` : ''}
        <ol class="linha-tempo">${eventos.map((e) => html`<li><strong>${badgeStatus(e.status)}</strong> <span class="muted pequeno">${dataBR(e.criado_em)}</span>${e.nota ? html`<div class="pequeno">${e.nota}</div>` : ''}</li>`)}</ol>
      </div>` : ''}
    </div></section>`));
  });

  r.get('/termos', (ctx) => ctx.html(paginaPublica(ctx, 'Termos de uso', legal.termos())));
  r.get('/privacidade', (ctx) => ctx.html(paginaPublica(ctx, 'Política de privacidade', legal.privacidade())));
};

module.exports.cardsPlanos = cardsPlanos;
