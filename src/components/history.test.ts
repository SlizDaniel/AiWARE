import { expect, test } from 'vitest'
import { isUndoable } from './history'

test('only stock changes that are neither undone nor undo entries can be undone', () => {
  expect(isUndoable({ event_type: 'stock_change', undo_of: null, undone_by: null })).toBe(true)
  expect(isUndoable({ event_type: 'stock_change', undo_of: null, undone_by: 12 })).toBe(false)
  expect(isUndoable({ event_type: 'stock_change', undo_of: 4, undone_by: null })).toBe(false)
  expect(isUndoable({ event_type: 'reorder_approved', undo_of: null, undone_by: null })).toBe(false)
  expect(isUndoable({ event_type: 'inventory_import', undo_of: null, undone_by: null })).toBe(false)
})

test('entries from an older server without undo fields are still undoable stock changes', () => {
  const legacy = { event_type: 'stock_change' } as Parameters<typeof isUndoable>[0]
  expect(isUndoable(legacy)).toBe(true)
})
