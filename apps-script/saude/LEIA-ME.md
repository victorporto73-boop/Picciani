# Gestão Integrada da Saúde — instalação do servidor

Backend do painel da Secretaria Municipal de Saúde. Roda no Google Apps Script
e grava numa Planilha Google. O aplicativo (pasta `docs/saude/`) conversa com ele
pela URL `/exec`.

## 1. Criar a planilha e o script

Use uma **conta institucional** da Prefeitura (Google Workspace), não uma conta
pessoal: os dados de gestão da saúde ficam nessa planilha.

1. Crie uma planilha em branco (ex.: "SEMUSA — Gestão Integrada").
2. **Extensões → Apps Script**.
3. Apague o conteúdo de `Código.gs` e cole o arquivo `Codigo.gs` desta pasta.
4. Em **Configurações do projeto** (engrenagem), confira o fuso horário:
   `(GMT-03:00) Horário de Brasília`.
5. Selecione a função **`prepararSistema`** e clique em **Executar**. Autorize.
6. Abra **Execuções** (ou o registro da execução) e copie a linha
   `Usuário: admin · Senha inicial: ...`.

A planilha passa a ter uma aba por módulo (`unidades`, `regulacao`, `judicial`...)
e três abas de controle:

| Aba | Conteúdo |
|---|---|
| `_Eventos` | Toda alteração: número sequencial, data, usuário, módulo, registro, ação, campos alterados e cópia do registro. É a trilha de auditoria e o canal de sincronização. |
| `_Usuarios` | Usuários, perfis, módulos autorizados e hash das senhas (nunca a senha). |
| `_Acessos` | Logins com sucesso, falhas, bloqueios e alterações de usuários. |

**Não apague, não ordene e não insira linhas na aba `_Eventos`.** O número da
linha é o número de sequência que os aplicativos usam para saber o que mudou.
Se isso acontecer por engano, os aplicativos detectam e recarregam tudo.

Edições feitas direto nas abas dos módulos aparecem para quem abrir o aplicativo
depois (ao carregar), mas **não** geram evento em tempo real nem entram na
auditoria. Use o aplicativo para o dia a dia.

## 2. Publicar como App da Web

1. **Implantar → Nova implantação → Tipo: App da Web**.
2. *Executar como:* **eu**.
3. *Quem tem acesso:* **qualquer pessoa**.
   O acesso aos dados é controlado pelo login do próprio sistema: sem usuário
   e senha válidos, o servidor não devolve nada.
4. Copie a URL que termina em `/exec`.

Sempre que alterar o `Codigo.gs`: **Implantar → Gerenciar implantações → editar →
Versão: nova versão**. Sem isso a URL continua executando o código antigo.

## 3. Conectar o aplicativo

Duas opções:

- **Recomendada:** em `docs/saude/js/config.js`, preencha `WEBAPP_URL` com a URL
  `/exec`. Todos os aparelhos já abrem conectados.
- **Sem editar código:** deixe vazio. Na primeira abertura o aplicativo pede a URL
  e a guarda naquele aparelho.

Entre com `admin` e a senha inicial. Depois:

1. **Configurações → Minha senha**: troque a senha do admin.
2. **Configurações → Dados da Secretaria**: confira os setores e informe a base de
   cálculo do ASPS (para o indicador da LC 141/2012, art. 7º).
3. **Usuários e perfis**: crie um usuário para cada pessoa.

## Perfis

| Perfil | Pode |
|---|---|
| `admin` | Tudo, inclusive usuários e dados da Secretaria. Reserve ao Secretário e à TI. |
| `gestor` | Ver e editar todos os módulos (subsecretários, chefia de gabinete). |
| `editor` | Ver e editar só os módulos marcados (ex.: farmácia só em *Farmácia e Insumos*). |
| `leitor` | Só consultar os módulos marcados. Pode comentar. |

As regras valem no servidor, a cada leitura e gravação: o aplicativo não recebe
dados de módulos que o usuário não pode ver. Comentários só aparecem para quem
pode ver o registro comentado. Mudar o perfil, os módulos, a senha ou desativar
um usuário encerra na hora as sessões abertas dele.

## Funções de manutenção (rodar pelo editor do Apps Script)

| Função | Uso |
|---|---|
| `prepararSistema()` | Primeira instalação. Pode rodar de novo sem perder nada. |
| `redefinirSenha('login', 'novaSenha')` | Quando alguém, inclusive o admin, esquece a senha. |
| `encerrarTodasAsSessoes()` | Derruba todos os acessos (ex.: aparelho perdido). |

## Segurança e LGPD

- Senhas: sal individual + SHA-256 iterado. Sessão: token assinado (HMAC-SHA256)
  com validade de 12 horas, renovado automaticamente enquanto o uso continua.
- Cinco senhas erradas seguidas bloqueiam o login por 10 minutos.
- Textos são gravados como texto literal, então nada digitado vira fórmula na planilha.
- Compartilhe a planilha apenas com os administradores. Os demais acessam pelo aplicativo.
- O sistema é **gerencial**. Para pacientes, registre apenas protocolo e iniciais;
  os dados identificados ficam nos sistemas oficiais (regulação, e-SUS, prontuário).
  Dados de saúde são dados pessoais sensíveis (LGPD, art. 5º, II, e art. 11).
- A aba `_Eventos` atende ao registro das operações de tratamento (LGPD, art. 37).

## Limites a conhecer

- A sincronização consulta o servidor a cada 6 segundos com a tela aberta e a cada
  45 segundos em segundo plano. Quando nada mudou, a resposta sai do cache e não
  abre a planilha.
- O Google limita as execuções simultâneas do Apps Script (30 por usuário na tabela
  de cotas atual; confira em developers.google.com/apps-script/guides/services/quotas).
  Como o App da Web roda "como eu", todas as requisições contam para a conta dona.
  Isso basta para algumas dezenas de usuários conectados ao mesmo tempo. Para centenas, migre
  o backend para um banco com tempo real (Firebase/Firestore ou Supabase); o
  aplicativo isola o servidor em `store.js` justamente para essa troca.
- Planilhas Google comportam até 10 milhões de células. Arquive o exercício anterior
  (copie a planilha e limpe as abas dos módulos) quando o volume crescer.
