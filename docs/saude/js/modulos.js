// Definição dos módulos da Secretaria. Cada módulo vira uma aba na planilha,
// uma tela com tabela/kanban, formulário, alertas e indicadores — tudo gerado
// a partir deste esquema. Para criar um campo novo, basta acrescentá-lo aqui.

import { hoje, addDias, diasAte, diasDesde, fmtMoeda, fmtPct, fmtNum, fmtMoedaCurta, fmtData, semanaEpi } from './util.js';

export const SETORES_PADRAO = [
  'Gabinete do Secretário',
  'Atenção Primária',
  'Atenção Especializada',
  'Urgência e Emergência',
  'Atenção Hospitalar',
  'Regulação, Controle e Avaliação',
  'Assistência Farmacêutica',
  'Vigilância em Saúde',
  'Saúde Mental',
  'Saúde Bucal',
  'Planejamento e Gestão',
  'Fundo Municipal de Saúde',
  'Compras e Contratos',
  'Recursos Humanos',
  'Assessoria Jurídica',
  'Ouvidoria',
  'Comunicação',
  'Tecnologia da Informação',
];

export const GRUPOS = [
  { id: 'gabinete', nome: 'Gabinete' },
  { id: 'rede', nome: 'Rede e Assistência' },
  { id: 'vigilancia', nome: 'Vigilância em Saúde' },
  { id: 'controle', nome: 'Controle e Demandas Externas' },
  { id: 'gestao', nome: 'Gestão e Finanças' },
];

const pct = (a, b) => (b > 0 ? (a / b) * 100 : null);
const n = (v) => Number(v) || 0;
const aberto = (m, r) => !(m.fechados || []).includes(r[m.status]);
const setor = (padrao) => ({ k: 'setor', l: 'Setor responsável', t: 'select', op: 'setores', filtro: true, padrao });
const unidadeRef = (l = 'Unidade', extra = {}) => ({ k: 'unidade', l, t: 'ref', ref: 'unidades', filtro: true, ...extra });

/** Alerta de prazo genérico: vencido = crítico; até `crit` dias = crítico; até `warn` dias = atenção. */
function alertaPrazo(data, rotulo, crit = 3, warn = 7) {
  const d = diasAte(data);
  if (d == null) return [];
  if (d < 0) return [{ nivel: 'crit', msg: `${rotulo} vencido há ${-d} dia(s)` }];
  if (d === 0) return [{ nivel: 'crit', msg: `${rotulo} vence hoje` }];
  if (d <= crit) return [{ nivel: 'crit', msg: `${rotulo} vence em ${d} dia(s)` }];
  if (d <= warn) return [{ nivel: 'warn', msg: `${rotulo} vence em ${d} dia(s)` }];
  return [];
}

export const MODULOS = [
  // ───────────────────────────── GABINETE ─────────────────────────────
  {
    id: 'agenda', nome: 'Agenda do Gabinete', singular: 'Compromisso', grupo: 'gabinete', icone: 'agenda',
    desc: 'Reuniões, audiências, visitas técnicas e sessões do Conselho Municipal de Saúde — integrada aos prazos de todos os módulos.',
    titulo: (r) => r.titulo, sub: (r) => [r.tipo, r.local].filter(Boolean).join(' · '),
    status: 'status', fechados: ['Realizado', 'Cancelado'],
    cores: { Agendado: 'info', Confirmado: 'pri', Realizado: 'ok', Cancelado: 'mute' },
    visoes: ['calendario', 'tabela'],
    campos: [
      { k: 'titulo', l: 'Título', t: 'text', req: true, col: true, larg: 'full' },
      { k: 'tipo', l: 'Tipo', t: 'select', col: true, filtro: true, op: ['Reunião', 'Audiência pública', 'Audiência judicial', 'Visita técnica', 'Conselho Municipal de Saúde', 'Evento', 'Despacho interno', 'Câmara Municipal', 'Outro'] },
      { k: 'status', l: 'Situação', t: 'select', col: true, filtro: true, op: ['Agendado', 'Confirmado', 'Realizado', 'Cancelado'], padrao: 'Agendado' },
      { k: 'inicio', l: 'Início', t: 'datetime', req: true, col: true },
      { k: 'fim', l: 'Término', t: 'datetime' },
      { k: 'local', l: 'Local', t: 'text', col: true },
      unidadeRef('Unidade relacionada'),
      { k: 'participantes', l: 'Participantes', t: 'text', larg: 'full' },
      { k: 'pauta', l: 'Pauta', t: 'textarea', larg: 'full' },
      { k: 'encaminhamentos', l: 'Encaminhamentos / deliberações', t: 'textarea', larg: 'full' },
    ],
    ordenar: (a, b) => String(a.inicio).localeCompare(String(b.inicio)),
    resumo: (l) => {
      const hj = hoje();
      const sem = addDias(hj, 7);
      return [
        { l: 'Hoje', v: l.filter((r) => String(r.inicio).slice(0, 10) === hj && r.status !== 'Cancelado').length },
        { l: 'Próximos 7 dias', v: l.filter((r) => { const d = String(r.inicio).slice(0, 10); return d > hj && d <= sem && r.status !== 'Cancelado'; }).length },
        { l: 'A confirmar', v: l.filter((r) => r.status === 'Agendado' && String(r.inicio).slice(0, 10) >= hj).length, tom: 'info' },
      ];
    },
  },
  {
    id: 'tarefas', nome: 'Demandas e Tarefas', singular: 'Demanda', grupo: 'gabinete', icone: 'tarefas',
    desc: 'Determinações do Secretário e demandas entre setores, com responsável, prazo e vínculo ao registro de origem.',
    titulo: (r) => r.titulo, sub: (r) => [r.setor, r.responsavel].filter(Boolean).join(' · '),
    status: 'status', fechados: ['Concluída', 'Cancelada'], kanban: 'status',
    cores: { 'A fazer': 'mute', 'Em andamento': 'info', 'Aguardando terceiros': 'warn', 'Concluída': 'ok', 'Cancelada': 'mute' },
    visoes: ['kanban', 'tabela'],
    campos: [
      { k: 'titulo', l: 'Demanda', t: 'text', req: true, col: true, larg: 'full' },
      { k: 'status', l: 'Situação', t: 'select', col: true, filtro: true, op: ['A fazer', 'Em andamento', 'Aguardando terceiros', 'Concluída', 'Cancelada'], padrao: 'A fazer' },
      { k: 'prioridade', l: 'Prioridade', t: 'select', col: true, filtro: true, op: ['Baixa', 'Média', 'Alta', 'Urgente'], padrao: 'Média' },
      setor(),
      { k: 'responsavel', l: 'Responsável', t: 'text', col: true },
      { k: 'prazo', l: 'Prazo', t: 'date', col: true },
      { k: 'origem', l: 'Origem', t: 'text', dica: 'Ex.: despacho do Secretário, reunião, ofício, mandado judicial.' },
      { k: 'descricao', l: 'Descrição / orientações', t: 'textarea', larg: 'full' },
      { k: 'vinculo', l: 'Registro vinculado', t: 'vinculo', larg: 'full' },
    ],
    prazo: 'prazo',
    ordenar: (a, b) => String(a.prazo || '9999').localeCompare(String(b.prazo || '9999')),
    alertas: (r, m) => {
      if (!aberto(m, r)) return [];
      const a = alertaPrazo(r.prazo, 'Prazo da demanda', 1, 3);
      if (!a.length && r.prioridade === 'Urgente') a.push({ nivel: 'warn', msg: 'Demanda urgente em aberto' });
      return a;
    },
    resumo: (l, m) => {
      const ab = l.filter((r) => aberto(m, r));
      return [
        { l: 'Em aberto', v: ab.length },
        { l: 'Atrasadas', v: ab.filter((r) => diasAte(r.prazo) < 0).length, tom: 'crit' },
        { l: 'Urgentes', v: ab.filter((r) => r.prioridade === 'Urgente').length, tom: 'warn' },
        { l: 'Concluídas (30 dias)', v: l.filter((r) => r.status === 'Concluída' && diasDesde(String(r.atualizado_em || '').slice(0, 10)) <= 30).length, tom: 'ok' },
      ];
    },
  },
  {
    id: 'avisos', nome: 'Mural de Avisos', singular: 'Aviso', grupo: 'gabinete', icone: 'mural',
    desc: 'Comunicados internos. Avisos importantes e urgentes aparecem na hora para todos os usuários conectados.',
    titulo: (r) => r.titulo, sub: (r) => [r.prioridade, r.destino].filter(Boolean).join(' · '),
    status: 'prioridade', cores: { Informativo: 'info', Importante: 'warn', Urgente: 'crit' },
    visoes: ['tabela'],
    campos: [
      { k: 'titulo', l: 'Título', t: 'text', req: true, col: true, larg: 'full' },
      { k: 'prioridade', l: 'Prioridade', t: 'select', col: true, filtro: true, op: ['Informativo', 'Importante', 'Urgente'], padrao: 'Informativo' },
      { k: 'destino', l: 'Destinatários', t: 'text', col: true, padrao: 'Todos os setores' },
      { k: 'validade', l: 'Exibir até', t: 'date', col: true },
      { k: 'mensagem', l: 'Mensagem', t: 'textarea', req: true, larg: 'full' },
    ],
    ordenar: (a, b) => String(b.criado_em).localeCompare(String(a.criado_em)),
  },

  // ───────────────────────────── REDE ─────────────────────────────
  {
    id: 'unidades', nome: 'Rede de Unidades', singular: 'Unidade', grupo: 'rede', icone: 'unidades',
    desc: 'Situação operacional de cada unidade, leitos e responsáveis. Abra uma unidade para ver tudo o que está ligado a ela em todos os módulos.',
    titulo: (r) => r.nome, sub: (r) => [r.tipo, r.bairro].filter(Boolean).join(' · '),
    status: 'status', cores: { Normal: 'ok', Atenção: 'warn', Crítico: 'crit', Fechada: 'mute' },
    kanban: 'status', visoes: ['tabela', 'kanban'],
    campos: [
      { k: 'nome', l: 'Nome da unidade', t: 'text', req: true, col: true, larg: 'full' },
      { k: 'tipo', l: 'Tipo', t: 'select', col: true, filtro: true, op: ['Hospital', 'UPA 24h', 'Pronto Atendimento', 'UBS / ESF', 'Policlínica / Especialidades', 'CAPS', 'CEO (Odontologia)', 'Farmácia / CAF', 'Laboratório', 'Vigilância em Saúde', 'SAMU / Base', 'Administrativo', 'Outro'] },
      { k: 'status', l: 'Situação operacional', t: 'select', col: true, filtro: true, op: ['Normal', 'Atenção', 'Crítico', 'Fechada'], padrao: 'Normal' },
      { k: 'bairro', l: 'Bairro', t: 'text', col: true, filtro: true },
      { k: 'endereco', l: 'Endereço', t: 'text', larg: 'full' },
      { k: 'responsavel', l: 'Direção / responsável', t: 'text', col: true },
      { k: 'telefone', l: 'Telefone', t: 'text' },
      { k: 'cnes', l: 'CNES', t: 'text', mono: true },
      { k: 'leitos_total', l: 'Leitos (total)', t: 'number', min: 0 },
      { k: 'leitos_ocupados', l: 'Leitos ocupados', t: 'number', min: 0 },
      { k: 'observacoes', l: 'Observações', t: 'textarea', larg: 'full' },
    ],
    calc: [{ k: 'ocupacao', l: 'Ocupação', fmt: 'pct', col: true, v: (r) => (n(r.leitos_total) ? pct(n(r.leitos_ocupados), n(r.leitos_total)) : null) }],
    ordenar: (a, b) => String(a.nome).localeCompare(String(b.nome)),
    alertas: (r) => {
      const a = [];
      if (r.status === 'Crítico') a.push({ nivel: 'crit', msg: 'Unidade em situação crítica' });
      const o = n(r.leitos_total) ? pct(n(r.leitos_ocupados), n(r.leitos_total)) : null;
      if (o != null && o >= 100) a.push({ nivel: 'crit', msg: `Leitos lotados (${fmtPct(o)})` });
      else if (o != null && o >= 90) a.push({ nivel: 'warn', msg: `Ocupação de leitos em ${fmtPct(o)}` });
      return a;
    },
    resumo: (l) => {
      const tot = l.reduce((s, r) => s + n(r.leitos_total), 0);
      const oc = l.reduce((s, r) => s + n(r.leitos_ocupados), 0);
      return [
        { l: 'Unidades', v: l.length },
        { l: 'Ocupação de leitos', v: fmtPct(pct(oc, tot)), sub: `${oc} de ${tot}` },
        { l: 'Em atenção', v: l.filter((r) => r.status === 'Atenção').length, tom: 'warn' },
        { l: 'Críticas', v: l.filter((r) => r.status === 'Crítico').length, tom: 'crit' },
      ];
    },
  },
  {
    id: 'ocorrencias', nome: 'Ocorrências da Rede', singular: 'Ocorrência', grupo: 'rede', icone: 'ocorrencias',
    desc: 'Problemas de infraestrutura, equipamentos, abastecimento, pessoal e segurança nas unidades.',
    titulo: (r) => r.titulo, sub: (r) => [r.tipo, r.gravidade].filter(Boolean).join(' · '),
    status: 'status', fechados: ['Resolvida'], kanban: 'status',
    cores: { Aberta: 'crit', 'Em atendimento': 'warn', Resolvida: 'ok' },
    visoes: ['kanban', 'tabela'],
    campos: [
      { k: 'titulo', l: 'Ocorrência', t: 'text', req: true, col: true, larg: 'full' },
      unidadeRef('Unidade', { req: true, col: true }),
      { k: 'tipo', l: 'Tipo', t: 'select', col: true, filtro: true, op: ['Infraestrutura / predial', 'Equipamento', 'Abastecimento', 'Recursos humanos', 'Segurança', 'Tecnologia / sistemas', 'Transporte', 'Outro'] },
      { k: 'gravidade', l: 'Gravidade', t: 'select', col: true, filtro: true, op: ['Baixa', 'Média', 'Alta', 'Crítica'], padrao: 'Média' },
      { k: 'status', l: 'Situação', t: 'select', col: true, filtro: true, op: ['Aberta', 'Em atendimento', 'Resolvida'], padrao: 'Aberta' },
      { k: 'data', l: 'Data', t: 'date', col: true, padrao: () => hoje() },
      setor(),
      { k: 'descricao', l: 'Descrição', t: 'textarea', larg: 'full' },
      { k: 'providencias', l: 'Providências', t: 'textarea', larg: 'full' },
    ],
    calc: [{ k: 'idade', l: 'Aberta há', fmt: 'dias', col: true, v: (r, m) => (aberto(m, r) ? diasDesde(r.data) : null) }],
    ordenar: (a, b) => String(b.data).localeCompare(String(a.data)),
    alertas: (r, m) => {
      if (!aberto(m, r)) return [];
      if (r.gravidade === 'Crítica') return [{ nivel: 'crit', msg: 'Ocorrência crítica em aberto' }];
      if (r.gravidade === 'Alta' && diasDesde(r.data) >= 2) return [{ nivel: 'warn', msg: `Ocorrência grave aberta há ${diasDesde(r.data)} dias` }];
      return [];
    },
    resumo: (l, m) => {
      const ab = l.filter((r) => aberto(m, r));
      return [
        { l: 'Em aberto', v: ab.length },
        { l: 'Críticas', v: ab.filter((r) => r.gravidade === 'Crítica').length, tom: 'crit' },
        { l: 'Altas', v: ab.filter((r) => r.gravidade === 'Alta').length, tom: 'warn' },
        { l: 'Resolvidas', v: l.length - ab.length, tom: 'ok' },
      ];
    },
  },
  {
    id: 'regulacao', nome: 'Regulação e Filas', singular: 'Solicitação', grupo: 'rede', icone: 'regulacao',
    desc: 'Filas de consultas especializadas, exames, cirurgias eletivas, leitos e TFD. Use apenas protocolo e iniciais: os dados identificados permanecem no sistema oficial de regulação.',
    titulo: (r) => `${r.protocolo || 's/ protocolo'} · ${r.especialidade || r.tipo || ''}`, sub: (r) => [r.tipo, r.classificacao, r.paciente].filter(Boolean).join(' · '),
    status: 'status', fechados: ['Realizado', 'Cancelado', 'Devolvido'], kanban: 'status',
    cores: { Aguardando: 'warn', Agendado: 'info', Realizado: 'ok', Cancelado: 'mute', Devolvido: 'mute' },
    visoes: ['tabela', 'kanban'],
    campos: [
      { k: 'protocolo', l: 'Protocolo', t: 'text', req: true, col: true, mono: true },
      { k: 'paciente', l: 'Iniciais do paciente', t: 'text', col: true, dica: 'Somente iniciais (minimização de dados — LGPD, art. 6º, III).' },
      { k: 'tipo', l: 'Tipo', t: 'select', col: true, filtro: true, req: true, op: ['Consulta especializada', 'Exame', 'Cirurgia eletiva', 'Leito / internação', 'TFD'] },
      { k: 'especialidade', l: 'Especialidade / procedimento', t: 'text', col: true },
      { k: 'classificacao', l: 'Classificação de risco', t: 'select', col: true, filtro: true, op: ['Vermelho — emergência', 'Amarelo — urgente', 'Verde — prioritário', 'Azul — eletivo'], padrao: 'Azul — eletivo' },
      { k: 'status', l: 'Situação', t: 'select', col: true, filtro: true, op: ['Aguardando', 'Agendado', 'Realizado', 'Cancelado', 'Devolvido'], padrao: 'Aguardando' },
      unidadeRef('Unidade solicitante'),
      { k: 'data_solicitacao', l: 'Data da solicitação', t: 'date', req: true, padrao: () => hoje() },
      { k: 'data_agendamento', l: 'Data agendada', t: 'date' },
      { k: 'prestador', l: 'Prestador / executante', t: 'text' },
      { k: 'judicializado', l: 'Objeto de ação judicial', t: 'bool', filtro: true },
      { k: 'observacoes', l: 'Observações', t: 'textarea', larg: 'full' },
    ],
    calc: [{ k: 'espera', l: 'Espera', fmt: 'dias', col: true, v: (r) => (r.status === 'Aguardando' ? diasDesde(r.data_solicitacao) : null) }],
    ordenar: (a, b) => {
      const ord = (r) => ['Vermelho', 'Amarelo', 'Verde', 'Azul'].findIndex((c) => String(r.classificacao).startsWith(c));
      return (r2(a) - r2(b)) || (ord(a) - ord(b)) || String(a.data_solicitacao).localeCompare(String(b.data_solicitacao));
      function r2(r) { return r.status === 'Aguardando' ? 0 : r.status === 'Agendado' ? 1 : 2; }
    },
    alertas: (r) => {
      if (r.status !== 'Aguardando') return [];
      const c = String(r.classificacao || '');
      const e = diasDesde(r.data_solicitacao) || 0;
      if (c.startsWith('Vermelho')) return [{ nivel: 'crit', msg: `Regulação vermelha aguardando ${e ? `há ${e} dia(s)` : 'desde hoje'}` }];
      if (c.startsWith('Amarelo') && e > 15) return [{ nivel: 'warn', msg: `Regulação amarela aguardando há ${e} dias` }];
      if (r.judicializado) return [{ nivel: 'warn', msg: 'Solicitação judicializada aguardando' }];
      if (e > 180) return [{ nivel: 'warn', msg: `Aguardando há ${e} dias` }];
      return [];
    },
    resumo: (l) => {
      const ag = l.filter((r) => r.status === 'Aguardando');
      const media = ag.length ? ag.reduce((s, r) => s + (diasDesde(r.data_solicitacao) || 0), 0) / ag.length : 0;
      return [
        { l: 'Aguardando', v: ag.length },
        { l: 'Espera média', v: `${fmtNum(media)} dias` },
        { l: 'Vermelho/amarelo', v: ag.filter((r) => /^(Vermelho|Amarelo)/.test(r.classificacao || '')).length, tom: 'crit' },
        { l: 'Agendados', v: l.filter((r) => r.status === 'Agendado').length, tom: 'info' },
      ];
    },
  },
  {
    id: 'estoque', nome: 'Farmácia e Insumos', singular: 'Item de estoque', grupo: 'rede', icone: 'estoque',
    desc: 'Estoque de medicamentos, vacinas e insumos por local, com cobertura em dias, validade e situação de compra.',
    titulo: (r) => r.item, sub: (r) => [r.categoria, r.apresentacao].filter(Boolean).join(' · '),
    status: 'situacao_compra', cores: { Regular: 'ok', 'Em processo de compra': 'info', Empenhado: 'info', 'Aguardando entrega': 'warn', Desabastecido: 'crit' },
    visoes: ['tabela'],
    campos: [
      { k: 'item', l: 'Item', t: 'text', req: true, col: true, larg: 'full' },
      { k: 'categoria', l: 'Categoria', t: 'select', col: true, filtro: true, op: ['Medicamento — componente básico', 'Medicamento — componente especializado', 'Medicamento — controlado (Port. 344/98)', 'Medicamento — hospitalar', 'Vacina / imunobiológico', 'Insumo / material médico', 'EPI', 'Outro'] },
      { k: 'apresentacao', l: 'Apresentação / unidade', t: 'text', dica: 'Ex.: comprimido, frasco 100 mL, ampola, caixa c/ 100.' },
      unidadeRef('Local de estoque', { col: true }),
      { k: 'quantidade', l: 'Quantidade em estoque', t: 'number', min: 0, col: true },
      { k: 'estoque_minimo', l: 'Estoque mínimo', t: 'number', min: 0 },
      { k: 'consumo_mensal', l: 'Consumo médio mensal', t: 'number', min: 0 },
      { k: 'lote', l: 'Lote (mais próximo do vencimento)', t: 'text', mono: true },
      { k: 'validade', l: 'Validade', t: 'date', col: true },
      { k: 'situacao_compra', l: 'Situação de compra', t: 'select', col: true, filtro: true, op: ['Regular', 'Em processo de compra', 'Empenhado', 'Aguardando entrega', 'Desabastecido'], padrao: 'Regular' },
      { k: 'contrato', l: 'Contrato / ata vinculado', t: 'ref', ref: 'contratos' },
      { k: 'observacoes', l: 'Observações', t: 'textarea', larg: 'full' },
    ],
    calc: [
      { k: 'cobertura', l: 'Cobertura', fmt: 'dias', col: true, v: (r) => (n(r.consumo_mensal) > 0 ? Math.floor(n(r.quantidade) / (n(r.consumo_mensal) / 30)) : null) },
      { k: 'nivel', l: 'Nível', fmt: 'nivel', col: true, v: (r) => nivelEstoque(r) },
    ],
    ordenar: (a, b) => ordemNivel(nivelEstoque(a)) - ordemNivel(nivelEstoque(b)) || String(a.item).localeCompare(String(b.item)),
    alertas: (r) => {
      const a = [];
      const nv = nivelEstoque(r);
      if (nv === 'Ruptura') a.push({ nivel: 'crit', msg: 'Ruptura de estoque' });
      else if (nv === 'Crítico') a.push({ nivel: 'crit', msg: `Abaixo do estoque mínimo (${fmtNum(r.quantidade)} / mín. ${fmtNum(r.estoque_minimo)})` });
      else if (nv === 'Atenção') a.push({ nivel: 'warn', msg: 'Cobertura inferior a 30 dias' });
      const dv = diasAte(r.validade);
      if (dv != null && n(r.quantidade) > 0) {
        if (dv < 0) a.push({ nivel: 'crit', msg: `Lote vencido em ${fmtData(r.validade)}` });
        else if (dv <= 60) a.push({ nivel: 'warn', msg: `Lote vence em ${dv} dia(s)` });
      }
      return a;
    },
    resumo: (l) => [
      { l: 'Itens monitorados', v: l.length },
      { l: 'Em ruptura', v: l.filter((r) => nivelEstoque(r) === 'Ruptura').length, tom: 'crit' },
      { l: 'Abaixo do mínimo', v: l.filter((r) => nivelEstoque(r) === 'Crítico').length, tom: 'crit' },
      { l: 'Vencendo em 60 dias', v: l.filter((r) => { const d = diasAte(r.validade); return d != null && d >= 0 && d <= 60 && n(r.quantidade) > 0; }).length, tom: 'warn' },
    ],
  },
  {
    id: 'escalas', nome: 'Escalas e Plantões', singular: 'Plantão', grupo: 'rede', icone: 'escalas',
    desc: 'Cobertura de plantões e escalas por unidade. Plantões descobertos nas próximas 48 horas geram alerta imediato.',
    titulo: (r) => `${r.categoria || 'Plantão'} — ${r.turno || ''}`, sub: (r) => [fmtData(r.data), r.profissional].filter(Boolean).join(' · '),
    status: 'situacao', cores: { Coberto: 'ok', Descoberto: 'crit', Falta: 'crit', Remanejado: 'info' },
    kanban: 'situacao', visoes: ['tabela', 'kanban'],
    campos: [
      unidadeRef('Unidade', { req: true, col: true }),
      { k: 'data', l: 'Data', t: 'date', req: true, col: true, padrao: () => hoje() },
      { k: 'turno', l: 'Turno', t: 'select', col: true, filtro: true, op: ['Manhã', 'Tarde', 'Noite', 'Plantão 12h diurno', 'Plantão 12h noturno', 'Plantão 24h'] },
      { k: 'categoria', l: 'Categoria profissional', t: 'select', col: true, filtro: true, op: ['Médico(a) clínico(a)', 'Médico(a) pediatra', 'Médico(a) ortopedista', 'Médico(a) obstetra', 'Médico(a) anestesista', 'Médico(a) intensivista', 'Enfermeiro(a)', 'Técnico(a) de enfermagem', 'Cirurgião(ã)-dentista', 'Farmacêutico(a)', 'Condutor(a) de ambulância', 'Outro'] },
      { k: 'profissional', l: 'Profissional escalado', t: 'text', col: true },
      { k: 'situacao', l: 'Situação', t: 'select', col: true, filtro: true, op: ['Coberto', 'Descoberto', 'Falta', 'Remanejado'], padrao: 'Coberto' },
      { k: 'observacao', l: 'Observação', t: 'textarea', larg: 'full' },
    ],
    ordenar: (a, b) => String(a.data).localeCompare(String(b.data)),
    alertas: (r) => {
      if (!['Descoberto', 'Falta'].includes(r.situacao)) return [];
      const d = diasAte(r.data);
      if (d == null || d < 0) return [];
      const oque = r.situacao === 'Falta' ? 'Falta de profissional no plantão' : 'Plantão descoberto';
      if (d === 0) return [{ nivel: 'crit', msg: `${oque} hoje` }];
      if (d <= 2) return [{ nivel: 'crit', msg: `${oque} em ${d} dia(s)` }];
      if (d <= 7) return [{ nivel: 'warn', msg: `${oque} em ${d} dias` }];
      return [];
    },
    resumo: (l) => {
      const fut = l.filter((r) => diasAte(r.data) >= 0);
      return [
        { l: 'Plantões programados', v: fut.length },
        { l: 'Descobertos (48h)', v: fut.filter((r) => ['Descoberto', 'Falta'].includes(r.situacao) && diasAte(r.data) <= 2).length, tom: 'crit' },
        { l: 'Descobertos (7 dias)', v: fut.filter((r) => ['Descoberto', 'Falta'].includes(r.situacao) && diasAte(r.data) <= 7).length, tom: 'warn' },
        { l: 'Taxa de cobertura', v: fmtPct(pct(fut.filter((r) => ['Coberto', 'Remanejado'].includes(r.situacao)).length, fut.length)), tom: 'ok' },
      ];
    },
  },

  // ───────────────────────────── VIGILÂNCIA ─────────────────────────────
  {
    id: 'vigilancia', nome: 'Agravos e Notificações', singular: 'Registro de agravo', grupo: 'vigilancia', icone: 'vigilancia',
    desc: 'Consolidado semanal de agravos por bairro (semana epidemiológica), com situação e ações de controle.',
    titulo: (r) => `${r.agravo} — SE ${r.semana}/${r.ano}`, sub: (r) => [r.bairro, `${fmtNum(r.notificados)} notificados`].filter(Boolean).join(' · '),
    status: 'situacao', cores: { Monitoramento: 'ok', Alerta: 'warn', 'Surto / epidemia': 'crit', Encerrado: 'mute' },
    visoes: ['tabela'],
    campos: [
      { k: 'agravo', l: 'Agravo', t: 'select', req: true, col: true, filtro: true, op: ['Dengue', 'Chikungunya', 'Zika', 'Covid-19', 'Influenza / SRAG', 'Tuberculose', 'Hanseníase', 'Sífilis', 'Leptospirose', 'Meningite', 'Sarampo', 'Febre amarela', 'Doença diarreica aguda', 'Outro'] },
      { k: 'semana', l: 'Semana epidemiológica', t: 'number', req: true, col: true, min: 1, max: 53, padrao: () => semanaEpi().se },
      { k: 'ano', l: 'Ano', t: 'number', req: true, padrao: () => semanaEpi().ano },
      { k: 'bairro', l: 'Bairro / território', t: 'text', col: true, filtro: true },
      { k: 'notificados', l: 'Casos notificados', t: 'number', min: 0, col: true },
      { k: 'confirmados', l: 'Casos confirmados', t: 'number', min: 0, col: true },
      { k: 'obitos', l: 'Óbitos', t: 'number', min: 0, col: true },
      { k: 'situacao', l: 'Situação', t: 'select', col: true, filtro: true, op: ['Monitoramento', 'Alerta', 'Surto / epidemia', 'Encerrado'], padrao: 'Monitoramento' },
      { k: 'acoes', l: 'Ações de controle', t: 'textarea', larg: 'full' },
    ],
    ordenar: (a, b) => (n(b.ano) - n(a.ano)) || (n(b.semana) - n(a.semana)) || String(a.agravo).localeCompare(String(b.agravo)),
    alertas: (r) => {
      if (r.situacao === 'Surto / epidemia') return [{ nivel: 'crit', msg: `${r.agravo}: surto/epidemia em ${r.bairro || 'território'}` }];
      if (r.situacao === 'Alerta') return [{ nivel: 'warn', msg: `${r.agravo}: alerta em ${r.bairro || 'território'}` }];
      if (n(r.obitos) > 0 && r.situacao !== 'Encerrado') return [{ nivel: 'warn', msg: `${r.agravo}: ${r.obitos} óbito(s) na SE ${r.semana}` }];
      return [];
    },
    resumo: (l) => {
      const ult = Math.max(0, ...l.map((r) => n(r.ano) * 100 + n(r.semana)));
      const daSemana = l.filter((r) => n(r.ano) * 100 + n(r.semana) === ult);
      return [
        { l: 'Última SE registrada', v: ult ? `SE ${ult % 100}/${Math.floor(ult / 100)}` : '—' },
        { l: 'Notificados na SE', v: fmtNum(daSemana.reduce((s, r) => s + n(r.notificados), 0)) },
        { l: 'Territórios em alerta', v: daSemana.filter((r) => r.situacao === 'Alerta').length, tom: 'warn' },
        { l: 'Surtos ativos', v: daSemana.filter((r) => r.situacao === 'Surto / epidemia').length, tom: 'crit' },
      ];
    },
  },
  {
    id: 'campanhas', nome: 'Imunização e Campanhas', singular: 'Campanha', grupo: 'vigilancia', icone: 'campanhas',
    desc: 'Campanhas de vacinação e ações coletivas, com meta de doses e cobertura alcançada.',
    titulo: (r) => r.nome, sub: (r) => [r.publico, `${fmtData(r.inicio)} a ${fmtData(r.fim)}`].filter(Boolean).join(' · '),
    status: 'status', fechados: ['Encerrada'], cores: { Planejada: 'info', 'Em andamento': 'pri', Encerrada: 'mute' },
    visoes: ['tabela'],
    campos: [
      { k: 'nome', l: 'Campanha / ação', t: 'text', req: true, col: true, larg: 'full' },
      { k: 'publico', l: 'Público-alvo', t: 'text', col: true },
      { k: 'status', l: 'Situação', t: 'select', col: true, filtro: true, op: ['Planejada', 'Em andamento', 'Encerrada'], padrao: 'Planejada' },
      { k: 'inicio', l: 'Início', t: 'date', col: true },
      { k: 'fim', l: 'Término', t: 'date', col: true },
      { k: 'meta', l: 'Meta (doses / atendimentos)', t: 'number', min: 0 },
      { k: 'realizado', l: 'Realizado', t: 'number', min: 0 },
      setor('Vigilância em Saúde'),
      { k: 'observacoes', l: 'Observações', t: 'textarea', larg: 'full' },
    ],
    calc: [{ k: 'cobertura', l: 'Cobertura', fmt: 'pct', col: true, v: (r) => pct(n(r.realizado), n(r.meta)) }],
    prazo: 'fim',
    ordenar: (a, b) => String(b.inicio).localeCompare(String(a.inicio)),
    alertas: (r) => {
      if (r.status !== 'Em andamento') return [];
      const c = pct(n(r.realizado), n(r.meta));
      const d = diasAte(r.fim);
      if (c != null && c < 90 && d != null && d >= 0 && d <= 7) return [{ nivel: 'warn', msg: `Cobertura em ${fmtPct(c)} a ${d} dia(s) do término` }];
      return [];
    },
    resumo: (l) => {
      const at = l.filter((r) => r.status === 'Em andamento');
      return [
        { l: 'Em andamento', v: at.length, tom: 'pri' },
        { l: 'Doses aplicadas (ativas)', v: fmtNum(at.reduce((s, r) => s + n(r.realizado), 0)) },
        { l: 'Cobertura média (ativas)', v: fmtPct(at.length ? at.reduce((s, r) => s + (pct(n(r.realizado), n(r.meta)) || 0), 0) / at.length : null) },
      ];
    },
  },

  // ───────────────────────────── CONTROLE ─────────────────────────────
  {
    id: 'judicial', nome: 'Judicialização e Órgãos de Controle', singular: 'Demanda judicial / de controle', grupo: 'controle', icone: 'judicial',
    desc: 'Mandados judiciais, ofícios e requisições do Ministério Público, da Defensoria, do TCE-RJ e da Câmara, com prazo de cumprimento e responsável.',
    titulo: (r) => `${r.numero || 's/ nº'} · ${r.tipo_objeto || ''}`, sub: (r) => [r.origem, r.beneficiario].filter(Boolean).join(' · '),
    status: 'status', fechados: ['Cumprido', 'Arquivado'], kanban: 'status',
    cores: { Recebido: 'warn', 'Em cumprimento': 'info', 'Cumprido parcialmente': 'warn', Cumprido: 'ok', 'Impossibilidade informada': 'pri', 'Defesa / recurso': 'pri', Arquivado: 'mute' },
    visoes: ['tabela', 'kanban'],
    info: 'Referências para o fluxo de cumprimento: Tema 793/STF (RE 855.178 — responsabilidade solidária dos entes, com direcionamento do cumprimento conforme a repartição de competências); Tema 1.234/STF (RE 1.366.243) e Súmulas Vinculantes 60 e 61; Tema 6/STF (RE 566.471 — medicamentos não incorporados); Tema 106/STJ (REsp 1.657.156/RJ). Confira a vigência e eventuais modulações antes de usar em peças.',
    campos: [
      { k: 'numero', l: 'Nº do processo / procedimento', t: 'text', req: true, col: true, mono: true, dica: 'Padrão CNJ para processos judiciais (NNNNNNN-DD.AAAA.J.TR.OOOO).' },
      { k: 'origem', l: 'Origem', t: 'select', col: true, filtro: true, req: true, op: ['Mandado judicial — TJRJ', 'Mandado judicial — Justiça Federal', 'Ministério Público (MPRJ)', 'Defensoria Pública', 'Tribunal de Contas (TCE-RJ)', 'Câmara Municipal', 'Outro órgão de controle'] },
      { k: 'tipo_objeto', l: 'Objeto', t: 'select', col: true, filtro: true, op: ['Medicamento', 'Procedimento / cirurgia', 'Exame', 'Leito / internação', 'Insumo / dieta / fralda', 'Transporte / TFD', 'Home care', 'Informações / documentos', 'Outro'] },
      { k: 'status', l: 'Situação', t: 'select', col: true, filtro: true, op: ['Recebido', 'Em cumprimento', 'Cumprido parcialmente', 'Cumprido', 'Impossibilidade informada', 'Defesa / recurso', 'Arquivado'], padrao: 'Recebido' },
      { k: 'beneficiario', l: 'Beneficiário (iniciais)', t: 'text', dica: 'Somente iniciais.' },
      { k: 'data_intimacao', l: 'Data da intimação / recebimento', t: 'date', padrao: () => hoje() },
      { k: 'prazo', l: 'Prazo para cumprimento / resposta', t: 'date', req: true, col: true },
      { k: 'multa', l: 'Multa cominada (R$/dia)', t: 'money' },
      { k: 'responsavel', l: 'Setor / servidor responsável', t: 'text', col: true },
      { k: 'procurador', l: 'Procurador(a) acompanhante', t: 'text' },
      { k: 'item_estoque', l: 'Item de estoque vinculado', t: 'ref', ref: 'estoque' },
      { k: 'regulacao', l: 'Solicitação de regulação vinculada', t: 'ref', ref: 'regulacao' },
      { k: 'descricao', l: 'Determinação / pedido', t: 'textarea', larg: 'full' },
      { k: 'providencias', l: 'Providências adotadas', t: 'textarea', larg: 'full' },
    ],
    calc: [{ k: 'restante', l: 'Prazo', fmt: 'prazo', col: true, v: (r, m) => (aberto(m, r) ? diasAte(r.prazo) : null) }],
    prazo: 'prazo',
    ordenar: (a, b) => String(a.prazo || '9999').localeCompare(String(b.prazo || '9999')),
    alertas: (r, m) => (aberto(m, r) ? alertaPrazo(r.prazo, r.origem && r.origem.startsWith('Mandado') ? 'Prazo do mandado' : 'Prazo de resposta', 3, 7) : []),
    resumo: (l, m) => {
      const ab = l.filter((r) => aberto(m, r));
      return [
        { l: 'Em aberto', v: ab.length },
        { l: 'Prazo vencido', v: ab.filter((r) => diasAte(r.prazo) < 0).length, tom: 'crit' },
        { l: 'Vencem em 3 dias', v: ab.filter((r) => { const d = diasAte(r.prazo); return d >= 0 && d <= 3; }).length, tom: 'crit' },
        { l: 'Mandados judiciais', v: ab.filter((r) => String(r.origem).startsWith('Mandado')).length, tom: 'info' },
      ];
    },
  },
  {
    id: 'ouvidoria', nome: 'Ouvidoria do SUS', singular: 'Manifestação', grupo: 'controle', icone: 'ouvidoria',
    desc: 'Manifestações dos usuários (reclamações, denúncias, solicitações, sugestões e elogios), com prazo de resposta.',
    titulo: (r) => `${r.protocolo || 's/ protocolo'} · ${r.assunto || r.tipo || ''}`, sub: (r) => [r.tipo, r.canal].filter(Boolean).join(' · '),
    status: 'status', fechados: ['Respondida', 'Concluída'], kanban: 'status',
    cores: { Recebida: 'warn', 'Em análise': 'info', 'Encaminhada ao setor': 'pri', Respondida: 'ok', Concluída: 'ok' },
    visoes: ['tabela', 'kanban'],
    info: 'Prazo de resposta: 30 dias, prorrogável uma única vez por igual período, mediante justificativa (Lei nº 13.460/2017, art. 16).',
    campos: [
      { k: 'protocolo', l: 'Protocolo', t: 'text', req: true, col: true, mono: true },
      { k: 'tipo', l: 'Tipo', t: 'select', col: true, filtro: true, req: true, op: ['Reclamação', 'Denúncia', 'Solicitação', 'Sugestão', 'Elogio', 'Informação'] },
      { k: 'canal', l: 'Canal', t: 'select', filtro: true, op: ['Presencial', 'Telefone', 'E-mail', 'Fala.BR', 'Disque Saúde 136', 'WhatsApp', 'Carta', 'Outro'] },
      { k: 'assunto', l: 'Assunto', t: 'text', col: true },
      unidadeRef('Unidade citada', { col: true }),
      { k: 'status', l: 'Situação', t: 'select', col: true, filtro: true, op: ['Recebida', 'Em análise', 'Encaminhada ao setor', 'Respondida', 'Concluída'], padrao: 'Recebida' },
      { k: 'data_registro', l: 'Data de registro', t: 'date', req: true, padrao: () => hoje() },
      { k: 'prazo', l: 'Prazo de resposta', t: 'date', col: true, padrao: () => addDias(hoje(), 30), dica: 'Preenchido com 30 dias a partir do registro.' },
      { k: 'prorrogada', l: 'Prazo prorrogado (justificado)', t: 'bool' },
      setor(),
      { k: 'descricao', l: 'Relato', t: 'textarea', larg: 'full' },
      { k: 'resposta', l: 'Resposta ao usuário', t: 'textarea', larg: 'full' },
    ],
    calc: [{ k: 'restante', l: 'Prazo', fmt: 'prazo', col: true, v: (r, m) => (aberto(m, r) ? diasAte(r.prazo) : null) }],
    prazo: 'prazo',
    // Recalcula o prazo legal quando a data de registro ou a prorrogação mudam.
    aoMudar: (k, v, vals) => {
      if (k === 'data_registro' && v) return { prazo: addDias(v, vals.prorrogada ? 60 : 30) };
      if (k === 'prorrogada' && vals.data_registro) return { prazo: addDias(vals.data_registro, v ? 60 : 30) };
      return null;
    },
    ordenar: (a, b) => String(a.prazo || '9999').localeCompare(String(b.prazo || '9999')),
    alertas: (r, m) => (aberto(m, r) ? alertaPrazo(r.prazo, 'Prazo da ouvidoria', 2, 5) : []),
    resumo: (l, m) => {
      const ab = l.filter((r) => aberto(m, r));
      const resp = l.filter((r) => !aberto(m, r));
      return [
        { l: 'Em aberto', v: ab.length },
        { l: 'Fora do prazo', v: ab.filter((r) => diasAte(r.prazo) < 0).length, tom: 'crit' },
        { l: 'Reclamações/denúncias abertas', v: ab.filter((r) => ['Reclamação', 'Denúncia'].includes(r.tipo)).length, tom: 'warn' },
        { l: 'Respondidas', v: resp.length, tom: 'ok' },
      ];
    },
  },
  {
    id: 'protocolo', nome: 'Protocolo e Documentos', singular: 'Documento', grupo: 'controle', icone: 'protocolo',
    desc: 'Ofícios, memorandos, requerimentos, portarias e processos administrativos, com tramitação e prazo.',
    titulo: (r) => `${r.numero || 's/ nº'} · ${r.assunto || ''}`, sub: (r) => [r.tipo, r.origem && `de ${r.origem}`, r.destino && `para ${r.destino}`].filter(Boolean).join(' · '),
    status: 'status', fechados: ['Respondido', 'Arquivado'], kanban: 'status',
    cores: { Recebido: 'warn', 'Em tramitação': 'info', 'Aguardando assinatura': 'pri', Respondido: 'ok', Arquivado: 'mute' },
    visoes: ['tabela', 'kanban'],
    campos: [
      { k: 'numero', l: 'Número', t: 'text', req: true, col: true, mono: true },
      { k: 'tipo', l: 'Tipo', t: 'select', col: true, filtro: true, op: ['Ofício recebido', 'Ofício expedido', 'Memorando', 'Processo administrativo', 'Requerimento', 'Portaria', 'Resolução do CMS', 'Parecer', 'Outro'] },
      { k: 'assunto', l: 'Assunto', t: 'text', req: true, col: true, larg: 'full' },
      { k: 'origem', l: 'Origem', t: 'text' },
      { k: 'destino', l: 'Destino', t: 'text' },
      { k: 'data', l: 'Data', t: 'date', padrao: () => hoje() },
      { k: 'prazo', l: 'Prazo', t: 'date', col: true },
      setor(),
      { k: 'status', l: 'Situação', t: 'select', col: true, filtro: true, op: ['Recebido', 'Em tramitação', 'Aguardando assinatura', 'Respondido', 'Arquivado'], padrao: 'Recebido' },
      { k: 'link', l: 'Link do documento (Drive / sistema de processos)', t: 'url', larg: 'full' },
      { k: 'observacoes', l: 'Observações', t: 'textarea', larg: 'full' },
    ],
    calc: [{ k: 'restante', l: 'Prazo', fmt: 'prazo', col: true, v: (r, m) => (aberto(m, r) && r.prazo ? diasAte(r.prazo) : null) }],
    prazo: 'prazo',
    ordenar: (a, b) => String(a.prazo || '9999').localeCompare(String(b.prazo || '9999')),
    alertas: (r, m) => (aberto(m, r) ? alertaPrazo(r.prazo, 'Prazo do documento', 2, 5) : []),
    resumo: (l, m) => {
      const ab = l.filter((r) => aberto(m, r));
      return [
        { l: 'Em tramitação', v: ab.length },
        { l: 'Prazo vencido', v: ab.filter((r) => r.prazo && diasAte(r.prazo) < 0).length, tom: 'crit' },
        { l: 'Aguardando assinatura', v: ab.filter((r) => r.status === 'Aguardando assinatura').length, tom: 'pri' },
      ];
    },
  },

  // ───────────────────────────── GESTÃO ─────────────────────────────
  {
    id: 'contratos', nome: 'Contratos e Compras', singular: 'Contrato / processo de compra', grupo: 'gestao', icone: 'contratos',
    desc: 'Processos de contratação e contratos vigentes, com fiscal, gestor e alerta de vencimento.',
    titulo: (r) => `${r.numero || 's/ nº'} · ${r.objeto || ''}`, sub: (r) => [r.fornecedor, r.modalidade].filter(Boolean).join(' · '),
    status: 'fase', fechados: ['Encerrado'], kanban: 'fase',
    cores: { 'Planejamento (ETP/TR)': 'mute', 'Fase interna': 'info', Publicado: 'info', 'Em julgamento': 'pri', Homologado: 'pri', Vigente: 'ok', Suspenso: 'warn', Encerrado: 'mute' },
    visoes: ['tabela', 'kanban'],
    info: 'Lei nº 14.133/2021: art. 117 (acompanhamento e fiscalização por fiscal designado) e arts. 106 e 107 (vigência e prorrogação de serviços e fornecimentos contínuos).',
    campos: [
      { k: 'numero', l: 'Contrato / processo', t: 'text', req: true, col: true, mono: true },
      { k: 'objeto', l: 'Objeto', t: 'text', req: true, col: true, larg: 'full' },
      { k: 'fornecedor', l: 'Fornecedor / contratado', t: 'text', col: true },
      { k: 'modalidade', l: 'Modalidade', t: 'select', filtro: true, op: ['Pregão eletrônico', 'Concorrência', 'Dispensa', 'Inexigibilidade', 'Adesão a ata de registro de preços', 'Credenciamento', 'Convênio / termo de colaboração', 'Contrato de gestão', 'Outro'] },
      { k: 'fase', l: 'Fase', t: 'select', col: true, filtro: true, op: ['Planejamento (ETP/TR)', 'Fase interna', 'Publicado', 'Em julgamento', 'Homologado', 'Vigente', 'Suspenso', 'Encerrado'], padrao: 'Fase interna' },
      { k: 'valor', l: 'Valor global', t: 'money', col: true },
      { k: 'inicio', l: 'Início da vigência', t: 'date' },
      { k: 'fim', l: 'Fim da vigência', t: 'date', col: true },
      { k: 'fiscal', l: 'Fiscal do contrato', t: 'text' },
      { k: 'gestor', l: 'Gestor do contrato', t: 'text' },
      unidadeRef('Unidade atendida'),
      { k: 'processo', l: 'Processo administrativo', t: 'text', mono: true },
      { k: 'observacoes', l: 'Observações', t: 'textarea', larg: 'full' },
    ],
    calc: [{ k: 'vence', l: 'Vigência', fmt: 'prazo', col: true, v: (r) => (r.fase === 'Vigente' && r.fim ? diasAte(r.fim) : null) }],
    prazo: 'fim',
    ordenar: (a, b) => String(a.fim || '9999').localeCompare(String(b.fim || '9999')),
    alertas: (r) => {
      if (r.fase !== 'Vigente' || !r.fim) return [];
      const d = diasAte(r.fim);
      if (d < 0) return [{ nivel: 'crit', msg: `Contrato com vigência encerrada há ${-d} dia(s) e ainda marcado como vigente` }];
      if (d <= 30) return [{ nivel: 'crit', msg: `Contrato vence em ${d} dia(s)` }];
      if (d <= 90) return [{ nivel: 'warn', msg: `Contrato vence em ${d} dias — avaliar prorrogação ou nova contratação` }];
      return [];
    },
    resumo: (l) => {
      const vig = l.filter((r) => r.fase === 'Vigente');
      return [
        { l: 'Vigentes', v: vig.length, tom: 'ok' },
        { l: 'Valor vigente', v: fmtMoedaCurta(vig.reduce((s, r) => s + n(r.valor), 0)) },
        { l: 'Vencem em 90 dias', v: vig.filter((r) => { const d = diasAte(r.fim); return d != null && d >= 0 && d <= 90; }).length, tom: 'warn' },
        { l: 'Em licitação', v: l.filter((r) => ['Fase interna', 'Publicado', 'Em julgamento', 'Homologado', 'Planejamento (ETP/TR)'].includes(r.fase)).length, tom: 'info' },
      ];
    },
  },
  {
    id: 'orcamento', nome: 'Orçamento e Fundo de Saúde', singular: 'Dotação orçamentária', grupo: 'gestao', icone: 'orcamento',
    desc: 'Execução orçamentária do Fundo Municipal de Saúde por ação, bloco e fonte de recurso.',
    titulo: (r) => r.acao, sub: (r) => [r.bloco, r.fonte].filter(Boolean).join(' · '),
    visoes: ['tabela'],
    info: 'Aplicação mínima em ações e serviços públicos de saúde pelos Municípios: 15% da base de impostos e transferências (LC nº 141/2012, art. 7º). O percentual exibido é estimativa gerencial; a apuração oficial é a do SIOPS.',
    campos: [
      { k: 'acao', l: 'Ação / programa', t: 'text', req: true, col: true, larg: 'full' },
      { k: 'exercicio', l: 'Exercício', t: 'number', req: true, filtro: true, padrao: () => new Date().getFullYear() },
      { k: 'bloco', l: 'Bloco de financiamento', t: 'select', col: true, filtro: true, op: ['Manutenção das ações e serviços públicos de saúde', 'Estruturação da rede de serviços públicos de saúde', 'Não se aplica (recursos próprios)'] },
      { k: 'fonte', l: 'Fonte de recurso', t: 'select', col: true, filtro: true, op: ['Recursos próprios (ASPS)', 'Transferência federal (FNS)', 'Transferência estadual (FES)', 'Emenda parlamentar', 'Convênio', 'Outra'] },
      { k: 'dotacao', l: 'Dotação atualizada', t: 'money', col: true },
      { k: 'empenhado', l: 'Empenhado', t: 'money', col: true },
      { k: 'liquidado', l: 'Liquidado', t: 'money', col: true },
      { k: 'pago', l: 'Pago', t: 'money', col: true },
      { k: 'observacoes', l: 'Observações', t: 'textarea', larg: 'full' },
    ],
    calc: [{ k: 'execucao', l: 'Execução (liq./dot.)', fmt: 'pct', col: true, v: (r) => pct(n(r.liquidado), n(r.dotacao)) }],
    ordenar: (a, b) => n(b.dotacao) - n(a.dotacao),
    alertas: (r) => {
      const a = [];
      if (n(r.empenhado) > n(r.dotacao) && n(r.dotacao) > 0) a.push({ nivel: 'crit', msg: 'Empenhado acima da dotação' });
      if (n(r.pago) > n(r.liquidado)) a.push({ nivel: 'warn', msg: 'Pago acima do liquidado — conferir lançamento' });
      return a;
    },
    resumo: (l, m, ctx) => {
      const s = (k) => l.reduce((t, r) => t + n(r[k]), 0);
      const proprios = l.filter((r) => r.fonte === 'Recursos próprios (ASPS)').reduce((t, r) => t + n(r.liquidado), 0);
      const base = n(ctx && ctx.config && ctx.config.receita_base);
      return [
        { l: 'Dotação', v: fmtMoedaCurta(s('dotacao')) },
        { l: 'Empenhado', v: fmtMoedaCurta(s('empenhado')), sub: fmtPct(pct(s('empenhado'), s('dotacao'))) },
        { l: 'Liquidado', v: fmtMoedaCurta(s('liquidado')), sub: fmtPct(pct(s('liquidado'), s('dotacao'))) },
        { l: 'Pago', v: fmtMoedaCurta(s('pago')), sub: fmtPct(pct(s('pago'), s('dotacao'))) },
        { l: 'ASPS (estimativa)', v: base ? fmtPct(pct(proprios, base)) : '—', sub: base ? 'mínimo 15% — LC 141, art. 7º' : 'informe a base em Configurações', tom: base && pct(proprios, base) < 15 ? 'warn' : 'ok' },
      ];
    },
  },
  {
    id: 'planejamento', nome: 'Planejamento e Metas', singular: 'Meta', grupo: 'gestao', icone: 'planejamento',
    desc: 'Metas do Plano Municipal de Saúde e da Programação Anual de Saúde, com indicador, resultado e situação.',
    titulo: (r) => r.meta, sub: (r) => [r.instrumento, r.indicador].filter(Boolean).join(' · '),
    status: 'situacao', cores: { 'No prazo': 'ok', 'Em risco': 'warn', Atingida: 'ok', 'Não atingida': 'crit', 'Não iniciada': 'mute' },
    kanban: 'situacao', visoes: ['tabela', 'kanban'],
    info: 'Instrumentos de planejamento do SUS: Plano de Saúde, Programação Anual de Saúde, RDQA e Relatório Anual de Gestão. O RAG é enviado ao Conselho até 30 de março do ano seguinte (LC 141/2012, art. 36, § 1º) e o relatório quadrimestral é apresentado em audiência pública na Câmara até o fim de maio, setembro e fevereiro (art. 36, § 5º).',
    campos: [
      { k: 'meta', l: 'Meta', t: 'text', req: true, col: true, larg: 'full' },
      { k: 'instrumento', l: 'Instrumento', t: 'select', filtro: true, op: ['Plano Municipal de Saúde', 'Programação Anual de Saúde', 'Pactuação interfederativa', 'Plano de governo', 'Outro'] },
      { k: 'diretriz', l: 'Diretriz / objetivo', t: 'text', larg: 'full' },
      { k: 'indicador', l: 'Indicador', t: 'text', col: true, larg: 'full' },
      { k: 'unidade_medida', l: 'Unidade de medida', t: 'select', op: ['%', 'número absoluto', 'taxa', 'dias', 'razão'] },
      { k: 'sentido', l: 'Sentido desejado', t: 'select', op: ['Maior é melhor', 'Menor é melhor'], padrao: 'Maior é melhor' },
      { k: 'linha_base', l: 'Linha de base', t: 'number' },
      { k: 'alvo', l: 'Meta do ano', t: 'number', col: true },
      { k: 'resultado', l: 'Resultado apurado', t: 'number', col: true },
      { k: 'ano', l: 'Ano', t: 'number', filtro: true, padrao: () => new Date().getFullYear() },
      setor(),
      { k: 'situacao', l: 'Situação', t: 'select', col: true, filtro: true, op: ['Não iniciada', 'No prazo', 'Em risco', 'Atingida', 'Não atingida'], padrao: 'No prazo' },
      { k: 'analise', l: 'Análise / justificativa', t: 'textarea', larg: 'full' },
    ],
    calc: [{ k: 'alcance', l: 'Alcance', fmt: 'pct', col: true, v: (r) => alcanceMeta(r) }],
    ordenar: (a, b) => String(a.setor).localeCompare(String(b.setor)),
    alertas: (r) => (r.situacao === 'Em risco' ? [{ nivel: 'warn', msg: 'Meta em risco' }] : []),
    resumo: (l) => [
      { l: 'Metas', v: l.length },
      { l: 'Atingidas', v: l.filter((r) => r.situacao === 'Atingida').length, tom: 'ok' },
      { l: 'Em risco', v: l.filter((r) => r.situacao === 'Em risco').length, tom: 'warn' },
      { l: 'Não atingidas', v: l.filter((r) => r.situacao === 'Não atingida').length, tom: 'crit' },
    ],
  },
];

export const estaAberto = (m, r) => !m.status || !(m.fechados || []).includes(r[m.status]);

/** Prazos legais recorrentes dos instrumentos de gestão do SUS (LC 141/2012, art. 36). */
export function obrigacoesLegais(anos) {
  const out = [];
  for (const a of anos) {
    const fimFev = new Date(a, 2, 0).getDate();
    out.push({ data: `${a}-02-${fimFev}`, titulo: `RDQA — 3º quadrimestre de ${a - 1}: audiência pública na Câmara`, base: 'LC 141/2012, art. 36, § 5º' });
    out.push({ data: `${a}-03-30`, titulo: `RAG ${a - 1}: envio ao Conselho Municipal de Saúde`, base: 'LC 141/2012, art. 36, § 1º' });
    out.push({ data: `${a}-05-31`, titulo: `RDQA — 1º quadrimestre de ${a}: audiência pública na Câmara`, base: 'LC 141/2012, art. 36, § 5º' });
    out.push({ data: `${a}-09-30`, titulo: `RDQA — 2º quadrimestre de ${a}: audiência pública na Câmara`, base: 'LC 141/2012, art. 36, § 5º' });
  }
  return out;
}

export function alcanceMeta(r) {
  const alvo = Number(r.alvo);
  const res = Number(r.resultado);
  if (!isFinite(alvo) || !isFinite(res) || r.resultado === '' || r.resultado == null || !alvo) return null;
  if (r.sentido === 'Menor é melhor') return res <= 0 ? 100 : Math.min(200, (alvo / res) * 100);
  return (res / alvo) * 100;
}

export function nivelEstoque(r) {
  const q = Number(r.quantidade) || 0;
  const min = Number(r.estoque_minimo) || 0;
  const cm = Number(r.consumo_mensal) || 0;
  if (q <= 0) return 'Ruptura';
  if (min && q < min) return 'Crítico';
  if (cm && q / (cm / 30) < 30) return 'Atenção';
  return 'Adequado';
}
const ordemNivel = (nv) => ['Ruptura', 'Crítico', 'Atenção', 'Adequado'].indexOf(nv);

export const MOD = Object.fromEntries(MODULOS.map((m) => [m.id, m]));

/** Coleções internas (não aparecem no menu). */
export const COLECOES_INTERNAS = ['comentarios', 'config'];
export const TODAS_COLECOES = [...MODULOS.map((m) => m.id), ...COLECOES_INTERNAS];

/** Valor de exibição de um campo (resolve referências e formata). */
export function valorCampo(campo, r, ctx) {
  const v = r[campo.k];
  if (v == null || v === '') return '';
  switch (campo.t) {
    case 'date': return fmtData(v);
    case 'datetime': return fmtData(v) + (String(v).includes('T') ? ' ' + String(v).slice(11, 16) : '');
    case 'money': return fmtMoeda(v);
    case 'number': return fmtNum(v);
    case 'bool': return v === true || v === 'true' || v === 'TRUE' ? 'Sim' : 'Não';
    case 'ref': {
      const alvo = ctx && ctx.porId(campo.ref, v);
      return alvo ? MOD[campo.ref].titulo(alvo) : '(registro removido)';
    }
    case 'vinculo': {
      const [c, id] = String(v).split(':');
      const alvo = ctx && MOD[c] && ctx.porId(c, id);
      return alvo ? `${MOD[c].singular}: ${MOD[c].titulo(alvo)}` : '';
    }
    default: return String(v);
  }
}
