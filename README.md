Este repositório tem dois sistemas:

- **Gestão Integrada da Saúde** — painel do Secretário Municipal de Saúde de Rio das Ostras
  (`docs/saude/` + `apps-script/saude/`). Veja a seção abaixo.
- **Cadastro Reunião** — app de presença em reunião (`docs/` + `apps-script/`). Veja mais abaixo.

# Gestão Integrada da Saúde

Painel único para o Secretário e as coordenações acompanharem a Secretaria inteira,
com atualização em tempo real entre todos os usuários conectados.

    docs/saude/              aplicativo (PWA) — publicado pelo GitHub Pages em /saude/
      js/modulos.js          os 16 módulos: campos, alertas, indicadores (edite aqui)
      js/store.js            cache local, fila offline e sincronização
      js/app.js              telas: painel, módulos, agenda, gaveta de registro, usuários
      js/demo.js             dados fictícios e equipe simulada do modo demonstração
      js/config.js           URL do servidor e intervalos de sincronização
    apps-script/saude/       servidor (Google Apps Script + Planilha) e guia de instalação

**Módulos**

| Grupo | Módulos |
|---|---|
| Gabinete | Painel do Secretário · Agenda integrada (compromissos + prazos de todos os módulos + obrigações da LC 141/2012) · Demandas e tarefas (quadro kanban) · Mural de avisos |
| Rede e Assistência | Rede de unidades (com visão integrada por unidade) · Ocorrências · Regulação e filas · Farmácia e insumos · Escalas e plantões |
| Vigilância em Saúde | Agravos por semana epidemiológica · Imunização e campanhas |
| Controle | Judicialização e órgãos de controle · Ouvidoria do SUS · Protocolo e documentos |
| Gestão e Finanças | Contratos e compras · Orçamento e Fundo de Saúde · Planejamento e metas |

**Integração e tempo real**

- Alertas automáticos (prazo de mandado, ouvidoria fora do prazo legal, ruptura e validade de
  estoque, leitos lotados, plantão descoberto, contrato vencendo...) no painel, no menu e no sino.
- Cada registro mostra o que se liga a ele nos outros módulos. Por exemplo: uma unidade
  reúne suas ocorrências, manifestações da ouvidoria, escalas, filas e contratos. Qualquer
  registro gera uma demanda vinculada com um clique.
- Alterações de qualquer usuário chegam às outras telas em segundos, com destaque visual,
  feed de atividade, presença de quem está conectado e comentários por registro.
- Funciona sem internet: a tela abre do cache e as gravações entram numa fila enviada
  automaticamente quando a conexão volta.
- Perfis (admin, gestor, editor, leitor) e módulos autorizados verificados no servidor;
  trilha de auditoria completa na aba `_Eventos`.

**Dentro do Claude:** o mesmo app roda como artefato no Claude (`artefato/`), com os dados no
armazenamento compartilhado do próprio artefato, login pela conta Claude e permissões pelo
botão Compartilhar. Veja `artefato/LEIA-ME.md`.

**Experimentar agora:** abra `/saude/` e escolha *Explorar em modo demonstração* (dados
fictícios e uma equipe simulada alterando registros a cada poucos segundos).

**Instalar de verdade:** siga `apps-script/saude/LEIA-ME.md`.

**Guia de uso para a equipe:** `docs/saude/GUIA.md`.

---

# Cadastro Reunião — app + planilha

App de cadastro de presença para reunião política. Funciona offline no celular e grava
na planilha do Google.

Planilha: `1UZR3rKnOLbIGDr9Z9qMR1RUmxTvxfqF1Zg3mwzUM4FU` (aba `Cadastros`)

## Estrutura

    apps-script/Codigo.gs   backend (grava na planilha, evita duplicidade, conta e lista)
    apps-script/Index.html  versão que roda dentro do próprio Apps Script
    docs/index.html         versão hospedada no GitHub Pages (grava via fetch no Apps Script)
    docs/sw.js              service worker — abre offline depois da primeira visita
    docs/manifest.webmanifest, docs/icon.svg   ícone e "adicionar à tela de início"

## Passo 1 — backend na planilha

1. Abra a planilha → **Extensões → Apps Script**.
2. Cole `apps-script/Codigo.gs` no arquivo `Codigo.gs`.
3. Crie um arquivo HTML chamado `Index` e cole `apps-script/Index.html`
   (opcional — só se quiser também abrir o app pela URL do Apps Script).
4. Rode a função `prepararPlanilha()` uma vez e autorize.
5. **Implantar → Nova implantação → App da Web**
   - Executar como: **eu**
   - Quem tem acesso: **qualquer pessoa**
6. Copie a URL gerada (termina em `/exec`).

Importante: a cada alteração no `Codigo.gs`, crie uma **nova versão** da implantação,
senão a URL continua servindo o código antigo.

## Passo 2 — publicar no GitHub Pages

1. Crie um repositório (pode ser público) e envie estes arquivos.
2. **Settings → Pages → Source: Deploy from a branch**, branch `main`, pasta **/docs**.
3. O link fica `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

## Passo 3 — conectar o app à planilha

Duas opções:

- **Recomendada:** edite `docs/index.html`, linha `const WEBAPP_URL = '';`, e coloque a URL
  `/exec` entre as aspas. Todos os celulares já abrem conectados.
- **Sem editar código:** deixe vazio. Na primeira abertura o app pede a URL e a guarda
  naquele celular.

Depois, no celular: abrir o link → **Adicionar à tela de início**.

## Como funciona offline

Cada cadastro entra numa fila no próprio celular com um `id` único. Quando há internet,
a fila é enviada em lote; o backend ignora `id` repetido, então reenviar não duplica linha.
Com o service worker, o app abre offline após a primeira visita — diferente da versão
hospedada no Apps Script, que exige internet para carregar.

## Observação sobre acesso

Com "quem tem acesso: qualquer pessoa", qualquer um com a URL `/exec` pode gravar na
planilha. Não publique essa URL em lugar aberto. Se precisar de controle, dê a URL apenas
aos cadastradores e troque a implantação depois da reunião.
