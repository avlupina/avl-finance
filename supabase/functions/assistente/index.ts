// Assistente financeiro do AVL Finance — usa a API da Anthropic (Claude) com o resumo financeiro do workspace.
// Secrets: ANTHROPIC_API_KEY (obrigatório), ANTHROPIC_MODEL (opcional, padrão claude-sonnet-5-5)
// Body: { workspace_id: string, mensagem: string }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `Você é o assistente financeiro do AVL Finance, um app de gestão de finanças pessoais usado por um consultor de gestão brasileiro.
Você recebe um resumo JSON com a posição atual (contas, cartões, investimentos, patrimônio), resultado mensal dos últimos 12 meses, despesas por categoria, metas, projeções e últimos lançamentos.
Regras:
- Responda em português do Brasil, de forma direta e objetiva, como um planejador financeiro experiente. Use R$ com separador de milhar brasileiro.
- Baseie-se nos números do resumo; quando precisar calcular, mostre o cálculo em uma linha. Não invente dados que não estejam no resumo; se faltar informação, diga o que falta e onde cadastrar no app (Lançamentos, Projeções, Plano, Futuro, Patrimônio, Contas, Integrações, Cadastros).
- Aponte riscos e oportunidades concretas (gastos fora do padrão, comprometimento fixo alto, reserva de emergência, taxa de poupança, itens sem categoria).
- Formate com parágrafos curtos e, quando útil, listas ou uma pequena tabela em Markdown. Evite introduções e despedidas.
- Não dê recomendações de produtos financeiros específicos; fale em classes e princípios. Não é aconselhamento regulado.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY não configurada nos secrets do projeto (Edge Functions → Secrets)." }, 400);
    const model = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5";

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: u, error: eu } = await sb.auth.getUser();
    if (eu || !u.user) return json({ error: "Não autenticado" }, 401);

    const { workspace_id, mensagem } = await req.json();
    if (!workspace_id || !mensagem?.trim()) return json({ error: "workspace_id e mensagem são obrigatórios" }, 400);

    // Contexto (RLS: a função resumo_financeiro valida a associação ao workspace)
    const { data: resumo, error: er } = await sb.rpc("resumo_financeiro", { ws: workspace_id });
    if (er) return json({ error: `Sem acesso ao workspace: ${er.message}` }, 403);

    const { data: hist } = await sb.from("assistente_mensagens").select("papel, conteudo").eq("workspace_id", workspace_id).eq("user_id", u.user.id).order("created_at", { ascending: false }).limit(12);
    const historico = (hist ?? []).reverse().map((m) => ({ role: m.papel as "user" | "assistant", content: m.conteudo }));

    const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const messages = [
      ...historico,
      { role: "user", content: `Data de hoje: ${hoje}\n\nResumo financeiro (JSON):\n${JSON.stringify(resumo)}\n\nPergunta: ${mensagem}` },
    ];

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1500, system: SYSTEM, messages }),
    });
    if (!r.ok) {
      const t = await r.text();
      return json({ error: `Anthropic API ${r.status}: ${t.slice(0, 300)}` }, 502);
    }
    const data = await r.json();
    const resposta: string = (data.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("\n").trim() || "Não consegui gerar uma resposta.";

    await sb.from("assistente_mensagens").insert([
      { workspace_id, user_id: u.user.id, papel: "user", conteudo: mensagem },
      { workspace_id, user_id: u.user.id, papel: "assistant", conteudo: resposta },
    ]);
    return json({ resposta, model, usage: data.usage });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
