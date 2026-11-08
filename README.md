# AVL Finance

SaaS de gestão financeira pessoal: coleta (Open Finance via agregador), integração e análise de contas bancárias, investimentos, movimentações, patrimônio e metas — com autenticação, workspaces multiusuário e permissões ponta a ponta no Supabase.

## Stack

| Camada | Tecnologia |
|---|---|
| Front-end | React 19 + TypeScript + Vite, Tailwind CSS v4, Recharts, lucide-react, fonte **Overlock** |
| Back-end | Supabase (Postgres + RLS, Auth, Edge Functions em Deno) — projeto `wllbunqisamgxfjlwlzi` (sa-east-1) |
| Open Finance | Pluggy (Connect Widget + API) — pronto para Belvo como 2º provedor |

## Estrutura

```
src/
  components/   Layout (menu lateral #104862), ui (modal, kpi, tabs...), charts
  hooks/        useAuth (sessão, workspace, papel, permissões), useQuery
  lib/          supabase client, formatadores, tipos
  pages/        Login, Lancamentos, Resultados, Analise, Investimentos, Futuro,
                Patrimonio, Contas, Integracoes, Cadastros, Usuarios
supabase/
  functions/    pluggy-connect-token, pluggy-sync, pluggy-webhook (já implantadas)
  migrations/   schema inicial (já aplicado no projeto)
```

## Modelo de dados (schema `public`)

- `workspaces`, `workspace_members` (papel `owner|admin|editor|leitor` + `permissoes` por módulo), `profiles`
- Cadastros: `plano_contas` (hierárquico, receita/despesa/investimento/transferência, natureza fixa/variável), `bancos` (COMPE, ISPB, conector Pluggy)
- Dados: `contas`, `lancamentos` (com `competencia` gerada), `orcamentos`, `investimentos`, `patrimonio`, `metas`
- Integração: `integracoes` (item do agregador), `sync_logs`
- Views: `v_resultado_mensal`, `v_despesas_por_categoria`, `v_patrimonio_liquido`
- Segurança: RLS em todas as tabelas via `is_member()`, `can_edit()`, `has_role()`.  
  Trigger `on_auth_user_created`: cria perfil, vincula convites pendentes pelo e-mail e, se não houver convite, cria o workspace pessoal já com plano de contas e bancos padrão.

## Rodando localmente

```bash
npm install
cp .env.example .env     # já aponta para o projeto AVL Finance
npm run dev
```

## Publicando (hospedagem estática)

`npm run build` gera `dist/` (roteamento por hash, `base: './'` — funciona em qualquer host estático).

- **Vercel (produção)**: repositório `avlupina/avl-finance` importado em vercel.com; `vercel.json` já define framework/saída. Variáveis em Settings → Environment Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_PLUGGY_SANDBOX`. Cada push em `main` publica em produção; branches ganham URL de preview.

Depois de publicar, em **Supabase → Authentication → URL Configuration** defina *Site URL* e *Redirect URLs* com a URL do app (confirmação de e-mail e recuperação de senha).

## Open Finance (Pluggy)

1. **Uso pessoal (gratuito) — Meu Pluggy**: crie conta em https://meu.pluggy.ai e conecte seus bancos lá (Open Finance oficial). Em https://dashboard.pluggy.ai crie a aplicação, inclua o conector **MeuPluggy** na lista de conectores e crie a *Development Application* — ela fornece `CLIENT_ID` / `CLIENT_SECRET`. No app, conecte via conector MeuPluggy (uma autorização por banco). O sync identifica o banco real de cada conta pelo código COMPE / nome da instituição.
   **Uso comercial**: aplicação normal no dashboard (plano pago) com os conectores diretos dos bancos.
2. Em **Supabase → Edge Functions → Secrets**, cadastre `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` e (opcional) `PLUGGY_WEBHOOK_SECRET`.
3. No app, **Integrações → Conectar instituição**: abre o widget da Pluggy, você autentica no banco (ex.: Banco do Brasil PF) e autoriza o consentimento. Ao concluir, `pluggy-sync` importa contas, extrato (12 meses) e investimentos.
4. Webhook (atualizações automáticas): `https://wllbunqisamgxfjlwlzi.supabase.co/functions/v1/pluggy-webhook` — já é informado no `connect_token`; pode também ser cadastrado no dashboard da Pluggy.
5. Para testar sem banco real, defina `VITE_PLUGGY_SANDBOX=true` e use o conector *Pluggy Bank* (sandbox).

### Edge Functions

| Função | JWT | Descrição |
|---|---|---|
| `pluggy-connect-token` | sim | Gera o token do widget (valida que o usuário pode editar o workspace) |
| `pluggy-sync` | sim | Sincroniza um item: upsert de contas, lançamentos (dedupe por `external_id`) e investimentos |
| `pluggy-webhook` | não | Recebe eventos `item/*` e `transactions/*` da Pluggy e dispara a sincronização |
| `assistente` | sim | Assistente de IA (Anthropic Claude) com o resumo financeiro do workspace (`resumo_financeiro`). Secrets: `ANTHROPIC_API_KEY`, opcional `ANTHROPIC_MODEL` |

Para reimplantar após alterações: `supabase functions deploy pluggy-sync --project-ref wllbunqisamgxfjlwlzi` (ou via MCP).

## Usuários e permissões

- **Proprietário**: criado automaticamente no cadastro; acesso total.
- **Administrador**: tudo, inclusive Usuários e Integrações.
- **Editor**: lança/edita nos módulos liberados (`ver`/`editar`/`nenhum` por módulo).
- **Leitor**: só consulta nos módulos liberados.
- Convite: Usuários → Convidar (e-mail + papel + permissões). Quando a pessoa criar a conta com o mesmo e-mail, o acesso é vinculado automaticamente.

## Módulos

| Menu | O que faz |
|---|---|
| Status Atual | Score financeiro 0–100 (Organização, Patrimônio, Liberdade financeira, Gestão de ativos) com alertas; posição consolidada (contas, cartões, investimentos, PL), receitas × gastos por período (data inicial/final), últimos lançamentos, projeções e objetivos |
| Projeções | Gastos e receitas previstos por mês (recorrentes, cópia do mês anterior, previsto × realizado) |
| Plano | Renda × gastos médios por natureza, metas de gasto por categoria (economia projetada), reserva ideal, orçamento completo |
| Lançamentos | Filtros por período/tipo/conta/categoria, categorização inline, CRUD, exportação CSV |
| Resultados | DRE pessoal (plano × meses), evolução mensal, orçado × realizado editável |
| Análise | Taxa de poupança, fixas × variáveis, top categorias, recorrências, gastos por dia da semana |
| Investimentos | Carteira, meta de investimento mensal, alocação por objetivo (reserva, projetos curto/médio/longo, independência), classe/instituição |
| Futuro | Independência financeira por idade (idade de aposentadoria, renda desejada, outras rendas, investimento mensal, taxa real) e projetos por prioridade (Essencial/Desejo/Sonho) |
| Proteção | Cobertura de vida necessária (padrão de vida, educação, sucessão) × apólices contratadas |
| Patrimônio | Bens e Dívidas (investimentos, empréstimos, bens móveis, imóveis, milhas; saldo devedor vinculado; ativo gerador de renda), Resumo Patrimonial, Evolução mensal |
| Contas | Contas e cartões (conectados ou manuais), saldos, sincronização |
| Integrações | Conexões Open Finance, histórico de sincronizações, configuração |
| Cadastros | Plano de contas, bancos, fornecedores (regras por descrição → categoria) e mapeamento de categorias do agregador |
| Usuários | Convites, alçadas e permissões por módulo |
