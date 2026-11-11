import { useState } from 'react'
import { Plug, RefreshCw, Trash2, ShieldCheck, Landmark, AlertTriangle, CheckCircle2, Clock, Info } from 'lucide-react'
import { supabase, callFunction } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, Empty, ErrorBox, Loading, PageHeader } from '../components/ui'
import { avisoAmigavel, fmtDateTime } from '../lib/format'
import type { Integracao } from '../lib/types'

declare global { interface Window { PluggyConnect?: new (opts: Record<string, unknown>) => { init: () => void } } }

// O CDN da Pluggy publica o widget em /latest (URLs versionadas podem retornar 404)
const PLUGGY_SCRIPTS = [
  'https://cdn.pluggy.ai/pluggy-connect/latest/pluggy-connect.js',
  'https://cdn.pluggy.ai/pluggy-connect/v2.8.2/pluggy-connect.js',
]
function loadScript(src: string) {
  return new Promise<void>((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true
    s.onload = () => res(); s.onerror = () => { s.remove(); rej(new Error(src)) }
    document.head.appendChild(s)
  })
}
async function loadPluggy(): Promise<void> {
  if (window.PluggyConnect) return
  for (const src of PLUGGY_SCRIPTS) {
    try { await loadScript(src); if (window.PluggyConnect) return } catch { /* tenta o próximo */ }
  }
  throw new Error('Não foi possível carregar o widget da Pluggy (verifique bloqueadores de script/adblock).')
}

const STATUS: Record<string, { label: string; tone: 'green' | 'red' | 'amber' | 'blue' | 'gray'; icon: typeof Info }> = {
  conectado: { label: 'Conectado', tone: 'green', icon: CheckCircle2 },
  atualizando: { label: 'Atualizando', tone: 'blue', icon: RefreshCw },
  pendente: { label: 'Pendente', tone: 'amber', icon: Clock },
  erro: { label: 'Erro', tone: 'red', icon: AlertTriangle },
  desconectado: { label: 'Desconectado', tone: 'gray', icon: Plug },
}

export default function Integracoes() {
  const { workspace, canEditModule } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('integracoes')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const q = useQuery(async () => {
    const i = await supabase.from('integracoes').select('*').eq('workspace_id', ws).order('created_at', { ascending: false })
    if (i.error) throw i.error
    return { integ: i.data as Integracao[] }
  }, [ws])

  const conectar = async (itemId?: string, integracaoId?: string) => {
    setErr(null); setMsg(null); setBusy(itemId ?? 'novo')
    try {
      const { accessToken } = await callFunction<{ accessToken: string }>('pluggy-connect-token', { workspace_id: ws, item_id: itemId })
      await loadPluggy()
      const widget = new window.PluggyConnect!({
        connectToken: accessToken,
        includeSandbox: import.meta.env.VITE_PLUGGY_SANDBOX === 'true',
        updateItem: itemId,
        language: 'pt',
        onSuccess: async (data: { item: { id: string; connector?: { name: string } } }) => {
          setMsg(`Consentimento concluído com ${data.item.connector?.name ?? 'a instituição'}. Importando dados...`)
          try {
            const from = new Date(); from.setMonth(from.getMonth() - 24)
            const r = await callFunction<{ resumo: Record<string, number> }>('pluggy-sync', { workspace_id: ws, item_id: data.item.id, integracao_id: integracaoId, from: from.toISOString().slice(0, 10) })
            setMsg(`Importação concluída: ${r.resumo.contas} conta(s), ${r.resumo.lancamentos} lançamento(s), ${r.resumo.investimentos} investimento(s).`)
          } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
          q.refetch(); setBusy(null)
        },
        onError: (e: { message?: string; data?: { item?: { error?: { message?: string } } } }) => { setErr(e?.data?.item?.error?.message ?? e?.message ?? 'Erro no widget de conexão.'); setBusy(null) },
        onClose: () => setBusy(null),
      })
      widget.init()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(null) }
  }

  const sincronizar = async (i: Integracao) => {
    if (!i.external_item_id) return
    setBusy(i.id); setErr(null); setMsg(null)
    try {
      const from = new Date(); from.setMonth(from.getMonth() - 24)
      const r = await callFunction<{ resumo: Record<string, number>; aviso?: string; item_updated_at?: string | null }>('pluggy-sync', { workspace_id: ws, item_id: i.external_item_id, integracao_id: i.id, from: from.toISOString().slice(0, 10), forcar: true })
      await supabase.from('contas').update({ ativa: true }).eq('integracao_id', i.id)
      setMsg(`Sincronizado: ${r.resumo.contas} conta(s), ${r.resumo.lancamentos} lançamento(s), ${r.resumo.investimentos} investimento(s).${r.item_updated_at ? ` Dados do banco de ${new Date(r.item_updated_at).toLocaleString('pt-BR')}.` : ''}${r.aviso ? ` ${avisoAmigavel(r.aviso)}` : ''}`)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null); q.refetch() }
  }

  const remover = async (i: Integracao) => {
    if (!confirm(`Desconectar ${i.connector_nome ?? 'a instituição'}? As contas e lançamentos importados são mantidos (contas ficam inativas) e a conexão para de atualizar. Para reativar, basta reconectar — nada é duplicado.`)) return
    await supabase.from('contas').update({ ativa: false }).eq('integracao_id', i.id)
    await supabase.from('integracoes').update({ status: 'desconectado' }).eq('id', i.id)
    q.refetch()
  }

  return (
    <div>
      <PageHeader title="Integrações" actions={podeEditar && <button className="btn btn-primary" onClick={() => conectar()} disabled={busy === 'novo'}><Plug size={16} /> Conectar instituição</button>} />

      <div className="grid gap-5">
        <div className="flex flex-col gap-4">
          <ErrorBox msg={err} />
          {msg && <div className="rounded-lg border border-green-200 bg-green-50 text-green-800 px-3 py-2 text-sm">{msg}</div>}

          {q.loading ? <Loading /> : !q.data?.integ.length ? (
            <Empty title="Nenhuma instituição conectada" hint="Conecte seu banco via Open Finance. Você faz o login e autoriza o compartilhamento diretamente na interface segura da instituição; o AVL Finance recebe apenas os dados estruturados (saldos, extratos e investimentos)." action={podeEditar && <button className="btn btn-primary" onClick={() => conectar()}><Plug size={16} /> Conectar instituição</button>} />
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {q.data.integ.map(i => {
                const st = STATUS[i.status] ?? STATUS.pendente
                return (
                  <div key={i.id} className="card p-4 flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-11 h-11 rounded-xl bg-brand-soft text-brand flex items-center justify-center shrink-0"><Landmark size={20} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="font-black truncate">{i.connector_nome ?? 'Instituição'}</div>
                        <div className="text-xs text-muted">via {i.provedor} · Open Finance</div>
                      </div>
                      <Badge tone={st.tone}><st.icon size={12} /> {st.label}</Badge>
                    </div>
                    {i.erro && <div className={`text-xs rounded-md px-2 py-1 ${i.status === 'erro' ? 'text-neg bg-red-50' : 'text-amber-800 bg-amber-50'}`}>{avisoAmigavel(i.erro)}</div>}
                    <div className="text-xs text-muted">Última cópia: <b>{fmtDateTime(i.ultima_sincronizacao)}</b>{(i as Integracao & { dados?: { item_updated_at?: string } }).dados?.item_updated_at && <> · Dado do banco de <b>{fmtDateTime((i as Integracao & { dados?: { item_updated_at?: string } }).dados!.item_updated_at!)}</b></>}</div>
                    {podeEditar && <div className="flex gap-2 border-t border-line pt-3">
                      <button className="btn flex-1 justify-center" onClick={() => sincronizar(i)} disabled={busy === i.id} title="Importa/atualiza os últimos 24 meses"><RefreshCw size={14} className={busy === i.id ? 'animate-spin' : ''} /> Sincronizar</button>
                      <button className="btn" title="Reautorizar consentimento" onClick={() => conectar(i.external_item_id ?? undefined, i.id)}><ShieldCheck size={14} /></button>
                      <button className="btn btn-danger" title="Desconectar" onClick={() => remover(i)}><Trash2 size={14} /></button>
                    </div>}
                  </div>
                )
              })}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
