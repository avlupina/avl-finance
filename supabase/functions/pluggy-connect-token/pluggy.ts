// Cliente mínimo da API Pluggy (https://docs.pluggy.ai) + rotina de sincronização.
// Secrets necessários no projeto Supabase: PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const PLUGGY_URL = "https://api.pluggy.ai";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export async function pluggyApiKey(): Promise<string> {
  const clientId = Deno.env.get("PLUGGY_CLIENT_ID");
  const clientSecret = Deno.env.get("PLUGGY_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET não configurados nos secrets do projeto.");
  const r = await fetch(`${PLUGGY_URL}/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, clientSecret }) });
  if (!r.ok) throw new Error(`Pluggy auth falhou: ${r.status} ${await r.text()}`);
  const { apiKey } = await r.json();
  return apiKey;
}

export async function pluggyGet(apiKey: string, path: string) {
  const r = await fetch(`${PLUGGY_URL}${path}`, { headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`Pluggy GET ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function pluggyPost(apiKey: string, path: string, body: unknown) {
  const r = await fetch(`${PLUGGY_URL}${path}`, { method: "POST", headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Pluggy POST ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function pluggyPatch(apiKey: string, path: string, body: unknown = {}) {
  const r = await fetch(`${PLUGGY_URL}${path}`, { method: "PATCH", headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Pluggy PATCH ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const EM_EXECUCAO_STATUS = ["UPDATING", "LOGIN_IN_PROGRESS", "WAITING_USER_INPUT"];
const EM_EXECUCAO_EXEC = ["CREATED", "LOGIN_IN_PROGRESS", "ACCOUNTS_IN_PROGRESS", "TRANSACTIONS_IN_PROGRESS", "INVESTMENTS_IN_PROGRESS", "CREDITCARDS_IN_PROGRESS", "IDENTITY_IN_PROGRESS", "PAYMENT_DATA_IN_PROGRESS", "OPPORTUNITIES_IN_PROGRESS", "LOANS_IN_PROGRESS", "INVESTMENTS_TRANSACTIONS_IN_PROGRESS"];
const emExecucao = (it: any) => EM_EXECUCAO_STATUS.includes(it?.status) || EM_EXECUCAO_EXEC.includes(it?.executionStatus);

/** Pede à Pluggy para atualizar o item junto ao banco e aguarda a conclusão (até ~50 s). */
export async function atualizarItem(apiKey: string, itemId: string): Promise<{ item: any; aviso?: string }> {
  let item = await pluggyGet(apiKey, `/items/${itemId}`);
  let aviso: string | undefined;
  if (!emExecucao(item)) {
    try { item = await pluggyPatch(apiKey, `/items/${itemId}`, {}); }
    catch (e) { return { item, aviso: `Pluggy não aceitou a atualização forçada agora (${e instanceof Error ? e.message.slice(0, 160) : String(e)}); usando dados em cache.` }; }
  }
  const inicio = Date.now();
  while (emExecucao(item) && Date.now() - inicio < 50000) {
    await new Promise((r) => setTimeout(r, 3000));
    item = await pluggyGet(apiKey, `/items/${itemId}`);
  }
  if (emExecucao(item)) aviso = "Atualização ainda em andamento na Pluggy; os dados chegam na próxima sincronização.";
  return { item, aviso };
}

/** Cliente com privilégios de serviço (ignora RLS) — usar somente após validar o usuário. */
export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

/** Cliente no contexto do usuário chamador (respeita RLS). */
export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
}

export async function requireUser(req: Request) {
  const sb = userClient(req);
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) throw new Error("Não autenticado");
  return { sb, user: data.user };
}

export async function assertCanEdit(sb: SupabaseClient, workspaceId: string) {
  const { data, error } = await sb.rpc("can_edit", { ws: workspaceId });
  if (error || !data) throw new Error("Sem permissão de edição neste workspace");
}

// ---------- Mapeamentos Pluggy -> AVL ----------
export function mapTipoConta(acc: any): string {
  if (acc.type === "CREDIT") return "cartao_credito";
  const st = (acc.subtype ?? "").toUpperCase();
  if (st.includes("SAVINGS")) return "poupanca";
  if (st.includes("CHECKING")) return "corrente";
  return "outro";
}

export function mapTipoInvestimento(inv: any): string {
  const t = (inv.type ?? "").toUpperCase();
  if (t === "FIXED_INCOME") return "renda_fixa";
  if (t === "EQUITY" || t === "ETF") return "renda_variavel";
  if (t === "MUTUAL_FUND") return "fundos";
  if (t === "SECURITY" && (inv.subtype ?? "").toUpperCase().includes("RETIREMENT")) return "previdencia";
  return "outro";
}

/** Identifica o banco real da conta (necessário quando o conector é um proxy, como o MeuPluggy). */
export function resolveBanco<T extends { id: string; nome: string; codigo_compe: string | null }>(bancos: T[], acc: any): T | undefined {
  const compe: string | undefined = acc.bankData?.transferNumber?.split("/")?.[0]?.replace(/\D/g, "");
  if (compe) {
    const b = bancos.find((x) => x.codigo_compe && Number(x.codigo_compe) === Number(compe));
    if (b) return b;
  }
  const texto = ` ${acc.institution?.name ?? ""} ${acc.marketingName ?? ""} ${acc.name ?? ""} `.toLowerCase();
  const palavra = (n: string) => new RegExp(`(^|[^a-z])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`);
  return bancos.find((x) => palavra(x.nome).test(texto))
    ?? bancos.find((x) => x.nome.split(" ")[0].length > 4 && palavra(x.nome.split(" ")[0]).test(texto));
}

/** Sincroniza um item Pluggy (contas, transações e investimentos) para um workspace. */
export async function syncItem(opts: { admin: SupabaseClient; apiKey: string; workspaceId: string; itemId: string; integracaoId?: string; userId?: string; fromDate?: string; forcar?: boolean }) {
  const { admin, apiKey, workspaceId, itemId } = opts;
  let item: any; let avisoAtualizacao: string | undefined;
  if (opts.forcar) { const r = await atualizarItem(apiKey, itemId); item = r.item; avisoAtualizacao = r.aviso; }
  else item = await pluggyGet(apiKey, `/items/${itemId}`);

  const { data: integ, error: eInt } = await admin.from("integracoes").upsert({
    id: opts.integracaoId,
    workspace_id: workspaceId,
    provedor: "pluggy",
    external_item_id: itemId,
    connector_id: item.connector?.id ?? null,
    connector_nome: item.connector?.name ?? null,
    status: "atualizando",
    created_by: opts.userId ?? null,
    dados: { item_status: item.status, execution_status: item.executionStatus },
  }, { onConflict: "provedor,external_item_id" }).select().single();
  if (eInt) throw eInt;

  const { data: log } = await admin.from("sync_logs").insert({ integracao_id: integ.id, workspace_id: workspaceId }).select().single();
  const resumo: Record<string, number> = { contas: 0, lancamentos: 0, investimentos: 0, categorizados: 0 };

  try {
    const { data: bancosWs } = await admin.from("bancos").select("id, nome, codigo_compe, pluggy_connector_id").eq("workspace_id", workspaceId);
    const bancos = (bancosWs ?? []) as { id: string; nome: string; codigo_compe: string | null; pluggy_connector_id: number | null }[];
    const bancoPorConector = bancos.find((b) => b.pluggy_connector_id === item.connector?.id);
    const isProxy = /meu ?pluggy/i.test(item.connector?.name ?? "");

    const accounts = await pluggyGet(apiKey, `/accounts?itemId=${itemId}`);
    // Um item = uma instituição: resolve o banco uma vez e aplica a todas as contas.
    const bancoItem = bancoPorConector ?? (accounts.results ?? []).map((a: any) => resolveBanco(bancos, a)).find((b: unknown) => b);
    for (const acc of accounts.results ?? []) {
      const row = {
        workspace_id: workspaceId,
        banco_id: bancoItem?.id ?? null,
        integracao_id: integ.id,
        external_id: acc.id,
        nome: acc.name ?? acc.marketingName ?? "Conta",
        tipo: mapTipoConta(acc),
        agencia: acc.bankData?.transferNumber?.split("/")?.[1] ?? null,
        numero: acc.number ?? null,
        moeda: acc.currencyCode ?? "BRL",
        saldo_atual: acc.type === "CREDIT" ? -(acc.balance ?? 0) : (acc.balance ?? 0),
        limite: acc.creditData?.creditLimit ?? null,
        fechamento_fatura: acc.creditData?.balanceCloseDate ? new Date(acc.creditData.balanceCloseDate).getDate() : null,
        vencimento_fatura: acc.creditData?.balanceDueDate ? new Date(acc.creditData.balanceDueDate).getDate() : null,
        ativa: true,
        // data em que o agregador obteve o dado no banco (não a hora da cópia)
        ultima_sincronizacao: acc.updatedAt ?? new Date().toISOString(),
        dados: acc,
      };
      const { data: c, error } = await admin.from("contas").upsert(row, { onConflict: "integracao_id,external_id" }).select("id").single();
      if (error) throw error;
      resumo.contas++;

      const from = opts.fromDate ?? new Date(Date.now() - 1000 * 60 * 60 * 24 * 365).toISOString().slice(0, 10);
      let query: string | null = `?accountId=${acc.id}&dateFrom=${from}`;
      let guard = 0;
      while (query && guard++ < 200) {
        const tx = await pluggyGet(apiKey, `/v2/transactions${query}`);
        const rows = (tx.results ?? []).map((t: any) => {
          const credito = t.type ? t.type === "CREDIT" : (t.amount ?? 0) >= 0;
          return {
            workspace_id: workspaceId,
            conta_id: c.id,
            data: (t.date ?? "").slice(0, 10),
            descricao: t.description ?? t.descriptionRaw ?? "Lançamento",
            valor: Math.abs(t.amount ?? 0),
            tipo: credito ? "receita" : "despesa",
            status: t.status === "PENDING" ? "pendente" : "efetivado",
            origem: "pluggy",
            external_id: t.id,
            categoria_origem: t.category ?? null,
            observacao: t.descriptionRaw ?? null,
            created_by: opts.userId ?? null,
          };
        });
        if (rows.length) {
          const { error: eTx } = await admin.from("lancamentos").upsert(rows, { onConflict: "conta_id,external_id" });
          if (eTx) throw eTx;
          resumo.lancamentos += rows.length;
        }
        const next: string | null = tx.next ?? null;
        query = next && next !== query ? next : null;
      }
    }

    const inv = await pluggyGet(apiKey, `/investments?itemId=${itemId}`);
    for (const i of inv.results ?? []) {
      const row = {
        workspace_id: workspaceId,
        integracao_id: integ.id,
        external_id: i.id,
        nome: i.name ?? i.code ?? "Investimento",
        tipo: mapTipoInvestimento(i),
        subtipo: i.subtype ?? null,
        instituicao: i.issuer ?? i.institution?.name ?? (isProxy ? (bancoItem?.nome ?? null) : item.connector?.name) ?? null,
        codigo: i.code ?? null,
        quantidade: i.quantity ?? null,
        valor_aplicado: i.amountOriginal ?? i.amount ?? 0,
        valor_atual: i.balance ?? i.amount ?? 0,
        rentabilidade_pct: i.annualRate ?? i.rate ?? null,
        taxa: i.fixedAnnualRate ? `${i.fixedAnnualRate}% a.a.` : (i.rateType ?? null),
        data_aplicacao: i.date ? String(i.date).slice(0, 10) : null,
        vencimento: i.dueDate ? String(i.dueDate).slice(0, 10) : null,
        dados: i,
        atualizado_em: i.updatedAt ?? new Date().toISOString(),
      };
      const { error } = await admin.from("investimentos").upsert(row, { onConflict: "integracao_id,external_id" });
      if (error) throw error;
      resumo.investimentos++;
    }

    const { data: mapeados } = await admin.rpc("aplicar_mapeamento", { ws: workspaceId });
    resumo.categorizados = Number(mapeados ?? 0);

    const itemUpdatedAt = item.updatedAt ?? item.lastUpdatedAt ?? null;
    await admin.from("integracoes").update({
      status: item.status === "LOGIN_ERROR" ? "erro" : "conectado",
      ultima_sincronizacao: new Date().toISOString(),
      erro: avisoAtualizacao ?? null,
      dados: { item_status: item.status, execution_status: item.executionStatus, item_updated_at: itemUpdatedAt },
    }).eq("id", integ.id);
    if (log) await admin.from("sync_logs").update({ finalizado_em: new Date().toISOString(), status: "ok", resumo: { ...resumo, forcado: !!opts.forcar, item_updated_at: itemUpdatedAt, aviso: avisoAtualizacao } }).eq("id", log.id);
    return { integracao_id: integ.id, resumo, aviso: avisoAtualizacao, item_status: item.status, item_updated_at: itemUpdatedAt };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from("integracoes").update({ status: "erro", erro: msg }).eq("id", integ.id);
    if (log) await admin.from("sync_logs").update({ finalizado_em: new Date().toISOString(), status: "erro", resumo: { erro: msg } }).eq("id", log.id);
    throw err;
  }
}
