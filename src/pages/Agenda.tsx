import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CreditCard, CalendarDays, Plus, Pencil, Trash2, CheckCircle2, Repeat } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, Empty, ErrorBox, Field, Kpi, Loading, Modal, MoneyCell, PageHeader, Tabs } from '../components/ui'
import { brl, fmtDate, todayISO } from '../lib/format'
import type { Conta, PlanoConta } from '../lib/types'

type Horizonte = '30' | '60' | '90'
interface AgendaEvento { id: string; data: string; titulo: string; valor: number; tipo: 'receita' | 'despesa' | 'transferencia'; plano_conta_id: string | null; recorrencia: 'unica' | 'mensal' | 'anual'; concluido: boolean; observacao: string | null }
interface Ajuste { id: string; chave: string; valor: number | null; data: string | null; titulo: string | null; observacao: string | null; oculto: boolean }
interface Item { key: string; data: string; titulo: string; detalhe: string; valor: number; tipo: 'receita' | 'despesa' | 'transferencia'; origem: 'fatura' | 'manual'; ev?: AgendaEvento; ajuste?: Ajuste; conta?: Conta; concluido?: boolean }

const addDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const iso = (d: Date) => d.toISOString().slice(0, 10)
const emptyForm = () => ({ data: todayISO(), titulo: '', valor: '', tipo: 'despesa' as AgendaEvento['tipo'], plano_conta_id: '', recorrencia: 'unica' as AgendaEvento['recorrencia'], observacao: '' })

/** Agenda: faturas dos cartões (vencimento) + compromissos lançados manualmente, nos próximos 30/60/90 dias. */
export default function Agenda() {
  const { workspace, canEditModule, user } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('agenda')
  const [h, setH] = useState<Horizonte>('30')
  const [modal, setModal] = useState<null | { id?: string; form: ReturnType<typeof emptyForm> }>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ajModal, setAjModal] = useState<null | { item: Item; valor: string; data: string; titulo: string; observacao: string }>(null)
  const hoje = new Date(todayISO() + 'T12:00:00')
  const fim = addDias(hoje, Number(h))

  const q = useQuery(async () => {
    const [c, e, p, aj, tx] = await Promise.all([
      supabase.from('contas').select('*').eq('workspace_id', ws).eq('ativa', true),
      supabase.from('agenda_eventos').select('*').eq('workspace_id', ws).gte('data', iso(addDias(hoje, -400))).lte('data', iso(fim)).order('data'),
      supabase.from('plano_contas').select('*').eq('workspace_id', ws).eq('ativo', true).order('codigo'),
      supabase.from('agenda_ajustes').select('*').eq('workspace_id', ws),
      supabase.from('lancamentos').select('conta_id, data, valor, tipo').eq('workspace_id', ws).gte('data', iso(addDias(hoje, -70))).lte('data', iso(addDias(fim, 40))).neq('tipo', 'transferencia').limit(20000),
    ])
    if (e.error) throw e.error
    return { contas: c.data as Conta[], eventos: e.data as AgendaEvento[], planos: (p.data ?? []) as PlanoConta[], ajustes: (aj.data ?? []) as Ajuste[], tx: (tx.data ?? []) as { conta_id: string; data: string; valor: number; tipo: string }[] }
  }, [ws, h])

  const itens = useMemo<Item[]>(() => {
    const d = q.data; if (!d) return []
    const out: Item[] = []
    const dentro = (s: string) => s >= iso(hoje) && s <= iso(fim)
    // Faturas de cartão — valor do ciclo (compras entre o fechamento anterior e o fechamento do ciclo), não o saldo total devedor.
    const ajusteDe = (chave: string) => d.ajustes.find(a => a.chave === chave)
    for (const c of d.contas.filter(x => x.tipo === 'cartao_credito')) {
      const venc = c.vencimento_fatura
      if (!venc) {
        const chave = `fatura:${c.id}:sem-data`; const aj = ajusteDe(chave); if (aj?.oculto) continue
        out.push({ key: chave, data: aj?.data ?? iso(hoje), titulo: aj?.titulo ?? `Fatura ${c.nome}`, detalhe: aj?.observacao ?? 'informe o dia de vencimento em Contas para posicionar e calcular por ciclo', valor: aj?.valor ?? Math.abs(Number(c.saldo_atual)), tipo: 'despesa', origem: 'fatura', ajuste: aj, conta: c }); continue
      }
      const fech = c.fechamento_fatura ?? Math.max(1, venc - 7)                 // sem fechamento informado: assume 7 dias antes do vencimento
      const txConta = d.tx.filter(t => t.conta_id === c.id)
      for (let k = -1; k <= 3; k++) {
        const ultimoDia = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
        const dtVenc = new Date(hoje.getFullYear(), hoje.getMonth() + k, Math.min(venc, ultimoDia(hoje.getFullYear(), hoje.getMonth() + k)), 12)
        // fechamento do ciclo: mesmo mês do vencimento se fech < venc, senão mês anterior
        const mesFech = fech < venc ? 0 : -1
        const dtFech = new Date(dtVenc.getFullYear(), dtVenc.getMonth() + mesFech, Math.min(fech, ultimoDia(dtVenc.getFullYear(), dtVenc.getMonth() + mesFech)), 12)
        const dtFechAnt = new Date(dtFech.getFullYear(), dtFech.getMonth() - 1, Math.min(fech, ultimoDia(dtFech.getFullYear(), dtFech.getMonth() - 1)), 12)
        const sVenc = iso(dtVenc); if (!dentro(sVenc)) continue
        const chave = `fatura:${c.id}:${sVenc}`; const aj = ajusteDe(chave); if (aj?.oculto) continue
        const ciclo = txConta.filter(t => t.data > iso(dtFechAnt) && t.data <= iso(dtFech))
        const calc = ciclo.reduce((a, t) => a + (t.tipo === 'despesa' ? Number(t.valor) : -Number(t.valor)), 0)
        const fechado = iso(dtFech) <= iso(hoje)
        const temDados = ciclo.length > 0
        const valor = aj?.valor ?? (temDados ? Math.max(0, calc) : (k <= 0 ? Math.abs(Number(c.saldo_atual)) : 0))
        const detalhe = aj?.observacao ?? (aj?.valor != null ? 'valor ajustado manualmente' : temDados ? `${ciclo.length} lançamentos de ${fmtDate(iso(addDias(dtFechAnt, 1)))} a ${fmtDate(iso(dtFech))}${fechado ? '' : ' · ciclo em aberto (parcial)'}` : k <= 0 ? 'sem lançamentos no ciclo — usando saldo informado pelo banco' : 'sem lançamentos previstos no ciclo')
        out.push({ key: chave, data: aj?.data ?? sVenc, titulo: aj?.titulo ?? `Fatura ${c.nome}`, detalhe, valor, tipo: 'despesa', origem: 'fatura', ajuste: aj, conta: c })
      }
    }
    // Lançamentos manuais (com recorrência)
    const nomePlano = (id: string | null) => d.planos.find(p => p.id === id)?.nome
    for (const ev of d.eventos) {
      const base = new Date(ev.data + 'T12:00:00')
      const datas: string[] = []
      if (ev.recorrencia === 'unica') datas.push(ev.data)
      else for (let k = 0; k <= 36; k++) { const dt = ev.recorrencia === 'mensal' ? new Date(base.getFullYear(), base.getMonth() + k, Math.min(base.getDate(), new Date(base.getFullYear(), base.getMonth() + k + 1, 0).getDate()), 12) : new Date(base.getFullYear() + k, base.getMonth(), base.getDate(), 12); const s = iso(dt); if (s > iso(fim)) break; datas.push(s) }
      for (const s of datas) if (dentro(s)) out.push({ key: `m-${ev.id}-${s}`, data: s, titulo: ev.titulo, detalhe: [nomePlano(ev.plano_conta_id), ev.recorrencia !== 'unica' ? (ev.recorrencia === 'mensal' ? 'mensal' : 'anual') : null, ev.observacao].filter(Boolean).join(' · '), valor: Number(ev.valor), tipo: ev.tipo, origem: 'manual', ev, concluido: ev.recorrencia === 'unica' && ev.concluido })
    }
    return out.sort((a, b) => a.data.localeCompare(b.data))
  }, [q.data, h])

  const tot = itens.filter(i => !i.concluido).reduce((a, e) => { if (e.tipo === 'despesa') a.d += e.valor; else if (e.tipo === 'receita') a.r += e.valor; return a }, { d: 0, r: 0 })
  const disponivel = (q.data?.contas ?? []).filter(c => c.tipo !== 'cartao_credito').reduce((a, c) => a + Number(c.saldo_atual), 0)
  const grupos = useMemo(() => {
    const m: Record<string, Item[]> = {}
    for (const e of itens) { const diff = Math.floor((new Date(e.data + 'T12:00:00').getTime() - hoje.getTime()) / 86400000); const k = diff < 7 ? 'Próximos 7 dias' : diff < 14 ? 'Em 1–2 semanas' : diff < 30 ? 'Em 2–4 semanas' : diff < 60 ? 'Em 1–2 meses' : 'Em 2–3 meses'; (m[k] ??= []).push(e) }
    return Object.entries(m)
  }, [itens])

  const salvar = async (e: FormEvent) => {
    e.preventDefault(); if (!modal) return; setErr(null)
    const f = modal.form
    const payload = { workspace_id: ws, data: f.data, titulo: f.titulo.trim(), valor: Math.abs(Number(String(f.valor).replace(/\./g, '').replace(',', '.'))) || 0, tipo: f.tipo, plano_conta_id: f.plano_conta_id || null, recorrencia: f.recorrencia, observacao: f.observacao || null, created_by: user!.id }
    const r = modal.id ? await supabase.from('agenda_eventos').update(payload).eq('id', modal.id) : await supabase.from('agenda_eventos').insert(payload)
    if (r.error) { setErr(r.error.message); return }
    setModal(null); q.refetch()
  }
  const excluir = async (ev: AgendaEvento) => { if (!confirm(`Excluir "${ev.titulo}"?`)) return; await supabase.from('agenda_eventos').delete().eq('id', ev.id); q.refetch() }
  const salvarAjuste = async (e: FormEvent) => {
    e.preventDefault(); if (!ajModal) return
    const v = Number(ajModal.valor.replace(/\./g, '').replace(',', '.'))
    const { error } = await supabase.from('agenda_ajustes').upsert({ workspace_id: ws, chave: ajModal.item.key, valor: isNaN(v) ? null : v, data: ajModal.data || null, titulo: ajModal.titulo || null, observacao: ajModal.observacao || null, oculto: false }, { onConflict: 'workspace_id,chave' })
    if (error) alert(error.message); else { setAjModal(null); q.refetch() }
  }
  const limparAjuste = async (item: Item) => { await supabase.from('agenda_ajustes').delete().eq('workspace_id', ws).eq('chave', item.key); setAjModal(null); q.refetch() }
  const ocultar = async (item: Item) => { if (!confirm('Ocultar este item da agenda?')) return; await supabase.from('agenda_ajustes').upsert({ workspace_id: ws, chave: item.key, oculto: true }, { onConflict: 'workspace_id,chave' }); q.refetch() }
  const concluir = async (ev: AgendaEvento) => { await supabase.from('agenda_eventos').update({ concluido: !ev.concluido }).eq('id', ev.id); q.refetch() }

  return (
    <div>
      <PageHeader crumb="Visão" title="Agenda" actions={<>
        <Tabs tabs={[{ key: '30', label: '30 dias' }, { key: '60', label: '60 dias' }, { key: '90', label: '90 dias' }]} value={h} onChange={setH} />
        {podeEditar && <button className="btn btn-primary" onClick={() => setModal({ form: emptyForm() })}><Plus size={16} /> Novo compromisso</button>}
      </>}>
        <p className="text-sm text-muted">De {fmtDate(iso(hoje))} a {fmtDate(iso(fim))}: faturas dos cartões calculadas por ciclo de fechamento (não o saldo total devedor) e compromissos lançados por você. Todos os itens podem ser ajustados.</p>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Saídas programadas" value={brl(tot.d)} tone="neg" sub={`${itens.filter(e => e.tipo === 'despesa' && !e.concluido).length} compromisso(s)`} />
        <Kpi label="Entradas previstas" value={brl(tot.r)} tone="pos" />
        <Kpi label="Disponível hoje" value={brl(disponivel)} tone="brand" sub="contas correntes e poupança" />
        <Kpi label="Saldo após compromissos" value={brl(disponivel + tot.r - tot.d)} tone={disponivel + tot.r - tot.d >= 0 ? 'pos' : 'neg'} sub={disponivel + tot.r - tot.d < 0 ? 'atenção: faltará caixa' : 'caixa suficiente'} />
      </div>

      {q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : !itens.length ? (
        <Empty title="Nada programado no período" hint="Informe o dia de vencimento dos cartões em Contas e lance aqui seus compromissos (IPVA, IPTU, escola, parcelas, viagens)." action={podeEditar && <button className="btn btn-primary" onClick={() => setModal({ form: emptyForm() })}><Plus size={16} /> Novo compromisso</button>} />
      ) : (
        <div className="flex flex-col gap-4">
          {grupos.map(([titulo, lista]) => (
            <div key={titulo} className="card">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between"><div className="font-black flex items-center gap-2"><CalendarDays size={16} className="text-brand" /> {titulo}</div><div className="text-sm num text-muted">saídas <b className="text-neg">{brl(lista.filter(e => e.tipo === 'despesa' && !e.concluido).reduce((a, e) => a + e.valor, 0))}</b></div></div>
              <table className="tbl">
                <tbody>{lista.map(e => (
                  <tr key={e.key} className={e.concluido ? 'opacity-50 line-through' : ''}>
                    <td className="num whitespace-nowrap w-28">{fmtDate(e.data)}<div className="text-[11px] text-muted">{new Date(e.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' })}</div></td>
                    <td className="w-10"><div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center text-ink/70">{e.origem === 'fatura' ? <CreditCard size={16} /> : e.ev?.recorrencia !== 'unica' ? <Repeat size={16} /> : <CalendarDays size={16} />}</div></td>
                    <td><div className="font-bold">{e.titulo}</div><div className="text-xs text-muted">{e.detalhe}</div></td>
                    <td><Badge tone={e.origem === 'fatura' ? 'red' : 'blue'}>{e.origem === 'fatura' ? (e.ajuste?.valor != null ? 'Fatura (ajustada)' : 'Fatura de cartão') : 'Compromisso'}</Badge></td>
                    <td className="text-right"><MoneyCell v={e.valor} tipo={e.tipo} /></td>
                    <td className="text-right w-32 whitespace-nowrap">
                      {e.origem === 'fatura' ? (podeEditar ? <>
                        <button className="btn btn-ghost p-1.5" title="Ajustar valor/data" onClick={() => setAjModal({ item: e, valor: String(e.valor), data: e.data, titulo: e.titulo, observacao: e.ajuste?.observacao ?? '' })}><Pencil size={15} /></button>
                        <button className="btn btn-ghost p-1.5 text-neg" title="Ocultar" onClick={() => ocultar(e)}><Trash2 size={15} /></button>
                        <Link to="/contas" className="text-xs font-bold text-brand ml-1" title="Dia de vencimento/fechamento">contas</Link>
                      </> : <Link to="/contas" className="text-xs font-bold text-brand">contas</Link>) : podeEditar && e.ev && <>
                        {e.ev.recorrencia === 'unica' && <button className="btn btn-ghost p-1.5 text-pos" title={e.ev.concluido ? 'Reabrir' : 'Concluir'} onClick={() => concluir(e.ev!)}><CheckCircle2 size={15} /></button>}
                        <button className="btn btn-ghost p-1.5" onClick={() => setModal({ id: e.ev!.id, form: { data: e.ev!.data, titulo: e.ev!.titulo, valor: String(e.ev!.valor), tipo: e.ev!.tipo, plano_conta_id: e.ev!.plano_conta_id ?? '', recorrencia: e.ev!.recorrencia, observacao: e.ev!.observacao ?? '' } })}><Pencil size={15} /></button>
                        <button className="btn btn-ghost p-1.5 text-neg" onClick={() => excluir(e.ev!)}><Trash2 size={15} /></button>
                      </>}
                    </td>
                  </tr>))}</tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!ajModal} onClose={() => setAjModal(null)} title="Ajustar fatura">
        {ajModal && <form onSubmit={salvarAjuste} className="grid grid-cols-2 gap-3">
          <div className="col-span-2 text-xs text-muted">O valor calculado considera os lançamentos do ciclo de fechamento. Se a fatura real for diferente (parcelamento, encargos, pagamento parcial), informe aqui — o ajuste vale só para este vencimento.</div>
          <Field label="Título" className="col-span-2"><input className="input" value={ajModal.titulo} onChange={e => setAjModal({ ...ajModal, titulo: e.target.value })} /></Field>
          <Field label="Valor a pagar (R$)"><input className="input num" required value={ajModal.valor} onChange={e => setAjModal({ ...ajModal, valor: e.target.value })} /></Field>
          <Field label="Data"><input type="date" className="input" value={ajModal.data} onChange={e => setAjModal({ ...ajModal, data: e.target.value })} /></Field>
          <Field label="Observação" className="col-span-2"><input className="input" value={ajModal.observacao} onChange={e => setAjModal({ ...ajModal, observacao: e.target.value })} /></Field>
          <div className="col-span-2 flex justify-between gap-2">{ajModal.item.ajuste ? <button type="button" className="btn btn-danger" onClick={() => limparAjuste(ajModal.item)}>Voltar ao calculado</button> : <span />}<div className="flex gap-2"><button type="button" className="btn" onClick={() => setAjModal(null)}>Cancelar</button><button className="btn btn-primary">Salvar</button></div></div>
        </form>}
      </Modal>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Editar compromisso' : 'Novo compromisso'}>
        {modal && <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
          <Field label="Tipo" className="col-span-2"><div className="grid grid-cols-2 gap-2">{(['despesa', 'receita'] as const).map(t => <button type="button" key={t} className={`btn justify-center ${modal.form.tipo === t ? 'btn-primary' : ''}`} onClick={() => setModal({ ...modal, form: { ...modal.form, tipo: t } })}>{t === 'despesa' ? 'Pagamento' : 'Recebimento'}</button>)}</div></Field>
          <Field label="Título" className="col-span-2"><input className="input" required placeholder="ex.: IPVA Hilux, mensalidade escola, parcela consórcio" value={modal.form.titulo} onChange={e => setModal({ ...modal, form: { ...modal.form, titulo: e.target.value } })} /></Field>
          <Field label="Data"><input type="date" className="input" required value={modal.form.data} onChange={e => setModal({ ...modal, form: { ...modal.form, data: e.target.value } })} /></Field>
          <Field label="Valor (R$)"><input className="input num" required inputMode="decimal" value={modal.form.valor} onChange={e => setModal({ ...modal, form: { ...modal.form, valor: e.target.value } })} /></Field>
          <Field label="Recorrência"><select className="input" value={modal.form.recorrencia} onChange={e => setModal({ ...modal, form: { ...modal.form, recorrencia: e.target.value as AgendaEvento['recorrencia'] } })}><option value="unica">Única</option><option value="mensal">Todo mês</option><option value="anual">Todo ano</option></select></Field>
          <Field label="Categoria"><select className="input" value={modal.form.plano_conta_id} onChange={e => setModal({ ...modal, form: { ...modal.form, plano_conta_id: e.target.value } })}><option value="">—</option>{(q.data?.planos ?? []).filter(p => p.parent_id && (p.tipo === modal.form.tipo || p.tipo === 'investimento')).map(p => <option key={p.id} value={p.id}>{p.codigo} {p.nome}</option>)}</select></Field>
          <Field label="Observação" className="col-span-2"><input className="input" value={modal.form.observacao} onChange={e => setModal({ ...modal, form: { ...modal.form, observacao: e.target.value } })} /></Field>
          <div className="col-span-2"><ErrorBox msg={err} /></div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
        </form>}
      </Modal>
    </div>
  )
}
