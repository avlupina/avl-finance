import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { ErrorBox, Field } from '../components/ui'
import { Loader2 } from 'lucide-react'

type Mode = 'login' | 'signup' | 'reset'

export default function Login() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [nome, setNome] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setInfo(null); setBusy(true)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
        if (error) throw error
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password: senha, options: { data: { nome }, emailRedirectTo: window.location.origin + window.location.pathname } })
        if (error) throw error
        if (!data.session) setInfo('Conta criada. Verifique seu e-mail para confirmar o acesso e depois entre.')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname })
        if (error) throw error
        setInfo('Enviamos um link de redefinição para o seu e-mail.')
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setErr(m.includes('Invalid login') ? 'E-mail ou senha inválidos.' : m.includes('already registered') ? 'E-mail já cadastrado.' : m)
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full grid md:grid-cols-[1.1fr_1fr]">
      <div className="hidden md:flex flex-col justify-between bg-brand text-white p-12 relative overflow-hidden">
        <div className="absolute -right-24 -bottom-24 w-[480px] h-[480px] rounded-full bg-white/5" />
        <div className="absolute -right-10 -bottom-10 w-[300px] h-[300px] rounded-full bg-white/5" />
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center"><img src="./logo.png" className="w-13 h-13 object-contain" alt="AVL" /></div>
          <div><div className="text-3xl font-black">AVL Finance</div><div className="text-white/70">Gestão financeira pessoal</div></div>
        </div>
        <div className="relative">
          <h2 className="text-4xl font-black leading-tight max-w-md">Suas contas, investimentos e patrimônio em um só mapa.</h2>
          <p className="text-white/75 mt-4 max-w-md">Integração Open Finance, plano de contas pessoal, DRE mensal, indicadores de uso do dinheiro e projeções de futuro.</p>
        </div>
        <div className="text-white/50 text-sm">© {new Date().getFullYear()} AVL Finance</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-4">
          <div className="md:hidden flex items-center gap-3 mb-2">
            <img src="./logo.png" className="w-12 h-12 object-contain" alt="AVL" /><div className="text-2xl font-black text-brand">AVL Finance</div>
          </div>
          <div>
            <h1 className="text-2xl font-black">{mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Criar conta' : 'Recuperar senha'}</h1>
            <p className="text-muted text-sm">{mode === 'login' ? 'Acesse com seu e-mail e senha.' : mode === 'signup' ? 'Crie o acesso do proprietário da carteira.' : 'Informe o e-mail cadastrado.'}</p>
          </div>
          {mode === 'signup' && <Field label="Nome"><input className="input" value={nome} onChange={e => setNome(e.target.value)} required /></Field>}
          <Field label="E-mail"><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></Field>
          {mode !== 'reset' && <Field label="Senha"><input className="input" type="password" value={senha} onChange={e => setSenha(e.target.value)} required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></Field>}
          <ErrorBox msg={err} />
          {info && <div className="rounded-lg border border-green-200 bg-green-50 text-green-800 px-3 py-2 text-sm">{info}</div>}
          <button className="btn btn-primary justify-center py-2.5" disabled={busy}>{busy && <Loader2 size={16} className="animate-spin" />}{mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Criar conta' : 'Enviar link'}</button>
          <div className="flex justify-between text-sm text-muted">
            {mode !== 'login' ? <button type="button" className="hover:text-brand" onClick={() => setMode('login')}>Já tenho conta</button> : <button type="button" className="hover:text-brand" onClick={() => setMode('signup')}>Criar conta</button>}
            {mode !== 'reset' && <button type="button" className="hover:text-brand" onClick={() => setMode('reset')}>Esqueci a senha</button>}
          </div>
        </form>
      </div>
    </div>
  )
}
