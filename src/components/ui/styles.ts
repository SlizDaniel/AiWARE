// Wspólny słownik klas: jeden kształt przycisku, pola i panelu na całej stronie.

export type ButtonVariant = 'primary' | 'action' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-semibold transition-[background-color,border-color,color,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-40'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-sheet hover:bg-ink-2',
  action: 'bg-act text-white hover:bg-act-ink',
  secondary: 'border border-line-strong bg-sheet text-ink hover:border-ink-2 hover:bg-ground',
  ghost: 'text-ink-2 hover:bg-ink/6 hover:text-ink',
  danger: 'border border-alarm/35 bg-sheet text-alarm-ink hover:border-alarm hover:bg-alarm-soft',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
}

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md'): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]}`
}

/** Pole tekstowe / select / data. */
export const fieldClass =
  'block w-full min-w-0 rounded-md border border-line-strong bg-sheet px-3 py-2 text-sm text-ink transition-colors hover:border-ink-2/60 focus-visible:border-act focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-act/25 disabled:cursor-not-allowed disabled:bg-ground disabled:text-mute'

/** Powierzchnia podniesiona nad tłem (tabela, panel ustawień). Nigdy panel w panelu. */
export const panelClass = 'min-w-0 rounded-lg border border-line bg-sheet'

/** Przełącznik segmentowy (np. okres dashboardu, filtr kolejki). */
export function segmentClass(active: boolean): string {
  return (
    'h-8 rounded-[5px] px-3 text-[13px] font-semibold transition-colors duration-150 ' +
    (active ? 'bg-sheet text-ink shadow-[0_1px_2px_oklch(0.2_0.01_255/0.12)]' : 'text-ink-2 hover:text-ink')
  )
}

/** Obudowa przełącznika segmentowego. */
export const segmentGroupClass = 'inline-flex items-center gap-0.5 rounded-md bg-rail p-0.5'
