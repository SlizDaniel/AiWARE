export type SectionId = 'mapa' | 'stany' | 'kolejka' | 'historia' | 'procedury' | 'ustawienia'

export const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'mapa', label: 'Mapa' },
  { id: 'stany', label: 'Stany' },
  { id: 'kolejka', label: 'Kolejka zatwierdzeń' },
  { id: 'historia', label: 'Historia' },
  { id: 'procedury', label: 'Procedury' },
  { id: 'ustawienia', label: 'Ustawienia' },
]
