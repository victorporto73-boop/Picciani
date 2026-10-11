'use strict';

const env = process.env;

module.exports = {
  APP_NOME: env.APP_NOME || 'Picciani Drop',
  PORT: Number(env.PORT || 3000),
  BASE_URL: env.BASE_URL || `http://localhost:${env.PORT || 3000}`,
  // "simulado": recargas Pix podem ser confirmadas por um botão (desenvolvimento/demonstração).
  // Em produção use "manual" (admin confirma) ou integre um PSP e confirme via webhook.
  PAGAMENTO_MODO: env.PAGAMENTO_MODO || 'simulado',
  ADMIN_EMAIL: env.ADMIN_EMAIL || 'admin@exemplo.com.br',
  ADMIN_SENHA: env.ADMIN_SENHA || (env.NODE_ENV === 'production' ? '' : 'admin12345'),
  COOKIE_SEGURO: env.COOKIE_SEGURO === '1' || (env.BASE_URL || '').startsWith('https://'),
  CONTATO_EMAIL: env.CONTATO_EMAIL || 'contato@exemplo.com.br',
  CONTATO_WHATSAPP: env.CONTATO_WHATSAPP || '',
  EMPRESA_RAZAO: env.EMPRESA_RAZAO || '[RAZÃO SOCIAL]',
  EMPRESA_CNPJ: env.EMPRESA_CNPJ || '',
  EMPRESA_ENDERECO: env.EMPRESA_ENDERECO || '[ENDEREÇO COMPLETO]',
  FORO: env.FORO || '[COMARCA]/[UF]',
  DPO_EMAIL: env.DPO_EMAIL || env.CONTATO_EMAIL || 'privacidade@exemplo.com.br',
};
