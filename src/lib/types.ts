export interface Banco { id: string; workspace_id: string; nome: string; codigo_compe: string | null; ispb: string | null; cor: string | null; pluggy_connector_id: number | null; ativo: boolean }
export interface PlanoConta { id: string; workspace_id: string; parent_id: string | null; codigo: string; nome: string; tipo: 'receita' | 'despesa' | 'transferencia' | 'investimento'; natureza: 'fixa' | 'variavel' | null; ativo: boolean }
export interface Conta {
  id: string; workspace_id: string; banco_id: string | null; integracao_id: string | null; external_id: string | null; nome: string;
  tipo: 'corrente' | 'poupanca' | 'cartao_credito' | 'investimento' | 'dinheiro' | 'outro'; agencia: string | null; numero: string | null; moeda: string;
  saldo_atual: number; limite: number | null; fechamento_fatura: number | null; vencimento_fatura: number | null; ativa: boolean; ultima_sincronizacao: string | null;
  bancos?: Banco | null
}
export interface Lancamento {
  id: string; workspace_id: string; conta_id: string | null; conta_destino_id: string | null; plano_conta_id: string | null; data: string; competencia: string;
  descricao: string; valor: number; tipo: 'receita' | 'despesa' | 'transferencia'; status: 'pendente' | 'efetivado' | 'conciliado'; origem: string;
  categoria_origem: string | null; tags: string[] | null; observacao: string | null;
  contas?: { nome: string } | null; plano_contas?: { nome: string; codigo: string } | null
}
export interface Investimento {
  id: string; workspace_id: string; conta_id: string | null; integracao_id: string | null; nome: string; tipo: string; subtipo: string | null; instituicao: string | null; codigo: string | null;
  quantidade: number | null; valor_aplicado: number; valor_atual: number; rentabilidade_pct: number | null; taxa: string | null; data_aplicacao: string | null; vencimento: string | null; liquidez: string | null; atualizado_em: string
}
export interface Patrimonio { id: string; workspace_id: string; nome: string; tipo: 'ativo' | 'passivo'; categoria: string; valor: number; valor_aquisicao: number | null; data_aquisicao: string | null; data_referencia: string; descricao: string | null }
export interface Meta { id: string; workspace_id: string; nome: string; tipo: 'meta' | 'projecao' | 'reserva'; valor_alvo: number; valor_atual: number; aporte_mensal: number | null; data_alvo: string | null; descricao: string | null }
export interface Integracao { id: string; workspace_id: string; provedor: string; external_item_id: string | null; connector_id: number | null; connector_nome: string | null; status: string; ultima_sincronizacao: string | null; erro: string | null; created_at: string }
export interface Membro { id: string; workspace_id: string; user_id: string | null; email: string; papel: 'owner' | 'admin' | 'editor' | 'leitor'; permissoes: Record<string, string>; ativo: boolean; convidado_em: string; aceito_em: string | null }
export interface Orcamento { id: string; plano_conta_id: string; competencia: string; valor: number }
export interface Fornecedor { id: string; workspace_id: string; nome: string; documento: string | null; plano_conta_id: string | null; padrao_descricao: string | null; tipo_padrao: 'receita' | 'despesa' | 'transferencia' | null; observacao: string | null; ativo: boolean }
export interface Projecao { id: string; workspace_id: string; competencia: string; data_prevista: string | null; descricao: string; plano_conta_id: string | null; fornecedor_id: string | null; tipo: 'receita' | 'despesa' | 'transferencia'; valor: number; recorrente: boolean; status: 'prevista' | 'realizada' | 'cancelada'; lancamento_id: string | null; observacao: string | null }
export interface PatrimonioSnapshot { competencia: string; saldo_contas: number; faturas_cartao: number; investimentos: number; outros_ativos: number; passivos: number; patrimonio_liquido: number }
