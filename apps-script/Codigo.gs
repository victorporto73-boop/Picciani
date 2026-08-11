/**
 * Cadastro Reunião — backend Apps Script
 * Planilha: 1UZR3rKnOLbIGDr9Z9qMR1RUmxTvxfqF1Zg3mwzUM4FU
 *
 * Instalação:
 * 1. Abra a planilha → Extensões → Apps Script
 * 2. Cole este arquivo em Codigo.gs e crie um arquivo HTML chamado "Index"
 *    com o conteúdo de Index.html
 * 3. Execute uma vez a função prepararPlanilha() (autorize quando pedir)
 * 4. Implantar → Nova implantação → App da Web
 *    Executar como: eu · Quem tem acesso: qualquer pessoa
 * 5. Abra a URL gerada no celular e use "Adicionar à tela de início"
 */

const SHEET_ID = '1UZR3rKnOLbIGDr9Z9qMR1RUmxTvxfqF1Zg3mwzUM4FU';
const ABA = 'Cadastros';
const COLUNAS = ['data_hora', 'nome', 'telefone', 'bairro', 'quem_indicou', 'cadastrado_por', 'id'];

function doGet(e) {
  // ?acao=total|listar → JSON (fallback de leitura para o app hospedado)
  const acao = e && e.parameter && e.parameter.acao;
  if (acao === 'total') return json_({ total: contarCadastros() });
  if (acao === 'listar') return json_(listarCadastros(Number(e.parameter.limite) || 200));

  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Cadastro Reunião')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function planilha_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let aba = ss.getSheetByName(ABA);
  if (!aba) {
    aba = ss.insertSheet(ABA);
  }
  if (aba.getLastRow() === 0) {
    aba.getRange(1, 1, 1, COLUNAS.length).setValues([COLUNAS]).setFontWeight('bold');
    aba.setFrozenRows(1);
  }
  return aba;
}

/** Rode uma vez na mão para criar a aba e o cabeçalho. */
function prepararPlanilha() {
  planilha_();
}

/** Ids já gravados, para não duplicar quando a fila é reenviada. */
function idsExistentes_(aba) {
  const linhas = aba.getLastRow() - 1;
  if (linhas < 1) return {};
  const valores = aba.getRange(2, COLUNAS.indexOf('id') + 1, linhas, 1).getValues();
  const mapa = {};
  valores.forEach(function (v) { mapa[String(v[0])] = true; });
  return mapa;
}

/**
 * Recebe a fila do celular. Retorna os ids realmente gravados
 * para o app marcar como enviados.
 */
function salvarRegistros(registros) {
  if (!registros || !registros.length) return { gravados: [], total: contarCadastros() };

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const aba = planilha_();
    const existentes = idsExistentes_(aba);
    const novas = [];
    const gravados = [];

    registros.forEach(function (r) {
      if (!r || !r.id || existentes[String(r.id)]) return;
      existentes[String(r.id)] = true;
      novas.push([
        r.data_hora || new Date().toISOString(),
        r.nome || '',
        r.telefone || '',
        r.bairro || '',
        r.quem_indicou || '',
        r.cadastrado_por || '',
        r.id,
      ]);
      gravados.push(r.id);
    });

    if (novas.length) {
      aba.getRange(aba.getLastRow() + 1, 1, novas.length, COLUNAS.length).setValues(novas);
    }
    return { gravados: gravados, total: aba.getLastRow() - 1 };
  } finally {
    lock.releaseLock();
  }
}

function contarCadastros() {
  return Math.max(planilha_().getLastRow() - 1, 0);
}

/** Últimos cadastros da planilha, para a aba Lista e para as sugestões. */
function listarCadastros(limite) {
  const aba = planilha_();
  const linhas = aba.getLastRow() - 1;
  if (linhas < 1) return { total: 0, itens: [] };

  const n = Math.min(limite || 200, linhas);
  const inicio = aba.getLastRow() - n + 1;
  const valores = aba.getRange(inicio, 1, n, COLUNAS.length).getValues();

  const itens = valores.map(function (v) {
    return {
      data_hora: v[0] instanceof Date ? v[0].toISOString() : String(v[0]),
      nome: String(v[1]),
      telefone: String(v[2]),
      bairro: String(v[3]),
      quem_indicou: String(v[4]),
      cadastrado_por: String(v[5]),
      id: String(v[6]),
    };
  }).reverse();

  return { total: linhas, itens: itens };
}

/**
 * Endpoint usado pela versão hospedada no GitHub Pages.
 * Recebe {acao:'salvar'|'total'|'listar', ...} por POST e devolve JSON.
 */
function doPost(e) {
  let resposta;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const acao = body.acao || 'salvar';
    if (acao === 'total') {
      resposta = { total: contarCadastros() };
    } else if (acao === 'listar') {
      resposta = listarCadastros(body.limite || 200);
    } else {
      resposta = salvarRegistros(body.registros || []);
    }
  } catch (err) {
    resposta = { erro: String(err) };
  }
  return json_(resposta);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
