import Link from "next/link";
const sections = [
  {
    "title": "1. Objeto, fornecedor e aceite",
    "body": [
      "Esta minuta regula a H.OIKOS, ambiente digital de gestão de empresas e profissionais autônomos, projetos, obras, orçamentos, planilhas, equipes, tarefas, documentos e integrações. A fornecedora aos usuários finais será a pessoa ou empresa que assumir a operação da H.OIKOS, identificada na versão definitiva e na oferta comercial. A autoria do software e sua fabricação pela Drap não identificam, por si, a operadora responsável pelo serviço.",
      "A Drap desenvolve a plataforma para entrega à sua adquirente e também fornece serviços próprios quando contratados. O contrato de desenvolvimento, venda ou licenciamento entre a Drap e a adquirente é separado destes Termos. Suporte, hospedagem, manutenção, propriedade intelectual e tratamento de dados após a entrega dependerão das responsabilidades efetivamente assumidas nesses contratos, sem afastar obrigações legais perante usuários.",
      "O cadastro deve conter informações verdadeiras e atualizadas. Quem contrata em nome de uma empresa declara possuir poderes para representá-la; um convite de colaborador não lhe concede poderes de representação comercial. O serviço destina-se a pessoas civilmente capazes e a usuários legitimamente autorizados.",
      "O aceite é expresso, vinculado à versão apresentada, à pessoa e à empresa. A contratação de um serviço pago exige informação prévia e confirmação própria: aceitar estes Termos ou salvar uma seleção de módulos não autoriza cobrança. A versão aceita permanece disponível para consulta.",
      "Condições específicas podem complementar estes Termos, sem afastar normas obrigatórias, direitos do consumidor quando aplicáveis nem garantias legais. O aceite não equivale a consentimento genérico para publicidade, compartilhamento indiscriminado ou qualquer tratamento de dados."
    ]
  },
  {
    "title": "2. Contas, hierarquia e administradores da empresa",
    "body": [
      "O superadministrador representa o titular da plataforma. O contratante é o proprietário da conta da empresa e pode designar mais de um administrador, inclusive sócios. Cada administrador atua somente nas empresas às quais esteja legitimamente vinculado, dentro das permissões concedidas.",
      "Administradores autorizados podem criar convites, atribuir perfis, limitar permissões e desativar ou restaurar colaboradores, gestores, parceiros, prestadores, financeiro, recursos humanos e contabilidade. Não podem conceder poderes superiores aos próprios nem transformar um acesso empresarial em superadministrador.",
      "Ter acesso a uma empresa não autoriza acesso a outra, mesmo quando há sócios, e-mails, clientes ou fornecedores em comum. O contratante deve revisar os vínculos e revogar pessoas desligadas. A autorização de acesso não transfere a propriedade dos documentos ou dados.",
      "Credenciais são individuais. Convites devem ser entregues apenas ao destinatário, têm validade limitada e não devem ser publicados. Cada usuário deve proteger sua sessão, utilizar senha adequada e comunicar indício de fraude ou comprometimento."
    ]
  },
  {
    "title": "3. Superadmin e separação dos dados",
    "body": [
      "O superadministrador possui leitura e edição em todos os módulos e pode administrar empresas, serviços, segurança e acessos. Esse poder técnico não representa autorização irrestrita para usar dados empresariais ou pessoais para qualquer finalidade.",
      "O acesso administrativo ao conteúdo de uma empresa deve servir à operação, suporte solicitado, correção, segurança ou cumprimento de obrigação legal, com necessidade, proporcionalidade, sigilo e rastreabilidade. É vedado divulgar conteúdo a outra empresa ou reutilizá-lo para finalidade incompatível.",
      "A H.OIKOS deve aplicar o isolamento entre empresas e verificar permissões no servidor. Registros administrativos devem permitir identificar ações relevantes e responsáveis, observados os limites de acesso e retenção. Usuários devem comunicar dados de terceiros que apareçam indevidamente e não copiá-los, explorá-los ou distribuí-los."
    ]
  },
  {
    "title": "4. Leis nacionais e regras do local de cada atividade",
    "body": [
      "A plataforma e seus usuários devem observar a legislação brasileira aplicável às suas respectivas atividades, incluindo obrigações civis, de consumo, proteção de dados, propriedade intelectual, tributárias, trabalhistas, ambientais e de acessibilidade.",
      "O contratante e o profissional responsável devem identificar o município, o estado e os órgãos competentes para cada projeto ou obra. Devem verificar, conforme a atividade, plano diretor, uso e ocupação do solo, código de obras e posturas, alvarás, licenças, regularização, regras de vizinhança, patrimônio cultural, vigilância sanitária e exigências ambientais.",
      "Devem também observar as normas estaduais e instruções do Corpo de Bombeiros aplicáveis à segurança contra incêndio, bem como normas municipais de serviços, documentos fiscais e tributos, quando incidentes. Não se presume que exigências de uma cidade ou estado valham em outra localidade.",
      "Normas técnicas devem ser observadas na extensão em que forem legalmente exigidas, incorporadas ao contrato ou necessárias à segurança e à boa técnica. Modelos, listas, cálculos, bibliotecas ou automações da H.OIKOS não certificam, por si, conformidade local nem substituem aprovação da autoridade competente."
    ]
  },
  {
    "title": "5. Responsabilidade profissional, obras e segurança do trabalho",
    "body": [
      "Atividades privativas de profissão regulamentada devem ser executadas e validadas por profissional habilitado, com registro no conselho competente. Cabem aos responsáveis a ART no sistema Confea/Crea ou o RRT no CAU, quando exigidos, e a identificação da autoria, escopo e responsabilidade técnica.",
      "O uso da H.OIKOS não cria habilitação profissional, licença de obra, vínculo com conselho ou aprovação pública. O fornecedor de software não assume automaticamente a responsabilidade técnica pelo projeto, orçamento, execução, fiscalização ou documento inserido pelo usuário.",
      "Empregadores, contratantes e responsáveis pela execução devem cumprir as obrigações trabalhistas e de saúde e segurança, inclusive as Normas Regulamentadoras aplicáveis, como a NR-18 na construção. Checklists digitais não substituem medidas de prevenção, treinamento, equipamentos, inspeções e documentos legalmente exigidos.",
      "A revisão profissional continua necessária antes de usar resultados em obra, proposta, medição, pagamento, declaração fiscal ou decisão que possa afetar pessoas e patrimônio. Isso não exclui a responsabilidade da H.OIKOS por defeitos de seu próprio serviço nos termos da lei."
    ]
  },
  {
    "title": "6. Uso permitido, conteúdo e automações",
    "body": [
      "É proibido praticar fraude, discriminação ilícita, falsificação, violação de sigilo ou de direitos autorais, coleta ilegal de dados, acesso sem autorização, distribuição de código malicioso ou tentativa de contornar limites e controles de segurança.",
      "O usuário deve ter autorização para inserir e compartilhar projetos, imagens, documentos e informações de clientes, trabalhadores e terceiros. Não deve inserir dados excessivos ou material obtido ilicitamente. O conteúdo não poderá ser publicado a terceiros sem base jurídica e permissão adequadas.",
      "Planilhas, importações, fórmulas, integrações e automações podem conter erros de origem ou limitações de compatibilidade. O responsável deve revisar os dados e resultados antes de aplicá-los. Recursos de inteligência artificial, quando disponibilizados, exigem informação sobre seu funcionamento e tratamento de dados; não se presume infalibilidade ou aprovação técnica.",
      "Uma automação só deve atuar no escopo autorizado. Processos que enviem informações a terceiros, emitam documentos fiscais ou produzam efeitos financeiros precisam respeitar suas confirmações, permissões e registros próprios. Não é permitido usar a plataforma para decisões discriminatórias ou tratamento ilícito de dados."
    ]
  },
  {
    "title": "7. Proteção de dados e confidencialidade",
    "body": [
      "Nos dados de conta, relacionamento, segurança e obrigações próprias, a fornecedora decide as finalidades de tratamento sob sua responsabilidade. Quanto ao conteúdo de terceiros inserido por uma empresa, esta normalmente atua como controladora e a H.OIKOS como operadora, conforme a operação efetivamente realizada e as instruções legítimas. A qualificação jurídica não depende apenas do nome dado pelas partes.",
      "Dados devem ser tratados para finalidades determinadas, com base legal adequada, necessidade, transparência e segurança. A execução do contrato, obrigações legais e exercício de direitos podem fundamentar operações; quando consentimento for a base necessária, ele deve ser específico e revogável na forma da lei.",
      "Titulares podem requerer confirmação, acesso, correção e demais direitos previstos na LGPD, inclusive eliminação ou anonimização nas hipóteses legais, informação sobre compartilhamento, revogação de consentimento e portabilidade conforme a regulamentação. Pedidos exigem verificação proporcional de identidade, sem cobrança indevida nem exigência de documentos excessivos.",
      "A H.OIKOS deve proteger dados por medidas técnicas e administrativas adequadas e cooperar com o contratante no atendimento de titulares e incidentes. A empresa deve informar finalidade e base legal dos dados que insere. Dados sensíveis e dados de crianças ou adolescentes só podem ser tratados quando necessários, lícitos e sujeitos às salvaguardas específicas aplicáveis.",
      "A política de privacidade deve detalhar categorias de dados, finalidades, prestadores, transferências internacionais, retenção e canais de exercício de direitos. Estes Termos não substituem essa transparência nem autorizam venda de dados ou uso do conteúdo confidencial para treinamento de modelos de terceiros."
    ]
  },
  {
    "title": "8. Registros, retenção e incidentes",
    "body": [
      "A H.OIKOS registra evidências do aceite por versão, empresa e usuário, além de eventos operacionais e administrativos necessários. A repetição de um aceite não deve apagar sua evidência original. Esses registros não equivalem a assinatura profissional certificada nem substituem documentos que exijam formalidade específica.",
      "Registros de acesso a aplicações devem ser mantidos sob sigilo pelo prazo legal aplicável, inclusive seis meses quando presente a hipótese do art. 15 do Marco Civil da Internet. A evidência de aceite baseada em resumo criptográfico de IP não substitui, por si, o registro de acesso exigido por lei.",
      "Demais dados devem ser conservados pelo tempo necessário à finalidade, obrigações legais ou regulatórias e exercício regular de direitos; encerrada a necessidade, devem ser eliminados ou anonimizados quando cabível. Guarda excepcional exige justificativa, acesso restrito e observância da lei, inclusive em cópias de segurança.",
      "Incidentes serão avaliados e tratados conforme a LGPD e a regulamentação da ANPD. Quando houver risco ou dano relevante, o controlador deverá comunicar a autoridade e os titulares nos prazos legais aplicáveis. A H.OIKOS, quando operadora, deve informar o controlador e cooperar para contenção, investigação e resposta."
    ]
  },
  {
    "title": "9. Serviços Drap e outros fornecedores",
    "body": [
      "A Drap fornece os módulos de gestão contratados por meio da integração. O usuário deve receber as condições e os documentos aplicáveis da Drap antes da contratação. As responsabilidades de cada fornecedor decorrem de sua atuação efetiva e da legislação; estes Termos não afastam responsabilidade legal da H.OIKOS.",
      "O valor oficial disponibilizado pela Drap constitui o preço-base mínimo dos respectivos serviços. Apenas o superadministrador da H.OIKOS pode definir um acréscimo opcional. O usuário deve conhecer o preço total, a periodicidade, os itens incluídos, eventuais tributos e todas as demais condições antes de confirmar.",
      "O pagamento dos módulos Drap é realizado diretamente à Drap, pelos meios que ela disponibilizar. A diferença acima do preço-base é registrada como comissionamento para posterior conciliação entre as partes. O usuário não deve pagar uma segunda cobrança da mesma comissão à H.OIKOS. Registro de comissão prevista ou de assinatura ativa não equivale a comprovante de pagamento.",
      "A criação ou vinculação de conta, a escolha de módulos, a confirmação de assinatura e a confirmação de pagamento são etapas distintas. Salvar uma seleção não contrata, não emite fatura e não libera automaticamente serviço pago. Enquanto a Drap conclui a integração e a homologação, a H.OIKOS deve informar claramente as etapas indisponíveis.",
      "Uma pendência Drap não implica bloqueio automático dos demais serviços H.OIKOS. Dados financeiros devem ser conferidos na fonte antes de pagamento, declaração ou prestação de contas. Conexões com outros fornecedores só devem compartilhar os dados necessários à finalidade autorizada."
    ]
  },
  {
    "title": "10. Ofertas, cobrança, cancelamento e direitos do consumidor",
    "body": [
      "A oferta deve identificar o fornecedor, suas formas de contato, os recursos efetivamente disponíveis, limitações, preço total, periodicidade, vencimento, eventual teste gratuito, renovação, reajuste, cancelamento e reembolso. Cobranças e alterações de preço não podem ser presumidas a partir do uso de uma tela.",
      "Quando houver relação de consumo, aplicam-se o Código de Defesa do Consumidor e o Decreto nº 7.962/2013. A contratação eletrônica deve permitir revisar e corrigir informações, obter confirmação e conservar o contrato, além de oferecer atendimento facilitado para dúvida, reclamação, suspensão ou cancelamento.",
      "O direito de arrependimento, quando aplicável, pode ser exercido no prazo legal de sete dias contado da assinatura ou do recebimento do produto ou serviço, conforme o caso, sem prejuízo de outras garantias legais. Os valores pagos devem ser devolvidos na forma da lei. Uma cláusula comercial não elimina esse direito.",
      "Cancelamento, exportação de dados e pedidos de privacidade são procedimentos distintos. Cancelar uma assinatura não dispensa valores legitimamente devidos nem impede contestação ou reembolso cabível. Excluir ou desativar um usuário não cancela automaticamente assinaturas. O fornecedor deve informar a data de encerramento e eventuais efeitos sobre acesso e renovação.",
      "Não há renúncia antecipada a direitos, exoneração genérica por falhas do serviço nem autorização para alteração unilateral abusiva. A existência de CNPJ, isoladamente, não afasta direitos de consumidor quando os requisitos legais estiverem presentes."
    ]
  },
  {
    "title": "11. Propriedade intelectual e documentos",
    "body": [
      "Projetos, planilhas, imagens e documentos permanecem sujeitos aos direitos de seus respectivos titulares. O contratante concede à H.OIKOS apenas as autorizações necessárias à prestação do serviço, armazenamento, processamento e disponibilização aos destinatários autorizados.",
      "O acesso de administrador ou superadministrador não transfere autoria nem permite explorar economicamente projetos de clientes sem autorização. Direitos morais e patrimoniais de autores, inclusive em arquitetura e engenharia, devem ser respeitados conforme a legislação.",
      "Elementos próprios do software, marcas e documentação permanecem com seus titulares, respeitadas as licenças de terceiros. Exportar ou guardar um documento na plataforma não o transforma em documento público, oficial, certificado ou assinado com validade técnica especial."
    ]
  },
  {
    "title": "12. Obrigações do fornecedor e continuidade",
    "body": [
      "A H.OIKOS deve prestar o serviço conforme a oferta, manter controles de acesso e segurança compatíveis com os riscos, corrigir falhas sob sua responsabilidade, informar limitações relevantes e disponibilizar atendimento pelos canais identificados.",
      "A fornecedora deve observar os requisitos legais de acessibilidade digital e tratar relatos de barreiras. Não se declara certificação integral de acessibilidade ou de segurança apenas pela publicação destes Termos.",
      "Manutenções, falhas e dependências de terceiros podem afetar disponibilidade. O fornecedor deve atuar para continuidade e recuperação, comunicar impactos relevantes e respeitar níveis de serviço que tenham sido expressamente contratados. Não é garantida disponibilidade absoluta; tampouco se excluem os direitos legais diante de serviço defeituoso.",
      "O contratante deve manter as cópias e documentos de que necessite para obrigações profissionais e legais, utilizando os meios de exportação disponíveis ou solicitando atendimento. Essa recomendação não exonera a H.OIKOS de deveres de conservação, segurança ou reparação que lhe caibam."
    ]
  },
  {
    "title": "13. Suspensão, encerramento e alterações",
    "body": [
      "Medidas de suspensão devem ter fundamento legítimo, como risco de segurança, uso ilícito, descumprimento relevante ou inadimplência nas condições válidas do serviço afetado. Devem ser proporcionais e, quando possível, precedidas de informação e oportunidade de correção. Urgência para evitar dano pode justificar ação imediata com informação posterior.",
      "O encerramento deve permitir encaminhar pedidos legítimos de recuperação, exportação e exercício de direitos, respeitadas restrições legais e contratuais válidas. Não se promete eliminação imediata de registros cuja guarda seja obrigatória, nem retenção indefinida sem finalidade.",
      "Alterações materiais geram nova versão, informação clara e novo aceite quando necessário. Não serão aplicadas retroativamente para retirar direitos adquiridos ou autorizar cobrança não contratada. Recusar novos termos não impede contestar valores, pedir cancelamento ou exercer direitos sobre dados pelos canais de atendimento.",
      "O uso continuado, isoladamente, não substitui uma confirmação expressa exigida pelo fluxo de contratação. Versões anteriores permanecem consultáveis, vinculadas às respectivas evidências de aceite."
    ]
  },
  {
    "title": "14. Atendimento, legislação e solução de conflitos",
    "body": [
      "Pedidos sobre o serviço, cobrança, acessibilidade e dados pessoais podem ser encaminhados aos canais identificados neste documento e na oferta. Informações sensíveis devem ser compartilhadas apenas pelo meio apropriado e no mínimo necessário à análise.",
      "Aplica-se a legislação brasileira, respeitadas as normas estaduais e municipais pertinentes à atividade e ao local. Não se impõe arbitragem obrigatória nem renúncia a órgãos de defesa do consumidor, ANPD ou Judiciário. Tentativa de solução administrativa não é condição para exercer direitos.",
      "Eventual foro deve respeitar as regras legais de competência e, quando aplicável, a proteção do consumidor, inclusive o acesso ao foro de seu domicílio. A nulidade de uma disposição não elimina as demais cláusulas válidas nem restringe direitos obrigatórios."
    ]
  }
];
const references = [
  [
    "Constituição Federal — competências e direitos fundamentais",
    "https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm"
  ],
  [
    "Código Civil — Lei nº 10.406/2002",
    "https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm"
  ],
  [
    "Código de Defesa do Consumidor — Lei nº 8.078/1990",
    "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm"
  ],
  [
    "Comércio eletrônico — Decreto nº 7.962/2013",
    "https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm"
  ],
  [
    "LGPD — Lei nº 13.709/2018",
    "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm"
  ],
  [
    "Marco Civil da Internet — Lei nº 12.965/2014",
    "https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm"
  ],
  [
    "Arquitetura e RRT — Lei nº 12.378/2010",
    "https://www.planalto.gov.br/ccivil_03/_ato2007-2010/2010/lei/l12378.htm"
  ],
  [
    "ART — Lei nº 6.496/1977",
    "https://www.planalto.gov.br/ccivil_03/leis/l6496.htm"
  ],
  [
    "Direitos autorais — Lei nº 9.610/1998",
    "https://www.planalto.gov.br/ccivil_03/leis/l9610.htm"
  ],
  [
    "Lei Brasileira de Inclusão — Lei nº 13.146/2015",
    "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13146.htm"
  ],
  [
    "NR-18 — Ministério do Trabalho e Emprego",
    "https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadora/normas-regulamentadoras-vigentes/norma-regulamentadora-no-18-nr-18"
  ],
  [
    "Comunicação de incidentes — ANPD",
    "https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis"
  ]
];
export function ProposedTermsPage() {
  return <main className="min-h-svh bg-hoikos-100 print:bg-white"><article className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
    <Link href="/termos" className="text-sm underline print:hidden">Consultar termos atualmente publicados</Link>
    <p className="mt-7 text-sm font-semibold uppercase tracking-wide">Minuta de 20/09/2026 · sem vigência contratual</p>
    <h1 className="display-heading mt-3 text-3xl text-hoikos-950 sm:text-5xl">Termos de Uso da H.OIKOS</h1>
    <div className="mt-6 space-y-3 rounded-md border border-hoikos-200 bg-white p-5 text-sm leading-6"><p><strong>Documento para a futura operadora.</strong> A Drap desenvolve a H.OIKOS para venda à adquirente. Esta minuta não identifica a Drap como operadora da H.OIKOS e não altera os termos já aceitos pelos usuários.</p><p>Antes de entrar em vigor, preencher razão social, CNPJ/CPF aplicável, endereço completo e canais de atendimento e privacidade da operadora; definir suas responsabilidades de hospedagem, suporte e dados; publicar a política de privacidade correspondente e concluir a revisão jurídica.</p><p>O contrato de desenvolvimento e venda entre a Drap e a adquirente é separado. A integração dos módulos Drap aguarda conclusão pela Drap. Não há botão de aceite nem contratação nesta página.</p></div>
    <nav aria-label="Índice da minuta" className="mt-8 print:hidden"><ol className="grid gap-2 text-sm sm:grid-cols-2">{sections.map((section,index) => <li key={section.title}><a className="underline underline-offset-4" href={`#clausula-${index+1}`}>{section.title}</a></li>)}</ol></nav>
    <div className="mt-10 space-y-9">{sections.map((section,index) => <section id={`clausula-${index+1}`} key={section.title} className="scroll-mt-6"><h2 className="text-xl font-semibold text-hoikos-950">{section.title}</h2><div className="mt-3 space-y-3 text-base leading-7 text-hoikos-700">{section.body.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div></section>)}</div>
    <section className="mt-10 border-t border-hoikos-200 pt-8"><h2 className="text-xl font-semibold">Referências normativas</h2><p className="mt-3 leading-7">Fontes oficiais consultadas em 20/09/2026. A aplicação depende da atividade, do local e do caso concreto; este documento não constitui certificação de conformidade. Normas estaduais, municipais e atos profissionais devem ser verificados no órgão competente.</p><ul className="mt-4 space-y-2 text-sm">{references.map(([title,url]) => <li key={url}><a className="underline underline-offset-4" href={url} target="_blank" rel="noreferrer">{title}</a></li>)}</ul></section>
    <footer className="mt-8 border-t pt-5 text-sm">Para conservar uma cópia, use a opção Imprimir do navegador e selecione Salvar como PDF. Esta minuta não autoriza cobranças nem coleta aceite.</footer>
  </article></main>;
}
