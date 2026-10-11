// Banco SQLite (módulo nativo node:sqlite), esquema e dados iniciais.
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS planos (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  preco_centavos INTEGER NOT NULL,
  limite_produtos INTEGER,              -- NULL = ilimitado
  taxa_pedido_centavos INTEGER NOT NULL DEFAULT 0,
  acesso_api INTEGER NOT NULL DEFAULT 0,
  recursos TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  documento TEXT NOT NULL DEFAULT '',
  telefone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'lojista' CHECK (role IN ('lojista','admin')),
  plano_id INTEGER REFERENCES planos(id),
  plano_valido_ate TEXT,
  loja_nome TEXT NOT NULL DEFAULT '',
  loja_slug TEXT UNIQUE,
  loja_cor TEXT NOT NULL DEFAULT '#4f46e5',
  saldo_centavos INTEGER NOT NULL DEFAULT 0,
  api_key TEXT UNIQUE,
  webhook_url TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1,
  aceite_termos_em TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expira_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icone TEXT NOT NULL DEFAULT '📦'
);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  categoria_id INTEGER REFERENCES categorias(id),
  custo_centavos INTEGER NOT NULL CHECK (custo_centavos >= 0),
  preco_sugerido_centavos INTEGER NOT NULL CHECK (preco_sugerido_centavos >= 0),
  estoque INTEGER NOT NULL DEFAULT 0 CHECK (estoque >= 0),
  peso_g INTEGER NOT NULL DEFAULT 500,
  emoji TEXT NOT NULL DEFAULT '📦',
  cor TEXT NOT NULL DEFAULT '#e0e7ff',
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loja_produtos (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  preco_venda_centavos INTEGER NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, produto_id)
);

CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  origem TEXT NOT NULL CHECK (origem IN ('manual','vitrine','api')),
  referencia_externa TEXT NOT NULL DEFAULT '',
  cliente_nome TEXT NOT NULL,
  cliente_email TEXT NOT NULL DEFAULT '',
  cliente_telefone TEXT NOT NULL DEFAULT '',
  cliente_documento TEXT NOT NULL DEFAULT '',
  cep TEXT NOT NULL,
  logradouro TEXT NOT NULL,
  numero TEXT NOT NULL,
  complemento TEXT NOT NULL DEFAULT '',
  bairro TEXT NOT NULL,
  cidade TEXT NOT NULL,
  uf TEXT NOT NULL,
  venda_centavos INTEGER NOT NULL,      -- quanto o cliente final pagou ao lojista
  custo_produtos_centavos INTEGER NOT NULL,
  frete_centavos INTEGER NOT NULL,
  taxa_centavos INTEGER NOT NULL,
  total_custo_centavos INTEGER NOT NULL, -- valor debitado da carteira do lojista
  status TEXT NOT NULL,
  rastreio TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pedidos_user ON pedidos(user_id, criado_em);

CREATE TABLE IF NOT EXISTS pedido_itens (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  sku TEXT NOT NULL,
  nome TEXT NOT NULL,
  qtd INTEGER NOT NULL CHECK (qtd > 0),
  custo_unit_centavos INTEGER NOT NULL,
  preco_unit_centavos INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pedido_eventos (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  nota TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transacoes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('recarga','pedido','estorno','assinatura','ajuste')),
  valor_centavos INTEGER NOT NULL,       -- positivo = crédito, negativo = débito
  descricao TEXT NOT NULL,
  pedido_id INTEGER REFERENCES pedidos(id),
  status TEXT NOT NULL DEFAULT 'confirmada' CHECK (status IN ('pendente','confirmada','cancelada')),
  pix_codigo TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transacoes_user ON transacoes(user_id, criado_em);
`;

const PLANOS = [
  { id: 1, nome: 'Start', preco: 4990, limite: 50, taxa: 200, api: 0,
    recursos: 'Até 50 produtos na loja|Vitrine própria com seu domínio de loja|Envio em até 24h úteis|Suporte por e-mail' },
  { id: 2, nome: 'Pro', preco: 9990, limite: 300, taxa: 100, api: 1,
    recursos: 'Até 300 produtos na loja|Vitrine própria personalizável|API e webhooks para integrar sua loja|Taxa por pedido reduzida|Suporte prioritário' },
  { id: 3, nome: 'Premium', preco: 19990, limite: null, taxa: 0, api: 1,
    recursos: 'Produtos ilimitados|Sem taxa por pedido|API e webhooks|Gerente de conta dedicado|Acesso antecipado a lançamentos' },
];

const CATEGORIAS = [
  ['Eletrônicos', 'eletronicos', '🎧'],
  ['Casa e Cozinha', 'casa-cozinha', '🍳'],
  ['Beleza e Cuidados', 'beleza', '💄'],
  ['Fitness e Saúde', 'fitness', '🏋️'],
  ['Pet Shop', 'pet', '🐾'],
  ['Automotivo', 'automotivo', '🚗'],
  ['Brinquedos', 'brinquedos', '🧸'],
  ['Moda e Acessórios', 'moda', '⌚'],
];

// [sku, nome, categoria, custo, sugerido, estoque, peso_g, emoji, cor, descrição]
const PRODUTOS = [
  ['ELE-001', 'Fone de Ouvido Bluetooth TWS', 'eletronicos', 3490, 8990, 320, 150, '🎧', '#e0e7ff', 'Fone sem fio com estojo carregador, Bluetooth 5.3, autonomia de até 20 horas com o estojo.'],
  ['ELE-002', 'Smartwatch Esportivo', 'eletronicos', 6990, 17990, 140, 120, '⌚', '#dbeafe', 'Monitor de frequência cardíaca, passos e sono. Resistente a respingos. Compatível com Android e iOS.'],
  ['ELE-003', 'Caixa de Som Portátil 10W', 'eletronicos', 4290, 10990, 210, 450, '🔊', '#ede9fe', 'Som potente, Bluetooth, entrada para cartão e rádio FM. Bateria para até 8 horas.'],
  ['ELE-004', 'Carregador Turbo USB-C 20W', 'eletronicos', 1590, 4490, 600, 90, '🔌', '#e0f2fe', 'Carregamento rápido para smartphones e tablets compatíveis com Power Delivery.'],
  ['ELE-005', 'Ring Light 26cm com Tripé', 'eletronicos', 5490, 12990, 95, 1200, '💡', '#fef9c3', 'Iluminação em 3 tons e 10 níveis de intensidade. Ideal para vídeos e lives.'],
  ['CAS-001', 'Mini Processador Elétrico', 'casa-cozinha', 3990, 9490, 180, 700, '🥕', '#dcfce7', 'Processa alimentos em segundos. Lâminas em aço inox, recarregável via USB.'],
  ['CAS-002', 'Kit Potes Herméticos 10 peças', 'casa-cozinha', 4590, 10990, 150, 1500, '🫙', '#ecfccb', 'Potes com tampa de vedação, livres de BPA, próprios para micro-ondas e freezer.'],
  ['CAS-003', 'Fritadeira Elétrica sem Óleo 4L', 'casa-cozinha', 18990, 39990, 60, 4200, '🍟', '#fee2e2', 'Prepara alimentos crocantes sem óleo. Timer de 60 minutos e controle de temperatura.'],
  ['CAS-004', 'Organizador de Gaveta Ajustável', 'casa-cozinha', 1290, 3990, 420, 300, '🗂️', '#f5f5f4', 'Divisórias ajustáveis para talheres, utensílios e acessórios.'],
  ['BEL-001', 'Escova Secadora Rotativa', 'beleza', 8990, 19990, 110, 900, '💇', '#fce7f3', 'Seca, alisa e modela ao mesmo tempo. Cerdas mistas e 3 níveis de temperatura.'],
  ['BEL-002', 'Kit Skincare Vitamina C', 'beleza', 3290, 8990, 230, 350, '🧴', '#ffedd5', 'Sérum, hidratante e tônico com vitamina C. Dermatologicamente testado.'],
  ['BEL-003', 'Massageador Facial Elétrico', 'beleza', 2790, 7490, 175, 200, '✨', '#fae8ff', 'Microvibração para estimular a circulação e melhorar a absorção de cosméticos.'],
  ['FIT-001', 'Kit Elásticos de Resistência', 'fitness', 2190, 5990, 380, 400, '💪', '#d1fae5', '5 faixas com níveis de resistência diferentes, alças e bolsa para transporte.'],
  ['FIT-002', 'Garrafa Térmica Inox 1L', 'fitness', 2990, 7990, 260, 500, '🥤', '#cffafe', 'Mantém bebidas geladas por 24h e quentes por 12h. Aço inox 304.'],
  ['FIT-003', 'Tapete de Yoga Antiderrapante', 'fitness', 3790, 8990, 130, 1100, '🧘', '#e0f2fe', 'Espessura de 6mm, material TPE ecológico, com alça para transporte.'],
  ['PET-001', 'Bebedouro Fonte para Pets 2L', 'pet', 5990, 13990, 90, 1000, '🐱', '#fef3c7', 'Água sempre filtrada e circulando. Silencioso, com filtro de carvão ativado.'],
  ['PET-002', 'Escova Removedora de Pelos', 'pet', 1490, 4490, 340, 150, '🐶', '#fde68a', 'Remove pelos soltos com um clique de limpeza. Para cães e gatos.'],
  ['PET-003', 'Cama Pet Nuvem Antiestresse', 'pet', 6490, 14990, 70, 1300, '🛏️', '#f3f4f6', 'Pelúcia macia com borda elevada que transmite segurança ao animal.'],
  ['AUT-001', 'Suporte Veicular Magnético', 'automotivo', 1190, 3990, 510, 120, '📱', '#e5e7eb', 'Fixação firme na saída de ar, rotação 360°. Compatível com qualquer celular.'],
  ['AUT-002', 'Aspirador de Pó Automotivo', 'automotivo', 4990, 11990, 120, 900, '🧹', '#d6d3d1', 'Portátil, sem fio, com filtro lavável e bocais intercambiáveis.'],
  ['BRI-001', 'Cubo Mágico Profissional 3x3', 'brinquedos', 990, 3490, 450, 100, '🧩', '#fecaca', 'Giro suave e ajuste de tensão. Ideal para iniciantes e speedcubers.'],
  ['BRI-002', 'Carrinho Controle Remoto 4x4', 'brinquedos', 7990, 17990, 65, 1400, '🏎️', '#bfdbfe', 'Tração nas 4 rodas, bateria recarregável e alcance de até 30 metros.'],
  ['MOD-001', 'Óculos de Sol Polarizado UV400', 'moda', 1990, 6990, 290, 80, '🕶️', '#e2e8f0', 'Lentes polarizadas com proteção UV400. Acompanha estojo e flanela.'],
  ['MOD-002', 'Mochila Antifurto USB', 'moda', 6990, 15990, 100, 900, '🎒', '#c7d2fe', 'Zíper oculto, compartimento para notebook de até 15,6" e saída USB para carregador.'],
];

function openDb(file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'dropship.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

// Executa fn dentro de uma transação; desfaz tudo se lançar exceção.
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function seed(db, { hashSenha, adminEmail, adminSenha }) {
  const temPlano = db.prepare('SELECT COUNT(*) n FROM planos').get().n;
  if (!temPlano) {
    const ins = db.prepare('INSERT INTO planos (id, nome, preco_centavos, limite_produtos, taxa_pedido_centavos, acesso_api, recursos) VALUES (?,?,?,?,?,?,?)');
    for (const p of PLANOS) ins.run(p.id, p.nome, p.preco, p.limite, p.taxa, p.api, p.recursos);
  }
  const temCat = db.prepare('SELECT COUNT(*) n FROM categorias').get().n;
  if (!temCat) {
    const ins = db.prepare('INSERT INTO categorias (nome, slug, icone) VALUES (?,?,?)');
    for (const c of CATEGORIAS) ins.run(...c);
    const cat = Object.fromEntries(db.prepare('SELECT slug, id FROM categorias').all().map((r) => [r.slug, r.id]));
    const insP = db.prepare(`INSERT INTO produtos (sku, nome, categoria_id, custo_centavos, preco_sugerido_centavos, estoque, peso_g, emoji, cor, descricao)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const [sku, nome, c, custo, sug, est, peso, emoji, cor, desc] of PRODUTOS) insP.run(sku, nome, cat[c], custo, sug, est, peso, emoji, cor, desc);
  }
  if (adminEmail && adminSenha) {
    const existe = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
    if (!existe) {
      db.prepare("INSERT INTO users (nome, email, senha_hash, role, aceite_termos_em) VALUES ('Administrador', ?, ?, 'admin', datetime('now'))")
        .run(adminEmail, hashSenha(adminSenha));
    }
  }
}

module.exports = { openDb, seed, tx };
