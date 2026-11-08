/** Score financeiro 0–100 em quatro pilares, no espírito do "termômetro" de planejadores financeiros. */
export interface ScoreInput {
  receitaMedia: number; despesaMedia: number       // últimos meses
  fixasMedia: number                               // despesas fixas (natureza 'fixa')
  dividasMedia: number                             // parcelas de financiamentos/empréstimos no período
  disponivel: number                               // contas + investimentos de liquidez
  investimentos: number; ativosTotais: number; passivosTotais: number
  ativosGeradores: number                          // bens/investimentos que geram renda
  semCategoriaPct: number                          // % de lançamentos sem categoria
  metasAtivas: number; aderenciaPlano: number | null // % categorias dentro do planejado (null se sem plano)
  progressoIF: number                              // % do patrimônio necessário para independência
  reservaMeses: number
  classesInvest: number                            // nº de classes de ativos distintas
}
export interface Pilar { key: string; label: string; score: number; cor: string; detalhes: string[] }
export interface Alerta { nivel: 'alto' | 'medio' | 'info'; texto: string; acao: string; to: string }

const clamp = (v: number, a = 0, b = 100) => Math.max(a, Math.min(b, v))
const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const faixa = (s: number) => s < 20 ? { rotulo: 'Na contramão!', cor: '#c0392b' } : s < 40 ? { rotulo: 'Desvio de rota!', cor: '#e67e22' } : s < 60 ? { rotulo: 'No caminho', cor: '#f1c40f' } : s < 80 ? { rotulo: 'Em boa rota', cor: '#27ae60' } : { rotulo: 'Rota exemplar!', cor: '#2a78d6' }

export function calcularScore(i: ScoreInput) {
  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0)
  const poupanca = pct(i.receitaMedia - i.despesaMedia, i.receitaMedia)           // meta ≥ 20%
  const fixas = pct(i.fixasMedia, i.receitaMedia)                                  // ideal ≤ 50%
  const dividas = pct(i.dividasMedia, i.despesaMedia)                              // ideal ≤ 30% das despesas
  const endividamento = pct(i.passivosTotais, i.ativosTotais)                      // ideal ≤ 30%
  const geradores = pct(i.ativosGeradores, i.ativosTotais)

  // 1) Organização financeira: poupança, categorização, aderência ao plano
  const org = clamp(
    clamp(poupanca * 2.5, 0, 50) +                               // 20% de poupança = 50 pts
    clamp(25 - i.semCategoriaPct * 2.5, 0, 25) +                 // 0% sem categoria = 25 pts
    (i.aderenciaPlano == null ? 10 : clamp(i.aderenciaPlano / 4, 0, 25)))
  // 2) Patrimônio: endividamento, reserva, comprometimento com dívidas
  const pat = clamp(
    clamp(40 - endividamento * (40 / 60), 0, 40) +               // 0% = 40 pts; 60%+ = 0
    clamp(i.reservaMeses * (35 / 6), 0, 35) +                    // 6 meses = 35 pts
    clamp(25 - Math.max(0, dividas - 10) * (25 / 40), 0, 25))    // até 10% das despesas = 25 pts; 50%+ = 0
  // 3) Liberdade financeira: progresso para a independência + capacidade de poupança
  const lib = clamp(clamp(i.progressoIF, 0, 70) + clamp(poupanca * 1.5, 0, 30))
  // 4) Gestão de ativos: ativos geradores de renda, diversificação, investimentos vs ativos
  const ges = clamp(clamp(geradores, 0, 40) + clamp(i.classesInvest * 10, 0, 30) + clamp(pct(i.investimentos, i.ativosTotais), 0, 30))

  const pilares: Pilar[] = [
    { key: 'org', label: 'Organização financeira', score: Math.round(org), cor: '#c0392b', detalhes: [`Taxa de poupança ${poupanca.toFixed(1)}% (meta ≥ 20%)`, `${i.semCategoriaPct.toFixed(0)}% dos lançamentos sem categoria`, i.aderenciaPlano == null ? 'Sem plano mensal definido' : `${i.aderenciaPlano.toFixed(0)}% das categorias dentro do planejado`] },
    { key: 'pat', label: 'Meu patrimônio', score: Math.round(pat), cor: '#e67e22', detalhes: [`Endividamento ${Math.min(999, endividamento).toFixed(1)}% dos ativos (ideal ≤ 30%)`, `Reserva de ${i.reservaMeses.toFixed(1)} meses (meta 6)`, `Dívidas consomem ${dividas.toFixed(1)}% das despesas`] },
    { key: 'lib', label: 'Liberdade financeira', score: Math.round(lib), cor: '#2a78d6', detalhes: [`${i.progressoIF.toFixed(1)}% do patrimônio para independência`, `Capacidade de poupança ${poupanca.toFixed(1)}%`] },
    { key: 'ges', label: 'Gestão de ativos', score: Math.round(ges), cor: '#f1c40f', detalhes: [`${geradores.toFixed(0)}% dos ativos geram renda`, `${i.classesInvest} classe(s) de investimento`, `Investimentos = ${pct(i.investimentos, i.ativosTotais).toFixed(0)}% dos ativos`] },
  ]
  const total = Math.round(org * 0.3 + pat * 0.25 + lib * 0.25 + ges * 0.2)

  const alertas: Alerta[] = []
  if (i.receitaMedia > 0 && i.despesaMedia > i.receitaMedia) alertas.push({ nivel: 'alto', texto: `Você está gastando ${(pct(i.despesaMedia - i.receitaMedia, i.receitaMedia)).toFixed(2)}% a mais do que ganha. Revise o orçamento e as metas de gasto.`, acao: 'Ajustar plano', to: '/plano' })
  else if (poupanca < 10 && i.receitaMedia > 0) alertas.push({ nivel: 'medio', texto: `Sua taxa de poupança está em ${poupanca.toFixed(1)}%. A referência mínima é 10% e a ideal 20%.`, acao: 'Ajustar plano', to: '/plano' })
  if (dividas > 30) alertas.push({ nivel: 'alto', texto: `Dívidas e financiamentos estão comprometendo ${dividas.toFixed(2)}% das suas despesas.`, acao: 'Ver patrimônio', to: '/patrimonio' })
  if (i.ativosTotais > 0 && i.passivosTotais > i.ativosTotais) alertas.push({ nivel: 'alto', texto: `Seus passivos (${fmtBRL(i.passivosTotais)}) superam seus ativos (${fmtBRL(i.ativosTotais)}). Cadastre seus bens em Patrimônio para refletir a posição real.`, acao: 'Ver patrimônio', to: '/patrimonio' })
  else if (endividamento > 50) alertas.push({ nivel: 'alto', texto: `${endividamento.toFixed(1)}% do seu patrimônio está comprometido com passivos.`, acao: 'Ver patrimônio', to: '/patrimonio' })
  if (i.reservaMeses < 3) alertas.push({ nivel: 'medio', texto: `Reserva de emergência cobre ${i.reservaMeses.toFixed(1)} mês(es) de despesas; o ideal são 6.`, acao: 'Ver futuro', to: '/futuro' })
  if (fixas > 60) alertas.push({ nivel: 'medio', texto: `Despesas fixas consomem ${fixas.toFixed(0)}% da renda — pouca margem para imprevistos.`, acao: 'Ver análise', to: '/analise' })
  if (i.semCategoriaPct > 5) alertas.push({ nivel: 'info', texto: `${i.semCategoriaPct.toFixed(0)}% dos lançamentos ainda sem categoria; os indicadores ficam imprecisos.`, acao: 'Classificar', to: '/lancamentos' })
  if (i.aderenciaPlano == null) alertas.push({ nivel: 'info', texto: 'Você ainda não definiu metas de gasto por categoria para este mês.', acao: 'Criar plano', to: '/plano' })
  if (geradores < 10 && i.ativosTotais > 0) alertas.push({ nivel: 'info', texto: `Apenas ${geradores.toFixed(0)}% dos seus ativos geram renda.`, acao: 'Ver patrimônio', to: '/patrimonio' })

  return { total, ...faixa(total), pilares, alertas, indicadores: { poupanca, fixas, dividas, endividamento, geradores } }
}
