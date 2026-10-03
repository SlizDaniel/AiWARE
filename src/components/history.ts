import type { HistoryEntry } from '@/lib/api'

/** Wpis, który da się cofnąć: zmiana stanu, jeszcze niecofnięta i sama niebędąca cofnięciem. */
export function isUndoable(entry: Pick<HistoryEntry, 'event_type' | 'undo_of' | 'undone_by'>): boolean {
  return entry.event_type === 'stock_change' && entry.undone_by == null && entry.undo_of == null
}
