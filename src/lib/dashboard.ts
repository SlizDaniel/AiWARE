/** Read-only manager dashboard contract. No frontend components or fetching side effects. */
export const DASHBOARD_EVENT_TYPES = [
  'stock_change', 'inventory_import', 'item_added', 'zone_added', 'procedure_saved',
  'reorder_draft_created', 'reorder_draft_updated', 'reorder_cancelled', 'reorder_approved', 'reorder_rejected',
] as const
export type DashboardEventType = typeof DASHBOARD_EVENT_TYPES[number]
export type ActivityStatus = 'all' | 'active' | 'undone' | 'undo'
export type DashboardRange = { from: string; to: string; timezone: string }
export type DashboardResponse = {
  generated_at: string
  data_version: number
  range: DashboardRange
  current: { total_items: number; below_minimum: number; pending_drafts: number; missing_location: number }
  period: { audit_events: number; stock_changes: number; withdrawals: number; receipts: number; undo_count: number; import_events: number }
  daily: { date: string; withdrawals: number; receipts: number; undo_count: number }[]
  most_changed_items: { item_id: number | null; item_name: string; stock_changes: number; withdrawals: number; receipts: number }[]
  attention: {
    below_minimum: { item_id: number; item_name: string; quantity: number; minimum: number; unit: string; pending_draft_id: number | null }[]
    pending_drafts: { id: number; item_id: number; item_name: string; quantity: number; unit: string; deliver_on: string; created_at: string; waiting_hours: number; overdue: boolean; waiting_priority: 'normal' | 'warning' | 'critical' }[]
    missing_location: { item_id: number; item_name: string }[]
  }
}

export type ShiftSummaryResponse = {
  window: { start: string; end: string; timezone: string }
  metrics: DashboardResponse['period']
  authors: { actor_id: string | null; actor: string; stock_changes: number; undo_count: number }[]
  authors_truncated: boolean
  procedures_saved: { audit_id: number; topic: string; actor: string; ts: string }[]
  procedures_truncated: boolean
  current: DashboardResponse['current']
  generated_at: string
}
export type StockTrendResponse = {
  range: DashboardRange
  item: { id: number; name: string; unit: string; quantity: number; minimum: number }
  opening_quantity: number | null
  closing_quantity: number | null
  points: { audit_id: number; ts: string; event_type: string; before: number; after: number; delta: number; undo_of: number | null; undone_by: number | null; continuous: boolean }[]
  quality: { opening_known: boolean; continuity_warnings: number; current_matches_latest_audit: boolean | null; unit_is_current: true }
}
export type DashboardActivity = {
  id: number; ts: string; actor_id: string | null; actor: string
  item_id: number | null; item_name: string; event_type: string
  text: string; details: string; delta: number; before: number; after: number
  undo_of: number | null; undone_by: number | null; status: Exclude<ActivityStatus, 'all'>
}
export type DashboardActivityResponse = {
  range: DashboardRange
  filters: { actor_id: string | null; event_type: DashboardEventType | null; item_id: number | null; q: string; status: ActivityStatus }
  page: number; page_size: number; total: number; has_more: boolean
  entries: DashboardActivity[]
}
