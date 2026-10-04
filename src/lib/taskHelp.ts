export type TaskHelp = {
  task_id: string
  mode: 'llm' | 'procedures' | 'missing'
  steps: { text: string; procedure_id: number; procedure_topic: string }[]
  /** Negative source IDs identify current packing rules; positive IDs are legacy notes. */
  sources: { id: number; topic: string; text: string; kind?: 'procedure' | 'packing_rule' }[]
  warning: string
}
