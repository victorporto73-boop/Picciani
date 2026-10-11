// Comportamentos progressivos (o site funciona sem JavaScript; aqui só há conveniências).
(function () {
  'use strict';
  if (window.__dropApp) return;
  window.__dropApp = true;

  const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const centavos = (s) => {
    s = String(s || '').replace(/[R$\s]/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  };
  const dig = (s) => String(s || '').replace(/\D/g, '');

  // ---- máscaras ----
  const mascaras = {
    cep: (v) => dig(v).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2'),
    telefone: (v) => {
      const d = dig(v).slice(0, 11);
      return d.length > 10 ? d.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3') : d.replace(/(\d{2})(\d{0,4})(\d{0,4})/, (m, a, b, c) => (a ? `(${a}` : '') + (b ? `) ${b}` : '') + (c ? `-${c}` : ''));
    },
    documento: (v) => {
      const d = dig(v).slice(0, 14);
      if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
      return d.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
    },
  };
  document.querySelectorAll('[data-mascara]').forEach((el) => {
    const f = mascaras[el.dataset.mascara];
    if (!f) return;
    el.value = f(el.value);
    el.addEventListener('input', () => { el.value = f(el.value); });
  });

  // ---- CEP → endereço (ViaCEP) ----
  document.querySelectorAll('[data-cep]').forEach((el) => {
    el.addEventListener('input', async () => {
      const cep = dig(el.value);
      document.dispatchEvent(new CustomEvent('cep-alterado', { detail: cep }));
      if (cep.length !== 8) return;
      try {
        const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const j = await r.json();
        if (j.erro) return;
        const form = el.closest('form');
        form.querySelectorAll('[data-cep-campo]').forEach((c) => {
          const v = j[c.dataset.cepCampo];
          if (v && !c.value) c.value = v;
        });
        const num = form.querySelector('[name=numero]');
        if (num && !num.value) num.focus();
      } catch { /* sem internet ou ViaCEP indisponível: preenchimento manual */ }
    });
  });

  // ---- copiar ----
  document.querySelectorAll('[data-copiar]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.preventDefault();
      const alvo = document.getElementById(b.dataset.copiar);
      try { await navigator.clipboard.writeText(alvo.value); } catch { alvo.type = 'text'; alvo.select(); document.execCommand('copy'); }
      const t = b.textContent; b.textContent = 'Copiado!'; setTimeout(() => { b.textContent = t; }, 1500);
    });
  });
  document.querySelectorAll('[data-revelar]').forEach((el) => {
    el.addEventListener('focus', () => { el.type = 'text'; });
    el.addEventListener('blur', () => { el.type = 'password'; });
  });

  // ---- confirmação ----
  document.querySelectorAll('form[data-confirmar]').forEach((f) => {
    f.addEventListener('submit', (e) => { if (!confirm(f.dataset.confirmar)) e.preventDefault(); });
  });

  // ---- atalhos de valor (recarga) ----
  document.querySelectorAll('[data-valor]').forEach((b) => {
    b.addEventListener('click', () => { const i = document.getElementById('valor-recarga'); i.value = b.dataset.valor; i.focus(); });
  });

  // ---- calculadora de margem (página do produto) ----
  const calc = document.querySelector('form.calc');
  if (calc) {
    const custo = Number(calc.dataset.custo);
    const preco = calc.querySelector('[data-calc-preco]');
    const atualizar = () => {
      const p = centavos(preco.value);
      const lucro = calc.querySelector('[data-calc-lucro]');
      const margem = calc.querySelector('[data-calc-margem]');
      if (!Number.isFinite(p) || p <= 0) { lucro.textContent = '—'; margem.textContent = '—'; return; }
      lucro.textContent = brl(p - custo);
      lucro.className = p - custo >= 0 ? 'verde' : 'vermelho';
      margem.textContent = Math.round(((p - custo) / p) * 100) + '%';
    };
    preco.addEventListener('input', atualizar);
    atualizar();
  }

  // ---- resumo do novo pedido (painel) ----
  const resumo = document.querySelector('[data-resumo]');
  if (resumo && window.FRETE) {
    const form = resumo.closest('form');
    let cep = dig((form.querySelector('[name=cep]') || {}).value);
    const taxaEl = resumo.querySelector('[data-r-taxa]');
    const taxa = Number(taxaEl.dataset.taxa || 0);
    const atualizar = () => {
      let venda = 0, custo = 0, peso = 0, n = 0;
      form.querySelectorAll('.input-qtd').forEach((i) => {
        const q = Number(i.value) || 0;
        if (q <= 0) return;
        n += q;
        venda += q * Number(i.dataset.preco);
        custo += q * Number(i.dataset.custo);
        peso += q * Number(i.dataset.peso);
      });
      let frete = null;
      if (cep.length === 8 && n) {
        frete = window.FRETE[cep[0]] + Math.max(0, Math.ceil((peso - 1000) / 1000)) * 450;
      }
      const set = (sel, v) => { resumo.querySelector(sel).textContent = v; };
      set('[data-r-venda]', n ? brl(venda) : '—');
      set('[data-r-custo]', n ? brl(custo) : '—');
      set('[data-r-frete]', frete === null ? (n ? 'informe o CEP' : '—') : brl(frete));
      taxaEl.textContent = n ? brl(taxa) : '—';
      if (n && frete !== null) {
        const total = custo + frete + taxa;
        set('[data-r-total]', brl(total));
        set('[data-r-lucro]', brl(venda - total));
      } else { set('[data-r-total]', '—'); set('[data-r-lucro]', '—'); }
    };
    form.addEventListener('input', atualizar);
    document.addEventListener('cep-alterado', (e) => { cep = e.detail; atualizar(); });
    atualizar();
  }
})();
