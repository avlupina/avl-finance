import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MessageSquare, X, Send, Loader2, Sparkles, Trash2 } from 'lucide-react'
import { supabase, callFunction } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

interface Msg { id?: string; papel: 'user' | 'assistant'; conteudo: string }
const SUGESTOES = ['Como está minha saúde financeira este mês?', 'Onde estou gastando mais do que deveria?', 'Quanto preciso poupar por mês para atingir meus objetivos?', 'Minha reserva de emergência é suficiente?']

/** Renderização leve de Markdown (negrito, listas, tabelas simples, quebras). */
function Md({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let i = 0
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, k) => p.startsWith('**') ? <b key={k}>{p.slice(2, -2)}</b> : p.startsWith('`') ? <code key={k} className="bg-black/5 px-1 rounded text-[12px]">{p.slice(1, -1)}</code> : p)
  while (i < lines.length) {
    const l = lines[i]
    if (l.trim().startsWith('|') && lines[i + 1]?.includes('---')) {
      const rows: string[][] = []; const head = l.split('|').slice(1, -1).map(s => s.trim()); i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i].split('|').slice(1, -1).map(s => s.trim())); i++ }
      out.push(<table key={out.length} className="text-xs my-2 w-full"><thead><tr>{head.map((h, k) => <th key={k} className="text-left border-b border-line px-1 py-0.5">{inline(h)}</th>)}</tr></thead><tbody>{rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className="px-1 py-0.5 border-b border-line/50 num">{inline(c)}</td>)}</tr>)}</tbody></table>)
      continue
    }
    if (/^\s*[-*•]\s+/.test(l)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*•]\s+/, '')); i++ }
      out.push(<ul key={out.length} className="list-disc pl-4 my-1 flex flex-col gap-0.5">{items.map((it, k) => <li key={k}>{inline(it)}</li>)}</ul>); continue
    }
    if (/^\s*\d+[.)]\s+/.test(l)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++ }
      out.push(<ol key={out.length} className="list-decimal pl-4 my-1 flex flex-col gap-0.5">{items.map((it, k) => <li key={k}>{inline(it)}</li>)}</ol>); continue
    }
    if (l.startsWith('#')) { out.push(<div key={out.length} className="font-black mt-2">{inline(l.replace(/^#+\s*/, ''))}</div>); i++; continue }
    if (l.trim() === '') { i++; continue }
    out.push(<p key={out.length} className="my-1">{inline(l)}</p>); i++
  }
  return <>{out}</>
}

export default function Assistente() {
  const { workspace, user } = useAuth()
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const ws = workspace?.id

  useEffect(() => {
    if (!open || !ws || !user) return
    supabase.from('assistente_mensagens').select('id, papel, conteudo').eq('workspace_id', ws).eq('user_id', user.id).order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setMsgs(((data ?? []) as Msg[]).reverse()))
  }, [open, ws, user])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  const enviar = async (texto?: string) => {
    const t = (texto ?? input).trim(); if (!t || !ws || busy) return
    setInput(''); setErr(null); setBusy(true)
    setMsgs(m => [...m, { papel: 'user', conteudo: t }])
    try {
      const r = await callFunction<{ resposta: string }>('assistente', { workspace_id: ws, mensagem: t })
      setMsgs(m => [...m, { papel: 'assistant', conteudo: r.resposta }])
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const limpar = async () => {
    if (!ws || !user || !confirm('Apagar o histórico desta conversa?')) return
    await supabase.from('assistente_mensagens').delete().eq('workspace_id', ws).eq('user_id', user.id); setMsgs([])
  }

  if (!ws) return null
  return (
    <>
      {!open && <button onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-40 btn bg-white shadow-lg border-line px-4 py-2.5 rounded-full no-print"><MessageSquare size={18} className="text-brand" /> Assistente</button>}
      {open && (
        <div className="fixed bottom-5 right-5 z-40 w-[400px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-2rem)] card shadow-2xl flex flex-col no-print">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-line bg-brand text-white rounded-t-xl">
            <Sparkles size={18} /><div className="font-black flex-1">Assistente AVL</div>
            <button className="p-1 rounded hover:bg-white/10" title="Limpar conversa" onClick={limpar}><Trash2 size={16} /></button>
            <button className="p-1 rounded hover:bg-white/10" onClick={() => setOpen(false)}><X size={18} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 text-sm">
            {!msgs.length && <div className="text-muted text-xs p-2">Pergunte sobre sua situação financeira. O assistente usa seus saldos, lançamentos, metas e projeções para responder. Sugestões:</div>}
            {!msgs.length && SUGESTOES.map(s => <button key={s} onClick={() => enviar(s)} className="text-left text-xs px-3 py-2 rounded-lg border border-line hover:bg-brand-soft">{s}</button>)}
            {msgs.map((m, i) => (
              <div key={m.id ?? i} className={`max-w-[92%] rounded-xl px-3 py-2 ${m.papel === 'user' ? 'self-end bg-brand text-white' : 'self-start bg-surface'}`}>
                {m.papel === 'user' ? m.conteudo : <Md text={m.conteudo} />}
              </div>
            ))}
            {busy && <div className="self-start bg-surface rounded-xl px-3 py-2 text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> analisando seus dados...</div>}
            {err && <div className="text-xs text-neg bg-red-50 rounded-lg px-3 py-2">{err}</div>}
            <div ref={endRef} />
          </div>
          <form className="p-3 border-t border-line flex gap-2" onSubmit={e => { e.preventDefault(); enviar() }}>
            <input className="input" placeholder="Pergunte algo..." value={input} onChange={e => setInput(e.target.value)} disabled={busy} />
            <button className="btn btn-primary px-3" disabled={busy || !input.trim()}><Send size={16} /></button>
          </form>
        </div>
      )}
    </>
  )
}
