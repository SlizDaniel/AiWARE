export type WorkTask = {
  id: string; title: string; description: string; priority: 'normal' | 'urgent'
  status: 'assigned' | 'done' | 'cancelled'; assigned_to: string; assignee_name: string
  created_by: string; creator_name: string; created_at: string; read_at: string | null; done_at: string | null
}
export type WorkTasksResponse = { tasks: WorkTask[]; unread_count: number; open_count: number; page: number; has_more: boolean }
export type CreateWorkTask = { title: string; description: string; assigned_to: string; priority: 'normal' | 'urgent' }
