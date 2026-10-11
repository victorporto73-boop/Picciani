// Minutas dos documentos legais. Os campos entre colchetes vêm de variáveis de ambiente
// (EMPRESA_RAZAO, EMPRESA_CNPJ, EMPRESA_ENDERECO, FORO, DPO_EMAIL) e devem ser preenchidos
// antes da publicação. Revise o conteúdo à luz do modelo de negócio efetivamente adotado.
'use strict';

const { html } = require('../http');
const c = require('../config');

const VIGENCIA = '11/10/2026';

function termos() {
  return html`<section class="secao"><div class="container estreito documento">
<h1>Termos de Uso e Condições Gerais de Fornecimento</h1>
<p class="muted">Versão vigente desde ${VIGENCIA}.</p>

<h2>1. Partes e objeto</h2>
<p>1.1. Estes Termos regulam o uso da plataforma ${c.APP_NOME}, mantida por ${c.EMPRESA_RAZAO}, inscrita no CNPJ sob o nº ${c.EMPRESA_CNPJ || '[CNPJ]'}, com sede em ${c.EMPRESA_ENDERECO} ("Plataforma"), pela pessoa física ou jurídica que se cadastra para revender produtos ("Lojista").</p>
<p>1.2. A Plataforma disponibiliza catálogo de produtos mantidos em estoque próprio ou de parceiros, ferramentas de gestão de pedidos e serviço de separação, embalagem e expedição das mercadorias diretamente ao comprador final do Lojista (modelo de <em>dropshipping</em>).</p>
<p>1.3. A relação entre Plataforma e Lojista é de natureza empresarial, de fornecimento de mercadorias e prestação de serviços logísticos, regida pelo Código Civil (Lei nº 10.406/2002). O Lojista adquire os produtos para revenda, não sendo destinatário final.</p>

<h2>2. Cadastro</h2>
<p>2.1. O Lojista declara que as informações prestadas são verdadeiras e se obriga a mantê-las atualizadas, respondendo civil e criminalmente por sua exatidão.</p>
<p>2.2. As credenciais de acesso e a chave de API são pessoais e intransferíveis. Operações realizadas com elas presumem-se feitas pelo Lojista.</p>

<h2>3. Planos, carteira e pagamentos</h2>
<p>3.1. O uso da Plataforma depende de plano ativo, cujos preços, limites e taxas estão publicados na página de Planos. O período de teste gratuito, quando oferecido, não gera cobrança automática.</p>
<p>3.2. Os pedidos são pagos com saldo pré-pago ("Carteira"). No momento do pagamento são debitados o custo dos produtos, o frete e a taxa por pedido do plano. Pedidos sem saldo suficiente permanecem "aguardando pagamento" e não são expedidos.</p>
<p>3.3. Pedidos cancelados antes da expedição têm o valor integralmente estornado à Carteira. O saldo não utilizado poderá ser restituído mediante solicitação, descontadas apenas tarifas bancárias comprovadas.</p>
<p>3.4. A assinatura é mensal, sem fidelidade, e pode ser cancelada a qualquer tempo, permanecendo ativa até o fim do período já pago.</p>

<h2>4. Preços de revenda e relação com o consumidor</h2>
<p>4.1. O Lojista define livremente o preço de revenda. O "preço sugerido" é meramente referencial.</p>
<p>4.2. Perante o comprador final, o Lojista é o fornecedor e deve cumprir integralmente o Código de Defesa do Consumidor (Lei nº 8.078/1990) e o Decreto nº 7.962/2013, inclusive quanto à identificação da sua empresa na loja virtual, informação clara de preço, frete e prazo, atendimento ao consumidor e respeito ao direito de arrependimento de 7 (sete) dias (art. 49 do CDC).</p>
<p>4.3. A Plataforma cooperará com o Lojista no atendimento a trocas, devoluções e reclamações relativas a vícios dos produtos, observados os prazos do art. 26 do CDC, mediante abertura de solicitação no painel. As partes reconhecem que eventual responsabilidade perante o consumidor pode ser solidária nos termos da lei, cabendo direito de regresso a quem não deu causa ao dano.</p>
<p>4.4. É vedado ao Lojista fazer publicidade enganosa ou abusiva, atribuir aos produtos características que não possuam ou utilizar marcas de terceiros sem autorização.</p>

<h2>5. Expedição e entrega</h2>
<p>5.1. Pedidos pagos até as 14h em dias úteis serão postados em até 24 horas úteis, ressalvados casos fortuitos ou de força maior. O prazo de entrega é estimado pela transportadora e informado no painel.</p>
<p>5.2. O Lojista é responsável pela exatidão do endereço de entrega informado. Reenvios decorrentes de endereço incorreto ou destinatário ausente serão cobrados.</p>

<h2>6. Integrações (API e webhooks)</h2>
<p>6.1. O acesso à API é oferecido nos planos que o incluem, mediante chave individual, e pode ser limitado para preservar a estabilidade do serviço.</p>

<h2>7. Dados pessoais</h2>
<p>7.1. Quanto aos dados dos compradores finais, o Lojista atua como controlador e a Plataforma como operadora (arts. 5º, VI e VII, e 39 da Lei nº 13.709/2018 — LGPD), tratando-os exclusivamente para processar, expedir e rastrear os pedidos e cumprir obrigações legais. Detalhes na <a href="/privacidade">Política de Privacidade</a>.</p>

<h2>8. Suspensão e encerramento</h2>
<p>8.1. A Plataforma poderá suspender ou encerrar contas em caso de fraude, violação destes Termos ou da legislação, mediante comunicação ao Lojista, preservados os pedidos já pagos e o direito à restituição do saldo remanescente.</p>

<h2>9. Limitação de responsabilidade</h2>
<p>9.1. A Plataforma não garante volume de vendas ou lucro ao Lojista e não responde por indisponibilidades de serviços de terceiros (meios de pagamento, transportadoras, provedores de internet), ressalvadas as hipóteses de dolo ou culpa grave.</p>

<h2>10. Disposições gerais</h2>
<p>10.1. Estes Termos podem ser alterados, com aviso prévio de 15 (quinze) dias por e-mail ou no painel. O uso continuado após a vigência implica concordância.</p>
<p>10.2. Fica eleito o foro da Comarca de ${c.FORO} para dirimir controvérsias oriundas destes Termos, com renúncia a qualquer outro, por mais privilegiado que seja.</p>
<p>Contato: <a href="mailto:${c.CONTATO_EMAIL}">${c.CONTATO_EMAIL}</a>.</p>
</div></section>`;
}

function privacidade() {
  return html`<section class="secao"><div class="container estreito documento">
<h1>Política de Privacidade</h1>
<p class="muted">Versão vigente desde ${VIGENCIA}. Elaborada em conformidade com a Lei nº 13.709/2018 (LGPD) e a Lei nº 12.965/2014 (Marco Civil da Internet).</p>

<h2>1. Quem somos</h2>
<p>${c.EMPRESA_RAZAO}, CNPJ ${c.EMPRESA_CNPJ || '[CNPJ]'}, com sede em ${c.EMPRESA_ENDERECO}, mantenedora da plataforma ${c.APP_NOME}.</p>

<h2>2. Dados que tratamos e finalidades</h2>
<table class="tabela">
<thead><tr><th>Titular / dados</th><th>Finalidade</th><th>Base legal (LGPD)</th></tr></thead>
<tbody>
<tr><td>Lojista: nome, e-mail, CPF/CNPJ, telefone, senha (armazenada com hash)</td><td>Cadastro, autenticação, execução do contrato, cobrança e comunicação</td><td>Execução de contrato (art. 7º, V)</td></tr>
<tr><td>Lojista: registros de pedidos e transações</td><td>Cumprimento de obrigações fiscais e contábeis</td><td>Obrigação legal (art. 7º, II)</td></tr>
<tr><td>Usuários: endereço IP, data e hora de acesso</td><td>Segurança e guarda de registros de acesso por 6 meses</td><td>Obrigação legal (art. 15 do Marco Civil; art. 7º, II, da LGPD)</td></tr>
<tr><td>Comprador final: nome, endereço, telefone, e-mail, CPF</td><td>Separação, expedição, entrega e rastreio do pedido, como operadora do Lojista</td><td>Execução de contrato do qual o titular é parte (art. 7º, V), por conta do controlador</td></tr>
</tbody></table>

<h2>3. Compartilhamento</h2>
<p>Compartilhamos dados apenas com transportadoras (para a entrega), instituições de pagamento (para recargas), provedores de hospedagem e autoridades, quando houver determinação legal ou judicial. Não vendemos dados pessoais.</p>

<h2>4. Cookies</h2>
<p>Usamos apenas cookies estritamente necessários: sessão de login, proteção contra falsificação de requisições (CSRF), mensagens de aviso e carrinho de compras das vitrines. Não usamos cookies de publicidade.</p>

<h2>5. Armazenamento e segurança</h2>
<p>Adotamos medidas técnicas e administrativas para proteger os dados (art. 46 da LGPD), incluindo senhas com hash, comunicação criptografada e controle de acesso. Os dados são mantidos pelo tempo necessário às finalidades acima e aos prazos legais de guarda.</p>

<h2>6. Direitos do titular</h2>
<p>Você pode solicitar confirmação de tratamento, acesso, correção, anonimização, portabilidade, eliminação, informação sobre compartilhamento e revogação de consentimento, nos termos do art. 18 da LGPD. Compradores finais devem, preferencialmente, dirigir-se ao Lojista (controlador); encaminharemos as solicitações que recebermos.</p>

<h2>7. Encarregado (DPO)</h2>
<p>Contato do encarregado pelo tratamento de dados pessoais (art. 41 da LGPD): <a href="mailto:${c.DPO_EMAIL}">${c.DPO_EMAIL}</a>.</p>

<h2>8. Alterações</h2>
<p>Esta Política pode ser atualizada; a versão vigente estará sempre nesta página, com a data de vigência.</p>
</div></section>`;
}

module.exports = { termos, privacidade };
