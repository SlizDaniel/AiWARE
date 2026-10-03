import type { ReorderDraft } from '@/lib/api'

export function confirmationMessage(summary: string, draft: ReorderDraft | null): string {
  if (draft?.created === false) {
    return `Istnieje już szkic zamówienia: ${draft.item_name} — ${draft.quantity} ${draft.unit}. Nie dodano nowego szkica ani nie zmieniono ilości.`
  }
  return draft
    ? `Zapisano: ${summary} · szkic zamówienia ${draft.quantity} ${draft.unit} w kolejce`
    : `Zapisano w bazie: ${summary} · wpis w historii`
}
