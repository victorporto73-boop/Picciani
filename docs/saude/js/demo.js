// Modo demonstração: dados FICTÍCIOS e um simulador que imita outras pessoas
// trabalhando ao mesmo tempo, para mostrar o painel atualizando ao vivo.
// Nenhum nome, número de processo, protocolo ou valor aqui corresponde a casos reais.

import { hoje, addDias, isoDataHora, prng, semanaEpi, paraData } from './util.js';
import { SETORES_PADRAO, nivelEstoque } from './modulos.js';

export const USUARIO_DEMO = { login: 'secretario', nome: 'Secretário(a) de Saúde', perfil: 'admin', modulos: '*', setor: 'Gabinete do Secretário' };

const EQUIPE = {
  regulacao: { login: 'regulacao', nome: 'Central de Regulação' },
  caf: { login: 'caf', nome: 'CAF — Farmácia' },
  ouvidoria: { login: 'ouvidoria', nome: 'Ouvidoria SUS' },
  upa: { login: 'upa', nome: 'Direção da UPA 24h' },
  hospital: { login: 'hospital', nome: 'Direção do Hospital' },
  juridico: { login: 'juridico', nome: 'Assessoria Jurídica' },
  escalas: { login: 'escalas', nome: 'Coordenação de Escalas' },
  vigilancia: { login: 'vigilancia', nome: 'Vigilância Epidemiológica' },
  manutencao: { login: 'manutencao', nome: 'Setor de Manutenção' },
};

const dh = (dias, hora, min = 0) => {
  const d = paraData(addDias(hoje(), dias));
  d.setHours(hora, min, 0, 0);
  return isoDataHora(d);
};

export function semear(store) {
  const rnd = prng(2026);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const letras = 'ABCDEFGJLMNPRSTV';
  const ini = () => `${pick(letras)}.${pick(letras)}.${pick(letras)}.`;
  const agora = new Date().toISOString();
  let seq = 0;
  const put = (c, r, autor = 'Implantação (demonstração)') => {
    seq += 1;
    store.dados[c].set(r.id, { criado_em: agora, criado_por: autor, atualizado_em: agora, atualizado_por: autor, _v: seq, ...r });
  };

  put('config', { id: 'geral', orgao: 'Secretaria Municipal de Saúde de Rio das Ostras', setores: SETORES_PADRAO.join('\n'), receita_base: 980000000, exercicio: new Date().getFullYear() });

  // Rede (nomes genéricos por tipo e bairro — exemplos)
  const U = [
    ['un-hosp', 'Hospital Municipal (exemplo)', 'Hospital', 'Centro', 140, 124, 'Atenção', 'Dir. Clínica — plantão'],
    ['un-upa', 'UPA 24h (exemplo)', 'UPA 24h', 'Âncora', 22, 21, 'Atenção', 'Coordenação médica'],
    ['un-pa', 'Pronto Atendimento Rocha Leão', 'Pronto Atendimento', 'Rocha Leão', 8, 4, 'Normal', 'Enf. responsável'],
    ['un-ubs', 'UBS Centro', 'UBS / ESF', 'Centro', 0, 0, 'Normal', 'Gerente da unidade'],
    ['un-esf1', 'ESF Âncora', 'UBS / ESF', 'Âncora', 0, 0, 'Normal', 'Gerente da unidade'],
    ['un-esf2', 'ESF Cidade Praiana', 'UBS / ESF', 'Cidade Praiana', 0, 0, 'Normal', 'Gerente da unidade'],
    ['un-esf3', 'ESF Nova Cidade', 'UBS / ESF', 'Nova Cidade', 0, 0, 'Atenção', 'Gerente da unidade'],
    ['un-esf4', 'ESF Jardim Mariléa', 'UBS / ESF', 'Jardim Mariléa', 0, 0, 'Normal', 'Gerente da unidade'],
    ['un-esf5', 'ESF Costazul', 'UBS / ESF', 'Costazul', 0, 0, 'Crítico', 'Gerente da unidade'],
    ['un-poli', 'Policlínica de Especialidades', 'Policlínica / Especialidades', 'Centro', 0, 0, 'Normal', 'Coordenação'],
    ['un-caps', 'CAPS II', 'CAPS', 'Extensão do Bosque', 0, 0, 'Normal', 'Coordenação'],
    ['un-ceo', 'CEO — Odontologia', 'CEO (Odontologia)', 'Centro', 0, 0, 'Normal', 'Coordenação'],
    ['un-caf', 'CAF — Central de Abastecimento Farmacêutico', 'Farmácia / CAF', 'Centro', 0, 0, 'Normal', 'Farmacêutico(a) responsável'],
    ['un-vig', 'Vigilância em Saúde', 'Vigilância em Saúde', 'Centro', 0, 0, 'Normal', 'Coordenação'],
    ['un-samu', 'Base Descentralizada SAMU', 'SAMU / Base', 'Âncora', 0, 0, 'Normal', 'Coordenação'],
  ];
  U.forEach(([id, nome, tipo, bairro, lt, lo, status, resp]) => put('unidades', {
    id, nome, tipo, bairro, status, responsavel: resp, telefone: '(22) 0000-0000',
    leitos_total: lt || '', leitos_ocupados: lt ? lo : '',
    observacoes: id === 'un-esf5' ? 'Equipe sem médico desde a última semana; atendimentos remanejados para a ESF Jardim Mariléa.' : '',
  }));

  // Ocorrências
  [
    ['ESF Costazul sem médico na equipe', 'un-esf5', 'Recursos humanos', 'Crítica', 'Em atendimento', -6, 'Recursos Humanos'],
    ['Autoclave da UBS Centro parada', 'un-ubs', 'Equipamento', 'Alta', 'Aberta', -3, 'Atenção Primária'],
    ['Queda de energia intermitente', 'un-esf3', 'Infraestrutura / predial', 'Média', 'Em atendimento', -2, 'Planejamento e Gestão'],
    ['Ar-condicionado da sala vermelha com defeito', 'un-upa', 'Equipamento', 'Alta', 'Aberta', -1, 'Urgência e Emergência'],
    ['Sistema de prontuário fora do ar', 'un-esf1', 'Tecnologia / sistemas', 'Média', 'Resolvida', -9, 'Tecnologia da Informação'],
    ['Ambulância em manutenção corretiva', 'un-samu', 'Transporte', 'Média', 'Aberta', 0, 'Urgência e Emergência'],
  ].forEach(([titulo, unidade, tipo, gravidade, status, d, setor], i) => put('ocorrencias', { id: `oc-${i + 1}`, titulo, unidade, tipo, gravidade, status, data: addDias(hoje(), d), setor }));

  // Regulação
  const ESPEC = {
    'Consulta especializada': ['Cardiologia', 'Ortopedia', 'Neurologia', 'Oftalmologia', 'Endocrinologia', 'Urologia', 'Psiquiatria', 'Dermatologia'],
    Exame: ['Ressonância magnética', 'Tomografia computadorizada', 'Ecocardiograma', 'Colonoscopia', 'Mamografia', 'Holter 24h'],
    'Cirurgia eletiva': ['Colecistectomia', 'Hernioplastia inguinal', 'Facectomia (catarata)', 'Artroplastia de joelho'],
    'Leito / internação': ['Leito de UTI adulto', 'Leito clínico', 'Leito de UTI neonatal'],
    TFD: ['Oncologia — tratamento fora do domicílio', 'Cirurgia cardíaca — TFD'],
  };
  const solic = ['un-ubs', 'un-esf1', 'un-esf2', 'un-esf3', 'un-esf4', 'un-poli', 'un-upa', 'un-hosp'];
  for (let i = 1; i <= 34; i += 1) {
    const tipo = pick(['Consulta especializada', 'Consulta especializada', 'Consulta especializada', 'Exame', 'Exame', 'Cirurgia eletiva', 'Leito / internação', 'TFD']);
    const espera = tipo === 'Leito / internação' ? int(0, 2) : int(3, 260);
    let classificacao = pick(['Azul — eletivo', 'Azul — eletivo', 'Verde — prioritário', 'Verde — prioritário', 'Amarelo — urgente']);
    if (tipo === 'Leito / internação') classificacao = pick(['Vermelho — emergência', 'Amarelo — urgente']);
    const status = i <= 24 ? 'Aguardando' : pick(['Agendado', 'Agendado', 'Realizado', 'Cancelado']);
    put('regulacao', {
      id: `rg-${i}`, protocolo: `REG-26-${String(4100 + i * 7).padStart(5, '0')}`, paciente: ini(), tipo,
      especialidade: pick(ESPEC[tipo]), classificacao, status, unidade: tipo === 'Leito / internação' ? pick(['un-upa', 'un-pa']) : pick(solic),
      data_solicitacao: addDias(hoje(), -espera), data_agendamento: status === 'Agendado' ? addDias(hoje(), int(2, 30)) : '',
      prestador: status === 'Agendado' ? pick(['Prestador contratado A', 'Policlínica de Especialidades', 'Referência estadual']) : '',
      judicializado: i === 3 || i === 11,
    });
  }

  // Estoque
  [
    ['Amoxicilina 500 mg', 'Medicamento — componente básico', 'cápsula', 4200, 6000, 9000, -1, 'Em processo de compra'],
    ['Losartana potássica 50 mg', 'Medicamento — componente básico', 'comprimido', 48000, 20000, 30000, 300, 'Regular'],
    ['Metformina 850 mg', 'Medicamento — componente básico', 'comprimido', 26000, 18000, 27000, 210, 'Regular'],
    ['Insulina humana NPH 100 UI/mL', 'Medicamento — componente básico', 'frasco 10 mL', 0, 300, 420, 120, 'Aguardando entrega'],
    ['Dipirona 500 mg/mL', 'Medicamento — componente básico', 'frasco 20 mL', 1800, 1500, 2100, 400, 'Regular'],
    ['Omeprazol 20 mg', 'Medicamento — componente básico', 'cápsula', 9000, 8000, 15000, 45, 'Em processo de compra'],
    ['Salbutamol 100 mcg spray', 'Medicamento — componente básico', 'frasco', 260, 200, 240, 500, 'Regular'],
    ['Sinvastatina 20 mg', 'Medicamento — componente básico', 'comprimido', 31000, 12000, 16000, 380, 'Regular'],
    ['AAS 100 mg', 'Medicamento — componente básico', 'comprimido', 22000, 10000, 14000, 260, 'Regular'],
    ['Clonazepam 2 mg', 'Medicamento — controlado (Port. 344/98)', 'comprimido', 5200, 4000, 6000, 500, 'Regular'],
    ['Ceftriaxona 1 g', 'Medicamento — hospitalar', 'frasco-ampola', 380, 500, 700, 200, 'Empenhado'],
    ['Soro fisiológico 0,9% 500 mL', 'Medicamento — hospitalar', 'bolsa', 2600, 1500, 3000, 150, 'Regular'],
    ['Enoxaparina 40 mg', 'Medicamento — hospitalar', 'seringa', 140, 120, 360, 50, 'Em processo de compra'],
    ['Vacina influenza trivalente', 'Vacina / imunobiológico', 'dose', 3400, 1000, 2500, 75, 'Regular'],
    ['Seringa descartável 5 mL', 'Insumo / material médico', 'unidade', 19000, 8000, 10000, 700, 'Regular'],
    ['Luva de procedimento (M)', 'Insumo / material médico', 'caixa c/ 100', 310, 400, 600, 600, 'Aguardando entrega'],
    ['Tiras reagentes de glicemia', 'Insumo / material médico', 'unidade', 7000, 6000, 9000, 35, 'Regular'],
    ['Fralda geriátrica G', 'Insumo / material médico', 'unidade', 2100, 1500, 4800, 400, 'Em processo de compra'],
    ['Máscara N95/PFF2', 'EPI', 'unidade', 1200, 800, 900, 600, 'Regular'],
  ].forEach(([item, categoria, apresentacao, quantidade, minimo, consumo, validade, compra], i) => put('estoque', {
    id: `es-${i + 1}`, item, categoria, apresentacao, quantidade, estoque_minimo: minimo, consumo_mensal: consumo,
    unidade: i === 10 || i === 11 || i === 12 ? 'un-hosp' : 'un-caf', lote: `L${int(10000, 99999)}`,
    validade: validade < 0 ? addDias(hoje(), -1) : addDias(hoje(), validade), situacao_compra: compra,
    contrato: i === 3 ? 'ct-2' : i === 15 ? 'ct-5' : '',
  }));

  // Escalas — próximos dias
  const cats = ['Médico(a) clínico(a)', 'Médico(a) pediatra', 'Enfermeiro(a)', 'Técnico(a) de enfermagem'];
  let ne = 0;
  for (let d = 0; d <= 6; d += 1) {
    ['un-upa', 'un-hosp', 'un-pa'].forEach((u) => {
      ['Plantão 12h diurno', 'Plantão 12h noturno'].forEach((turno) => {
        cats.slice(0, u === 'un-pa' ? 2 : 3).forEach((cat) => {
          ne += 1;
          const desc = (d === 0 && u === 'un-upa' && turno === 'Plantão 12h noturno' && cat === 'Médico(a) pediatra')
            || (d === 1 && u === 'un-hosp' && turno === 'Plantão 12h noturno' && cat === 'Médico(a) clínico(a)')
            || (d === 4 && u === 'un-pa' && turno === 'Plantão 12h diurno' && cat === 'Médico(a) clínico(a)')
            || (d === 2 && u === 'un-upa' && turno === 'Plantão 12h diurno' && cat === 'Enfermeiro(a)');
          put('escalas', {
            id: `ec-${ne}`, unidade: u, data: addDias(hoje(), d), turno, categoria: cat,
            profissional: desc ? '' : `Profissional ${String.fromCharCode(65 + (ne % 26))}${ne}`,
            situacao: desc ? (d === 2 ? 'Falta' : 'Descoberto') : 'Coberto',
          });
        });
      });
    });
  }

  // Vigilância — últimas 8 semanas epidemiológicas
  const { se, ano } = semanaEpi();
  const bairros = ['Âncora', 'Cidade Praiana', 'Nova Cidade', 'Rocha Leão', 'Costazul', 'Jardim Mariléa'];
  let nv = 0;
  for (let k = 7; k >= 0; k -= 1) {
    const s = se - k > 0 ? se - k : se - k + 52;
    const a = se - k > 0 ? ano : ano - 1;
    bairros.forEach((b, bi) => {
      nv += 1;
      const base = [6, 3, 4, 2, 3, 2][bi];
      const tendencia = bi === 2 ? (8 - k) * 3 : bi === 0 ? (8 - k) : 0;
      const notificados = Math.max(0, base + tendencia + int(-2, 3));
      const situacao = bi === 2 && k <= 1 ? 'Alerta' : 'Monitoramento';
      put('vigilancia', { id: `vg-${nv}`, agravo: 'Dengue', semana: s, ano: a, bairro: b, notificados, confirmados: Math.round(notificados * 0.42), obitos: 0, situacao, acoes: situacao === 'Alerta' ? 'Intensificação de visitas domiciliares e bloqueio de transmissão.' : '' });
    });
    nv += 1;
    put('vigilancia', { id: `vg-${nv}`, agravo: 'Influenza / SRAG', semana: s, ano: a, bairro: 'Município (total)', notificados: int(4, 11), confirmados: int(1, 4), obitos: k === 2 ? 1 : 0, situacao: 'Monitoramento' });
  }

  // Campanhas
  [
    ['Campanha de vacinação contra influenza', 'Idosos, gestantes, crianças e grupos prioritários', 'Em andamento', -40, 5, 38000, 30400],
    ['Multivacinação — atualização da caderneta', 'Crianças e adolescentes até 15 anos', 'Em andamento', -10, 20, 12000, 4100],
    ['Vacinação contra HPV nas escolas', 'Estudantes de 9 a 14 anos', 'Planejada', 15, 60, 6000, 0],
    ['Mutirão de rastreamento de câncer de mama', 'Mulheres de 50 a 69 anos', 'Encerrada', -70, -40, 2500, 2310],
  ].forEach(([nome, publico, status, i0, i1, meta, realizado], i) => put('campanhas', { id: `cp-${i + 1}`, nome, publico, status, inicio: addDias(hoje(), i0), fim: addDias(hoje(), i1), meta, realizado, setor: 'Vigilância em Saúde' }));

  // Judicialização (identificadores fictícios — não seguem a numeração CNJ de propósito)
  [
    ['DEMO-JUD-0001/2026', 'Mandado judicial — TJRJ', 'Medicamento', 'Em cumprimento', -1, 500, 'Fornecimento de insulina análoga de ação prolongada.', 'es-4', ''],
    ['DEMO-JUD-0002/2026', 'Mandado judicial — TJRJ', 'Leito / internação', 'Recebido', 0, 1000, 'Transferência para leito de UTI adulto em 24 horas.', '', 'rg-3'],
    ['DEMO-JUD-0003/2026', 'Ministério Público (MPRJ)', 'Informações / documentos', 'Em cumprimento', 2, '', 'Requisição de informações sobre a fila de cirurgias ortopédicas.', '', ''],
    ['DEMO-JUD-0004/2026', 'Mandado judicial — TJRJ', 'Procedimento / cirurgia', 'Em cumprimento', 5, 300, 'Realização de artroplastia de joelho.', '', 'rg-11'],
    ['DEMO-JUD-0005/2026', 'Defensoria Pública', 'Insumo / dieta / fralda', 'Recebido', 9, '', 'Fornecimento de fraldas geriátricas e dieta enteral.', 'es-18', ''],
    ['DEMO-JUD-0006/2026', 'Tribunal de Contas (TCE-RJ)', 'Informações / documentos', 'Em cumprimento', 15, '', 'Envio de documentos sobre contratos de gestão.', '', ''],
    ['DEMO-JUD-0007/2026', 'Mandado judicial — Justiça Federal', 'Medicamento', 'Defesa / recurso', 20, '', 'Medicamento oncológico não incorporado — análise de competência.', '', ''],
    ['DEMO-JUD-0008/2026', 'Câmara Municipal', 'Informações / documentos', 'Cumprido', -12, '', 'Requerimento de informações sobre escalas da UPA.', '', ''],
  ].forEach(([numero, origem, tipo_objeto, status, p, multa, descricao, item, reg], i) => put('judicial', {
    id: `jd-${i + 1}`, numero, origem, tipo_objeto, status, beneficiario: origem.startsWith('Mandado') || origem === 'Defensoria Pública' ? ini() : '',
    data_intimacao: addDias(hoje(), p - 10), prazo: addDias(hoje(), p), multa, responsavel: tipo_objeto === 'Medicamento' || tipo_objeto.startsWith('Insumo') ? 'Assistência Farmacêutica' : tipo_objeto === 'Informações / documentos' ? 'Assessoria Jurídica' : 'Regulação, Controle e Avaliação',
    procurador: 'Procuradoria-Geral do Município', descricao, item_estoque: item, regulacao: reg,
  }, EQUIPE.juridico.nome));

  // Ouvidoria
  [
    ['Reclamação', 'Demora no atendimento da UPA', 'un-upa', 'Em análise', -27, 'Telefone'],
    ['Reclamação', 'Falta de medicamento na farmácia', 'un-caf', 'Encaminhada ao setor', -33, 'Fala.BR'],
    ['Denúncia', 'Profissional ausente no horário de atendimento', 'un-esf5', 'Em análise', -20, 'Disque Saúde 136'],
    ['Solicitação', 'Agendamento de consulta com cardiologista', 'un-poli', 'Recebida', -2, 'Presencial'],
    ['Elogio', 'Atendimento humanizado da equipe de enfermagem', 'un-hosp', 'Concluída', -14, 'E-mail'],
    ['Sugestão', 'Ampliação do horário da UBS', 'un-ubs', 'Respondida', -18, 'WhatsApp'],
    ['Reclamação', 'Marcação de exame de ressonância', 'un-poli', 'Encaminhada ao setor', -25, 'Telefone'],
    ['Informação', 'Calendário de vacinação contra influenza', 'un-vig', 'Respondida', -5, 'Telefone'],
    ['Reclamação', 'Ambulância demorou a chegar', 'un-samu', 'Recebida', -1, 'Disque Saúde 136'],
    ['Solicitação', 'Fornecimento de fraldas geriátricas', 'un-caf', 'Em análise', -12, 'Presencial'],
  ].forEach(([tipo, assunto, unidade, status, d, canal], i) => put('ouvidoria', {
    id: `ov-${i + 1}`, protocolo: `OUV-2026-${String(812 + i * 3).padStart(5, '0')}`, tipo, assunto, unidade, status, canal,
    data_registro: addDias(hoje(), d), prazo: addDias(hoje(), d + 30), setor: 'Ouvidoria',
    resposta: ['Respondida', 'Concluída'].includes(status) ? 'Resposta enviada ao usuário.' : '',
  }, EQUIPE.ouvidoria.nome));

  // Protocolo
  [
    ['PROT-2026-01533', 'Ofício recebido', 'Solicitação de dados de cobertura vacinal', 'Câmara Municipal', 'Gabinete', -4, 3, 'Vigilância em Saúde', 'Em tramitação'],
    ['PROT-2026-01540', 'Processo administrativo', 'Aquisição de equipamentos para a UPA', 'Urgência e Emergência', 'Compras e Contratos', -15, '', 'Compras e Contratos', 'Em tramitação'],
    ['PROT-2026-01548', 'Portaria', 'Designação de fiscais de contratos', 'Gabinete', 'Publicação', -1, 1, 'Gabinete do Secretário', 'Aguardando assinatura'],
    ['PROT-2026-01551', 'Ofício recebido', 'Pedido de informações sobre ESF Costazul', 'Conselho Municipal de Saúde', 'Gabinete', -3, -1, 'Atenção Primária', 'Recebido'],
    ['PROT-2026-01560', 'Resolução do CMS', 'Aprovação da Programação Anual de Saúde', 'Conselho Municipal de Saúde', 'Planejamento', -20, '', 'Planejamento e Gestão', 'Arquivado'],
    ['PROT-2026-01566', 'Memorando', 'Remanejamento de profissionais para a UPA', 'Recursos Humanos', 'Urgência e Emergência', -2, 4, 'Recursos Humanos', 'Em tramitação'],
  ].forEach(([numero, tipo, assunto, origem, destino, d, p, setor, status], i) => put('protocolo', { id: `pt-${i + 1}`, numero, tipo, assunto, origem, destino, data: addDias(hoje(), d), prazo: p === '' ? '' : addDias(hoje(), p), setor, status }));

  // Contratos (fornecedores fictícios)
  [
    ['CT 014/2025', 'Serviços de exames de imagem', 'Empresa Exemplo A Ltda.', 'Pregão eletrônico', 'Vigente', 4200000, -320, 45, ''],
    ['ARP 022/2025', 'Fornecimento de medicamentos da atenção básica', 'Distribuidora Exemplo B S.A.', 'Adesão a ata de registro de preços', 'Vigente', 6800000, -200, 165, ''],
    ['CT 031/2025', 'Manutenção preventiva e corretiva de equipamentos médicos', 'Empresa Exemplo C Ltda.', 'Pregão eletrônico', 'Vigente', 1250000, -340, 25, 'un-hosp'],
    ['CT 007/2026', 'Locação de ambulâncias com motorista', 'Empresa Exemplo D Ltda.', 'Pregão eletrônico', 'Vigente', 3900000, -120, 245, 'un-samu'],
    ['ARP 040/2025', 'Material médico-hospitalar', 'Distribuidora Exemplo E Ltda.', 'Adesão a ata de registro de preços', 'Vigente', 2100000, -280, 80, ''],
    ['PE 058/2026', 'Aquisição de equipamentos para a UPA 24h', '', 'Pregão eletrônico', 'Em julgamento', 980000, '', '', 'un-upa'],
    ['PE 061/2026', 'Contratação de serviço de dietas enterais', '', 'Pregão eletrônico', 'Fase interna', 1500000, '', '', ''],
    ['CT 002/2024', 'Serviço de limpeza hospitalar', 'Empresa Exemplo F Ltda.', 'Concorrência', 'Vigente', 5400000, -700, -3, 'un-hosp'],
  ].forEach(([numero, objeto, fornecedor, modalidade, fase, valor, i0, i1, unidade], i) => put('contratos', {
    id: `ct-${i + 1}`, numero, objeto, fornecedor, modalidade, fase, valor, unidade,
    inicio: i0 === '' ? '' : addDias(hoje(), i0), fim: i1 === '' ? '' : addDias(hoje(), i1),
    fiscal: fase === 'Vigente' ? `Servidor(a) fiscal ${i + 1}` : '', gestor: fase === 'Vigente' ? 'Compras e Contratos' : '',
  }));

  // Orçamento (valores fictícios)
  const ex = new Date().getFullYear();
  [
    ['Atenção Primária à Saúde', 'Manutenção das ações e serviços públicos de saúde', 'Recursos próprios (ASPS)', 92e6, 80e6, 68e6, 64e6],
    ['Atenção Especializada e Hospitalar (MAC)', 'Manutenção das ações e serviços públicos de saúde', 'Recursos próprios (ASPS)', 140e6, 128e6, 104e6, 99e6],
    ['Atenção Especializada e Hospitalar (MAC)', 'Manutenção das ações e serviços públicos de saúde', 'Transferência federal (FNS)', 46e6, 41e6, 35e6, 34e6],
    ['Atenção Primária — incentivos federais', 'Manutenção das ações e serviços públicos de saúde', 'Transferência federal (FNS)', 24e6, 21e6, 18.5e6, 18e6],
    ['Assistência Farmacêutica', 'Manutenção das ações e serviços públicos de saúde', 'Recursos próprios (ASPS)', 21e6, 19e6, 14e6, 13.2e6],
    ['Vigilância em Saúde', 'Manutenção das ações e serviços públicos de saúde', 'Transferência federal (FNS)', 6.2e6, 5.1e6, 4.2e6, 4.1e6],
    ['Gestão do SUS e manutenção administrativa', 'Não se aplica (recursos próprios)', 'Recursos próprios (ASPS)', 18e6, 16.5e6, 14e6, 13.6e6],
    ['Reforma e ampliação de unidades', 'Estruturação da rede de serviços públicos de saúde', 'Emenda parlamentar', 4.5e6, 2.2e6, 0.9e6, 0.9e6],
    ['Aquisição de equipamentos', 'Estruturação da rede de serviços públicos de saúde', 'Transferência estadual (FES)', 3.2e6, 1.1e6, 0.4e6, 0.4e6],
  ].forEach(([acao, bloco, fonte, dotacao, empenhado, liquidado, pago], i) => put('orcamento', { id: `or-${i + 1}`, acao, bloco, fonte, dotacao, empenhado, liquidado, pago, exercicio: ex }));

  // Planejamento
  [
    ['Ampliar a cobertura da Estratégia Saúde da Família', 'Cobertura populacional estimada pelas equipes de APS', '%', 'Maior é melhor', 72, 80, 76, 'No prazo', 'Atenção Primária'],
    ['Garantir 6 ou mais consultas de pré-natal', 'Proporção de gestantes com 6+ consultas', '%', 'Maior é melhor', 58, 70, 61, 'Em risco', 'Atenção Primária'],
    ['Alcançar cobertura vacinal contra influenza nos grupos prioritários', 'Cobertura vacinal — influenza', '%', 'Maior é melhor', 66, 90, 80, 'No prazo', 'Vigilância em Saúde'],
    ['Reduzir o tempo médio de espera para consulta especializada', 'Tempo médio de espera (dias)', 'dias', 'Menor é melhor', 140, 90, 118, 'Em risco', 'Regulação, Controle e Avaliação'],
    ['Responder as manifestações da ouvidoria dentro do prazo legal', 'Proporção de manifestações respondidas no prazo', '%', 'Maior é melhor', 71, 95, 88, 'No prazo', 'Ouvidoria'],
    ['Implantar prontuário eletrônico em todas as UBS', 'Proporção de UBS com prontuário eletrônico', '%', 'Maior é melhor', 60, 100, 100, 'Atingida', 'Tecnologia da Informação'],
    ['Reduzir internações por condições sensíveis à APS', 'Proporção de internações por CSAP', '%', 'Menor é melhor', 28, 24, 27, 'Não atingida', 'Atenção Primária'],
    ['Manter abastecimento dos medicamentos da REMUME', 'Proporção de itens sem ruptura', '%', 'Maior é melhor', 88, 97, 94, 'No prazo', 'Assistência Farmacêutica'],
  ].forEach(([meta, indicador, um, sentido, lb, alvo, resultado, situacao, setor], i) => put('planejamento', { id: `pl-${i + 1}`, meta, indicador, unidade_medida: um, sentido, linha_base: lb, alvo, resultado, situacao, setor, ano: ex, instrumento: 'Programação Anual de Saúde' }));

  // Agenda
  [
    ['Reunião de monitoramento com diretores das unidades de urgência', 'Reunião', 0, 9, 'Gabinete', 'Confirmado', 'un-upa'],
    ['Despacho com a Assessoria Jurídica — mandados com prazo', 'Despacho interno', 0, 14, 'Gabinete', 'Agendado', ''],
    ['Visita técnica à ESF Costazul', 'Visita técnica', 1, 10, 'ESF Costazul', 'Confirmado', 'un-esf5'],
    ['Reunião ordinária do Conselho Municipal de Saúde', 'Conselho Municipal de Saúde', 2, 18, 'Sede do CMS', 'Confirmado', ''],
    ['Alinhamento com Vigilância — situação da dengue', 'Reunião', 3, 11, 'Vigilância em Saúde', 'Agendado', 'un-vig'],
    ['Audiência na Vara — demanda de saúde', 'Audiência judicial', 6, 13, 'Fórum', 'Agendado', ''],
    ['Reunião com a Comissão de Saúde da Câmara', 'Câmara Municipal', 8, 15, 'Câmara Municipal', 'Agendado', ''],
    ['Inauguração da sala de vacina reformada', 'Evento', 12, 10, 'UBS Centro', 'Agendado', 'un-ubs'],
    ['Reunião com fornecedores de medicamentos', 'Reunião', -2, 10, 'Gabinete', 'Realizado', 'un-caf'],
  ].forEach(([titulo, tipo, d, hora, local, status, unidade], i) => put('agenda', { id: `ag-${i + 1}`, titulo, tipo, inicio: dh(d, hora), fim: dh(d, hora + 1, 30), local, status, unidade, participantes: '' }));

  // Tarefas
  [
    ['Providenciar compra emergencial de insulina NPH', 'Assistência Farmacêutica', 'Farmacêutico(a) responsável', 'Urgente', 'Em andamento', 1, 'estoque:es-4'],
    ['Cumprir mandado de transferência para UTI', 'Regulação, Controle e Avaliação', 'Central de Regulação', 'Urgente', 'Em andamento', 0, 'judicial:jd-2'],
    ['Responder requisição do MPRJ sobre fila de ortopedia', 'Assessoria Jurídica', 'Assessor(a) jurídico(a)', 'Alta', 'A fazer', 2, 'judicial:jd-3'],
    ['Recompor equipe da ESF Costazul', 'Recursos Humanos', 'Coordenação de RH', 'Alta', 'Aguardando terceiros', 3, 'unidades:un-esf5'],
    ['Iniciar processo de renovação do contrato de exames de imagem', 'Compras e Contratos', 'Gestor(a) de contratos', 'Alta', 'A fazer', 10, 'contratos:ct-1'],
    ['Consertar autoclave da UBS Centro', 'Planejamento e Gestão', 'Setor de Manutenção', 'Média', 'Em andamento', 4, 'ocorrencias:oc-2'],
    ['Preparar apresentação do RDQA para audiência pública', 'Planejamento e Gestão', 'Coordenação de Planejamento', 'Média', 'A fazer', 30, ''],
    ['Intensificar ações contra dengue em Nova Cidade', 'Vigilância em Saúde', 'Coordenação de Vigilância', 'Alta', 'Em andamento', 5, ''],
    ['Cobrir plantão pediátrico noturno da UPA', 'Urgência e Emergência', 'Coordenação de Escalas', 'Urgente', 'A fazer', 0, ''],
    ['Publicar portaria de fiscais de contratos', 'Gabinete do Secretário', 'Chefia de Gabinete', 'Média', 'Concluída', -1, 'protocolo:pt-3'],
    ['Regularizar contrato de limpeza hospitalar vencido', 'Compras e Contratos', 'Gestor(a) de contratos', 'Urgente', 'A fazer', -2, 'contratos:ct-8'],
  ].forEach(([titulo, setor, responsavel, prioridade, status, p, vinculo], i) => put('tarefas', { id: `tf-${i + 1}`, titulo, setor, responsavel, prioridade, status, prazo: addDias(hoje(), p), vinculo, origem: 'Despacho do Secretário' }));

  // Avisos e comentários
  put('avisos', { id: 'av-1', titulo: 'Plano de contingência para o verão', prioridade: 'Importante', destino: 'Todas as unidades', validade: addDias(hoje(), 20), mensagem: 'Revisar escalas e estoques para o aumento da população flutuante no período de verão.' });
  put('avisos', { id: 'av-2', titulo: 'Atualização do fluxo de mandados judiciais', prioridade: 'Informativo', destino: 'Coordenações', validade: addDias(hoje(), 10), mensagem: 'Todo mandado deve ser cadastrado no módulo de Judicialização no mesmo dia do recebimento.' });
  put('comentarios', { id: 'cm-1', colecao: 'judicial', registro: 'jd-1', texto: 'Fornecedor confirmou entrega para amanhã cedo. Juntar comprovante ao processo.', autor: EQUIPE.caf.nome }, EQUIPE.caf.nome);
  put('comentarios', { id: 'cm-2', colecao: 'unidades', registro: 'un-esf5', texto: 'Chamamento de profissional publicado; previsão de posse em 5 dias.', autor: 'Coordenação de RH' }, 'Coordenação de RH');

  store.seq = seq;
  store.carregado = true;
  store.eventos = [];
  [
    [EQUIPE.juridico, 'judicial', 'jd-2', 'criar', [], 50],
    [EQUIPE.caf, 'estoque', 'es-4', 'atualizar', ['quantidade', 'situacao_compra'], 40],
    [EQUIPE.ouvidoria, 'ouvidoria', 'ov-9', 'criar', [], 30],
    [EQUIPE.escalas, 'escalas', 'ec-5', 'atualizar', ['situacao'], 20],
    [EQUIPE.upa, 'unidades', 'un-upa', 'atualizar', ['leitos_ocupados'], 8],
  ].forEach(([u, c, id, a, f, minAtras], i) => store.registrarEvento({ s: i + 1, q: new Date(Date.now() - minAtras * 60000).toISOString(), u: u.login, n: u.nome, c, id, a, f }));
}

/** Simula a equipe trabalhando: uma alteração a cada 8–18 segundos. */
export function iniciarSimulador(store) {
  let parado = false;
  let n = 0;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const presenca = () => {
    const t = new Date().toISOString();
    store.online = [EQUIPE.regulacao, EQUIPE.caf, EQUIPE.ouvidoria, EQUIPE.upa, EQUIPE.juridico].map((u) => ({ ...u, t }));
  };
  presenca();

  const acoes = [
    () => { // regulação agenda alguém da fila
      const r = pick(store.lista('regulacao').filter((x) => x.status === 'Aguardando' && x.tipo !== 'Leito / internação'));
      if (r) store.mudancaExterna('regulacao', { id: r.id, status: 'Agendado', data_agendamento: addDias(hoje(), 3 + Math.floor(Math.random() * 20)), prestador: 'Policlínica de Especialidades' }, EQUIPE.regulacao);
    },
    () => { // dispensação na farmácia
      const r = pick(store.lista('estoque').filter((x) => Number(x.quantidade) > 50));
      if (r) store.mudancaExterna('estoque', { id: r.id, quantidade: Math.max(0, Math.round(Number(r.quantidade) * (0.9 + Math.random() * 0.06))) }, EQUIPE.caf);
    },
    () => { // nova manifestação
      const assuntos = [['Reclamação', 'Tempo de espera para consulta'], ['Solicitação', 'Segunda via de cartão SUS'], ['Elogio', 'Atendimento na vacinação'], ['Reclamação', 'Falta de pediatra no plantão']];
      const [tipo, assunto] = pick(assuntos);
      const id = `ov-s${Date.now().toString(36)}`;
      store.mudancaExterna('ouvidoria', { id, protocolo: `OUV-2026-${String(900 + Math.floor(Math.random() * 99)).padStart(5, '0')}`, tipo, assunto, unidade: pick(['un-upa', 'un-ubs', 'un-esf2', 'un-poli']), status: 'Recebida', canal: 'Disque Saúde 136', data_registro: hoje(), prazo: addDias(hoje(), 30), setor: 'Ouvidoria' }, EQUIPE.ouvidoria);
    },
    () => { // movimento de leitos
      const r = pick([store.porId('unidades', 'un-upa'), store.porId('unidades', 'un-hosp'), store.porId('unidades', 'un-pa')].filter(Boolean));
      if (!r) return;
      const tot = Number(r.leitos_total) || 0;
      const oc = Math.min(tot, Math.max(0, (Number(r.leitos_ocupados) || 0) + pick([-2, -1, 1, 1, 2])));
      const pctOc = tot ? oc / tot : 0;
      store.mudancaExterna('unidades', { id: r.id, leitos_ocupados: oc, status: r.id === 'un-esf5' ? r.status : pctOc >= 1 ? 'Crítico' : pctOc >= 0.85 ? 'Atenção' : 'Normal' }, r.id === 'un-hosp' ? EQUIPE.hospital : EQUIPE.upa);
    },
    () => { // escala coberta
      const r = pick(store.lista('escalas').filter((x) => ['Descoberto', 'Falta'].includes(x.situacao)));
      if (r) store.mudancaExterna('escalas', { id: r.id, situacao: 'Coberto', profissional: 'Profissional remanejado(a)' }, EQUIPE.escalas);
    },
    () => { // tarefa avança
      const ordem = ['A fazer', 'Em andamento', 'Concluída'];
      const r = pick(store.lista('tarefas').filter((x) => ['A fazer', 'Em andamento'].includes(x.status)));
      if (r) store.mudancaExterna('tarefas', { id: r.id, status: ordem[ordem.indexOf(r.status) + 1] }, pick([EQUIPE.regulacao, EQUIPE.caf, EQUIPE.juridico]));
    },
    () => { // mandado entra em cumprimento
      const r = pick(store.lista('judicial').filter((x) => x.status === 'Recebido'));
      if (r) store.mudancaExterna('judicial', { id: r.id, status: 'Em cumprimento', providencias: 'Encaminhado ao setor responsável para cumprimento.' }, EQUIPE.juridico);
    },
    () => { // reposição de estoque
      const r = pick(store.lista('estoque').filter((x) => ['Ruptura', 'Crítico'].includes(nivelEstoque(x))));
      if (r) store.mudancaExterna('estoque', { id: r.id, quantidade: Math.round((Number(r.estoque_minimo) || 100) * 1.6), situacao_compra: 'Regular' }, EQUIPE.caf);
    },
  ];

  const passo = () => {
    if (parado) return;
    n += 1;
    presenca();
    if (n === 4 && !store.lista('avisos').some((a) => a.id === 'av-sim')) {
      store.mudancaExterna('avisos', { id: 'av-sim', titulo: 'Aumento de casos de dengue em Nova Cidade', prioridade: 'Urgente', destino: 'Atenção Primária e Vigilância', validade: addDias(hoje(), 7), mensagem: 'Bairro em alerta pela segunda semana. Reforçar notificação imediata e visitas domiciliares.' }, EQUIPE.vigilancia);
    } else {
      pick(acoes)();
    }
    setTimeout(passo, 8000 + Math.random() * 10000);
  };
  setTimeout(passo, 7000);
  return () => { parado = true; };
}
