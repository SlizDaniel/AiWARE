import { listItems } from '@/server/db'
import { HttpError, route } from '@/server/http'
import { exportInventoryCsv, exportInventoryXlsx } from '@/server/inventory'
import { session } from '@/server/session'

export const GET = route(async (_request: Request, context: { params: Promise<{ format: string }> }) => {
  const { format } = await context.params
  if (format !== 'csv' && format !== 'xlsx') throw new HttpError(404, 'Obsługiwane formaty eksportu to CSV i XLSX.')
  const { db } = await session()
  const items = await listItems(db)
  const body = format === 'csv' ? exportInventoryCsv(items) : exportInventoryXlsx(items)
  return new Response(Buffer.from(body), {
    headers: {
      'Content-Type':
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="magazyn.${format}"`,
      'Cache-Control': 'no-store',
    },
  })
})
