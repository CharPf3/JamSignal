import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'JamSignal — jam band and Grateful Dead shows near you',
  description:
    'Find jam bands, Grateful Dead tributes and improvisational acts playing near you. Each artist is scored on genre tags, listener similarity and what they actually play live, with the reasoning shown.',
  openGraph: {
    title: 'JamSignal',
    description: 'Jam bands and Dead tributes playing near you, scored on evidence.',
    type: 'website',
  },
}

/** Both themes are defined in globals.css, so the UA can be told we support both. */
export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf7f2' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0c0a' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  )
}
