# Guia prático — Gestão Integrada da Saúde

Painel de controle da Secretaria Municipal de Saúde de Rio das Ostras.

**Endereço:** `https://victorporto73-boop.github.io/Picciani/saude/`

---

## 1. Primeiro contato: modo demonstração

1. Abra o endereço acima.
2. Clique em **Explorar em modo demonstração**.
3. Os dados são fictícios e ficam só naquele navegador. Uma equipe simulada altera
   registros a cada poucos segundos, para mostrar o painel atualizando sozinho.

Para sair da demonstração e conectar ao servidor da Secretaria, clique em
**Conectar ao servidor** na faixa roxa do topo.

## 2. Entrar

Na primeira vez, informe:

- **Endereço do servidor:** a URL `/exec` fornecida pela administração do sistema
  (não aparece se já estiver configurada);
- **Usuário** e **senha** recebidos do administrador.

Troque a senha no primeiro acesso: **Configurações → Minha senha** (mínimo de 8 caracteres).

## 3. Instalar no celular

- **iPhone (Safari):** abrir o endereço → **Compartilhar → Adicionar à Tela de Início**.
- **Android (Chrome):** abrir o endereço → **⋮ → Instalar app** (ou *Adicionar à tela inicial*).

O aplicativo ganha ícone próprio e abre mesmo sem sinal, com os últimos dados salvos.

## 4. Perfis de acesso

| Perfil | Para quem | Pode |
|---|---|---|
| Administrador | Secretário e TI | Tudo, inclusive usuários e dados da Secretaria |
| Gestor | Subsecretário, chefia de gabinete | Ver e editar todos os módulos |
| Editor | Coordenações | Editar só os módulos autorizados |
| Consulta | Quem só acompanha | Ler os módulos autorizados e comentar |

## 5. As telas

### Painel do Secretário (tela inicial)

- **Cartões do topo:** ocupação de leitos, fila da regulação, farmácia, mandados,
  plantões descobertos, ouvidoria, contratos a vencer e demandas atrasadas.
  Clique num cartão para abrir o módulo.
- **Alertas prioritários:** primeiro o que expõe o paciente ou o gestor (mandados,
  plantões descobertos, regulação vermelha).
- **Agenda e prazos**, **Mural de avisos**, **Situação da rede** e **Atividade em tempo real**.
- **Relatório:** imprime ou gera PDF do painel.

### Barra superior

- **Busca:** procura em todos os módulos. Atalho: tecla `/`.
- **Indicador de conexão:**

| Indicador | Significa |
|---|---|
| ● verde, "Ao vivo" | Conectado. Alterações dos outros chegam a cada 6 segundos |
| ● azul, "Enviando" | Gravando no servidor |
| ● amarelo, "Sem conexão · N na fila" | Pode continuar trabalhando: envia sozinho quando a internet voltar |
| ● vermelho, "Falha" | O servidor não respondeu. Tenta de novo sozinho; o botão ↻ força |

- **Iniciais ao lado:** quem está conectado agora.
- **Sino:** alertas. Ali também se ativam os avisos do navegador para o mural.

### Dentro de um módulo

- Indicadores do setor no topo.
- **Tabela** (clique no título da coluna para ordenar), **Quadro** (arraste o cartão
  para mudar a situação) ou **Calendário** (Agenda).
- **Filtros:** busca, listas por campo, *Ocultar encerrados*, *Só com alerta*.
- **CSV:** exporta a lista filtrada, pronta para o Excel.
- **Base legal:** fundamento do módulo.
- **+ Novo:** cadastra um registro. Campos com * são obrigatórios.

### Painel do registro (abre pela direita)

- **Dados:** editar e salvar.
- **Vínculos:** o que se liga ao registro em outros módulos. Nas unidades chama-se
  **Visão integrada** e reúne ocorrências, ouvidoria, escalas, filas e contratos daquela unidade.
- **Comentários:** conversa da equipe sobre o caso. Ctrl+Enter envia.
- **Histórico:** quem alterou o quê e quando.
- **Gerar demanda:** cria uma tarefa já vinculada ao registro, com prazo sugerido.
- **🔗:** copia o link direto do registro. Quem recebe precisa ter login.

Se outra pessoa alterar o registro enquanto você edita, aparece um aviso amarelo.
Ao salvar, os campos alterados por cada um são mesclados.

### Agenda do Gabinete

O calendário mostra os compromissos e, com a opção marcada, os prazos de todos
os módulos e as obrigações legais do planejamento do SUS:

- RDQA em audiência pública na Câmara: até o fim de fevereiro, maio e setembro
  (LC 141/2012, art. 36, § 5º);
- RAG ao Conselho Municipal de Saúde: até 30 de março (art. 36, § 1º).

Clique num dia para ver a lista e criar um compromisso.

### Mural de avisos

Avisos **Urgentes** e **Importantes** aparecem na hora na tela de todos os conectados.

## 6. Rotina sugerida

**Secretário, pela manhã (5 minutos)**
Painel → Alertas prioritários → Agenda e prazos do dia → **Gerar demanda** para o
que precisa de providência.

**Coordenações: manter o próprio módulo em dia**

| Setor | Quando atualizar |
|---|---|
| Regulação | Ao agendar, realizar ou cancelar |
| Farmácia / CAF | Ao receber, dispensar ou mudar a situação de compra |
| Assessoria Jurídica | Mandado ou ofício cadastrado no dia do recebimento |
| Ouvidoria | Ao registrar, encaminhar e responder |
| Escalas | Assim que souber de falta ou plantão descoberto |
| Direções de unidade | Ocupação de leitos e ocorrências |
| Vigilância | Consolidado da semana epidemiológica |
| Compras e Contratos / Fundo | Fase dos processos, vigência e execução orçamentária |

**Sempre:** clique em **Sair** em computador compartilhado. Ao sair, o aplicativo
apaga os dados guardados naquele aparelho.

## 7. Proteção de dados

O sistema é gerencial. Para pacientes, registre **somente protocolo e iniciais**.
Os dados identificados ficam nos sistemas oficiais (regulação, e-SUS, prontuário).
Dados de saúde são dados pessoais sensíveis (LGPD, art. 5º, II, e art. 11).

## 8. Problemas comuns

| Situação | O que fazer |
|---|---|
| "Não foi possível alcançar o servidor" | Conferir a internet e a URL `/exec`; avisar a TI |
| "Sessão expirou" | Entrar de novo. Também ocorre quando o administrador muda o seu perfil |
| Esqueci a senha | Pedir ao administrador: Usuários e perfis → abrir o usuário → nova senha |
| Não vejo um módulo | O seu perfil não inclui esse módulo; pedir ao administrador |
| Aparelho perdido | Avisar a TI para encerrar todas as sessões |

Instalação e manutenção do servidor: `apps-script/saude/LEIA-ME.md`.
