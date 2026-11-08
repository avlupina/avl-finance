// Cliente mínimo da API Pluggy (https://docs.pluggy.ai)
// Secrets necessários no projeto Supabase: PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const PLUGGY_URL = "https://api.pluggy.ai";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function pluggyApiKey(): Promise<string> {
  const clientId = Deno.env.get("PLUGGY_CLIENT_ID");
  const clientSecret = Deno.env.get("PLUGGY_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error(
      "PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET não configurados nos secrets do projeto.",
    );
  }
  const r = await fetch(`${PLUGGY_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!r.ok) throw new Error(`Pluggy auth falhou: ${r.status} ${await r.text()}`);
  const { apiKey } = await r.json();
  return apiKey;
}

export async function pluggyGet(apiKey: string, path: string) {
  const r = await fetch(`${PLUGGY_URL}${path}`, {
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`Pluggy GET ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function pluggyPost(apiKey: string, path: string, body: unknown) {
  const r = await fetch(`${PLUGGY_URL}${path}`, {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Pluggy POST ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

/** Cliente com privilégios de serviço (ignora RLS) — usar somente após validar o usuário. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/** Cliente no contexto do usuário chamador (respeita RLS). */
export function userClient(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
}

export async function requireUser(req: Request) {
  const sb = userClient(req);
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) throw new Error("Não autenticado");
  return { sb, user: data.user };
}

/** Garante que o usuário pode editar o workspace. */
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
  if (t === "COE" || t === "OTHER") return "outro";
  return "outro";
}

/** Tenta identificar o banco real da conta (útil quando o conector é um proxy, como o MeuPluggy). */
export function resolveBanco<T extends { id: string; nome: string; codigo_compe: string | null }>(bancos: T[], acc: any): T | undefined {
  const compe: string | undefined = acc.bankData?.transferNumber?.split("/")?.[0]?.replace(/\D/g, "");
  if (compe) {
    const b = bancos.find((x) => x.codigo_compe && Number(x.codigo_compe) === Number(compe));
    if (b) return b;
  }
  const texto = `${acc.institution?.name ?? ""} ${acc.marketingName ?? ""} ${acc.name ?? ""}`.toLowerCase();
  return bancos.find((x) => texto.includes(x.nome.toLowerCase().split(" ")[0]) && x.nome.split(" ")[0].length > 3)
    ?? bancos.find((x) => texto.includes(x.nome.toLowerCase()));
}

/** Sincroniza um item Pluggy (contas, transações e investimentos) para um workspace. */
export async function syncItem(opts: {
  admin: SupabaseClient;
  apiKey: string;
  workspaceId: string;
  itemId: string;
  integracaoId?: string;
  userId?: string;
  fromDate?: string; // YYYY-MM-DD
}) {
  const { admin, apiKey, workspaceId, itemId } = opts;
  const item = await pluggyGet(apiKey, `/items/${itemId}`);

  // 1) integração
  const { data: integ, error: eInt } = await admin
    .from("integracoes")
    .upsert(
      {
        id: opts.integracaoId,
        workspace_id: workspaceId,
        provedor: "pluggy",
        external_item_id: itemId,
        connector_id: item.connector?.id ?? null,
        connector_nome: item.connector?.name ?? null,
        status: "atualizando",
        created_by: opts.userId ?? null,
        dados: { item_status: item.status, execution_status: item.executionStatus },
      },
      { onConflict: "provedor,external_item_id" },
    )
    .select()
    .single();
  if (eInt) throw eInt;

  const { data: log } = await admin
    .from("sync_logs")
    .insert({ integracao_id: integ.id, workspace_id: workspaceId })
    .select()
    .single();

  const resumo: Record<string, number> = { contas: 0, lancamentos: 0, investimentos: 0 };

  try {
    // bancos cadastrados no workspace — usados para vincular cada conta à instituição real
    const { data: bancosWs } = await admin
      .from("bancos")
      .select("id, nome, codigo_compe, pluggy_connector_id")
      .eq("workspace_id", workspaceId);
    const bancos = (bancosWs ?? []) as { id: string; nome: string; codigo_compe: string | null; pluggy_connector_id: number | null }[];
    const bancoPorConector = bancos.find((b) => b.pluggy_connector_id === item.connector?.id);
    const isProxy = /meu ?pluggy/i.test(item.connector?.name ?? "");

    // 2) contas
    const accounts = await pluggyGet(apiKey, `/accounts?itemId=${itemId}`);
    const contaIdPorExternal: Record<string, string> = {};
    for (const acc of accounts.results ?? []) {
      const banco = bancoPorConector ?? resolveBanco(bancos, acc);
      const row = {
        workspace_id: workspaceId,
        banco_id: banco?.id ?? null,
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
        ultima_sincronizacao: new Date().toISOString(),
        dados: acc,
      };
      const { data: c, error } = await admin
        .from("contas")
        .upsert(row, { onConflict: "integracao_id,external_id" })
        .select("id")
        .single();
      if (error) throw error;
      contaIdPorExternal[acc.id] = c.id;
      resumo.contas++;

      // 3) transações
      const from = opts.fromDate ??
        new Date(Date.now() - 1000 * 60 * 60 * 24 * 365).toISOString().slice(0, 10);
      let page = 1;
      while (true) {
        const tx = await pluggyGet(
          apiKey,
          `/transactions?accountId=${acc.id}&from=${from}&pageSize=500&page=${page}`,
        );
        const rows = (tx.results ?? []).map((t: any) => ({
          workspace_id: workspaceId,
          conta_id: c.id,
          data: (t.date ?? "").slice(0, 10),
          descricao: t.description ?? t.descriptionRaw ?? "Lançamento",
          valor: Math.abs(t.amount ?? 0),
          tipo: (t.amount ?? 0) >= 0 ? (acc.type === "CREDIT" ? "despesa" : "receita") : (acc.type === "CREDIT" ? "receita" : "despesa"),
          status: t.status === "PENDING" ? "pendente" : "efetivado",
          origem: "pluggy",
          external_id: t.id,
          categoria_origem: t.category ?? null,
          observacao: t.descriptionRaw ?? null,
          created_by: opts.userId ?? null,
        }));
        // Cartão: na Pluggy, gasto no cartão vem com amount positivo (débito) — tratado acima.
        if (rows.length) {
          const { error: eTx } = await admin
            .from("lancamentos")
            .upsert(rows, { onConflict: "conta_id,external_id", ignoreDuplicates: false });
          if (eTx) throw eTx;
          resumo.lancamentos += rows.length;
        }
        if (page >= (tx.totalPages ?? 1)) break;
        page++;
      }
    }

    // 4) investimentos
    const inv = await pluggyGet(apiKey, `/investments?itemId=${itemId}`);
    for (const i of inv.results ?? []) {
      const row = {
        workspace_id: workspaceId,
        integracao_id: integ.id,
        external_id: i.id,
        nome: i.name ?? i.code ?? "Investimento",
        tipo: mapTipoInvestimento(i),
        subtipo: i.subtype ?? null,
        instituicao: i.issuer ?? i.institution?.name ?? (isProxy ? null : item.connector?.name) ?? null,
        codigo: i.code ?? null,
        quantidade: i.quantity ?? null,
        valor_aplicado: i.amountOriginal ?? i.amount ?? 0,
        valor_atual: i.balance ?? i.amount ?? 0,
        rentabilidade_pct: i.annualRate ?? i.rate ?? null,
        taxa: i.fixedAnnualRate ? `${i.fixedAnnualRate}% a.a.` : (i.rateType ?? null),
        data_aplicacao: i.date ? String(i.date).slice(0, 10) : null,
        vencimento: i.dueDate ? String(i.dueDate).slice(0, 10) : null,
        dados: i,
        atualizado_em: new Date().toISOString(),
      };
      const { error } = await admin
        .from("investimentos")
        .upsert(row, { onConflict: "integracao_id,external_id" });
      if (error) throw error;
      resumo.investimentos++;
    }

    await admin.from("integracoes").update({
      status: item.status === "UPDATED" || item.status === "OUTDATED" ? "conectado" : item.status === "LOGIN_ERROR" ? "erro" : "conectado",
      ultima_sincronizacao: new Date().toISOString(),
      erro: null,
    }).eq("id", integ.id);
    if (log) await admin.from("sync_logs").update({ finalizado_em: new Date().toISOString(), status: "ok", resumo }).eq("id", log.id);
    return { integracao_id: integ.id, resumo };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from("integracoes").update({ status: "erro", erro: msg }).eq("id", integ.id);
    if (log) await admin.from("sync_logs").update({ finalizado_em: new Date().toISOString(), status: "erro", resumo: { erro: msg } }).eq("id", log.id);
    throw err;
  }
}
