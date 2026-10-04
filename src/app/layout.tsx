import type { Metadata, Viewport } from 'next'
import { Archivo } from 'next/font/google'
import type { ReactNode } from 'react'
import './globals.css'

// Jeden krój na całą aplikację; oś szerokości daje zwężone etykiety i gęste dane bez drugiej rodziny.
const archivo = Archivo({
  subsets: ['latin', 'latin-ext'],
  axes: ['wdth'],
  variable: '--font-archivo',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'MAGAZYNIER — głosowy agent magazynowy',
  description: 'Panel operacyjny magazynu z głosowym agentem MAGAZYNIER.',
  icons: { icon: { url: '/brand/mascot.jpg', type: 'image/jpeg' } },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#eef0f2',
}

// Kontrakt kierunku wizualnego (impeccable) — musi przetrwać build produkcyjny.
const DIRECTION_CONTRACT = `<!--
THESIS: A calm operator screen (ISA-101): grey quiet for normal state, colour only for a deviation or a decision awaiting a human; refuses the KPI-tile SaaS dashboard.
OWN-WORLD: cool greys, graphite ink, cyan-blue for operator action, amber below minimum, red for empty or error; every state is colour plus shape (square, triangle, diamond); range indicators with a minimum tick; Archivo with condensed caps labels; hairlines, no card shadows.
STORY: The manager sees what deviates, speaks or types a command, reads the change card's before-to-after on the range indicator and confirms; each change announces itself in place.
FIRST VIEWPORT: left rail with mascot and nav counts; alarm strip on top; stock list with range indicators in the centre; agent column on the right with live transcript, command field and the change card as the primary action.
FORM: ISA-101 high-performance HMI, #7 of 7, seed 7e80f2a8; raises from Solari board, vertical feed, Metro, lexicon, Factory catalog.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->`

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pl" className={archivo.variable}>
      <body>
        <div hidden dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
        {children}
      </body>
    </html>
  )
}
