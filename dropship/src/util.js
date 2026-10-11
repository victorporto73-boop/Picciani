'use strict';

const crypto = require('node:crypto');

function brl(centavos) {
  return (Number(centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Converte "1.234,56", "1234.56" ou "89,90" em centavos inteiros.
function toCentavos(v) {
  if (typeof v === 'number') return Math.round(v * 100);
  let s = String(v ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

const centsToInput = (c) => (Number(c || 0) / 100).toFixed(2).replace('.', ',');

function slugify(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');

function cpfValido(cpf) {
  cpf = soDigitos(cpf);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  for (let t = 9; t < 11; t++) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(cpf[i]) * (t + 1 - i);
    const d = ((soma * 10) % 11) % 10;
    if (d !== Number(cpf[t])) return false;
  }
  return true;
}

function cnpjValido(cnpj) {
  cnpj = soDigitos(cnpj);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const calc = (len) => {
    const pesos = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + Number(cnpj[i]) * p, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

const documentoValido = (d) => cpfValido(d) || cnpjValido(d);

const token = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

function codigoPedido() {
  return 'PD' + Date.now().toString(36).toUpperCase().slice(-6) + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function dataBR(sqlDate) {
  if (!sqlDate) return '';
  const d = new Date(sqlDate.replace(' ', 'T') + (sqlDate.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

module.exports = { brl, toCentavos, centsToInput, slugify, soDigitos, cpfValido, cnpjValido, documentoValido, token, codigoPedido, dataBR, UFS };
