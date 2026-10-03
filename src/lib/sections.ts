export type SectionId = 'mapa' | 'stany' | 'kolejka' | 'historia' | 'procedury' | 'dashboard' | 'ustawienia'

/** `managerOnly` — sekcja widoczna tylko dla kierownika (po ustaleniu roli). */
export const SECTIONS: { id: SectionId; label: string; managerOnly?: boolean }[] = [
  { id: 'mapa', label: 'Mapa' },
  { id: 'stany', label: 'Stany' },
  { id: 'kolejka', label: 'Kolejka zatwierdzeń' },
  { id: 'historia', label: 'Historia' },
  { id: 'procedury', label: 'Procedury' },
  { id: 'dashboard', label: 'Dashboard kierownika', managerOnly: true },
  { id: 'ustawienia', label: 'Ustawienia' },
]

/** Sekcje dostępne dla roli; przed ustaleniem roli (`canManage=false`) bez sekcji kierownika. */
export function visibleSections(canManage: boolean) {
  return SECTIONS.filter((section) => canManage || !section.managerOnly)
}
