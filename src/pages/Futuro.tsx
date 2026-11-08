import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Sunrise, Settings2, Briefcase, Star, Sparkles } from 'lucide-react'
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceDot } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { useResumo } from '../hooks/useResumo'
import { Badge, ErrorBox, Field, Loading, Modal, PageHeader, Tabs } from '../components/ui'
import { brl, brlCompact, fmtDate, pct } from '../lib/format'
import type { Meta } from '../lib/types'

type Tab = 'independencia' | 'projetos' | 'tabela'
const PRIORIDADES = [{ k: 'essencial', l: 'Essencial', icon: Briefcase }, { k: 'desejo', l: 'Desejo', icon: Star }, { k: 'sonho', l: 'Sonho', icon: Sparkles }] as const
const emptyForm = () => ({ nome: '', prioridade: 'essencial' as Meta['prioridade'], prazo: 'curto' as NonNullable<Meta['prazo']>, valor_alvo: '', valor_atual: '', aporte_mensal: '', data_alvo: '', descricao: '', ativo: true })

export default function Futuro() {
  const { workspace, canEditModule, updateConfig, profile, refresh } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('futuro')
  const resumo = useResumo()
  const r = resumo.r
  const [tab, setTab] = useState<Tab>('independencia')
  const [horizonte, setHorizonte] = useState<'2' | '5' | '10' | 'max'>('max')
  const [negativos, setNegativos] = useState(false)
  const [modal, setModal] = useState<null | { id?: string; form: ReturnType<typeof emptyForm> }>(null)
  const [cfg, setCfg] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [nasc, setNasc] = useState(profile?.data_nascimento ?? '')

  const metasQ = useQuery(async () => { const { data, error } = await supabase.from('metas').select('*').eq('workspace_id', ws).order('data_alvo', { nullsFirst: false }); if (error) throw error; return data as Meta[] }, [ws])
  const metas = metasQ.data ?? []

  // Premissas (persistidas em workspaces.config)
  const idadeAtual = r?.idade ?? 40
  const c = r?.config ?? {}
  const idadeApos = c.idade_aposentadoria ?? 65
  const rendaDesejada = c.renda_desejada ?? Math.round(r?.media.desp ?? 0)
  const outras = c.outras_rendas ?? 0
  const investMensal = c.investimento_mensal ?? Math.max(0, Math.round((r?.media.rec ?? 0) - (r?.media.desp ?? 0)))
  const taxaReal = c.taxa_real ?? 4
  const expectativa = 100
  const set = (patch: Record<string, unknown>) => updateConfig(patch)

  const sim = useMemo(() => {
    if (!r) return null
    const i = Math.pow(1 + taxaReal / 100, 1 / 12) - 1
    const anosAcum = Math.max(0, idadeApos - idadeAtual)
    const rendaLiq = Math.max(0, rendaDesejada - outras)
    // aportes dos projetos ativos saem do investimento mensal disponível para a independência
    const aporteProjetos = metas.filter(m => m.ativo && (m.aporte_mensal ?? 0) > 0 && Number(m.valor_atual) < Number(m.valor_alvo)).reduce((a, m) => a + Number(m.aporte_mensal), 0)
    const aporteIF = Math.max(0, investMensal - aporteProjetos)
    // patrimônio necessário para consumir até a expectativa de vida (renda vitalícia perpétua = renda*12/taxa; consumo até 100 = anuidade)
    const mesesRetirada = Math.max(1, (expectativa - idadeApos) * 12)
    const necessarioPerp = taxaReal > 0 ? (rendaLiq * 12) / (taxaReal / 100) : rendaLiq * mesesRetirada
    const necessarioAnuidade = i > 0 ? rendaLiq * (1 - Math.pow(1 + i, -mesesRetirada)) / i : rendaLiq * mesesRetirada
    const necessario = Math.min(necessarioPerp, necessarioAnuidade)
    // aporte necessário para chegar em `necessario` na aposentadoria partindo do investido hoje
    const n = anosAcum * 12
    const fv0 = r.investTotal * Math.pow(1 + i, n)
    const aporteNecessario = n > 0 ? Math.max(0, (necessario - fv0) * i / (Math.pow(1 + i, n) - 1)) : 0
    // séries por idade
    const serie: { idade: number; principal: number; total: number; ideal: number }[] = []
    let principal = r.investTotal, total = r.investTotal, ideal = r.investTotal
    for (let idade = idadeAtual; idade <= expectativa; idade++) {
      serie.push({ idade, principal: Math.round(principal), total: Math.round(total), ideal: Math.round(ideal) })
      for (let k = 0; k < 12; k++) {
        if (idade < idadeApos) { principal += aporteIF; total = total * (1 + i) + aporteIF; ideal = ideal * (1 + i) + aporteNecessario }
        else { principal = Math.max(0, principal - rendaLiq); total = total * (1 + i) - rendaLiq; ideal = ideal * (1 + i) - rendaLiq }
      }
      if (!negativos) { total = Math.max(0, total); ideal = Math.max(0, ideal) }
    }
    const limite = horizonte === 'max' ? expectativa : idadeAtual + Number(horizonte)
    const idadeEsgota = serie.find(s => s.idade > idadeApos && s.total <= 0)?.idade ?? null
    const picoTotal = serie.find(s => s.idade === idadeApos)?.total ?? 0
    return { serie: serie.filter(s => s.idade <= limite), necessario, aporteNecessario, aporteIF, aporteProjetos, idadeEsgota, picoTotal, rendaLiq }
  }, [r, idadeApos, idadeAtual, rendaDesejada, outras, investMensal, taxaReal, metas, negativos, horizonte])

  const salvarNasc = async () => { if (!profile) return; await supabase.from('profiles').update({ data_nascimento: nasc || null }).eq('id', profile.id); await refresh(); setCfg(false) }

  const salvar = async (e: FormEvent) => {
    e.preventDefault(); if (!modal) return; setErr(null)
    const f = modal.form; const n = (s: string) => s ? Number(String(s).replace(/\./g, '').replace(',', '.')) : null
    const payload = { workspace_id: ws, nome: f.nome.trim(), tipo: 'meta', prioridade: f.prioridade, prazo: f.prazo, valor_alvo: n(f.valor_alvo) ?? 0, valor_atual: n(f.valor_atual) ?? 0, aporte_mensal: n(f.aporte_mensal), data_alvo: f.data_alvo || null, descricao: f.descricao || null, ativo: f.ativo }
    const res = modal.id ? await supabase.from('metas').update(payload).eq('id', modal.id) : await supabase.from('metas').insert(payload)
    if (res.error) { setErr(res.error.message); return }
    setModal(null); metasQ.refetch()
  }
  const toggle = async (m: Meta) => { await supabase.from('metas').update({ ativo: !m.ativo }).eq('id', m.id); metasQ.refetch() }
  const excluir = async (m: Meta) => { if (!confirm(`Excluir "${m.nome}"?`)) return; await supabase.from('metas').delete().eq('id', m.id); metasQ.refetch() }
  const aporteNecessario = (m: Meta) => { if (!m.data_alvo) return null; const meses = Math.max(1, Math.round((new Date(m.data_alvo).getTime() - Date.now()) / (1000 * 3600 * 24 * 30.44))); const falta = Number(m.valor_alvo) - Number(m.valor_atual); return { meses, aporte: falta > 0 ? falta / meses : 0 } }

  const Toggle = ({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) => <button type="button" disabled={disabled} onClick={onClick} className={`w-11 h-6 rounded-full relative transition-colors ${on ? 'bg-pos' : 'bg-slate-300'} disabled:opacity-50`}><span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-5.5 translate-x-0.5' : 'left-0.5'}`} /></button>

  return (
    <div>
      <PageHeader title="Futuro" actions={podeEditar && tab !== 'independencia' && <button className="btn btn-primary" onClick={() => setModal({ form: emptyForm() })}><Plus size={16} /> Novo projeto</button>}>
        <Tabs tabs={[{ key: 'independencia', label: 'Independência Financeira' }, { key: 'projetos', label: 'Meus Projetos' }, { key: 'tabela', label: 'Tabela' }]} value={tab} onChange={setTab} />
      </PageHeader>

      {resumo.loading || !r ? <Loading /> : resumo.error ? <ErrorBox msg={resumo.error} /> : tab === 'independencia' && sim ? (
        <div className="grid lg:grid-cols-[1fr_340px] gap-5">
          <div className="card p-4">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <div className="font-black text-lg">Independência financeira</div>
              <div className="flex items-center gap-2 text-sm">
                <label className="flex items-center gap-2 text-muted mr-2">Negativos <Toggle on={negativos} onClick={() => setNegativos(!negativos)} /></label>
                {(['2', '5', '10', 'max'] as const).map(h => <button key={h} className={`btn py-1.5 text-xs ${horizonte === h ? 'border-brand bg-brand-soft' : ''}`} onClick={() => setHorizonte(h)}>{h === 'max' ? 'Máximo' : `${h} anos`}</button>)}
                <button className="btn btn-ghost p-1.5" title="Premissas" onClick={() => setCfg(true)}><Settings2 size={16} /></button>
              </div>
            </div>
            {!profile?.data_nascimento && <div className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 mb-2">Informe sua data de nascimento nas premissas (ícone de engrenagem) para projetar por idade. Usando {idadeAtual} anos como padrão.</div>}
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={sim.serie} margin={{ left: 8, right: 16, top: 16 }}>
                <CartesianGrid vertical={false} stroke="#eef1f4" />
                <XAxis dataKey="idade" tick={{ fontSize: 12, fill: '#64748b', fontFamily: 'Overlock' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={brlCompact} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} width={80} />
                <Tooltip formatter={(v) => brl(Number(v))} labelFormatter={l => `${l} anos`} contentStyle={{ borderRadius: 10, fontFamily: 'Overlock' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="total" name="Patrimônio total projetado" stroke="#9bbf57" fill="#cfe3a5" fillOpacity={0.8} />
                <Area type="monotone" dataKey="principal" name="Patrimônio principal investido" stroke="#6b8db0" fill="#9fb6cc" fillOpacity={0.9} />
                <Line type="monotone" dataKey="ideal" name="Aposentadoria ideal" stroke="#e67e22" strokeWidth={2} dot={false} />
                <ReferenceDot x={idadeApos} y={sim.picoTotal} r={6} fill="#e3f0c9" stroke="#27ae60" />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="grid sm:grid-cols-3 gap-3 mt-3 text-sm">
              <div className="rounded-xl bg-surface p-3"><div className="text-xs text-muted">Investido hoje</div><div className="font-black num">{brl(r.investTotal)}</div></div>
              <div className="rounded-xl bg-surface p-3"><div className="text-xs text-muted">Aos {idadeApos} anos (ritmo atual)</div><div className="font-black num">{brl(sim.picoTotal)}</div></div>
              <div className="rounded-xl bg-surface p-3"><div className="text-xs text-muted">Patrimônio esgota</div><div className={`font-black num ${sim.idadeEsgota && sim.idadeEsgota < expectativa ? 'text-neg' : 'text-pos'}`}>{sim.idadeEsgota ? `aos ${sim.idadeEsgota} anos` : 'não esgota'}</div></div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="card p-4 flex gap-3 items-start bg-green-50 border-green-100"><div className="w-10 h-10 rounded-full bg-white text-pos flex items-center justify-center shrink-0"><Sunrise size={20} /></div><div className="text-sm">Você precisa investir <b className="text-pos num">{brl(sim.aporteNecessario)}/mês</b> para chegar na sua aposentadoria ideal com <b className="text-pos num">{brl(sim.necessario)}</b> acumulados aos {idadeApos} anos.{sim.aporteProjetos > 0 && <div className="text-xs text-muted mt-1">Do investimento mensal, {brl(sim.aporteProjetos)} vão para projetos ativos; {brl(sim.aporteIF)} para a independência.</div>}</div></div>
            <div className="card p-4 flex flex-col gap-5">
              <Slider label="Idade aposentadoria" value={idadeApos} min={Math.max(idadeAtual + 1, 40)} max={85} fmt={v => String(v)} onChange={v => set({ idade_aposentadoria: v })} disabled={!podeEditar} />
              <Slider label="Renda desejada" value={rendaDesejada} min={1000} max={100000} step={500} fmt={brl} onChange={v => set({ renda_desejada: v })} disabled={!podeEditar} />
              <Slider label="Outras fontes de renda" value={outras} min={0} max={50000} step={500} fmt={brl} onChange={v => set({ outras_rendas: v })} disabled={!podeEditar} hint="INSS, aluguéis, pensão" />
              <Slider label="Investimento mensal" value={investMensal} min={0} max={100000} step={100} fmt={brl} onChange={v => set({ investimento_mensal: v })} disabled={!podeEditar} />
              <Slider label="Taxa real (acima da inflação)" value={taxaReal} min={1} max={10} step={0.5} fmt={v => `${v}% a.a.`} onChange={v => set({ taxa_real: v })} disabled={!podeEditar} />
              <div className="text-xs text-muted">Valores em moeda de hoje. Patrimônio necessário = o menor entre renda perpétua (renda ÷ taxa) e consumo até os {expectativa} anos.</div>
            </div>
          </div>
        </div>
      ) : tab === 'projetos' ? (
        <div>
          <div className="grid lg:grid-cols-3 gap-5">
            {PRIORIDADES.map(p => {
              const lista = metas.filter(m => m.prioridade === p.k)
              const totalAtivo = lista.filter(m => m.ativo).reduce((a, m) => a + Number(m.valor_alvo), 0)
              const Icon = p.icon
              return (
                <div key={p.k} className="flex flex-col gap-3">
                  <div className="card p-4 flex items-center justify-between"><div><div className="font-black text-lg">{p.l}</div><div className="text-muted num">{brl(totalAtivo)}</div></div><Toggle on={lista.some(m => m.ativo)} disabled={!podeEditar || !lista.length} onClick={async () => { const on = !lista.some(m => m.ativo); await supabase.from('metas').update({ ativo: on }).in('id', lista.map(m => m.id)); metasQ.refetch() }} /></div>
                  {lista.map(m => { const prog = Number(m.valor_alvo) ? Math.min(100, Number(m.valor_atual) / Number(m.valor_alvo) * 100) : 0; const nec = aporteNecessario(m); return (
                    <div key={m.id} className={`card p-4 flex flex-col gap-2 ${!m.ativo ? 'opacity-60' : ''}`}>
                      <div className="flex items-start justify-between"><div className="w-10 h-10 rounded-full bg-green-50 text-pos flex items-center justify-center"><Icon size={18} /></div><Toggle on={m.ativo} disabled={!podeEditar} onClick={() => toggle(m)} /></div>
                      <div className="text-xs text-muted num">{m.data_alvo ? fmtDate(m.data_alvo) : 'sem data'}{m.prazo && <Badge>{m.prazo === 'curto' ? 'curto prazo' : m.prazo === 'medio' ? 'médio prazo' : 'longo prazo'}</Badge>}</div>
                      <div className="font-bold">{m.nome}</div>
                      <div className="h-1.5 rounded-full bg-surface overflow-hidden"><div className="h-full bg-pos" style={{ width: `${prog}%` }} /></div>
                      <div className="flex justify-between text-sm text-muted"><span>Alocado: <b className="text-ink num">{brl(m.valor_atual)}</b></span><span className="num">{brl(m.valor_alvo)}</span></div>
                      <div className="text-xs text-muted flex justify-between"><span>Aporte: {m.aporte_mensal ? brl(m.aporte_mensal) + '/mês' : '—'}</span>{nec && nec.aporte > 0 && <span className={m.aporte_mensal != null && Number(m.aporte_mensal) < nec.aporte - 0.5 ? 'text-amber-700 font-bold' : ''}>necessário {brl(nec.aporte)}/mês</span>}</div>
                      {podeEditar && <div className="flex justify-end gap-1 -mb-1"><button className="btn btn-ghost p-1" onClick={() => setModal({ id: m.id, form: { nome: m.nome, prioridade: m.prioridade, prazo: m.prazo ?? 'curto', valor_alvo: String(m.valor_alvo), valor_atual: String(m.valor_atual), aporte_mensal: m.aporte_mensal != null ? String(m.aporte_mensal) : '', data_alvo: m.data_alvo ?? '', descricao: m.descricao ?? '', ativo: m.ativo } })}><Pencil size={14} /></button><button className="btn btn-ghost p-1 text-neg" onClick={() => excluir(m)}><Trash2 size={14} /></button></div>}
                    </div>) })}
                  {podeEditar && <button className="card p-3 text-sm text-muted hover:text-brand hover:border-brand flex items-center justify-center gap-2" onClick={() => setModal({ form: { ...emptyForm(), prioridade: p.k } })}><Plus size={16} /> Adicionar {p.l.toLowerCase()}</button>}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl"><thead><tr><th>Projeto</th><th>Prioridade</th><th>Prazo</th><th>Data alvo</th><th className="text-right">Alvo</th><th className="text-right">Alocado</th><th className="text-right">%</th><th className="text-right">Aporte/mês</th><th className="text-right">Necessário/mês</th><th>Ativo</th></tr></thead>
            <tbody>{metas.map(m => { const nec = aporteNecessario(m); return <tr key={m.id}><td className="font-bold">{m.nome}</td><td><Badge tone={m.prioridade === 'essencial' ? 'green' : m.prioridade === 'desejo' ? 'blue' : 'amber'}>{m.prioridade}</Badge></td><td className="text-muted">{m.prazo ?? '—'}</td><td className="num">{fmtDate(m.data_alvo)}</td><td className="text-right num">{brl(m.valor_alvo)}</td><td className="text-right num">{brl(m.valor_atual)}</td><td className="text-right num">{pct(Number(m.valor_alvo) ? Number(m.valor_atual) / Number(m.valor_alvo) * 100 : 0, 0)}</td><td className="text-right num">{m.aporte_mensal ? brl(m.aporte_mensal) : '—'}</td><td className="text-right num">{nec ? brl(nec.aporte) : '—'}</td><td>{m.ativo ? 'sim' : 'não'}</td></tr> })}
              {!metas.length && <tr><td colSpan={10} className="text-muted">Nenhum projeto cadastrado.</td></tr>}</tbody>
            <tfoot><tr className="font-black bg-surface/60"><td colSpan={4}>Total (ativos)</td><td className="text-right num">{brl(metas.filter(m => m.ativo).reduce((a, m) => a + Number(m.valor_alvo), 0))}</td><td className="text-right num">{brl(metas.filter(m => m.ativo).reduce((a, m) => a + Number(m.valor_atual), 0))}</td><td></td><td className="text-right num">{brl(metas.filter(m => m.ativo).reduce((a, m) => a + Number(m.aporte_mensal ?? 0), 0))}</td><td colSpan={2}></td></tr></tfoot>
          </table>
        </div>
      )}

      <Modal open={cfg} onClose={() => setCfg(false)} title="Premissas pessoais">
        <div className="flex flex-col gap-3">
          <Field label="Sua data de nascimento"><input type="date" className="input" value={nasc} onChange={e => setNasc(e.target.value)} /></Field>
          <div className="text-xs text-muted">Usada para projetar por idade. Expectativa de vida considerada: {expectativa} anos.</div>
          <div className="flex justify-end gap-2"><button className="btn" onClick={() => setCfg(false)}>Cancelar</button><button className="btn btn-primary" onClick={salvarNasc}>Salvar</button></div>
        </div>
      </Modal>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Editar projeto' : 'Novo projeto'}>
        {modal && <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
          <Field label="Nome" className="col-span-2"><input className="input" required value={modal.form.nome} onChange={e => setModal({ ...modal, form: { ...modal.form, nome: e.target.value } })} /></Field>
          <Field label="Prioridade"><select className="input" value={modal.form.prioridade} onChange={e => setModal({ ...modal, form: { ...modal.form, prioridade: e.target.value as Meta['prioridade'] } })}>{PRIORIDADES.map(p => <option key={p.k} value={p.k}>{p.l}</option>)}</select></Field>
          <Field label="Prazo"><select className="input" value={modal.form.prazo} onChange={e => setModal({ ...modal, form: { ...modal.form, prazo: e.target.value as NonNullable<Meta['prazo']> } })}><option value="curto">Curto (1–2 anos)</option><option value="medio">Médio (3–4 anos)</option><option value="longo">Longo (5+ anos)</option></select></Field>
          <Field label="Valor alvo"><input className="input num" required value={modal.form.valor_alvo} onChange={e => setModal({ ...modal, form: { ...modal.form, valor_alvo: e.target.value } })} /></Field>
          <Field label="Já alocado"><input className="input num" value={modal.form.valor_atual} onChange={e => setModal({ ...modal, form: { ...modal.form, valor_atual: e.target.value } })} /></Field>
          <Field label="Data alvo"><input type="date" className="input" value={modal.form.data_alvo} onChange={e => setModal({ ...modal, form: { ...modal.form, data_alvo: e.target.value } })} /></Field>
          <Field label="Aporte mensal planejado"><input className="input num" value={modal.form.aporte_mensal} onChange={e => setModal({ ...modal, form: { ...modal.form, aporte_mensal: e.target.value } })} /></Field>
          <Field label="Descrição" className="col-span-2"><textarea className="input" rows={2} value={modal.form.descricao} onChange={e => setModal({ ...modal, form: { ...modal.form, descricao: e.target.value } })} /></Field>
          <label className="col-span-2 text-sm flex items-center gap-2"><input type="checkbox" checked={modal.form.ativo} onChange={e => setModal({ ...modal, form: { ...modal.form, ativo: e.target.checked } })} /> Ativo (entra na projeção)</label>
          <div className="col-span-2"><ErrorBox msg={err} /></div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
        </form>}
      </Modal>
    </div>
  )
}

function Slider({ label, value, min, max, step = 1, fmt, onChange, disabled, hint }: { label: string; value: number; min: number; max: number; step?: number; fmt: (v: number) => string; onChange: (v: number) => void; disabled?: boolean; hint?: string }) {
  const [local, setLocal] = useState<number | null>(null)
  const v = local ?? value
  return (
    <div>
      <div className="flex justify-between text-sm mb-1"><span className="font-bold">{label}</span><span className="num">{fmt(v)}</span></div>
      <input type="range" min={min} max={max} step={step} value={v} disabled={disabled} className="w-full accent-brand" onChange={e => setLocal(Number(e.target.value))} onMouseUp={() => { if (local != null) { onChange(local); setLocal(null) } }} onTouchEnd={() => { if (local != null) { onChange(local); setLocal(null) } }} onKeyUp={() => { if (local != null) { onChange(local); setLocal(null) } }} />
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  )
}
