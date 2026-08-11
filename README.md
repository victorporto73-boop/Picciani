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
