# Como publicar o app (Apps Script)

Dois arquivos: `Codigo.gs` e `Index.html`.

1. Abra a planilha → **Extensões → Apps Script**.
2. No editor, cole o conteúdo de `Codigo.gs` no arquivo `Código.gs`.
3. **+ → HTML**, nomeie o arquivo como **Index** (sem extensão) e cole o conteúdo de `Index.html`.
4. Selecione a função `prepararPlanilha` e clique em **Executar**. Autorize o acesso. Isso cria a aba `Cadastros` com o cabeçalho.
5. **Implantar → Nova implantação → App da Web**:
   - Executar como: **eu**
   - Quem tem acesso: **qualquer pessoa** (ou "qualquer pessoa com Conta do Google", se preferir exigir login)
6. Copie a URL `/exec` e mande para os cabos eleitorais. No celular, abrir a URL e usar **Adicionar à tela de início** deixa com cara de app.

## Como funciona o offline

Cada cadastro é gravado primeiro no próprio celular (localStorage) com um id único. A fila é enviada quando há internet — automaticamente ao salvar, quando a conexão volta, a cada 20 segundos e no botão **Sincronizar**. Como o id vai junto, reenviar a mesma fila nunca duplica linha na planilha.

Na primeira abertura o app pergunta quem está usando aquele celular; esse nome vai na coluna `cadastrado_por`.

## Colunas geradas

`data_hora | nome | telefone | bairro | quem_indicou | cadastrado_por | id`

## Limitações a conhecer

- A tela em si precisa de internet para carregar na primeira vez. Depois de aberta, o app continua cadastrando sem sinal — mas se a pessoa fechar a aba sem sinal, não reabre. Orientação prática: abrir o app antes de entrar no salão e não fechar.
- Se quiser funcionar mesmo fechando a aba, aí é preciso um PWA hospedado fora do Apps Script (o Apps Script não permite service worker próprio). A planilha continuaria sendo o destino, via o `doPost` que já está no `Codigo.gs`.
- Telefone e indicação são dados pessoais: registre o consentimento e restrinja quem enxerga a planilha.
