// Sincroniza todas as integrações conectadas (todos os workspaces). Chamada pelo agendador (pg_cron) diariamente.
// Autenticação: header x-cron-key igual ao valor em public.app_config ('cron_key').
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, pluggyApiKey, adminClient, syncItem } from "./pluggy.ts";

Deno.serve(async (req) => {
  try {
    const admin = adminClient();
    const { data: cfg } = await admin.from("app_config").select("valor").eq("chave", "cron_key").maybeSingle();
    if (!cfg?.valor || req.headers.get("x-cron-key") !== cfg.valor) return json({ error: "unauthorized" }, 401);

    const { data: integs } = await admin.from("integracoes").select("id, workspace_id, external_item_id, connector_nome, created_by").eq("provedor", "pluggy").neq("status", "desconectado").not("external_item_id", "is", null);
    const apiKey = await pluggyApiKey();
    const from = new Date(Date.now() - 1000 * 3600 * 24 * 90).toISOString().slice(0, 10);
    const resultado: Record<string, unknown>[] = [];
    for (const i of integs ?? []) {
      try {
        const r = await syncItem({ admin, apiKey, workspaceId: i.workspace_id, itemId: i.external_item_id!, integracaoId: i.id, userId: i.created_by ?? undefined, fromDate: from });
        resultado.push({ integracao: i.connector_nome, ok: true, ...r.resumo });
      } catch (e) {
        resultado.push({ integracao: i.connector_nome, ok: false, erro: e instanceof Error ? e.message : String(e) });
      }
    }
    // registra snapshot de patrimônio de cada workspace
    const wss = new Set((integs ?? []).map((i) => i.workspace_id));
    for (const ws of wss) await admin.rpc("registrar_snapshot_patrimonio_admin", { ws });
    return json({ ok: true, total: resultado.length, resultado });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
