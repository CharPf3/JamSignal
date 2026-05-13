import { NextRequest, NextResponse } from 'next/server'
import { getSetlistData } from '@/lib/setlistfm/client'

export async function GET(request: NextRequest) {
  const band = request.nextUrl.searchParams.get('band') ?? 'Armchair Boogie'
  const result = await getSetlistData(band)
  return NextResponse.json({ band, result })
}
