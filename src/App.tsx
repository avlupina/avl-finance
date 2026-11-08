import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Layout, { NAV } from './components/Layout'
import Login from './pages/Login'
import Lancamentos from './pages/Lancamentos'
import Status from './pages/Status'
import Agenda from './pages/Agenda'
import Projecoes from './pages/Projecoes'
import Plano from './pages/Plano'
import Protecao from './pages/Protecao'
import Assistente from './components/Assistente'
import Resultados from './pages/Resultados'
import Analise from './pages/Analise'
import Investimentos from './pages/Investimentos'
import Futuro from './pages/Futuro'
import Patrimonio from './pages/Patrimonio'
import Contas from './pages/Contas'
import Integracoes from './pages/Integracoes'
import Cadastros from './pages/Cadastros'
import Usuarios from './pages/Usuarios'
import { Loading } from './components/ui'

function Guard() {
  const { session, loading, workspace, canSee } = useAuth()
  if (loading) return <div className="h-full flex items-center justify-center"><Loading /></div>
  if (!session) return <Login />
  if (!workspace) return <div className="h-full flex items-center justify-center p-6 text-center text-muted">Sua conta ainda não está vinculada a nenhuma carteira. Peça ao proprietário para convidá-lo em <b>Usuários</b>.</div>
  const first = NAV.find(n => canSee(n.modulo))?.to ?? '/status'
  return (
    <Routes>
      <Route element={<><Layout /><Assistente /></>}>
        <Route index element={<Navigate to={first} replace />} />
        <Route path="/status" element={<Status />} />
        <Route path="/agenda" element={<Agenda />} />
        <Route path="/lancamentos" element={<Lancamentos />} />
        <Route path="/projecoes" element={<Projecoes />} />
        <Route path="/plano" element={<Plano />} />
        <Route path="/protecao" element={<Protecao />} />
        <Route path="/resultados" element={<Resultados />} />
        <Route path="/analise" element={<Analise />} />
        <Route path="/investimentos" element={<Investimentos />} />
        <Route path="/futuro" element={<Futuro />} />
        <Route path="/patrimonio" element={<Patrimonio />} />
        <Route path="/contas" element={<Contas />} />
        <Route path="/integracoes" element={<Integracoes />} />
        <Route path="/cadastros" element={<Cadastros />} />
        <Route path="/usuarios" element={<Usuarios />} />
        <Route path="*" element={<Navigate to={first} replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Guard />
      </HashRouter>
    </AuthProvider>
  )
}
