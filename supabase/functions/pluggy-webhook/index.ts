// Webhook da Pluggy: recebe eventos de item (item/created, item/updated, transactions/created...)
// e dispara a sincronização do item correspondente. Sem JWT (chamado pela Pluggy).
// Opcional: configure PLUGGY_WEBHOOK_SECRET e envie o mesmo valor no header "x-webhook-secret"
// ao criar o webhook na Pluggy, para validar a origem.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, pluggyApiKey, adminClient, syncItem } from "./pluggy.ts";

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get("PLUGGY_WEBHOOK_SECRET");
    if (secret && req.headers.get("x-webhook-secret") !== secret) {
      return json({ error: "unauthorized" }, 401);
    }
    const evt = await req.json();
    const itemId: string | undefined = evt.itemId ?? evt.item?.id;
    const event: string = evt.event ?? "";
    if (!itemId) return json({ ok: true, ignored: true });

    const admin = adminClient();
    // Descobre o workspace a partir do clientUserId ("workspace:user") ou de uma integração já existente
    let workspaceId: string | undefined;
    let userId: string | undefined;
    const cu: string | undefined = evt.clientUserId ?? evt.item?.clientUserId;
    if (cu && cu.includes(":")) [workspaceId, userId] = cu.split(":");
    if (!workspaceId) {
      const { data } = await admin.from("integracoes").select("workspace_id, created_by").eq("external_item_id", itemId).maybeSingle();
      workspaceId = data?.workspace_id;
      userId = data?.created_by ?? undefined;
    }
    if (!workspaceId) return json({ ok: true, ignored: true, reason: "workspace não identificado" });

    if (event.startsWith("item/error") || event === "item/login_succeeded") {
      await admin.from("integracoes").update({
        status: event.startsWith("item/error") ? "erro" : "atualizando",
        erro: evt.error?.message ?? null,
      }).eq("external_item_id", itemId);
      return json({ ok: true });
    }

    const apiKey = await pluggyApiKey();
    const result = await syncItem({ admin, apiKey, workspaceId, itemId, userId });
    return json({ ok: true, ...result });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
