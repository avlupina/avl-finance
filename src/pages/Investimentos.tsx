import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, Empty, ErrorBox, Field, Kpi, Loading, Modal, PageHeader } from '../components/ui'
import { Rosca } from '../components/charts'
import { brl, downloadCSV, fmtDate, fmtDateTime, pct, TIPO_INV_LABEL } from '../lib/format'
import type { Investimento } from '../lib/types'

const emptyForm = () => ({ nome: '', tipo: 'renda_fixa', subtipo: '', instituicao: '', codigo: '', valor_aplicado: '', valor_atual: '', taxa: '', data_aplicacao: '', vencimento: '', liquidez: '' })

export default function Investimentos() {
  const { workspace, canEditModule } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('investimentos')
  const [modal, setModal] = useState<null | { id?: string; form: ReturnType<typeof emptyForm> }>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')

  const q = useQuery(async () => { const { data, error } = await supabase.from('investimentos').select('*').eq('workspace_id', ws).order('valor_atual', { ascending: false }); if (error) throw error; return data as Investimento[] }, [ws])
  const rows = useMemo(() => (q.data ?? []).filter(i => !filtro || i.tipo === filtro), [q.data, filtro])
  const tot = useMemo(() => rows.reduce((a, i) => ({ apl: a.apl + Number(i.valor_aplicado), atual: a.atual + Number(i.valor_atual) }), { apl: 0, atual: 0 }), [rows])
  const porTipo = useMemo(() => { const m: Record<string, number> = {}; for (const i of q.data ?? []) m[TIPO_INV_LABEL[i.tipo] ?? i.tipo] = (m[TIPO_INV_LABEL[i.tipo] ?? i.tipo] ?? 0) + Number(i.valor_atual); return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([nome, valor]) => ({ nome, valor })) }, [q.data])
  const porInst = useMemo(() => { const m: Record<string, number> = {}; for (const i of q.data ?? []) m[i.instituicao ?? 'Não informado'] = (m[i.instituicao ?? 'Não informado'] ?? 0) + Number(i.valor_atual); return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([nome, valor]) => ({ nome, valor })) }, [q.data])
  const liquidezCurta = useMemo(() => (q.data ?? []).filter(i => !i.vencimento || (new Date(i.vencimento).getTime() - Date.now()) < 1000 * 3600 * 24 * 30 || /d\+?0|di[aá]ria|imediata/i.test(i.liquidez ?? '')).reduce((a, i) => a + Number(i.valor_atual), 0), [q.data])

  const salvar = async (e: FormEvent) => {
    e.preventDefault(); if (!modal) return; setErr(null)
    const f = modal.form; const n = (s: string) => s ? Number(String(s).replace(',', '.')) : null
    const payload = { workspace_id: ws, nome: f.nome.trim(), tipo: f.tipo, subtipo: f.subtipo || null, instituicao: f.instituicao || null, codigo: f.codigo || null, valor_aplicado: n(f.valor_aplicado) ?? 0, valor_atual: n(f.valor_atual) ?? 0, taxa: f.taxa || null, data_aplicacao: f.data_aplicacao || null, vencimento: f.vencimento || null, liquidez: f.liquidez || null, rentabilidade_pct: n(f.valor_aplicado) ? ((n(f.valor_atual)! - n(f.valor_aplicado)!) / n(f.valor_aplicado)!) * 100 : null, atualizado_em: new Date().toISOString() }
    const r = modal.id ? await supabase.from('investimentos').update(payload).eq('id', modal.id) : await supabase.from('investimentos').insert(payload)
    if (r.error) { setErr(r.error.message); return }
    setModal(null); q.refetch()
  }
  const excluir = async (i: Investimento) => { if (!confirm(`Excluir "${i.nome}"?`)) return; const { error } = await supabase.from('investimentos').delete().eq('id', i.id); if (error) alert(error.message); else q.refetch() }

  return (
    <div>
      <PageHeader title="Investimentos" actions={<>
        <select className="input w-44" value={filtro} onChange={e => setFiltro(e.target.value)}><option value="">Todos os tipos</option>{Object.entries(TIPO_INV_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn" onClick={() => downloadCSV('investimentos.csv', rows.map(i => ({ nome: i.nome, tipo: TIPO_INV_LABEL[i.tipo], instituicao: i.instituicao ?? '', aplicado: Number(i.valor_aplicado).toFixed(2).replace('.', ','), atual: Number(i.valor_atual).toFixed(2).replace('.', ','), rentabilidade: i.rentabilidade_pct ?? '', vencimento: fmtDate(i.vencimento) })))}><Download size={16} /> Exportar</button>
        {podeEditar && <button className="btn btn-primary" onClick={() => setModal({ form: emptyForm() })}><Plus size={16} /> Novo investimento</button>}
      </>} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Patrimônio investido" value={brl(tot.atual)} tone="brand" />
        <Kpi label="Valor aplicado" value={brl(tot.apl)} />
        <Kpi label="Resultado acumulado" value={brl(tot.atual - tot.apl)} tone={tot.atual - tot.apl >= 0 ? 'pos' : 'neg'} sub={tot.apl ? pct(((tot.atual - tot.apl) / tot.apl) * 100, 2) : undefined} />
        <Kpi label="Liquidez em até 30 dias" value={brl(liquidezCurta)} sub="reserva disponível" />
      </div>

      {q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : !q.data?.length ? <Empty title="Nenhum investimento cadastrado" hint="Investimentos conectados via Open Finance aparecem aqui automaticamente. Você também pode cadastrar posições manualmente." /> : (
        <>
          <div className="grid lg:grid-cols-2 gap-4 mb-4">
            <div className="card p-4"><div className="font-black mb-2">Alocação por classe</div><Rosca data={porTipo} /></div>
            <div className="card p-4"><div className="font-black mb-2">Alocação por instituição</div><Rosca data={porInst} /></div>
          </div>
          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Ativo</th><th>Classe</th><th>Instituição</th><th className="text-right">Aplicado</th><th className="text-right">Atual</th><th className="text-right">Rent.</th><th>Vencimento</th><th>Atualizado</th>{podeEditar && <th></th>}</tr></thead>
              <tbody>{rows.map(i => (
                <tr key={i.id}>
                  <td><div className="font-bold">{i.nome}</div><div className="text-xs text-muted">{[i.codigo, i.subtipo, i.taxa].filter(Boolean).join(' · ')}</div></td>
                  <td><Badge tone="blue">{TIPO_INV_LABEL[i.tipo] ?? i.tipo}</Badge></td>
                  <td className="text-muted">{i.instituicao ?? '—'}</td>
                  <td className="text-right num">{brl(i.valor_aplicado)}</td>
                  <td className="text-right num font-bold">{brl(i.valor_atual)}</td>
                  <td className={`text-right num font-bold ${Number(i.rentabilidade_pct) < 0 ? 'text-neg' : 'text-pos'}`}>{pct(i.rentabilidade_pct, 2)}</td>
                  <td className="num">{fmtDate(i.vencimento)}</td>
                  <td className="text-xs text-muted whitespace-nowrap">{fmtDateTime(i.atualizado_em)}{i.integracao_id && <Badge tone="green">auto</Badge>}</td>
                  {podeEditar && <td className="text-right whitespace-nowrap">
                    <button className="btn btn-ghost p-1.5" onClick={() => setModal({ id: i.id, form: { nome: i.nome, tipo: i.tipo, subtipo: i.subtipo ?? '', instituicao: i.instituicao ?? '', codigo: i.codigo ?? '', valor_aplicado: String(i.valor_aplicado), valor_atual: String(i.valor_atual), taxa: i.taxa ?? '', data_aplicacao: i.data_aplicacao ?? '', vencimento: i.vencimento ?? '', liquidez: i.liquidez ?? '' } })}><Pencil size={15} /></button>
                    {!i.integracao_id && <button className="btn btn-ghost p-1.5 text-neg" onClick={() => excluir(i)}><Trash2 size={15} /></button>}
                  </td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Editar investimento' : 'Novo investimento'}>
        {modal && <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
          <Field label="Nome do ativo" className="col-span-2"><input className="input" required value={modal.form.nome} onChange={e => setModal({ ...modal, form: { ...modal.form, nome: e.target.value } })} /></Field>
          <Field label="Classe"><select className="input" value={modal.form.tipo} onChange={e => setModal({ ...modal, form: { ...modal.form, tipo: e.target.value } })}>{Object.entries(TIPO_INV_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Subtipo (CDB, LCI, FII, ação...)"><input className="input" value={modal.form.subtipo} onChange={e => setModal({ ...modal, form: { ...modal.form, subtipo: e.target.value } })} /></Field>
          <Field label="Instituição"><input className="input" value={modal.form.instituicao} onChange={e => setModal({ ...modal, form: { ...modal.form, instituicao: e.target.value } })} /></Field>
          <Field label="Código / ticker"><input className="input" value={modal.form.codigo} onChange={e => setModal({ ...modal, form: { ...modal.form, codigo: e.target.value } })} /></Field>
          <Field label="Valor aplicado"><input className="input num" value={modal.form.valor_aplicado} onChange={e => setModal({ ...modal, form: { ...modal.form, valor_aplicado: e.target.value } })} /></Field>
          <Field label="Valor atual"><input className="input num" required value={modal.form.valor_atual} onChange={e => setModal({ ...modal, form: { ...modal.form, valor_atual: e.target.value } })} /></Field>
          <Field label="Taxa (ex.: 110% CDI)"><input className="input" value={modal.form.taxa} onChange={e => setModal({ ...modal, form: { ...modal.form, taxa: e.target.value } })} /></Field>
          <Field label="Liquidez (ex.: D+0, no vencimento)"><input className="input" value={modal.form.liquidez} onChange={e => setModal({ ...modal, form: { ...modal.form, liquidez: e.target.value } })} /></Field>
          <Field label="Data de aplicação"><input type="date" className="input" value={modal.form.data_aplicacao} onChange={e => setModal({ ...modal, form: { ...modal.form, data_aplicacao: e.target.value } })} /></Field>
          <Field label="Vencimento"><input type="date" className="input" value={modal.form.vencimento} onChange={e => setModal({ ...modal, form: { ...modal.form, vencimento: e.target.value } })} /></Field>
          <div className="col-span-2"><ErrorBox msg={err} /></div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
        </form>}
      </Modal>
    </div>
  )
}
