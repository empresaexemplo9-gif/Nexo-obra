import { TITULAR } from "@/lib/legal/titular";

// Revisar com advogado antes de considerar a versão definitiva.
export const VERSAO_DOCUMENTOS = "23/11/2026";

export type DocumentoLegalTipo = "termos" | "privacidade";

export const DOCUMENTOS: Record<DocumentoLegalTipo, { titulo: string; secoes: { titulo: string; paragrafos: string[] }[] }> = {
  termos: {
    titulo: "Termos de Uso",
    secoes: [
      { titulo: "1. Quem fornece a plataforma", paragrafos: [
        `Esta plataforma é um software desenvolvido e fornecido pela ${TITULAR.razaoSocial} (nome fantasia ${TITULAR.nomeFantasia}), inscrita no CNPJ sob o nº ${TITULAR.cnpj}, com sede na ${TITULAR.endereco}. Contato: ${TITULAR.email} · ${TITULAR.telefone}.`,
      ] },
      { titulo: "2. Objeto", paragrafos: [
        `Estes termos regem o acesso e o uso da plataforma. Quando houver contrato firmado com a DRAP, as condições do contrato prevalecem sobre estes termos naquilo em que forem diferentes.`,
        `A DRAP concede ao cliente uma licença de uso não exclusiva, intransferível e revogável, válida enquanto durar a relação contratual. Nenhum direito de propriedade sobre o software é transferido.`,
      ] },
      { titulo: "3. Conta e acesso", paragrafos: [
        `O usuário deve informar dados verdadeiros e manter suas credenciais em sigilo. Atos praticados com a conta são de responsabilidade do seu titular, que deve avisar a DRAP imediatamente em caso de uso não autorizado.`,
        `A empresa cliente é responsável por quem ela convida e pelas permissões que concede aos seus usuários.`,
      ] },
      { titulo: "4. Uso permitido", paragrafos: [
        `É proibido: usar a plataforma para fins ilícitos; tentar acessar dados de outras contas ou empresas; copiar, revender, sublicenciar, descompilar ou fazer engenharia reversa do software; sobrecarregar a infraestrutura ou burlar mecanismos de segurança.`,
        `A DRAP pode suspender o acesso que viole estes termos, com aviso sempre que possível.`,
      ] },
      { titulo: "5. Propriedade intelectual", paragrafos: [
        `O software, seu código, interfaces, marcas e documentação pertencem à DRAP e são protegidos pelas Leis nº 9.609/1998, nº 9.610/1998 e nº 9.279/1996.`,
        `Os dados inseridos pelo cliente continuam sendo do cliente.`,
      ] },
      { titulo: "6. Disponibilidade e suporte", paragrafos: [
        `A DRAP trabalha para manter a plataforma disponível e segura, mas podem ocorrer interrupções para manutenção, por falhas de terceiros ou por caso fortuito e força maior. Níveis de serviço e suporte específicos valem somente quando previstos em contrato.`,
      ] },
      { titulo: "7. Responsabilidade", paragrafos: [
        `A DRAP responde pelos danos que causar nos limites da legislação aplicável, inclusive o Código de Defesa do Consumidor quando a relação for de consumo. A DRAP não responde pelo conteúdo inserido pelos usuários nem por decisões tomadas pelo cliente com base nas informações da plataforma.`,
      ] },
      { titulo: "8. Dados pessoais", paragrafos: [
        `O tratamento de dados pessoais segue a Política de Privacidade, disponível em /privacidade, e a Lei nº 13.709/2018 (LGPD).`,
      ] },
      { titulo: "9. Alterações", paragrafos: [
        `Estes termos podem ser atualizados. Mudanças relevantes serão comunicadas com antecedência razoável pela plataforma ou por e-mail.`,
      ] },
      { titulo: "10. Lei e foro", paragrafos: [
        `Aplica-se a lei brasileira. Fica eleito o foro da Comarca de Goiânia/GO, ressalvado o direito do consumidor de propor ação no foro do seu domicílio.`,
      ] },
    ],
  },
  privacidade: {
    titulo: "Política de Privacidade",
    secoes: [
      { titulo: "1. Controlador", paragrafos: [
        `${TITULAR.razaoSocial}, CNPJ ${TITULAR.cnpj}, ${TITULAR.endereco}, é a controladora dos dados de cadastro e de uso das contas da plataforma.`,
        `Quando uma empresa cliente cadastra dados dos seus próprios clientes, colaboradores ou parceiros, ela é a controladora desses dados e a DRAP atua como operadora, tratando-os somente conforme as instruções do cliente e o contrato.`,
      ] },
      { titulo: "2. Dados que tratamos", paragrafos: [
        `Cadastro: nome, e-mail, telefone, empresa e perfil de acesso. Senhas são guardadas apenas em formato cifrado.`,
        `Uso: endereço IP, navegador, data e hora de acesso e registros de ações relevantes, para segurança e auditoria.`,
        `Conteúdo: as informações que o cliente insere na plataforma para usar suas funções.`,
      ] },
      { titulo: "3. Finalidades e bases legais", paragrafos: [
        `Prestar o serviço contratado e manter a conta (execução de contrato, art. 7º, V, da LGPD); cumprir obrigações legais e regulatórias, inclusive fiscais (art. 7º, II); proteger a plataforma contra fraude e acesso indevido (legítimo interesse, art. 7º, IX); enviar comunicações sobre o serviço. Comunicações de marketing só são enviadas com consentimento, que pode ser revogado a qualquer momento.`,
      ] },
      { titulo: "4. Compartilhamento", paragrafos: [
        `Compartilhamos dados apenas com fornecedores necessários ao funcionamento da plataforma, como hospedagem, banco de dados, envio de e-mail e mensagens, e com autoridades quando houver obrigação legal ou ordem judicial. A DRAP não vende dados pessoais.`,
      ] },
      { titulo: "5. Transferência internacional", paragrafos: [
        `Alguns fornecedores de infraestrutura podem armazenar dados fora do Brasil. Nesses casos a transferência segue o art. 33 da LGPD, com fornecedores que oferecem garantias adequadas de proteção.`,
      ] },
      { titulo: "6. Retenção", paragrafos: [
        `Os dados são mantidos enquanto a conta ou o contrato estiverem ativos e, depois disso, pelo prazo exigido por lei. Registros de acesso a aplicações são guardados por no mínimo 6 meses, conforme o art. 15 do Marco Civil da Internet. Encerrados os prazos, os dados são excluídos ou anonimizados.`,
      ] },
      { titulo: "7. Segurança", paragrafos: [
        `Usamos conexão criptografada, controle de acesso por perfil, separação dos dados por empresa e registros de auditoria. Em caso de incidente de segurança com risco relevante, os titulares afetados e a ANPD serão comunicados conforme a lei.`,
      ] },
      { titulo: "8. Seus direitos", paragrafos: [
        `Você pode pedir confirmação do tratamento, acesso, correção, anonimização, portabilidade e exclusão dos seus dados, informação sobre compartilhamentos e revogação de consentimento (art. 18 da LGPD). Envie o pedido para ${TITULAR.email}. Se os dados foram inseridos por uma empresa cliente, encaminharemos o pedido a ela. Você também pode reclamar à ANPD.`,
      ] },
      { titulo: "9. Cookies", paragrafos: [
        `Usamos apenas cookies necessários para manter a sessão, lembrar preferências e proteger a conta.`,
      ] },
      { titulo: "10. Encarregado e contato", paragrafos: [
        `Assuntos de privacidade: ${TITULAR.email} · ${TITULAR.telefone}. ${TITULAR.razaoSocial}, ${TITULAR.endereco}.`,
      ] },
    ],
  },
};
