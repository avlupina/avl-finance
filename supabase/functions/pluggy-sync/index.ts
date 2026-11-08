// Sincroniza manualmente um item Pluggy para o workspace do usuário.
// Body: { workspace_id: string, item_id: string, integracao_id?: string, from?: 'YYYY-MM-DD' }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json, pluggyApiKey, requireUser, assertCanEdit, adminClient, syncItem } from "./pluggy.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { sb, user } = await requireUser(req);
    const { workspace_id, item_id, integracao_id, from } = await req.json();
    if (!workspace_id || !item_id) return json({ error: "workspace_id e item_id obrigatórios" }, 400);
    await assertCanEdit(sb, workspace_id);

    const apiKey = await pluggyApiKey();
    const result = await syncItem({
      admin: adminClient(),
      apiKey,
      workspaceId: workspace_id,
      itemId: item_id,
      integracaoId: integracao_id,
      userId: user.id,
      fromDate: from,
    });
    return json({ ok: true, ...result });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
