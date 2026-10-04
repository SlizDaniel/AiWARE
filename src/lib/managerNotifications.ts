export type ManagerNotification = {
  id: string
  kind: 'out_of_stock' | 'low_stock' | 'large_withdrawal' | 'overdue_order'
  priority: 'critical' | 'warning'
  title: string
  message: string
  item_id: number
  item_name: string
  occurred_at: string | null
  target: 'stany' | 'historia' | 'kolejka'
  read: boolean
}
export type ManagerNotifications = {
  generated_at: string
  notifications: ManagerNotification[]
  unread_count: number
  critical_count: number
  truncated: boolean
}
