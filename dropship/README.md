# Plataforma de Dropshipping

Plataforma de dropshipping nacional: o lojista escolhe produtos do catálogo, vende na própria
vitrine, em marketplaces ou na sua loja integrada via API, e a plataforma separa, embala e envia
direto ao cliente final.

Não usa dependências externas: Node.js ≥ 22.13 com SQLite nativo (`node:sqlite`).

## Rodar

    cd dropship
    npm start          # http://localhost:3000
    npm test           # testes de ponta a ponta

Administrador padrão em desenvolvimento: `admin@exemplo.com.br` / `admin12345`
(altere com `ADMIN_EMAIL` e `ADMIN_SENHA`; em produção não há senha padrão).

## Funcionalidades

**Site público** — página inicial, catálogo (custo oculto para visitantes), planos, FAQ,
rastreio público sem dados pessoais, Termos de Uso e Política de Privacidade (minutas).

**Painel do lojista** (`/painel`)
- Catálogo com custo, preço sugerido, lucro, margem, estoque, busca, filtros e ordenação
- Minha loja: preço de venda próprio (nunca abaixo do custo), ocultar/remover produtos
- Pedidos manuais (marketplace, WhatsApp) com busca de CEP (ViaCEP) e resumo de lucro ao vivo
- Carteira pré-paga: recarga via Pix, extrato e liberação automática de pedidos pendentes
- Planos Start / Pro / Premium (limite de produtos, taxa por pedido, acesso à API); 7 dias grátis
- Integrações: chave de API, webhook assinado (HMAC-SHA256) e documentação
- Configurações da loja (nome, endereço da vitrine, cor) e troca de senha

**Vitrine do lojista** (`/loja/<slug>`) — produtos com o preço do lojista, carrinho, checkout,
confirmação; identificação do fornecedor no rodapé (Decreto 7.962/2013).

**Administração** (`/admin`) — fila de expedição, avanço de status com rastreio, cancelamento
com estorno, cadastro de produtos e estoque, lojistas (ajuste de saldo, desativação), recargas.

**API REST** (`/api/v1`, planos Pro e Premium) — produtos, cotação de frete, criação de pedidos
(idempotente por `referencia_externa`), consulta, listagem e cancelamento.

## Ciclo do pedido

    aguardando_pagamento → pago → em_separacao → enviado (rastreio) → entregue
                       ↘ cancelado (estorno integral e devolução do estoque se já pago)

No pagamento são debitados da carteira: custo dos produtos + frete + taxa do plano. O estoque
só é baixado quando o pedido é pago.

## Configuração (variáveis de ambiente)

| Variável | Uso |
|---|---|
| `PORT`, `BASE_URL` | porta e URL pública (com `https://` os cookies ficam `Secure`) |
| `DB_FILE` | caminho do banco SQLite (padrão `data/dropship.db`) |
| `APP_NOME` | nome da plataforma |
| `PAGAMENTO_MODO` | `simulado` (botão de confirmação, demonstração) ou `manual` (admin confirma) |
| `ADMIN_EMAIL`, `ADMIN_SENHA` | administrador criado na primeira execução |
| `EMPRESA_RAZAO`, `EMPRESA_CNPJ`, `EMPRESA_ENDERECO`, `FORO`, `DPO_EMAIL`, `CONTATO_EMAIL`, `CONTATO_WHATSAPP` | dados exibidos no rodapé e nos documentos legais |

## Antes de colocar em produção

1. **Pagamentos**: integrar um PSP (Mercado Pago, Asaas, Efí etc.) em `criarRecarga()` e confirmar
   via webhook chamando `confirmarRecarga()` (`src/servicos.js`). Na vitrine, o cliente final hoje
   paga de forma simulada; integre o meio de pagamento do lojista no checkout.
2. **Frete**: trocar a tabela por faixa de CEP em `calcularFrete()` por cotação real
   (Correios, Melhor Envio, Frenet).
3. **Fiscal**: emissão de NF-e não está incluída.
4. **Documentos legais**: preencher os campos entre colchetes e revisar as minutas em
   `src/views/legal.js` conforme o modelo de negócio efetivo.
5. Rodar atrás de proxy HTTPS (Nginx, Caddy) e fazer backup periódico do arquivo SQLite.
