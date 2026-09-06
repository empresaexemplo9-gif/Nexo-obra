import Image from "next/image";
import Link from "next/link";

import { CURRENT_TERMS_EFFECTIVE_DATE, CURRENT_TERMS_VERSION } from "@/lib/terms";

const sections = [
  {
    title: "1. Objeto e vínculo contratual",
    body: [
      "Estes Termos regulam o acesso ao Nexo Obra, serviço digital de organização de empresas, projetos, obras, clientes, tarefas, documentos, informações financeiras integradas e funcionalidades futuras. O fornecedor do serviço é a pessoa ou empresa identificada na proposta, pedido, fatura ou instrumento comercial aceito pelo Contratante.",
      "O uso da plataforma, a contratação do serviço ou o aceite eletrônico destes Termos forma vínculo contratual. Condições comerciais específicas, política de privacidade e contrato assinado prevalecem quando tratarem de assunto particular de forma expressa.",
    ],
  },
  {
    title: "2. Contas, empresas e perfis",
    body: [
      "O Contratante é o usuário primário e proprietário do ambiente da empresa. Ele responde pela veracidade dos dados cadastrais, pela indicação de seus administradores e pela gestão dos acessos concedidos.",
      "O proprietário e os administradores autorizados podem convidar colaboradores, parceiros, prestadores de serviço, equipe financeira, contabilidade e outros usuários. Para cada acesso, definem quais módulos podem ser visualizados ou editados. A permissão de edição inclui a visualização necessária ao trabalho.",
      "Convites são pessoais, vinculados ao e-mail indicado, temporários e de uso único. Credenciais e links não podem ser compartilhados. Cada usuário deve proteger sua autenticação e comunicar imediatamente qualquer suspeita de uso indevido.",
    ],
  },
  {
    title: "3. Superadmin e separação dos dados",
    body: [
      "O superadmin é exclusivo do titular da plataforma e administra disponibilidade, empresas cadastradas, acessos, segurança, planos, integrações, suporte e indicadores técnicos ou agregados.",
      "O painel de superadmin não concede acesso comum ao conteúdo sigiloso dos ambientes contratantes, incluindo cadastros de clientes, projetos, arquivos, documentos e valores financeiros. Cada empresa permanece isolada por organização e suas consultas são filtradas no servidor.",
      "Qualquer suporte que exija contato com conteúdo de uma empresa dependerá de solicitação ou autorização do Contratante, necessidade comprovada de segurança ou obrigação legal, aplicando-se acesso mínimo, finalidade determinada e registro de auditoria quando tecnicamente disponível.",
    ],
  },
  {
    title: "4. Obrigações do Contratante e dos usuários",
    body: [
      "O Contratante deve conceder apenas os acessos necessários, revisar permissões periodicamente, revogar pessoas desligadas, assegurar base legal para os dados inseridos e orientar seus usuários sobre sigilo e uso correto.",
      "É proibido usar a plataforma para fraude, violação de direitos, acesso não autorizado, distribuição de código malicioso, tentativa de contornar controles de segurança, tratamento ilícito de dados ou armazenamento de conteúdo que o usuário não esteja autorizado a utilizar.",
      "Perfis de financeiro e contabilidade destinam-se à prestação de contas e serviços autorizados. A plataforma não substitui validação profissional contábil, fiscal, jurídica, financeira, técnica ou de engenharia.",
    ],
  },
  {
    title: "5. Dados pessoais, confidencialidade e segurança",
    body: [
      "A empresa contratante decide as finalidades e os meios essenciais do tratamento do conteúdo de seu ambiente e deve atender os direitos dos titulares. O fornecedor trata esse conteúdo para executar o serviço, conforme instruções legítimas, e trata dados próprios de conta, segurança, cobrança e operação para administrar a relação e cumprir obrigações aplicáveis.",
      "São adotados controles proporcionais, como isolamento por empresa, permissões no servidor, sessões protegidas, armazenamento de senhas administrativas por hash, registros de aceite e auditoria. Nenhum sistema é isento de risco; incidentes confirmados serão tratados e comunicados conforme a legislação aplicável.",
      "Os dados devem ser limitados ao necessário. Informações especialmente sensíveis, segredos profissionais ou documentos sujeitos a restrições adicionais só devem ser inseridos quando houver necessidade, autorização e controles adequados.",
    ],
  },
  {
    title: "6. Integrações e terceiros",
    body: [
      "Integrações com Drap, autenticação, hospedagem, armazenamento, pagamentos ou outros fornecedores dependem de seus próprios serviços e termos. O Contratante autoriza apenas as conexões que decidir ativar e deve manter suas credenciais de integração válidas e protegidas.",
      "Dados financeiros exibidos por integração refletem a fonte conectada. Divergências devem ser conferidas no sistema de origem antes de decisões, pagamentos, declarações ou prestação de contas.",
    ],
  },
  {
    title: "7. Planos, cobrança e disponibilidade",
    body: [
      "Preço, periodicidade, limites, testes, reajustes, tributos e cancelamento constam da oferta comercial vigente. Recursos pagos não serão ativados sem informação adequada sobre as condições aplicáveis.",
      "A plataforma poderá passar por manutenção, atualização ou indisponibilidade de terceiros. O fornecedor buscará continuidade razoável, correção de falhas e preservação dos dados, sem prometer operação ininterrupta quando isso não estiver previsto em contrato específico.",
    ],
  },
  {
    title: "8. Propriedade intelectual e dados do Contratante",
    body: [
      "A tecnologia, identidade, interface, documentação e componentes próprios da plataforma permanecem de seus respectivos titulares. O Contratante mantém os direitos sobre o conteúdo que inserir e concede somente a autorização técnica necessária para armazená-lo, processá-lo e disponibilizá-lo aos usuários autorizados.",
      "Sugestões podem ser usadas para melhorar o produto sem revelar informações confidenciais nem transferir ao fornecedor a propriedade do conteúdo empresarial.",
    ],
  },
  {
    title: "9. Suspensão, encerramento e exportação",
    body: [
      "Acesso pode ser suspenso por risco de segurança, uso ilícito, inadimplência prevista em contrato ou descumprimento relevante, sempre que possível com comunicação e oportunidade de correção. Medidas urgentes podem ser adotadas para impedir dano.",
      "No encerramento, aplicam-se os prazos de exportação, retenção e eliminação informados no contrato ou política vigente, respeitadas obrigações legais, defesa de direitos, cópias de segurança e dados anonimizados.",
    ],
  },
  {
    title: "10. Evolução do serviço e alterações dos Termos",
    body: [
      "Novos módulos, automações, integrações e tipos de acesso poderão ser adicionados. Eles devem herdar os princípios de isolamento por empresa, menor privilégio, transparência, segurança e controle do Contratante.",
      "Mudanças materiais que afetem direitos, cobrança, tratamento de dados ou responsabilidades gerarão nova versão e novo aceite quando necessário. Ajustes técnicos, correções e melhorias sem impacto material podem ser comunicados pela própria plataforma.",
    ],
  },
  {
    title: "11. Responsabilidade e solução de conflitos",
    body: [
      "Cada parte responde por suas ações, usuários, obrigações legais e danos que causar. Limitações de responsabilidade previstas em proposta ou contrato não afastam direitos indisponíveis nem responsabilidades que a lei não permita limitar.",
      "Dúvidas e solicitações devem ser encaminhadas pelo canal de suporte indicado na contratação. As partes buscarão solução direta antes de medidas contenciosas, sem impedir o acesso a autoridades e direitos garantidos pela legislação brasileira.",
    ],
  },
];

export function TermsPage() {
  return <main className="min-h-svh bg-slate-100"><header className="border-b border-slate-800 bg-[#071426] text-white"><div className="mx-auto flex max-w-5xl items-center gap-4 px-5 py-5 sm:px-8"><Image src="/drap-architector-logo.png" alt="Drap Architector" width={2037} height={772} priority className="h-auto w-[210px]" /><Link href="/" className="ml-auto text-sm text-slate-300 hover:text-cyan-300">Voltar à plataforma</Link></div></header><article className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14"><p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">Versão {CURRENT_TERMS_VERSION}</p><h1 className="display-heading mt-3 text-4xl font-semibold tracking-tight text-slate-950">Termos de Uso do Nexo Obra</h1><p className="mt-3 text-slate-600">Vigentes a partir de {CURRENT_TERMS_EFFECTIVE_DATE}.</p><div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950"><strong>Documento inicial.</strong> Estes Termos organizam o funcionamento do produto e o aceite eletrônico, mas devem ser revisados por assessoria jurídica antes do início da cobrança comercial e complementados pelos dados do fornecedor, política de privacidade, canal de atendimento e condições do plano contratado.</div><div className="mt-10 space-y-9">{sections.map((section) => <section key={section.title}><h2 className="text-xl font-semibold text-slate-950">{section.title}</h2><div className="mt-3 space-y-3 text-base leading-7 text-slate-700">{section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div></section>)}</div><section className="mt-10 border-t border-slate-200 pt-8"><h2 className="text-xl font-semibold text-slate-950">Referências normativas</h2><p className="mt-3 leading-7 text-slate-700">Este texto considera a Lei Geral de Proteção de Dados Pessoais, o Marco Civil da Internet, o Código de Defesa do Consumidor quando aplicável e orientações da Autoridade Nacional de Proteção de Dados. A referência não substitui avaliação jurídica do modelo comercial concreto.</p><ul className="mt-4 space-y-2 text-sm text-blue-700"><li><a className="hover:underline" href="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm" target="_blank" rel="noreferrer">Lei Geral de Proteção de Dados Pessoais</a></li><li><a className="hover:underline" href="https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm" target="_blank" rel="noreferrer">Marco Civil da Internet</a></li><li><a className="hover:underline" href="https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm" target="_blank" rel="noreferrer">Código de Defesa do Consumidor</a></li><li><a className="hover:underline" href="https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-sobre-seguranca-da-informacao-para-agentes-de-tratamento-de-pequeno-porte" target="_blank" rel="noreferrer">Guia de Segurança da Informação da ANPD</a></li></ul></section></article></main>;
}
