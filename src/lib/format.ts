export const brl = (v: number | string | null | undefined, opts: Intl.NumberFormatOptions = {}) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2, ...opts }).format(Number(v ?? 0))

export const brlCompact = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(v)

export const pct = (v: number | null | undefined, digits = 1) =>
  v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`

export const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return '—'
  const s = typeof d === 'string' ? d : d.toISOString()
  const [y, m, day] = s.slice(0, 10).split('-')
  return `${day}/${m}/${y}`
}

export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

export const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
export const mesLabel = (competencia: string) => {
  const [y, m] = competencia.slice(0, 10).split('-')
  return `${MESES[Number(m) - 1]}/${y.slice(2)}`
}

export const todayISO = () => new Date().toISOString().slice(0, 10)
export const firstDayOfMonth = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
export const competenciaISO = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-01`

export const TIPO_CONTA_LABEL: Record<string, string> = {
  corrente: 'Conta corrente', poupanca: 'Poupança', cartao_credito: 'Cartão de crédito',
  investimento: 'Conta investimento', dinheiro: 'Dinheiro', outro: 'Outro',
}
export const TIPO_INV_LABEL: Record<string, string> = {
  renda_fixa: 'Renda fixa', renda_variavel: 'Renda variável', fundos: 'Fundos',
  previdencia: 'Previdência', cripto: 'Cripto', outro: 'Outro',
}
export const PAPEL_LABEL: Record<string, string> = { owner: 'Proprietário', admin: 'Administrador', editor: 'Editor', leitor: 'Leitor' }

export function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const cols = Object.keys(rows[0])
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [cols.join(';'), ...rows.map(r => cols.map(c => esc(r[c])).join(';'))].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click()
}

/** Traduz avisos técnicos do agregador para linguagem de usuário. */
export function avisoAmigavel(msg: string | null | undefined): string | null {
  if (!msg) return null
  if (/cant be updated|can't be updated|MeuPluggy item/i.test(msg)) return 'Conexão via Meu Pluggy: a busca de dados novos no banco é feita pelo próprio Meu Pluggy (automática, ~1x ao dia). Para forçar agora, abra meu.pluggy.ai → Conexões → Atualizar nessa instituição e depois clique em Atualizar aqui.'
  if (/429|rate limit|too many/i.test(msg)) return 'Limite de atualizações do agregador atingido; tente novamente mais tarde.'
  if (/LOGIN_ERROR|INVALID_CREDENTIALS|consent/i.test(msg)) return 'O consentimento com o banco expirou ou foi revogado. Reautorize a conexão (ícone de escudo em Integrações).'
  return msg
}
