# Arquitetura do Nexo Obra

O Nexo Obra vive em `apps/nexo-obra` para não compartilhar código, configuração ou dados com os outros produtos deste repositório.

## Organização

```text
apps/nexo-obra/
├── app/                         # rotas, layout e endpoints HTTP
│   └── api/                     # entrada da aplicação; fina e validada
├── components/ui/               # primitivas acessíveis, sem regra de negócio
├── features/                    # experiência organizada por domínio
│   └── workspace/               # shell, navegação e visão operacional
├── db/                          # esquema e acesso centralizado ao D1
├── drizzle/                     # migrações imutáveis do banco
├── lib/integrations/            # integrações exclusivamente no servidor
├── docs/                        # decisões e contratos técnicos
└── public/                      # ativos públicos estáticos
```

À medida que cada módulo ganhar fluxos próprios, ele recebe uma pasta em `features/<dominio>` com `components`, `data`, `services` e `types` apenas quando essas camadas forem necessárias. Não devem existir pastas vazias ou abstrações sem uso.

## Limites obrigatórios

- Toda tabela operacional carrega `organization_id`.
- A organização vem da associação autenticada no servidor, nunca de um identificador enviado pelo navegador.
- D1 guarda dados relacionais; R2 guarda arquivos; o D1 mantém os metadados dos arquivos.
- A Drap é a fonte financeira. Tokens e chamadas remotas ficam em `lib/integrations/drap/server.ts`.
- Endpoints em `app/api` validam entrada, autorização e organização antes de tocar nos dados.
- Criação, alteração, exclusão e mudança de status geram evento de auditoria.

## Fluxo de dependências

```text
app → features → components/ui
app/api → db + lib/integrations
features → contratos públicos da API
db e integrações nunca importam componentes
```

Esse sentido único evita dependências circulares e permite separar os módulos em pacotes no futuro sem antecipar complexidade agora.
