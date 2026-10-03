import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'MAGAZYNIER — głosowy agent magazynowy',
  description: 'Panel operacyjny magazynu z głosowym agentem MAGAZYNIER.',
  icons: { icon: { url: '/brand/mascot.jpg', type: 'image/jpeg' } },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f5f4f0',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  )
}
