import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Shield, GraduationCap, Wallet, Landmark, Inbox } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { useResumo } from '../hooks/useResumo'
import { Badge, ErrorBox, Field, Loading, Modal, PageHeader, Tabs } from '../components/ui'
import { brl, fmtDate, pct } from '../lib/format'
import type { Apolice } from '../lib/types'

const TIPOS: Record<string, string> = { vida: 'Seguro de vida', invalidez: 'Invalidez', doencas_graves: 'Doenças graves', saude: 'Plano de saúde', auto: 'Auto', residencial: 'Residencial', patrimonial: 'Patrimonial / rural', previdencia: 'Previdência', outro: 'Outro' }
const SEGURADOS = [{ k: 'familia', l: 'Família' }, { k: 'titular', l: 'Titular' }, { k: 'conjuge', l: 'Cônjuge' }, { k: 'dependente', l: 'Dependente' }]
const emptyForm = () => ({ tipo: 'vida', seguradora: '', produto: '', segurado: 'titular', cobertura: '', premio_mensal: '', vigencia_fim: '', beneficiarios: '', observacao: '', ativa: true })

/** Proteção: cobertura de vida necessária (padrão de vida, educação de dependentes, sucessão) × apólices contratadas. */
export default function Protecao() {
  const { workspace, canEditModule, updateConfig } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('protecao')
  const resumo = useResumo()
  const [filtro, setFiltro] = useState<'familia' | 'titular' | 'conjuge'>('familia')
  const [modal, setModal] = useState<null | { id?: string; form: ReturnType<typeof emptyForm> }>(null)
  const [cfg, setCfg] = useState<null | 'padrao' | 'educacao' | 'sucessao'>(null)
  const [err, setErr] = useState<string | null>(null)

  const q = useQuery(async () => { const { data, error } = await supabase.from('apolices').select('*').eq('workspace_id', ws).order('tipo'); if (error) throw error; return data as Apolice[] }, [ws])
  const prot = resumo.r?.config.protecao ?? {}
  const anos = prot.anos_padrao_vida ?? 10, educacao = prot.educacao_dependentes ?? 0, sucessaoPct = prot.sucessao_pct ?? 0
  const despesaAnual = (resumo.r?.media.desp ?? 0) * 12
  const patrimonio = (resumo.r?.ativos ?? 0) - (resumo.r?.passivos ?? 0)
  const nec = useMemo(() => ({ padrao: despesaAnual * anos, educacao, sucessao: Math.max(0, patrimonio) * sucessaoPct / 100, dividas: resumo.r?.passivos ?? 0 }), [despesaAnual, anos, educacao, patrimonio, sucessaoPct, resumo.r])
  const necessaria = nec.padrao + nec.educacao + nec.sucessao
  const apolices = (q.data ?? []).filter(a => a.ativa && (filtro === 'familia' || a.segurado === filtro || a.segurado === 'familia'))
  const coberturaVida = apolices.filter(a => ['vida', 'invalidez', 'doencas_graves'].includes(a.tipo)).reduce((a, x) => a + Number(x.cobertura), 0)
  const premioTotal = (q.data ?? []).filter(a => a.ativa).reduce((a, x) => a + Number(x.premio_mensal ?? 0), 0)
  const descoberto = Math.max(0, necessaria - coberturaVida)

  const salvar = async (e: FormEvent) => {
    e.preventDefault(); if (!modal) return; setErr(null)
    const f = modal.form; const n = (s: string) => s ? Number(String(s).replace(/\./g, '').replace(',', '.')) : null
    const payload = { workspace_id: ws, tipo: f.tipo, seguradora: f.seguradora || null, produto: f.produto || null, segurado: f.segurado, cobertura: n(f.cobertura) ?? 0, premio_mensal: n(f.premio_mensal) ?? 0, vigencia_fim: f.vigencia_fim || null, beneficiarios: f.beneficiarios || null, observacao: f.observacao || null, ativa: f.ativa }
    const r = modal.id ? await supabase.from('apolices').update(payload).eq('id', modal.id) : await supabase.from('apolices').insert(payload)
    if (r.error) { setErr(r.error.message); return }
    setModal(null); q.refetch()
  }
  const excluir = async (a: Apolice) => { if (!confirm('Excluir esta apólice?')) return; await supabase.from('apolices').delete().eq('id', a.id); q.refetch() }

  const Card = ({ icon: Icon, cor, titulo, valor, onCfg, desc }: { icon: typeof Shield; cor: string; titulo: string; valor: number; onCfg: () => void; desc: string }) => (
    <div className="flex-1 min-w-[220px]">
      <div className={`w-11 h-11 rounded-full flex items-center justify-center mb-3 ${cor}`}><Icon size={20} /></div>
      <div className="font-black text-lg">{titulo}</div>
      <div className="text-xs text-muted mb-3">{desc}</div>
      {podeEditar && <button className="text-sm font-bold underline text-ink/80 hover:text-brand" onClick={onCfg}>Configurar cobertura</button>}
      <div className="mt-4 text-xs text-muted">Cobertura necessária</div><div className="font-bold num text-brand">{brl(valor)}</div>
    </div>
  )

  return (
    <div>
      <PageHeader title="Proteção" actions={podeEditar && <button className="btn btn-primary" onClick={() => setModal({ form: emptyForm() })}><Plus size={16} /> Adicionar apólice</button>}>
        <Tabs tabs={[{ key: 'familia', label: 'Família' }, { key: 'titular', label: 'Titular' }, { key: 'conjuge', label: 'Cônjuge' }]} value={filtro} onChange={setFiltro} />
      </PageHeader>

      {resumo.loading || q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : (
        <div className="grid lg:grid-cols-[1fr_400px] gap-5">
          <div className="flex flex-col gap-5">
            <div className="card p-5">
              <div className="w-11 h-11 rounded-full bg-violet-50 text-violet-700 flex items-center justify-center mb-3"><Shield size={20} /></div>
              <div className="font-black text-lg">Proteção vida total</div>
              <div className="text-xs text-muted mt-3">Cobertura necessária</div>
              <div className="text-3xl font-black num">{brl(necessaria)}</div>
              <div className="flex justify-between text-sm mt-4"><span className="text-muted">Cobertura atual<br /><b className="text-violet-700 num">{brl(coberturaVida)} ({necessaria ? pct(coberturaVida / necessaria * 100, 0) : '—'})</b></span><span className="text-right text-muted">Descoberto<br /><b className="text-neg num">{brl(descoberto)}</b></span></div>
              <div className="h-2 rounded-full bg-surface overflow-hidden mt-2"><div className="h-full bg-violet-600" style={{ width: `${necessaria ? Math.min(100, coberturaVida / necessaria * 100) : 0}%` }} /></div>
              <div className="text-xs text-muted mt-2">Prêmios mensais contratados: <b className="num text-ink">{brl(premioTotal)}</b> ({resumo.r?.media.rec ? pct(premioTotal / resumo.r.media.rec * 100) : '—'} da renda)</div>
            </div>
            <div className="card p-5 flex gap-6 flex-wrap">
              <Card icon={GraduationCap} cor="bg-indigo-50 text-indigo-700" titulo="Educação e dependentes" valor={nec.educacao} onCfg={() => setCfg('educacao')} desc="Custo total da educação dos dependentes até a independência." />
              <Card icon={Wallet} cor="bg-green-50 text-pos" titulo="Padrão de vida" valor={nec.padrao} onCfg={() => setCfg('padrao')} desc={`${anos} anos de despesas (${brl(despesaAnual)}/ano).`} />
              <Card icon={Landmark} cor="bg-orange-50 text-orange-700" titulo="Sucessão patrimonial" valor={nec.sucessao} onCfg={() => setCfg('sucessao')} desc={`${sucessaoPct}% do patrimônio líquido para custos de inventário/ITCMD.`} />
            </div>
            <div className="card p-4 text-sm text-muted">Dívidas e financiamentos em aberto: <b className="text-ink num">{brl(nec.dividas)}</b>. Em geral, seguros prestamistas cobrem financiamentos; confira se as suas dívidas têm cobertura vinculada antes de somar ao seguro de vida.</div>
          </div>

          <div className="card p-5 flex flex-col">
            <div className="font-black text-lg mb-3">Apólices</div>
            {!apolices.length ? <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-10"><div className="w-12 h-12 rounded-full bg-cyan-50 text-cyan-700 flex items-center justify-center"><Inbox size={22} /></div><div className="font-bold">Você ainda não tem apólices</div>{podeEditar && <button className="btn btn-primary" onClick={() => setModal({ form: emptyForm() })}>Adicionar</button>}</div> : (
              <ul className="divide-y divide-line">{apolices.map(a => (
                <li key={a.id} className="py-3 flex gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between gap-2"><div className="font-bold truncate">{TIPOS[a.tipo]}{a.produto ? ` · ${a.produto}` : ''}</div><div className="font-black num">{brl(a.cobertura)}</div></div>
                    <div className="text-xs text-muted flex gap-2 flex-wrap"><span>{a.seguradora ?? 'Seguradora não informada'}</span><Badge>{SEGURADOS.find(s => s.k === a.segurado)?.l ?? a.segurado}</Badge>{a.premio_mensal ? <span className="num">{brl(a.premio_mensal)}/mês</span> : null}{a.vigencia_fim && <span>vence {fmtDate(a.vigencia_fim)}</span>}</div>
                  </div>
                  {podeEditar && <div className="flex gap-0.5"><button className="btn btn-ghost p-1" onClick={() => setModal({ id: a.id, form: { tipo: a.tipo, seguradora: a.seguradora ?? '', produto: a.produto ?? '', segurado: a.segurado, cobertura: String(a.cobertura), premio_mensal: a.premio_mensal ? String(a.premio_mensal) : '', vigencia_fim: a.vigencia_fim ?? '', beneficiarios: a.beneficiarios ?? '', observacao: a.observacao ?? '', ativa: a.ativa } })}><Pencil size={14} /></button><button className="btn btn-ghost p-1 text-neg" onClick={() => excluir(a)}><Trash2 size={14} /></button></div>}
                </li>))}</ul>
            )}
          </div>
        </div>
      )}

      <Modal open={!!cfg} onClose={() => setCfg(null)} title="Configurar cobertura">
        {cfg === 'padrao' && <div className="flex flex-col gap-3 text-sm"><p className="text-muted">Quantos anos de despesas a família deve ter garantidos na sua ausência? Referência comum: 10 anos ou até a independência dos dependentes.</p><Field label={`Anos de padrão de vida: ${anos}`}><input type="range" min={1} max={30} value={anos} className="w-full accent-brand" onChange={e => updateConfig({ protecao: { ...prot, anos_padrao_vida: Number(e.target.value) } })} /></Field><div className="num">= {brl(despesaAnual * anos)}</div></div>}
        {cfg === 'educacao' && <div className="flex flex-col gap-3 text-sm"><p className="text-muted">Estimativa do custo total de educação dos dependentes (escola + faculdade) até a independência.</p><Field label="Número de dependentes"><input type="number" className="input" min={0} defaultValue={prot.dependentes ?? 0} onBlur={e => updateConfig({ protecao: { ...prot, dependentes: Number(e.target.value) } })} /></Field><Field label="Custo total estimado (R$)"><input className="input num" defaultValue={educacao} onBlur={e => updateConfig({ protecao: { ...prot, educacao_dependentes: Number(e.target.value.replace(/\./g, '').replace(',', '.')) || 0 } })} /></Field></div>}
        {cfg === 'sucessao' && <div className="flex flex-col gap-3 text-sm"><p className="text-muted">Percentual do patrimônio líquido ({brl(Math.max(0, patrimonio))}) a reservar para custos de inventário, ITCMD e honorários — tipicamente 10% a 20%.</p><Field label={`Percentual: ${sucessaoPct}%`}><input type="range" min={0} max={30} value={sucessaoPct} className="w-full accent-brand" onChange={e => updateConfig({ protecao: { ...prot, sucessao_pct: Number(e.target.value) } })} /></Field><div className="num">= {brl(Math.max(0, patrimonio) * sucessaoPct / 100)}</div></div>}
        <div className="flex justify-end mt-4"><button className="btn btn-primary" onClick={() => setCfg(null)}>Concluir</button></div>
      </Modal>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Editar apólice' : 'Adicionar apólice'}>
        {modal && <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
          <Field label="Tipo"><select className="input" value={modal.form.tipo} onChange={e => setModal({ ...modal, form: { ...modal.form, tipo: e.target.value } })}>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Segurado"><select className="input" value={modal.form.segurado} onChange={e => setModal({ ...modal, form: { ...modal.form, segurado: e.target.value } })}>{SEGURADOS.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}</select></Field>
          <Field label="Seguradora"><input className="input" value={modal.form.seguradora} onChange={e => setModal({ ...modal, form: { ...modal.form, seguradora: e.target.value } })} /></Field>
          <Field label="Produto / plano"><input className="input" value={modal.form.produto} onChange={e => setModal({ ...modal, form: { ...modal.form, produto: e.target.value } })} /></Field>
          <Field label="Capital segurado / cobertura (R$)"><input className="input num" required value={modal.form.cobertura} onChange={e => setModal({ ...modal, form: { ...modal.form, cobertura: e.target.value } })} /></Field>
          <Field label="Prêmio mensal (R$)"><input className="input num" value={modal.form.premio_mensal} onChange={e => setModal({ ...modal, form: { ...modal.form, premio_mensal: e.target.value } })} /></Field>
          <Field label="Fim da vigência"><input type="date" className="input" value={modal.form.vigencia_fim} onChange={e => setModal({ ...modal, form: { ...modal.form, vigencia_fim: e.target.value } })} /></Field>
          <Field label="Beneficiários"><input className="input" value={modal.form.beneficiarios} onChange={e => setModal({ ...modal, form: { ...modal.form, beneficiarios: e.target.value } })} /></Field>
          <Field label="Observação" className="col-span-2"><textarea className="input" rows={2} value={modal.form.observacao} onChange={e => setModal({ ...modal, form: { ...modal.form, observacao: e.target.value } })} /></Field>
          <label className="col-span-2 text-sm flex items-center gap-2"><input type="checkbox" checked={modal.form.ativa} onChange={e => setModal({ ...modal, form: { ...modal.form, ativa: e.target.checked } })} /> Apólice ativa</label>
          <div className="col-span-2"><ErrorBox msg={err} /></div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
        </form>}
      </Modal>
    </div>
  )
}
