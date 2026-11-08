import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Download, PiggyBank, Star, Sunrise } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader } from '../components/ui'
import { Rosca } from '../components/charts'
import { brl, downloadCSV, firstDayOfMonth, fmtDate, fmtDateTime, pct, TIPO_INV_LABEL } from '../lib/format'
import { useResumo } from '../hooks/useResumo'
import type { Investimento } from '../lib/types'

const emptyForm = () => ({ nome: '', tipo: 'renda_fixa', subtipo: '', instituicao: '', codigo: '', valor_aplicado: '', valor_atual: '', taxa: '', data_aplicacao: '', vencimento: '', liquidez: '', objetivo: '' })
const OBJ_LABEL: Record<string, string> = { reserva: 'Reserva de emergência', curto: 'Curto prazo (1–2 anos)', medio: 'Médio prazo (3–4 anos)', longo: 'Longo prazo (5+ anos)', independencia: 'Independência financeira' }

export default function Investimentos() {
  const { workspace, canEditModule, updateConfig } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('investimentos')
  const resumo = useResumo()
  const [modal, setModal] = useState<null | { id?: string; form: ReturnType<typeof emptyForm> }>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')

  const q = useQuery(async () => { const { data, error } = await supabase.from('investimentos').select('*').eq('workspace_id', ws).order('valor_atual', { ascending: false }); if (error) throw error; return data as Investimento[] }, [ws])
  const mesQ = useQuery(async () => {
    const { data } = await supabase.from('lancamentos').select('valor, tipo, plano_contas!inner(tipo)').eq('workspace_id', ws).gte('data', firstDayOfMonth()).eq('plano_contas.tipo', 'investimento').neq('status', 'pendente')
    return ((data ?? []) as unknown as { valor: number; tipo: string }[]).reduce((a, l) => a + (l.tipo === 'receita' ? -Number(l.valor) : Number(l.valor)), 0)
  }, [ws])
  const metaMensal = (resumo.r?.config.meta_investimento_mensal ?? resumo.r?.config.investimento_mensal ?? 0)
  const investidoMes = mesQ.data ?? 0
  const porObjetivo = useMemo(() => { const m: Record<string, number> = { reserva: 0, curto: 0, medio: 0, longo: 0, independencia: 0, sem: 0 }; for (const i of q.data ?? []) m[i.objetivo ?? 'sem'] += Number(i.valor_atual); return m }, [q.data])
  const reservaIdeal = (resumo.r?.media.desp ?? 0) * (resumo.r?.config.reserva_meses ?? 6)
  const metasQ = useQuery(async () => { const { data } = await supabase.from('metas').select('prazo, valor_alvo, aporte_mensal, ativo').eq('workspace_id', ws).eq('ativo', true); return (data ?? []) as { prazo: string | null; valor_alvo: number; aporte_mensal: number | null }[] }, [ws])
  const alvoPrazo = (p: string) => (metasQ.data ?? []).filter(m => m.prazo === p).reduce((a, m) => a + Number(m.valor_alvo), 0)
  const aportePrazo = (p: string) => (metasQ.data ?? []).filter(m => m.prazo === p).reduce((a, m) => a + Number(m.aporte_mensal ?? 0), 0)
  const necessarioIF = resumo.r?.necessarioIF ?? 0
  const setObjetivo = async (i: Investimento, objetivo: string) => { await supabase.from('investimentos').update({ objetivo: objetivo || null }).eq('id', i.id); q.refetch() }
  const rows = useMemo(() => (q.data ?? []).filter(i => !filtro || i.tipo === filtro), [q.data, filtro])
  const tot = useMemo(() => rows.reduce((a, i) => ({ apl: a.apl + Number(i.valor_aplicado), atual: a.atual + Number(i.valor_atual) }), { apl: 0, atual: 0 }), [rows])
  const porTipo = useMemo(() => { const m: Record<string, number> = {}; for (const i of q.data ?? []) m[TIPO_INV_LABEL[i.tipo] ?? i.tipo] = (m[TIPO_INV_LABEL[i.tipo] ?? i.tipo] ?? 0) + Number(i.valor_atual); return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([nome, valor]) => ({ nome, valor })) }, [q.data])
  const porInst = useMemo(() => { const m: Record<string, number> = {}; for (const i of q.data ?? []) m[i.instituicao ?? 'Não informado'] = (m[i.instituicao ?? 'Não informado'] ?? 0) + Number(i.valor_atual); return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([nome, valor]) => ({ nome, valor })) }, [q.data])
  const liquidezCurta = useMemo(() => (q.data ?? []).filter(i => !i.vencimento || (new Date(i.vencimento).getTime() - Date.now()) < 1000 * 3600 * 24 * 30 || /d\+?0|di[aá]ria|imediata/i.test(i.liquidez ?? '')).reduce((a, i) => a + Number(i.valor_atual), 0), [q.data])

  const salvar = async (e: FormEvent) => {
    e.preventDefault(); if (!modal) return; setErr(null)
    const f = modal.form; const n = (s: string) => s ? Number(String(s).replace(',', '.')) : null
    const payload = { workspace_id: ws, nome: f.nome.trim(), tipo: f.tipo, subtipo: f.subtipo || null, instituicao: f.instituicao || null, codigo: f.codigo || null, valor_aplicado: n(f.valor_aplicado) ?? 0, valor_atual: n(f.valor_atual) ?? 0, taxa: f.taxa || null, data_aplicacao: f.data_aplicacao || null, vencimento: f.vencimento || null, liquidez: f.liquidez || null, objetivo: f.objetivo || null, rentabilidade_pct: n(f.valor_aplicado) ? ((n(f.valor_atual)! - n(f.valor_aplicado)!) / n(f.valor_aplicado)!) * 100 : null, atualizado_em: new Date().toISOString() }
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

      <div className="grid lg:grid-cols-[1fr_380px] gap-4 mb-5 items-start">
        <div className="flex gap-8 flex-wrap">
          <div><div className="text-xs text-muted font-bold uppercase">Investimentos totais</div><div className="text-2xl font-black num">{brl(tot.atual)}</div><div className="text-xs text-muted">aplicado {brl(tot.apl)} · resultado <span className={tot.atual - tot.apl >= 0 ? 'text-pos' : 'text-neg'}>{brl(tot.atual - tot.apl)} ({tot.apl ? pct((tot.atual - tot.apl) / tot.apl * 100, 2) : '—'})</span></div></div>
          <div><div className="text-xs text-muted font-bold uppercase">Meta de investimento mensal</div>{podeEditar ? <input className="text-2xl font-black num text-pos bg-transparent outline-none w-44 border-b border-dashed border-line focus:border-brand" defaultValue={metaMensal} key={metaMensal} onBlur={e => { const v = Number(e.target.value.replace(/\./g, '').replace(',', '.')); if (!isNaN(v) && v !== metaMensal) updateConfig({ meta_investimento_mensal: v }) }} /> : <div className="text-2xl font-black num text-pos">{brl(metaMensal)}</div>}<div className="text-xs text-muted">edite o valor · referência: capacidade de poupança {brl((resumo.r?.media.rec ?? 0) - (resumo.r?.media.desp ?? 0))}</div></div>
          <div><div className="text-xs text-muted font-bold uppercase">Liquidez em até 30 dias</div><div className="text-2xl font-black num">{brl(liquidezCurta)}</div></div>
        </div>
        <div className="card p-4">
          <div className="flex justify-between text-sm"><span className="text-muted">Investimentos no mês</span><span className="text-muted">Meta: <b className="text-ink num">{brl(metaMensal)}</b></span></div>
          <div className="text-2xl font-black num">{brl(investidoMes)}</div>
          <div className="h-2 rounded-full bg-surface overflow-hidden mt-2"><div className="h-full bg-brand" style={{ width: `${metaMensal ? Math.min(100, investidoMes / metaMensal * 100) : 0}%` }} /></div>
          <div className="flex justify-between text-xs text-muted mt-1"><span>{metaMensal ? pct(investidoMes / metaMensal * 100, 0) : '—'}</span><span>Falta investir: <b className="num">{brl(Math.max(0, metaMensal - investidoMes))}</b></span></div>
        </div>
      </div>

      {/* Alocação por objetivo */}
      <div className="grid lg:grid-cols-[1fr_2fr_1fr] gap-4 mb-5">
        <div className="card p-4 flex flex-col">
          <div className="w-11 h-11 rounded-full bg-cyan-50 text-cyan-700 flex items-center justify-center mb-2"><PiggyBank size={20} /></div>
          <div className="font-black">Reserva de emergência</div>
          <div className="text-muted num text-sm">ideal {brl(reservaIdeal)}</div>
          <div className="flex-1 flex items-end justify-center py-4"><Barra v={porObjetivo.reserva} alvo={reservaIdeal} rotulo="Liquidez diária" /></div>
          <div className="text-xs text-muted border-t border-line pt-2 flex justify-between"><span>Alocado</span><b className="num text-ink">{brl(porObjetivo.reserva)}</b></div>
        </div>
        <div className="card p-4 flex flex-col">
          <div className="w-11 h-11 rounded-full bg-green-50 text-pos flex items-center justify-center mb-2"><Star size={20} /></div>
          <div className="font-black">Projetos de vida</div>
          <div className="text-muted num text-sm">alvo {brl(alvoPrazo('curto') + alvoPrazo('medio') + alvoPrazo('longo'))}</div>
          <div className="flex-1 grid grid-cols-3 gap-2 items-end py-4">
            <Barra v={porObjetivo.curto} alvo={alvoPrazo('curto')} rotulo="Curto prazo" sub="(1–2 anos)" />
            <Barra v={porObjetivo.medio} alvo={alvoPrazo('medio')} rotulo="Médio prazo" sub="(3–4 anos)" />
            <Barra v={porObjetivo.longo} alvo={alvoPrazo('longo')} rotulo="Longo prazo" sub="(+5 anos)" />
          </div>
          <div className="text-xs text-muted border-t border-line pt-2 flex justify-between"><span>Meta mensal (projetos ativos): <b className="num text-ink">{brl(aportePrazo('curto') + aportePrazo('medio') + aportePrazo('longo'))}</b></span><span>Alocado: <b className="num text-ink">{brl(porObjetivo.curto + porObjetivo.medio + porObjetivo.longo)}</b></span></div>
        </div>
        <div className="card p-4 flex flex-col">
          <div className="w-11 h-11 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center mb-2"><Sunrise size={20} /></div>
          <div className="font-black">Independência financeira</div>
          <div className="text-muted num text-sm">necessário {brl(necessarioIF)}</div>
          <div className="flex-1 flex items-end justify-center py-4"><Barra v={porObjetivo.independencia} alvo={necessarioIF} rotulo="Longo prazo" /></div>
          <div className="text-xs text-muted border-t border-line pt-2 flex justify-between"><span>Alocado</span><b className="num text-ink">{brl(porObjetivo.independencia)}</b></div>
        </div>
      </div>
      {porObjetivo.sem > 0 && <div className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 mb-4">{brl(porObjetivo.sem)} em investimentos ainda sem objetivo definido — use a coluna "Objetivo" na tabela abaixo para alocar.</div>}

      {q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : !q.data?.length ? <Empty title="Nenhum investimento cadastrado" hint="Investimentos conectados via Open Finance aparecem aqui automaticamente. Você também pode cadastrar posições manualmente." /> : (
        <>
          <div className="grid lg:grid-cols-2 gap-4 mb-4">
            <div className="card p-4"><div className="font-black mb-2">Alocação por classe</div><Rosca data={porTipo} /></div>
            <div className="card p-4"><div className="font-black mb-2">Alocação por instituição</div><Rosca data={porInst} /></div>
          </div>
          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Ativo</th><th>Classe</th><th>Objetivo</th><th>Instituição</th><th className="text-right">Aplicado</th><th className="text-right">Atual</th><th className="text-right">Rent.</th><th>Vencimento</th><th>Atualizado</th>{podeEditar && <th></th>}</tr></thead>
              <tbody>{rows.map(i => (
                <tr key={i.id}>
                  <td><div className="font-bold">{i.nome}</div><div className="text-xs text-muted">{[i.codigo, i.subtipo, i.taxa].filter(Boolean).join(' · ')}</div></td>
                  <td><Badge tone="blue">{TIPO_INV_LABEL[i.tipo] ?? i.tipo}</Badge></td>
                  <td><select className={`input py-1 text-xs ${!i.objetivo ? 'border-amber-300 bg-amber-50' : ''}`} disabled={!podeEditar} value={i.objetivo ?? ''} onChange={e => setObjetivo(i, e.target.value)}><option value="">— definir —</option>{Object.entries(OBJ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                  <td className="text-muted">{i.instituicao ?? '—'}</td>
                  <td className="text-right num">{brl(i.valor_aplicado)}</td>
                  <td className="text-right num font-bold">{brl(i.valor_atual)}</td>
                  <td className={`text-right num font-bold ${Number(i.rentabilidade_pct) < 0 ? 'text-neg' : 'text-pos'}`}>{pct(i.rentabilidade_pct, 2)}</td>
                  <td className="num">{fmtDate(i.vencimento)}</td>
                  <td className="text-xs text-muted whitespace-nowrap">{fmtDateTime(i.atualizado_em)}{i.integracao_id && <Badge tone="green">auto</Badge>}</td>
                  {podeEditar && <td className="text-right whitespace-nowrap">
                    <button className="btn btn-ghost p-1.5" onClick={() => setModal({ id: i.id, form: { nome: i.nome, tipo: i.tipo, subtipo: i.subtipo ?? '', instituicao: i.instituicao ?? '', codigo: i.codigo ?? '', valor_aplicado: String(i.valor_aplicado), valor_atual: String(i.valor_atual), taxa: i.taxa ?? '', data_aplicacao: i.data_aplicacao ?? '', vencimento: i.vencimento ?? '', liquidez: i.liquidez ?? '', objetivo: i.objetivo ?? '' } })}><Pencil size={15} /></button>
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
          <Field label="Objetivo" className="col-span-2"><select className="input" value={modal.form.objetivo} onChange={e => setModal({ ...modal, form: { ...modal.form, objetivo: e.target.value } })}><option value="">—</option>{Object.entries(OBJ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
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

function Barra({ v, alvo, rotulo, sub }: { v: number; alvo: number; rotulo: string; sub?: string }) {
  const p = alvo > 0 ? Math.min(100, v / alvo * 100) : (v > 0 ? 100 : 0)
  return (
    <div className="flex flex-col items-center gap-1 w-full">
      <div className="text-xs num text-muted">{brl(v)}</div>
      <div className="w-full max-w-[120px] h-40 rounded bg-surface relative overflow-hidden"><div className="absolute bottom-0 inset-x-0 bg-slate-300" style={{ height: `${p}%` }} /><div className="absolute inset-0 flex items-center justify-center text-white font-black text-sm drop-shadow">{p > 8 ? pct(p, 0) : ''}</div></div>
      <div className="text-xs text-center"><div>{rotulo}</div>{sub && <div className="text-muted">{sub}</div>}</div>
    </div>
  )
}
