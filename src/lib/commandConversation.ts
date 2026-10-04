/** Short, client-local memory of an unresolved command. */
export type ClarificationTurn = { userText: string; question: string }
export const MAX_CLARIFICATION_TURNS = 4
export const CLARIFICATION_TTL_MS = 5 * 60_000
export const CONVERSATION_LIMIT_MESSAGE = 'Limit doprecyzowań został osiągnięty. Rozpocznij nową komendę i podaj całe polecenie.'

export function parseCommandConversation(value: unknown): ClarificationTurn[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_CLARIFICATION_TURNS) throw new Error('Niepoprawny kontekst komendy.')
  return value.map((turn) => {
    if (!turn || typeof turn !== 'object' || Array.isArray(turn)
      || typeof turn.userText !== 'string' || !turn.userText.trim() || turn.userText.length > 2000
      || typeof turn.question !== 'string' || !turn.question.trim() || turn.question.length > 1000
      || Object.keys(turn).some((key) => key !== 'userText' && key !== 'question')) {
      throw new Error('Niepoprawny kontekst komendy.')
    }
    return { userText: turn.userText, question: turn.question }
  })
}

export function createCommandConversation(now = Date.now) {
  let turns: ClarificationTurn[] = []
  let expires = 0
  const clear = () => { turns = []; expires = 0 }
  const context = (): ClarificationTurn[] => {
    if (now() >= expires) clear()
    return turns.map((turn) => ({ ...turn }))
  }
  return {
    clear,
    context,
    /** false means the caller must explicitly ask for a new complete command. */
    remember(userText: string, question: string): boolean {
      context()
      if (turns.length >= MAX_CLARIFICATION_TURNS) { clear(); return false }
      turns.push({ userText, question })
      expires = now() + CLARIFICATION_TTL_MS
      return true
    },
  }
}
