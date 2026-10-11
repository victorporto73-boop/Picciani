'use strict';

const http = require('node:http');
const { createApp } = require('./src/app');
const config = require('./src/config');

if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_SENHA) {
  console.warn('[aviso] ADMIN_SENHA não definida: nenhum administrador padrão será criado.');
}

const { handler } = createApp();
http.createServer(handler).listen(config.PORT, () => {
  console.log(`${config.APP_NOME} rodando em ${config.BASE_URL}`);
  if (config.PAGAMENTO_MODO === 'simulado') console.log('Pagamentos em modo SIMULADO (demonstração).');
});
