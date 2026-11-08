import { useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, RefreshCw, Wallet, CreditCard, PiggyBank, Landmark, Link2 } from 'lucide-react'
import { supabase, callFunction } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, Empty, ErrorBox, Field, Kpi, Loading, Modal, PageHeader } from '../components/ui'
import { brl, fmtDateTime, TIPO_CONTA_LABEL } from '../lib/format'
import type { Banco, Conta, Integracao } from '../lib/types'
import { Link } from 'react-router-dom'

const ICON: Record<string, typeof Wallet> = { corrente: Landmark, poupanca: PiggyBank, cartao_credito: CreditCard, investimento: Landmark, dinheiro: Wallet, outro: Wallet }
const emptyForm = () => ({ nome: '', tipo: 'corrente' as Conta['tipo'], banco_id: '', agencia: '', numero: '', saldo_atual: '0', limite: '', fechamento_fatura: '', vencimento_fatura: '', ativa: true })

export default function Contas() {
  const { workspace, canEditModule } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('contas')
  const [modal, setModal] = useState<null | { id?: string; form: ReturnType<typeof emptyForm> }>(null)
  const [err, setErr] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [mostrarInativas, setMostrarInativas] = useState(false)

  const q = useQuery(async () => {
    const [c, b, i] = await Promise.all([
      supabase.from('contas').select('*, bancos(*)').eq('workspace_id', ws).order('tipo').order('nome'),
      supabase.from('bancos').select('*').eq('workspace_id', ws).eq('ativo', true).order('nome'),
      supabase.from('integracoes').select('*').eq('workspace_id', ws),
    ])
    if (c.error) throw c.error
    return { contas: c.data as Conta[], bancos: (b.data ?? []) as Banco[], integ: (i.data ?? []) as Integracao[] }
  }, [ws])

  const contas = (q.data?.contas ?? []).filter(c => mostrarInativas || c.ativa)
  const saldo = contas.filter(c => c.ativa && c.tipo !== 'cartao_credito').reduce((a, c) => a + Number(c.saldo_atual), 0)
  const faturas = contas.filter(c => c.ativa && c.tipo === 'cartao_credito').reduce((a, c) => a + Number(c.saldo_atual), 0)
  const conectadas = contas.filter(c => c.integracao_id).length

  const salvar = async (e: FormEvent) => {
    e.preventDefault(); if (!modal) return; setErr(null)
    const f = modal.form
    const payload = {
      workspace_id: ws, nome: f.nome.trim(), tipo: f.tipo, banco_id: f.banco_id || null, agencia: f.agencia || null, numero: f.numero || null,
      saldo_atual: Number(String(f.saldo_atual).replace(',', '.')) || 0, limite: f.limite ? Number(String(f.limite).replace(',', '.')) : null,
      fechamento_fatura: f.fechamento_fatura ? Number(f.fechamento_fatura) : null, vencimento_fatura: f.vencimento_fatura ? Number(f.vencimento_fatura) : null, ativa: f.ativa,
    }
    const r = modal.id ? await supabase.from('contas').update(payload).eq('id', modal.id) : await supabase.from('contas').insert(payload)
    if (r.error) { setErr(r.error.message); return }
    setModal(null); q.refetch()
  }

  const excluir = async (c: Conta) => {
    if (!confirm(`Excluir a conta "${c.nome}"? Os lançamentos ficarão sem conta.`)) return
    const { error } = await supabase.from('contas').delete().eq('id', c.id)
    if (error) alert(error.message); else q.refetch()
  }

  const sincronizar = async (c: Conta) => {
    const integ = q.data?.integ.find(i => i.id === c.integracao_id)
    if (!integ?.external_item_id) return
    setSyncing(c.id)
    try { const from = new Date(); from.setMonth(from.getMonth() - 24); await callFunction('pluggy-sync', { workspace_id: ws, item_id: integ.external_item_id, integracao_id: integ.id, from: from.toISOString().slice(0, 10) }); q.refetch() }
    catch (e) { alert(e instanceof Error ? e.message : String(e)) } finally { setSyncing(null) }
  }

  return (
    <div>
      <PageHeader title="Contas" actions={<>
        <label className="text-sm flex items-center gap-2 text-muted"><input type="checkbox" checked={mostrarInativas} onChange={e => setMostrarInativas(e.target.checked)} /> Mostrar inativas</label>
        <Link to="/integracoes" className="btn"><Link2 size={16} /> Conectar banco</Link>
        {podeEditar && <button className="btn btn-primary" onClick={() => setModal({ form: emptyForm() })}><Plus size={16} /> Nova conta manual</button>}
      </>} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Saldo em contas" value={brl(saldo)} tone="brand" />
        <Kpi label="Faturas em aberto" value={brl(Math.abs(faturas))} tone="neg" />
        <Kpi label="Posição líquida" value={brl(saldo + faturas)} tone={saldo + faturas >= 0 ? 'pos' : 'neg'} />
        <Kpi label="Contas conectadas" value={`${conectadas}/${contas.length}`} sub="via Open Finance" />
      </div>

      {q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : !contas.length ? (
        <Empty title="Nenhuma conta cadastrada" hint="Conecte seu banco via Open Finance em Integrações para trazer contas e saldos atualizados automaticamente, ou cadastre uma conta manual." />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {contas.map(c => {
            const Icon = ICON[c.tipo] ?? Wallet
            const cor = c.bancos?.cor ?? '#104862'
            const integ = q.data?.integ.find(i => i.id === c.integracao_id)
            return (
              <div key={c.id} className={`card p-4 flex flex-col gap-3 ${!c.ativa ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0" style={{ background: cor }}><Icon size={20} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="font-black truncate">{c.nome}</div>
                    <div className="text-xs text-muted truncate">{c.bancos?.nome ?? 'Sem banco'} · {TIPO_CONTA_LABEL[c.tipo]}{c.agencia ? ` · Ag ${c.agencia}` : ''}{c.numero ? ` · ${c.numero}` : ''}</div>
                  </div>
                  {c.integracao_id ? <Badge tone={integ?.status === 'erro' ? 'red' : 'green'}>{integ?.status === 'erro' ? 'erro' : 'conectada'}</Badge> : <Badge>manual</Badge>}
                </div>
                <div>
                  <div className="text-xs text-muted uppercase font-bold">{c.tipo === 'cartao_credito' ? 'Fatura atual' : 'Saldo atual'}</div>
                  <div className={`text-2xl font-black num ${Number(c.saldo_atual) < 0 ? 'text-neg' : ''}`}>{brl(Math.abs(Number(c.saldo_atual)))}</div>
                  {c.tipo === 'cartao_credito' && c.limite != null && <div className="text-xs text-muted">Limite {brl(c.limite)}{c.vencimento_fatura ? ` · vence dia ${c.vencimento_fatura}` : ''}</div>}
                </div>
                <div className="flex items-center justify-between text-xs text-muted border-t border-line pt-2">
                  <span>{c.ultima_sincronizacao ? `Atualizado ${fmtDateTime(c.ultima_sincronizacao)}` : 'Saldo informado manualmente'}</span>
                  <div className="flex gap-1 no-print">
                    {c.integracao_id && podeEditar && <button className="btn btn-ghost p-1.5" title="Sincronizar agora" onClick={() => sincronizar(c)} disabled={syncing === c.id}><RefreshCw size={14} className={syncing === c.id ? 'animate-spin' : ''} /></button>}
                    {podeEditar && <button className="btn btn-ghost p-1.5" title="Editar" onClick={() => setModal({ id: c.id, form: { nome: c.nome, tipo: c.tipo, banco_id: c.banco_id ?? '', agencia: c.agencia ?? '', numero: c.numero ?? '', saldo_atual: String(c.saldo_atual), limite: c.limite != null ? String(c.limite) : '', fechamento_fatura: c.fechamento_fatura ? String(c.fechamento_fatura) : '', vencimento_fatura: c.vencimento_fatura ? String(c.vencimento_fatura) : '', ativa: c.ativa } })}><Pencil size={14} /></button>}
                    {podeEditar && !c.integracao_id && <button className="btn btn-ghost p-1.5 text-neg" title="Excluir" onClick={() => excluir(c)}><Trash2 size={14} /></button>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Editar conta' : 'Nova conta manual'}>
        {modal && <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
          <Field label="Nome da conta" className="col-span-2"><input className="input" required value={modal.form.nome} onChange={e => setModal({ ...modal, form: { ...modal.form, nome: e.target.value } })} /></Field>
          <Field label="Tipo"><select className="input" value={modal.form.tipo} onChange={e => setModal({ ...modal, form: { ...modal.form, tipo: e.target.value as Conta['tipo'] } })}>{Object.entries(TIPO_CONTA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Banco"><select className="input" value={modal.form.banco_id} onChange={e => setModal({ ...modal, form: { ...modal.form, banco_id: e.target.value } })}><option value="">—</option>{q.data?.bancos.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}</select></Field>
          <Field label="Agência"><input className="input" value={modal.form.agencia} onChange={e => setModal({ ...modal, form: { ...modal.form, agencia: e.target.value } })} /></Field>
          <Field label="Número"><input className="input" value={modal.form.numero} onChange={e => setModal({ ...modal, form: { ...modal.form, numero: e.target.value } })} /></Field>
          <Field label={modal.form.tipo === 'cartao_credito' ? 'Fatura atual (negativo)' : 'Saldo atual'}><input className="input num" value={modal.form.saldo_atual} onChange={e => setModal({ ...modal, form: { ...modal.form, saldo_atual: e.target.value } })} /></Field>
          {modal.form.tipo === 'cartao_credito' && <>
            <Field label="Limite"><input className="input num" value={modal.form.limite} onChange={e => setModal({ ...modal, form: { ...modal.form, limite: e.target.value } })} /></Field>
            <Field label="Dia de fechamento"><input className="input" type="number" min={1} max={31} value={modal.form.fechamento_fatura} onChange={e => setModal({ ...modal, form: { ...modal.form, fechamento_fatura: e.target.value } })} /></Field>
            <Field label="Dia de vencimento"><input className="input" type="number" min={1} max={31} value={modal.form.vencimento_fatura} onChange={e => setModal({ ...modal, form: { ...modal.form, vencimento_fatura: e.target.value } })} /></Field>
          </>}
          <label className="col-span-2 text-sm flex items-center gap-2"><input type="checkbox" checked={modal.form.ativa} onChange={e => setModal({ ...modal, form: { ...modal.form, ativa: e.target.checked } })} /> Conta ativa</label>
          <div className="col-span-2"><ErrorBox msg={err} /></div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
        </form>}
      </Modal>
    </div>
  )
}
