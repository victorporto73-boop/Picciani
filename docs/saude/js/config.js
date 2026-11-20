// Configuração da implantação.
export const CONFIG = {
  // URL /exec do Apps Script (Implantar → App da Web). Deixe vazio para que o
  // app peça a URL na primeira abertura (fica gravada naquele aparelho).
  WEBAPP_URL: '',

  NOME_SISTEMA: 'Gestão Integrada da Saúde',
  ORGAO: 'Secretaria Municipal de Saúde de Rio das Ostras',

  // Intervalo de sincronização: com a aba visível e em segundo plano.
  POLL_VISIVEL_MS: 6000,
  POLL_OCULTO_MS: 45000,
};
