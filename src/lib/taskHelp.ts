export type TaskHelp = {
  task_id: string
  mode: 'llm' | 'procedures' | 'missing'
  steps: { text: string; procedure_id: number; procedure_topic: string }[]
  sources: { id: number; topic: string; text: string }[]
  warning: string
}
