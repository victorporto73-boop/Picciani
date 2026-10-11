// API REST v1 para integração de lojas virtuais. Autenticação: Authorization: Bearer <api_key>.
'use strict';

const crypto = require('node:crypto');
const S = require('../servicos');

function erro(ctx, status, mensagem) { ctx.json({ erro: mensagem }, status); return false; }

module.exports = function rotasApi(r, db) {
  const autenticar = (ctx) => {
    const m = /^Bearer\s+(\S+)$/i.exec(ctx.req.headers.authorization || '');
    if (!m) return erro(ctx, 401, 'Informe o cabeçalho Authorization: Bearer <chave>.');
    // Comparação em tempo constante sobre o hash, para não vazar a chave por temporização.
    const h = crypto.createHash('sha256').update(m[1]).digest();
    const u = db.prepare("SELECT * FROM users WHERE api_key = ? AND role = 'lojista' AND ativo = 1").get(m[1]);
    if (!u || !crypto.timingSafeEqual(h, crypto.createHash('sha256').update(u.api_key).digest())) return erro(ctx, 401, 'Chave de API inválida.');
    const plano = S.planoAtivo(db, u);
    if (!plano) return erro(ctx, 402, 'Plano inativo.');
    if (!plano.acesso_api) return erro(ctx, 403, 'Seu plano não inclui acesso à API.');
    ctx.apiUser = u;
    return true;
  };

  const produtoApi = (p) => ({
    id: p.id, sku: p.sku, nome: p.nome, descricao: p.descricao, categoria: p.categoria,
    custo_centavos: p.custo_centavos, preco_sugerido_centavos: p.preco_sugerido_centavos,
    preco_venda_centavos: p.preco_venda_centavos ?? null, na_minha_loja: p.preco_venda_centavos != null,
    estoque: p.estoque, peso_g: p.peso_g,
  });

  r.get('/api/v1/produtos', autenticar, (ctx) => {
    const rows = db.prepare(`SELECT p.*, c.nome categoria, lp.preco_venda_centavos FROM produtos p JOIN categorias c ON c.id = p.categoria_id
      LEFT JOIN loja_produtos lp ON lp.produto_id = p.id AND lp.user_id = ? WHERE p.ativo = 1 ORDER BY p.sku`).all(ctx.apiUser.id);
    ctx.json({ produtos: rows.map(produtoApi) });
  });

  // Converte itens [{sku|produto_id, qtd, preco_unit_centavos}] para o formato interno.
  function resolverItens(itens) {
    if (!Array.isArray(itens)) throw new S.ErroNegocio('"itens" deve ser uma lista.', 400);
    return itens.map((i) => {
      let id = Number(i.produto_id);
      if (i.sku) {
        const p = db.prepare('SELECT id FROM produtos WHERE sku = ?').get(String(i.sku).toUpperCase());
        if (!p) throw new S.ErroNegocio(`SKU inexistente: ${i.sku}`, 404);
        id = p.id;
      }
      const preco = i.preco_unit_centavos === undefined ? undefined : Number(i.preco_unit_centavos);
      return { produto_id: id, qtd: Number(i.qtd), preco_unit_centavos: Number.isInteger(preco) ? preco : undefined };
    });
  }

  r.get('/api/v1/frete', autenticar, (ctx) => {
    try {
      const itens = resolverItens(String(ctx.query.itens || '').split(',').filter(Boolean).map((s) => {
        const [sku, qtd] = s.split(':');
        return { sku, qtd: Number(qtd || 1) };
      }));
      const { peso, custo } = S.cotarItens(db, ctx.apiUser, itens);
      const f = S.calcularFrete(ctx.query.cep, peso);
      ctx.json({ frete_centavos: f.centavos, prazo: f.prazo, regiao: f.regiao, peso_g: peso, custo_produtos_centavos: custo });
    } catch (e) {
      if (!e.negocio) throw e;
      erro(ctx, e.status, e.message);
    }
  });

  r.post('/api/v1/pedidos', autenticar, (ctx) => {
    const b = ctx.body || {};
    const c = b.cliente || {};
    const e = b.endereco || {};
    try {
      const ref = String(b.referencia_externa || '').trim();
      if (ref) {
        // Idempotência: reenviar o mesmo pedido externo devolve o já criado.
        const ja = db.prepare('SELECT * FROM pedidos WHERE user_id = ? AND referencia_externa = ? AND status <> ?').get(ctx.apiUser.id, ref, 'cancelado');
        if (ja) return ctx.json({ pedido: S.pedidoParaApi(db, ja), duplicado: true }, 200);
      }
      const p = S.criarPedido(db, ctx.apiUser.id, {
        referencia_externa: ref,
        cliente_nome: c.nome, cliente_email: c.email, cliente_telefone: c.telefone, cliente_documento: c.documento,
        cep: e.cep, logradouro: e.logradouro, numero: e.numero, complemento: e.complemento, bairro: e.bairro, cidade: e.cidade, uf: e.uf,
        itens: resolverItens(b.itens),
      }, 'api');
      ctx.json({ pedido: S.pedidoParaApi(db, p) }, 201);
    } catch (err) {
      if (!err.negocio) throw err;
      erro(ctx, err.status, err.message);
    }
  });

  r.get('/api/v1/pedidos', autenticar, (ctx) => {
    const st = S.STATUS[ctx.query.status] ? ctx.query.status : '';
    const limite = Math.min(100, Math.max(1, Number(ctx.query.limite) || 50));
    const rows = db.prepare("SELECT * FROM pedidos WHERE user_id = ? AND (? = '' OR status = ?) ORDER BY id DESC LIMIT ?").all(ctx.apiUser.id, st, st, limite);
    ctx.json({ pedidos: rows.map((p) => S.pedidoParaApi(db, p)) });
  });

  r.get('/api/v1/pedidos/:codigo', autenticar, (ctx) => {
    const p = db.prepare('SELECT * FROM pedidos WHERE codigo = ? AND user_id = ?').get(ctx.params.codigo, ctx.apiUser.id);
    if (!p) return erro(ctx, 404, 'Pedido não encontrado.');
    ctx.json({ pedido: S.pedidoParaApi(db, p) });
  });

  r.post('/api/v1/pedidos/:codigo/cancelar', autenticar, (ctx) => {
    const p = db.prepare('SELECT * FROM pedidos WHERE codigo = ? AND user_id = ?').get(ctx.params.codigo, ctx.apiUser.id);
    if (!p) return erro(ctx, 404, 'Pedido não encontrado.');
    try {
      S.cancelarPedido(db, p.id);
      ctx.json({ pedido: S.pedidoParaApi(db, db.prepare('SELECT * FROM pedidos WHERE id = ?').get(p.id)) });
    } catch (e) {
      if (!e.negocio) throw e;
      erro(ctx, e.status, e.message);
    }
  });
};
