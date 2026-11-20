# Versão dentro do Claude (artefato)

`index.html` é a página de entrada do aplicativo publicado como artefato no Claude.
O resto vem de `docs/saude/` (o mesmo código da versão do GitHub Pages):

| Caminho publicado | Arquivo |
|---|---|
| `index.html` | `artefato/index.html` |
| `estilo.css` | `docs/saude/estilo.css` |
| `js/*.js` | `docs/saude/js/*.js` (exceto `sw.js`, que não se aplica) |

Dentro do Claude o app entra sozinho no **modo Claude**:

- os dados ficam no armazenamento compartilhado do próprio artefato;
- cada pessoa entra com a própria conta Claude;
- o nível no botão **Compartilhar** define o perfil: Proprietário/Editor = administrador,
  Colaborador = editor, Comentarista/Leitor = consulta;
- alterações chegam às outras telas na hora, e as iniciais de quem está com o app aberto
  aparecem no topo.

Capacidades declaradas na publicação: `db` (regra: `config` só administradores gravam),
`user` (escopo `profile`), `room` (presença) e `downloads` (CSV e cópia JSON).

Limites: o armazenamento do artefato comporta até 25 mil documentos (registros + eventos).
O feed de atividade guarda 60 dias. Para volume maior ou restrição por módulo, use a versão
com servidor (Apps Script + Planilha) descrita em `apps-script/saude/LEIA-ME.md`.
