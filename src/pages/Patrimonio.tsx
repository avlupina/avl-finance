import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Home, Car, HandCoins, Plane, TrendingUp, Inbox, Landmark } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, LabelList } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, ErrorBox, Field, Loading, Modal, PageHeader, Tabs } from '../components/ui'
import { LinhaChart, Rosca } from '../components/charts'
import { brl, brlCompact, mesLabel, pct, todayISO } from '../lib/format'
import type { Investimento, Patrimonio as Pat, PatrimonioSnapshot } from '../lib/types'

type Tab = 'bens' | 'resumo' | 'evolucao'
interface Secao { key: string; titulo: string; tipo: 'ativo' | 'passivo'; cats: string[]; icon: typeof Home }
const SECOES: Secao[] = [
  { key: 'dividas', titulo: 'Empréstimos e dívidas', tipo: 'passivo', cats: ['emprestimo', 'outro_passivo', 'cartao', 'cheque_especial'], icon: HandCoins },
  { key: 'moveis', titulo: 'Bens móveis', tipo: 'ativo', cats: ['veiculo', 'maquina', 'outro_ativo'], icon: Car },
  { key: 'imoveis', titulo: 'Bens imóveis', tipo: 'ativo', cats: ['imovel', 'terra'], icon: Home },
  { key: 'milhas', titulo: 'Milhas e pontos', tipo: 'ativo', cats: ['milhas'], icon: Plane },
  { key: 'participacoes', titulo: 'Participações e outros', tipo: 'ativo', cats: ['participacao'], icon: Landmark },
]
const CATS: { k: string; l: string; tipo: 'ativo' | 'passivo' }[] = [
  { k: 'imovel', l: 'Imóvel', tipo: 'ativo' }, { k: 'terra', l: 'Terra / área rural', tipo: 'ativo' }, { k: 'veiculo', l: 'Veículo', tipo: 'ativo' }, { k: 'maquina', l: 'Máquina / equipamento', tipo: 'ativo' },
  { k: 'participacao', l: 'Participação societária', tipo: 'ativo' }, { k: 'milhas', l: 'Milhas / pontos', tipo: 'ativo' }, { k: 'outro_ativo', l: 'Outro bem', tipo: 'ativo' },
  { k: 'emprestimo', l: 'Empréstimo', tipo: 'passivo' }, { k: 'financiamento', l: 'Financiamento (sem bem vinculado)', tipo: 'passivo' }, { k: 'cheque_especial', l: 'Cheque especial / rotativo', tipo: 'passivo' }, { k: 'outro_passivo', l: 'Outra dívida', tipo: 'passivo' },
]
const emptyForm = () => ({ nome: '', categoria: 'imovel', detalhe: '', valor: '', saldo_devedor: '', gerador_renda: false, renda_mensal: '', valor_aquisicao: '', data_aquisicao: '', data_referencia: todayISO(), descricao: '' })

export default function Patrimonio() {
  const { workspace, canEditModule } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('patrimonio')
  const [tab, setTab] = useState<Tab>('bens')
  const [modal, setModal] = useState<null | { id?: string; form: ReturnType<typeof emptyForm> }>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { supabase.rpc('registrar_snapshot_patrimonio', { ws }).then(() => {}) }, [ws])
  const q = useQuery(async () => {
    const [p, v, sn, inv, c] = await Promise.all([
      supabase.from('patrimonio').select('*').eq('workspace_id', ws).order('valor', { ascending: false }),
      supabase.from('v_patrimonio_liquido').select('*').eq('workspace_id', ws).maybeSingle(),
      supabase.from('patrimonio_snapshots').select('*').eq('workspace_id', ws).order('competencia').limit(36),
      supabase.from('investimentos').select('*').eq('workspace_id', ws).order('valor_atual', { ascending: false }),
      supabase.from('contas').select('nome, tipo, saldo_atual').eq('workspace_id', ws).eq('ativa', true),
    ])
    if (p.error) throw p.error
    return { itens: p.data as Pat[], pos: (v.data ?? {}) as Record<string, number>, snaps: (sn.data ?? []) as PatrimonioSnapshot[], inv: (inv.data ?? []) as Investimento[], contas: (c.data ?? []) as { nome: string; tipo: string; saldo_atual: number }[] }
  }, [ws])

  const d = q.data
  const itens = d?.itens ?? []
  const bens = itens.filter(i => i.tipo === 'ativo'); const dividas = itens.filter(i => i.tipo === 'passivo')
  const investTotal = (d?.inv ?? []).reduce((a, i) => a + Number(i.valor_atual), 0)
  const saldoContas = (d?.contas ?? []).filter(c => c.tipo !== 'cartao_credito').reduce((a, c) => a + Number(c.saldo_atual), 0)
  const faturas = Math.abs((d?.contas ?? []).filter(c => c.tipo === 'cartao_credito').reduce((a, c) => a + Number(c.saldo_atual), 0))
  const bensTotal = bens.reduce((a, i) => a + Number(i.valor), 0)
  const financiamentos = bens.reduce((a, i) => a + Number(i.saldo_devedor ?? 0), 0) + dividas.filter(x => x.categoria === 'financiamento').reduce((a, i) => a + Number(i.valor), 0)
  const emprestimos = dividas.filter(x => x.categoria !== 'financiamento').reduce((a, i) => a + Number(i.valor), 0)
  const ativos = bensTotal + investTotal + saldoContas
  const passivos = financiamentos + emprestimos + faturas
  const pl = ativos - passivos
  const geradores = bens.filter(b => b.gerador_renda).reduce((a, i) => a + Number(i.valor), 0) + investTotal
  const rendaGerada = bens.filter(b => b.gerador_renda).reduce((a, i) => a + Number(i.renda_mensal ?? 0), 0)
  const evolucao = useMemo(() => (d?.snaps ?? []).map(s => ({ mes: mesLabel(s.competencia), patrimonioLiquido: Number(s.patrimonio_liquido), ativos: Number(s.saldo_contas) + Number(s.investimentos) + Number(s.outros_ativos), passivos: Number(s.passivos) + Math.abs(Number(s.faturas_cartao)) })), [d])

  const salvar = async (e: FormEvent) => {
    e.preventDefault(); if (!modal) return; setErr(null)
    const f = modal.form; const n = (s: string) => s ? Number(String(s).replace(/\./g, '').replace(',', '.')) : null
    const cat = CATS.find(c => c.k === f.categoria)!
    const payload = { workspace_id: ws, nome: f.nome.trim(), tipo: cat.tipo, categoria: f.categoria, detalhe: f.detalhe || null, valor: n(f.valor) ?? 0, saldo_devedor: cat.tipo === 'ativo' ? (n(f.saldo_devedor) ?? 0) : 0, gerador_renda: cat.tipo === 'ativo' && f.gerador_renda, renda_mensal: f.gerador_renda ? (n(f.renda_mensal) ?? 0) : 0, valor_aquisicao: n(f.valor_aquisicao), data_aquisicao: f.data_aquisicao || null, data_referencia: f.data_referencia || todayISO(), descricao: f.descricao || null }
    const r = modal.id ? await supabase.from('patrimonio').update(payload).eq('id', modal.id) : await supabase.from('patrimonio').insert(payload)
    if (r.error) { setErr(r.error.message); return }
    setModal(null); q.refetch(); supabase.rpc('registrar_snapshot_patrimonio', { ws }).then(() => {})
  }
  const excluir = async (i: Pat) => { if (!confirm(`Excluir "${i.nome}"?`)) return; const { error } = await supabase.from('patrimonio').delete().eq('id', i.id); if (error) alert(error.message); else q.refetch() }
  const novo = (cat: string) => setModal({ form: { ...emptyForm(), categoria: cat } })
  const editar = (i: Pat) => setModal({ id: i.id, form: { nome: i.nome, categoria: i.categoria, detalhe: i.detalhe ?? '', valor: String(i.valor), saldo_devedor: i.saldo_devedor ? String(i.saldo_devedor) : '', gerador_renda: i.gerador_renda, renda_mensal: i.renda_mensal ? String(i.renda_mensal) : '', valor_aquisicao: i.valor_aquisicao != null ? String(i.valor_aquisicao) : '', data_aquisicao: i.data_aquisicao ?? '', data_referencia: i.data_referencia, descricao: i.descricao ?? '' } })

  const Cartao = ({ sec }: { sec: Secao }) => {
    const lista = itens.filter(i => sec.cats.includes(i.categoria))
    const total = lista.reduce((a, i) => a + Number(i.valor), 0); const devedor = lista.reduce((a, i) => a + Number(sec.tipo === 'ativo' ? (i.saldo_devedor ?? 0) : i.valor), 0)
    const Icon = sec.icon
    return (
      <div className="flex flex-col">
        <div className="flex items-center justify-between mb-2 px-1"><div className="font-black text-lg">{sec.titulo}</div>{podeEditar && <button className="text-sm font-bold text-ink/70 flex items-center gap-1 hover:text-brand" onClick={() => novo(sec.cats[0])}><Plus size={16} className="rounded-full border border-current" /> Adicionar</button>}</div>
        <div className="card p-4 flex-1 flex flex-col min-h-[260px]">
          {!lista.length ? <div className="flex-1 flex flex-col items-center justify-center text-muted text-sm gap-2 text-center"><Inbox size={28} className="opacity-40" />Você ainda não tem itens para acompanhar</div> : (
            <ul className="flex-1 flex flex-col divide-y divide-line">
              {lista.map(i => (
                <li key={i.id} className="py-3 flex gap-3">
                  <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center shrink-0 text-ink/70"><Icon size={20} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between gap-2"><div className="font-bold truncate">{i.nome}</div><div className="font-black num whitespace-nowrap">{brl(i.valor)}</div></div>
                    <div className="flex justify-between gap-2 text-xs text-muted"><span className="truncate">{[i.detalhe, CATS.find(c => c.k === i.categoria)?.l].filter(Boolean).join(' | ')}{i.gerador_renda && <Badge tone="green">gera renda</Badge>}</span><span className="num whitespace-nowrap">{sec.tipo === 'ativo' ? `Saldo devedor: ${brl(i.saldo_devedor ?? 0)}` : 'Saldo devedor'}</span></div>
                  </div>
                  {podeEditar && <div className="flex gap-0.5 -mr-2"><button className="btn btn-ghost p-1" onClick={() => editar(i)}><Pencil size={14} /></button><button className="btn btn-ghost p-1 text-neg" onClick={() => excluir(i)}><Trash2 size={14} /></button></div>}
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line pt-3 mt-3 text-right"><div className="font-black">Total: <span className="num">{brl(total)}</span></div><div className="text-xs text-muted num">Saldo devedor: {brl(devedor)}</div></div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Patrimônio" actions={podeEditar && <button className="btn btn-primary" onClick={() => novo('imovel')}><Plus size={16} /> Cadastrar bem ou dívida</button>}>
        <Tabs tabs={[{ key: 'bens', label: 'Bens e Dívidas' }, { key: 'resumo', label: 'Resumo Patrimonial' }, { key: 'evolucao', label: 'Evolução' }]} value={tab} onChange={setTab} />
      </PageHeader>

      {q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : tab === 'bens' ? (
        <div className="flex flex-col gap-6">
          <div className="grid lg:grid-cols-[1fr_1fr_320px] gap-5">
            <div className="flex flex-col">
              <div className="flex items-center justify-between mb-2 px-1"><div className="font-black text-lg">Investimentos</div><Link to="/investimentos" className="text-sm font-bold text-ink/70 hover:text-brand">Gerenciar</Link></div>
              <div className="card p-4 flex-1 flex flex-col min-h-[260px]">
                {!d?.inv.length ? <div className="flex-1 flex flex-col items-center justify-center text-muted text-sm gap-2 text-center"><Inbox size={28} className="opacity-40" />Nenhum investimento cadastrado</div> : <ul className="flex-1 divide-y divide-line">{d.inv.slice(0, 6).map(i => <li key={i.id} className="py-2.5 flex gap-3 items-center"><div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center text-ink/70"><TrendingUp size={18} /></div><div className="flex-1 min-w-0"><div className="font-bold truncate">{i.nome}</div><div className="text-xs text-muted truncate">{i.instituicao ?? i.subtipo ?? ''}</div></div><div className="font-black num">{brl(i.valor_atual)}</div></li>)}{d.inv.length > 6 && <li className="pt-2 text-xs text-muted">+ {d.inv.length - 6} outros</li>}</ul>}
                <div className="border-t border-line pt-3 mt-3 text-right font-black">Total: <span className="num">{brl(investTotal)}</span></div>
              </div>
            </div>
            <Cartao sec={SECOES[0]} />
            <div className="flex flex-col gap-4">
              <div className="card p-5"><div className="font-black text-lg mb-1">Ativos</div><div className="text-muted">Seus ativos somam o total de <b className="text-brand num">{brl(ativos)}</b></div></div>
              <div className="card p-5"><div className="font-black text-lg mb-1">Financiamentos</div><div className="text-muted">O saldo devedor dos seus financiamentos é <b className="text-amber-600 num">{brl(financiamentos)}</b></div></div>
              <div className="card p-5"><div className="font-black text-lg mb-1">Empréstimos e dívidas</div><div className="text-muted">O saldo devedor dos seus empréstimos, dívidas e faturas é <b className="text-neg num">{brl(emprestimos + faturas)}</b></div></div>
            </div>
          </div>
          <div className="grid lg:grid-cols-3 gap-5">
            <Cartao sec={SECOES[1]} /><Cartao sec={SECOES[2]} /><Cartao sec={SECOES[3]} />
          </div>
          {itens.some(i => i.categoria === 'participacao') && <div className="grid lg:grid-cols-3 gap-5"><Cartao sec={SECOES[4]} /></div>}
        </div>
      ) : tab === 'resumo' ? (
        <div className="grid lg:grid-cols-[1fr_1fr_320px] gap-5">
          <div className="card p-5"><div className="font-black text-lg mb-2">Ativos</div><Rosca height={220} data={[{ nome: 'Gerador de renda', valor: geradores }, { nome: 'Uso pessoal', valor: Math.max(0, ativos - geradores) }].filter(x => x.valor > 0)} /></div>
          <div className="card p-5"><div className="font-black text-lg mb-2">Passivos</div>{passivos > 0 ? <Rosca height={220} data={[{ nome: 'Empréstimos e dívidas', valor: emprestimos }, { nome: 'Financiamentos', valor: financiamentos }, { nome: 'Faturas de cartão', valor: faturas }].filter(x => x.valor > 0)} /> : <div className="text-sm text-muted py-10 text-center">Sem passivos cadastrados.</div>}</div>
          <div className="flex flex-col gap-4">
            <div className="card p-5"><div className="font-black text-lg mb-1">Ativo gerador de renda</div><div className="text-muted text-sm">Você possui <b className="text-brand">{pct(ativos ? geradores / ativos * 100 : 0, 2)}</b> dos seus ativos gerando renda, totalizando <b className="text-brand num">{brl(geradores)}</b>{rendaGerada > 0 && <> ({brl(rendaGerada)}/mês de bens)</>}.</div><Link to="/futuro" className="btn btn-primary mt-3 text-xs tracking-wider">VER MEU FUTURO</Link></div>
            <div className="card p-5"><div className="font-black text-lg mb-1">Nível de endividamento</div><div className="text-muted text-sm">Você possui <b className="text-amber-600">{pct(ativos ? passivos / ativos * 100 : 0, 2)}</b> do seu patrimônio comprometido com financiamentos e dívidas, totalizando <b className="text-amber-600 num">{brl(passivos)}</b>.</div></div>
            <div className="card p-5"><div className="font-black text-lg mb-1">Patrimônio líquido</div><div className="text-muted text-sm">Seu patrimônio líquido atual é de <b className={`num ${pl >= 0 ? 'text-amber-500' : 'text-neg'}`}>{brl(pl)}</b>.</div></div>
          </div>
          <div className="card p-5 lg:col-span-2">
            <div className="font-black text-lg mb-2">Patrimônio Líquido</div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={[{ nome: 'Ativos', v: ativos, c: '#7fb3e3' }, { nome: 'Passivos', v: passivos, c: '#eb8f4a' }, { nome: 'Patrimônio líquido', v: pl, c: '#f5c431' }]} margin={{ top: 20 }}>
                <CartesianGrid vertical={false} stroke="#eef1f4" /><XAxis dataKey="nome" tick={{ fontSize: 12, fontFamily: 'Overlock' }} axisLine={false} tickLine={false} /><YAxis hide /><Tooltip formatter={(v) => brl(Number(v))} contentStyle={{ borderRadius: 10, fontFamily: 'Overlock' }} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="v" radius={[4, 4, 0, 0]}>{[0, 1, 2].map(i => <Cell key={i} fill={['#7fb3e3', '#eb8f4a', '#f5c431'][i]} />)}<LabelList dataKey="v" position="top" formatter={(v: unknown) => brlCompact(Number(v))} style={{ fontSize: 12, fontWeight: 700, fontFamily: 'Overlock' }} /></Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className="card p-4">
          <div className="font-black mb-1">Evolução do patrimônio</div>
          <div className="text-xs text-muted mb-2">Posição registrada mensalmente (contas + investimentos + bens − dívidas). O histórico se forma a partir de agora, a cada acesso ou sincronização.</div>
          {evolucao.length >= 2 ? <LinhaChart data={evolucao} height={320} series={[{ key: 'patrimonioLiquido', name: 'Patrimônio líquido', color: '#104862' }, { key: 'ativos', name: 'Ativos', color: '#1baf7a' }, { key: 'passivos', name: 'Passivos', color: '#eb6834' }]} /> : <div className="text-sm text-muted py-6">Primeiro registro feito neste mês ({brl(pl)}). O gráfico aparece a partir do segundo mês.</div>}
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Editar item' : 'Cadastrar bem ou dívida'}>
        {modal && (() => { const cat = CATS.find(c => c.k === modal.form.categoria)!; return <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
          <Field label="Categoria" className="col-span-2"><select className="input" value={modal.form.categoria} onChange={e => setModal({ ...modal, form: { ...modal.form, categoria: e.target.value } })}><optgroup label="Bens (ativos)">{CATS.filter(c => c.tipo === 'ativo').map(c => <option key={c.k} value={c.k}>{c.l}</option>)}</optgroup><optgroup label="Dívidas (passivos)">{CATS.filter(c => c.tipo === 'passivo').map(c => <option key={c.k} value={c.k}>{c.l}</option>)}</optgroup></select></Field>
          <Field label="Nome" className="col-span-2"><input className="input" required value={modal.form.nome} onChange={e => setModal({ ...modal, form: { ...modal.form, nome: e.target.value } })} /></Field>
          <Field label={cat.tipo === 'ativo' ? 'Detalhe (ex.: Residencial, Cliente, Cônjuge)' : 'Credor / detalhe'}><input className="input" value={modal.form.detalhe} onChange={e => setModal({ ...modal, form: { ...modal.form, detalhe: e.target.value } })} /></Field>
          <Field label={cat.tipo === 'ativo' ? 'Valor atual de mercado' : 'Saldo devedor'}><input className="input num" required value={modal.form.valor} onChange={e => setModal({ ...modal, form: { ...modal.form, valor: e.target.value } })} /></Field>
          {cat.tipo === 'ativo' && <>
            <Field label="Saldo devedor do financiamento"><input className="input num" value={modal.form.saldo_devedor} onChange={e => setModal({ ...modal, form: { ...modal.form, saldo_devedor: e.target.value } })} /></Field>
            <Field label="Gera renda?"><label className="input flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={modal.form.gerador_renda} onChange={e => setModal({ ...modal, form: { ...modal.form, gerador_renda: e.target.checked } })} /> Ativo gerador de renda</label></Field>
            {modal.form.gerador_renda && <Field label="Renda mensal gerada" className="col-span-2"><input className="input num" value={modal.form.renda_mensal} onChange={e => setModal({ ...modal, form: { ...modal.form, renda_mensal: e.target.value } })} /></Field>}
            <Field label="Valor de aquisição"><input className="input num" value={modal.form.valor_aquisicao} onChange={e => setModal({ ...modal, form: { ...modal.form, valor_aquisicao: e.target.value } })} /></Field>
            <Field label="Data de aquisição"><input type="date" className="input" value={modal.form.data_aquisicao} onChange={e => setModal({ ...modal, form: { ...modal.form, data_aquisicao: e.target.value } })} /></Field>
          </>}
          <Field label="Data de referência"><input type="date" className="input" value={modal.form.data_referencia} onChange={e => setModal({ ...modal, form: { ...modal.form, data_referencia: e.target.value } })} /></Field>
          <Field label="Observação" className="col-span-2"><textarea className="input" rows={2} value={modal.form.descricao} onChange={e => setModal({ ...modal, form: { ...modal.form, descricao: e.target.value } })} /></Field>
          <div className="col-span-2"><ErrorBox msg={err} /></div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
        </form> })()}
      </Modal>
    </div>
  )
}
