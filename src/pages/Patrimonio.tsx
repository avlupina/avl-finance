import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Home, Car, Briefcase, Landmark, HandCoins, Package } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, Empty, ErrorBox, Field, Kpi, Loading, Modal, PageHeader } from '../components/ui'
import { Rosca } from '../components/charts'
import { brl, fmtDate, pct, todayISO } from '../lib/format'
import type { Patrimonio as Pat } from '../lib/types'

const CATS: { k: string; l: string; tipo: 'ativo' | 'passivo'; icon: typeof Home }[] = [
  { k: 'imovel', l: 'Imóvel', tipo: 'ativo', icon: Home }, { k: 'veiculo', l: 'Veículo', tipo: 'ativo', icon: Car }, { k: 'participacao', l: 'Participação societária', tipo: 'ativo', icon: Briefcase },
  { k: 'terra', l: 'Terra / área rural', tipo: 'ativo', icon: Landmark }, { k: 'outro_ativo', l: 'Outro ativo', tipo: 'ativo', icon: Package },
  { k: 'financiamento', l: 'Financiamento', tipo: 'passivo', icon: HandCoins }, { k: 'emprestimo', l: 'Empréstimo', tipo: 'passivo', icon: HandCoins }, { k: 'outro_passivo', l: 'Outro passivo', tipo: 'passivo', icon: HandCoins },
]
const emptyForm = () => ({ nome: '', tipo: 'ativo' as 'ativo' | 'passivo', categoria: 'imovel', valor: '', valor_aquisicao: '', data_aquisicao: '', data_referencia: todayISO(), descricao: '' })

export default function Patrimonio() {
  const { workspace, canEditModule } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('patrimonio')
  const [modal, setModal] = useState<null | { id?: string; form: ReturnType<typeof emptyForm> }>(null)
  const [err, setErr] = useState<string | null>(null)

  const q = useQuery(async () => {
    const [p, v] = await Promise.all([
      supabase.from('patrimonio').select('*').eq('workspace_id', ws).order('tipo').order('valor', { ascending: false }),
      supabase.from('v_patrimonio_liquido').select('*').eq('workspace_id', ws).maybeSingle(),
    ])
    if (p.error) throw p.error
    return { itens: p.data as Pat[], pos: (v.data ?? { saldo_contas: 0, faturas_cartao: 0, investimentos: 0, outros_ativos: 0, passivos: 0 }) as Record<string, number> }
  }, [ws])

  const pos = q.data?.pos
  const ativos = Number(pos?.saldo_contas ?? 0) + Number(pos?.investimentos ?? 0) + Number(pos?.outros_ativos ?? 0)
  const passivos = Number(pos?.passivos ?? 0) + Math.abs(Number(pos?.faturas_cartao ?? 0))
  const pl = ativos - passivos
  const composicao = useMemo(() => [
    { nome: 'Contas bancárias', valor: Number(pos?.saldo_contas ?? 0) }, { nome: 'Investimentos', valor: Number(pos?.investimentos ?? 0) },
    ...CATS.filter(c => c.tipo === 'ativo').map(c => ({ nome: c.l, valor: (q.data?.itens ?? []).filter(i => i.categoria === c.k).reduce((a, i) => a + Number(i.valor), 0) })),
  ].filter(x => x.valor > 0), [pos, q.data])

  const salvar = async (e: FormEvent) => {
    e.preventDefault(); if (!modal) return; setErr(null)
    const f = modal.form; const n = (s: string) => s ? Number(String(s).replace(',', '.')) : null
    const payload = { workspace_id: ws, nome: f.nome.trim(), tipo: CATS.find(c => c.k === f.categoria)?.tipo ?? f.tipo, categoria: f.categoria, valor: n(f.valor) ?? 0, valor_aquisicao: n(f.valor_aquisicao), data_aquisicao: f.data_aquisicao || null, data_referencia: f.data_referencia || todayISO(), descricao: f.descricao || null }
    const r = modal.id ? await supabase.from('patrimonio').update(payload).eq('id', modal.id) : await supabase.from('patrimonio').insert(payload)
    if (r.error) { setErr(r.error.message); return }
    setModal(null); q.refetch()
  }
  const excluir = async (i: Pat) => { if (!confirm(`Excluir "${i.nome}"?`)) return; const { error } = await supabase.from('patrimonio').delete().eq('id', i.id); if (error) alert(error.message); else q.refetch() }

  return (
    <div>
      <PageHeader title="Patrimônio" actions={podeEditar && <button className="btn btn-primary" onClick={() => setModal({ form: emptyForm() })}><Plus size={16} /> Cadastrar bem ou dívida</button>} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Patrimônio líquido" value={brl(pl)} tone={pl >= 0 ? 'brand' : 'neg'} />
        <Kpi label="Total de ativos" value={brl(ativos)} tone="pos" sub={`contas ${brl(pos?.saldo_contas ?? 0)} · invest. ${brl(pos?.investimentos ?? 0)}`} />
        <Kpi label="Total de passivos" value={brl(passivos)} tone="neg" sub={`inclui faturas de cartão ${brl(Math.abs(Number(pos?.faturas_cartao ?? 0)))}`} />
        <Kpi label="Endividamento" value={pct(ativos ? (passivos / ativos) * 100 : 0)} sub="passivos / ativos" />
      </div>

      {q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : (
        <div className="grid lg:grid-cols-[1fr_380px] gap-4">
          <div className="flex flex-col gap-4">
            {(['ativo', 'passivo'] as const).map(t => {
              const itens = (q.data?.itens ?? []).filter(i => i.tipo === t)
              return (
                <div key={t} className="card">
                  <div className="px-4 py-3 border-b border-line font-black flex items-center justify-between"><span>{t === 'ativo' ? 'Bens e direitos' : 'Dívidas e obrigações'}</span><span className={`num ${t === 'ativo' ? 'text-pos' : 'text-neg'}`}>{brl(itens.reduce((a, i) => a + Number(i.valor), 0))}</span></div>
                  {!itens.length ? <div className="p-4 text-sm text-muted">Nenhum item cadastrado.</div> : (
                    <table className="tbl"><thead><tr><th>Item</th><th>Categoria</th><th className="text-right">Valor atual</th><th className="text-right">Aquisição</th><th>Referência</th>{podeEditar && <th></th>}</tr></thead>
                      <tbody>{itens.map(i => { const c = CATS.find(x => x.k === i.categoria); const Icon = c?.icon ?? Package; return (
                        <tr key={i.id}>
                          <td><div className="flex items-center gap-2"><Icon size={16} className="text-brand" /><div><div className="font-bold">{i.nome}</div>{i.descricao && <div className="text-xs text-muted">{i.descricao}</div>}</div></div></td>
                          <td><Badge>{c?.l ?? i.categoria}</Badge></td>
                          <td className="text-right num font-bold">{brl(i.valor)}</td>
                          <td className="text-right num text-muted">{i.valor_aquisicao != null ? <>{brl(i.valor_aquisicao)}{Number(i.valor_aquisicao) ? <div className={`text-xs ${Number(i.valor) >= Number(i.valor_aquisicao) ? 'text-pos' : 'text-neg'}`}>{pct(((Number(i.valor) - Number(i.valor_aquisicao)) / Number(i.valor_aquisicao)) * 100)}</div> : null}</> : '—'}</td>
                          <td className="num text-muted">{fmtDate(i.data_referencia)}</td>
                          {podeEditar && <td className="text-right whitespace-nowrap"><button className="btn btn-ghost p-1.5" onClick={() => setModal({ id: i.id, form: { nome: i.nome, tipo: i.tipo, categoria: i.categoria, valor: String(i.valor), valor_aquisicao: i.valor_aquisicao != null ? String(i.valor_aquisicao) : '', data_aquisicao: i.data_aquisicao ?? '', data_referencia: i.data_referencia, descricao: i.descricao ?? '' } })}><Pencil size={15} /></button><button className="btn btn-ghost p-1.5 text-neg" onClick={() => excluir(i)}><Trash2 size={15} /></button></td>}
                        </tr>) })}</tbody></table>
                  )}
                </div>
              )
            })}
          </div>
          <div className="card p-4 self-start"><div className="font-black mb-2">Composição dos ativos</div>{composicao.length ? <Rosca data={composicao} height={200} /> : <Empty title="Sem ativos ainda" hint="Conecte contas ou cadastre bens." />}</div>
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Editar item' : 'Cadastrar bem ou dívida'}>
        {modal && <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
          <Field label="Categoria" className="col-span-2"><select className="input" value={modal.form.categoria} onChange={e => setModal({ ...modal, form: { ...modal.form, categoria: e.target.value } })}><optgroup label="Ativos">{CATS.filter(c => c.tipo === 'ativo').map(c => <option key={c.k} value={c.k}>{c.l}</option>)}</optgroup><optgroup label="Passivos">{CATS.filter(c => c.tipo === 'passivo').map(c => <option key={c.k} value={c.k}>{c.l}</option>)}</optgroup></select></Field>
          <Field label="Nome" className="col-span-2"><input className="input" required value={modal.form.nome} onChange={e => setModal({ ...modal, form: { ...modal.form, nome: e.target.value } })} /></Field>
          <Field label="Valor atual"><input className="input num" required value={modal.form.valor} onChange={e => setModal({ ...modal, form: { ...modal.form, valor: e.target.value } })} /></Field>
          <Field label="Data de referência"><input type="date" className="input" value={modal.form.data_referencia} onChange={e => setModal({ ...modal, form: { ...modal.form, data_referencia: e.target.value } })} /></Field>
          <Field label="Valor de aquisição"><input className="input num" value={modal.form.valor_aquisicao} onChange={e => setModal({ ...modal, form: { ...modal.form, valor_aquisicao: e.target.value } })} /></Field>
          <Field label="Data de aquisição"><input type="date" className="input" value={modal.form.data_aquisicao} onChange={e => setModal({ ...modal, form: { ...modal.form, data_aquisicao: e.target.value } })} /></Field>
          <Field label="Descrição" className="col-span-2"><textarea className="input" rows={2} value={modal.form.descricao} onChange={e => setModal({ ...modal, form: { ...modal.form, descricao: e.target.value } })} /></Field>
          <div className="col-span-2"><ErrorBox msg={err} /></div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
        </form>}
      </Modal>
    </div>
  )
}
