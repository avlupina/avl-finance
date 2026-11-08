// Gera um Connect Token da Pluggy para abrir o widget de consentimento (Open Finance).
// Body: { workspace_id: string, item_id?: string }  (item_id para reconectar/atualizar um item existente)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json, pluggyApiKey, pluggyPost, requireUser, assertCanEdit } from "./pluggy.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { sb, user } = await requireUser(req);
    const { workspace_id, item_id } = await req.json();
    if (!workspace_id) return json({ error: "workspace_id obrigatório" }, 400);
    await assertCanEdit(sb, workspace_id);

    const apiKey = await pluggyApiKey();
    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/pluggy-webhook`;
    const body: Record<string, unknown> = {
      clientUserId: `${workspace_id}:${user.id}`,
      options: { webhookUrl },
    };
    if (item_id) body.itemId = item_id;
    const { accessToken } = await pluggyPost(apiKey, "/connect_token", body);
    return json({ accessToken });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
