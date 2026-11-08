import { useState } from 'react'
import { Plug, RefreshCw, Trash2, ShieldCheck, Landmark, AlertTriangle, CheckCircle2, Clock, Info } from 'lucide-react'
import { supabase, callFunction, FUNCTIONS_URL } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, Empty, ErrorBox, Loading, PageHeader } from '../components/ui'
import { fmtDateTime } from '../lib/format'
import type { Integracao } from '../lib/types'

declare global { interface Window { PluggyConnect?: new (opts: Record<string, unknown>) => { init: () => void } } }

const PLUGGY_SCRIPT = 'https://cdn.pluggy.ai/pluggy-connect/v2.9.1/pluggy-connect.js'
function loadPluggy(): Promise<void> {
  return new Promise((res, rej) => {
    if (window.PluggyConnect) return res()
    const s = document.createElement('script'); s.src = PLUGGY_SCRIPT; s.async = true
    s.onload = () => res(); s.onerror = () => rej(new Error('Não foi possível carregar o widget da Pluggy.'))
    document.head.appendChild(s)
  })
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
    const [i, l] = await Promise.all([
      supabase.from('integracoes').select('*').eq('workspace_id', ws).order('created_at', { ascending: false }),
      supabase.from('sync_logs').select('*').eq('workspace_id', ws).order('iniciado_em', { ascending: false }).limit(15),
    ])
    if (i.error) throw i.error
    return { integ: i.data as Integracao[], logs: (l.data ?? []) as { id: string; integracao_id: string; iniciado_em: string; finalizado_em: string | null; status: string; resumo: Record<string, unknown> }[] }
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
            const r = await callFunction<{ resumo: Record<string, number> }>('pluggy-sync', { workspace_id: ws, item_id: data.item.id, integracao_id: integracaoId })
            setMsg(`Importação concluída: ${r.resumo.contas} conta(s), ${r.resumo.lancamentos} lançamento(s), ${r.resumo.investimentos} investimento(s).`)
          } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
          q.refetch(); setBusy(null)
        },
        onError: (e: { message?: string }) => { setErr(e?.message ?? 'Erro no widget de conexão.'); setBusy(null) },
        onClose: () => setBusy(null),
      })
      widget.init()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(null) }
  }

  const sincronizar = async (i: Integracao) => {
    if (!i.external_item_id) return
    setBusy(i.id); setErr(null); setMsg(null)
    try {
      const r = await callFunction<{ resumo: Record<string, number> }>('pluggy-sync', { workspace_id: ws, item_id: i.external_item_id, integracao_id: i.id })
      setMsg(`Sincronizado: ${r.resumo.contas} conta(s), ${r.resumo.lancamentos} lançamento(s), ${r.resumo.investimentos} investimento(s).`)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null); q.refetch() }
  }

  const remover = async (i: Integracao) => {
    if (!confirm(`Remover a conexão com ${i.connector_nome ?? 'a instituição'}? As contas importadas permanecem, mas deixam de atualizar.`)) return
    await supabase.from('contas').update({ integracao_id: null }).eq('integracao_id', i.id)
    await supabase.from('integracoes').delete().eq('id', i.id)
    q.refetch()
  }

  return (
    <div>
      <PageHeader title="Integrações" actions={podeEditar && <button className="btn btn-primary" onClick={() => conectar()} disabled={busy === 'novo'}><Plug size={16} /> Conectar instituição</button>} />

      <div className="grid lg:grid-cols-[1fr_340px] gap-5">
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
                    {i.erro && <div className="text-xs text-neg bg-red-50 rounded-md px-2 py-1">{i.erro}</div>}
                    <div className="text-xs text-muted">Última sincronização: <b>{fmtDateTime(i.ultima_sincronizacao)}</b></div>
                    {podeEditar && <div className="flex gap-2 border-t border-line pt-3">
                      <button className="btn flex-1 justify-center" onClick={() => sincronizar(i)} disabled={busy === i.id}><RefreshCw size={14} className={busy === i.id ? 'animate-spin' : ''} /> Sincronizar</button>
                      <button className="btn" title="Reautorizar consentimento" onClick={() => conectar(i.external_item_id ?? undefined, i.id)}><ShieldCheck size={14} /></button>
                      <button className="btn btn-danger" title="Remover conexão" onClick={() => remover(i)}><Trash2 size={14} /></button>
                    </div>}
                  </div>
                )
              })}
            </div>
          )}

          {!!q.data?.logs.length && (
            <div className="card">
              <div className="px-4 py-3 border-b border-line font-black">Histórico de sincronizações</div>
              <table className="tbl">
                <thead><tr><th>Início</th><th>Instituição</th><th>Status</th><th>Resumo</th></tr></thead>
                <tbody>{q.data.logs.map(l => {
                  const i = q.data!.integ.find(x => x.id === l.integracao_id)
                  const r = l.resumo ?? {}
                  return <tr key={l.id}><td className="num whitespace-nowrap">{fmtDateTime(l.iniciado_em)}</td><td>{i?.connector_nome ?? '—'}</td><td><Badge tone={l.status === 'ok' ? 'green' : l.status === 'erro' ? 'red' : 'blue'}>{l.status}</Badge></td><td className="text-xs text-muted">{r.erro ? String(r.erro) : `${r.contas ?? 0} contas · ${r.lancamentos ?? 0} lançamentos · ${r.investimentos ?? 0} investimentos`}</td></tr>
                })}</tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <div className="card p-4">
            <div className="font-black mb-2 flex items-center gap-2"><ShieldCheck size={18} className="text-brand" /> Como funciona</div>
            <ol className="text-sm text-ink/80 flex flex-col gap-2 list-decimal pl-5">
              <li><b>Consentimento:</b> ao clicar em Conectar, abre-se a interface segura do agregador (Pluggy). Você faz login na instituição e autoriza o compartilhamento — suas credenciais nunca passam pelo AVL Finance.</li>
              <li><b>Coleta:</b> o agregador consulta a API oficial de Open Finance (ex.: Banco do Brasil PF) e devolve saldo, extrato e investimentos em JSON.</li>
              <li><b>Integração:</b> as Edge Functions gravam contas, lançamentos e investimentos no seu workspace, sem duplicar registros.</li>
              <li><b>Atualização:</b> o webhook da Pluggy dispara nova sincronização a cada atualização do item; você também pode sincronizar manualmente.</li>
            </ol>
          </div>
          <div className="card p-4 text-sm">
            <div className="font-black mb-2">Configuração do ambiente</div>
            <p className="text-muted mb-2">No painel do Supabase (Edge Functions → Secrets), defina:</p>
            <ul className="font-mono text-xs bg-surface rounded-lg p-3 flex flex-col gap-1">
              <li>PLUGGY_CLIENT_ID</li><li>PLUGGY_CLIENT_SECRET</li><li className="text-muted">PLUGGY_WEBHOOK_SECRET (opcional)</li>
            </ul>
            <p className="text-muted mt-3">URL do webhook para cadastrar na Pluggy:</p>
            <code className="block text-xs bg-surface rounded-lg p-2 mt-1 break-all">{FUNCTIONS_URL}/pluggy-webhook</code>
            <p className="text-muted mt-3 text-xs">A Belvo pode ser adicionada como segundo provedor: a tabela <code>integracoes.provedor</code> e as funções já estão preparadas para isso.</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
