export async function POST(req: Request) {
  const { text, voice = 'male-qn-qingse', speed = 1.0 } = await req.json()
if (!text?.trim()) return Response.json({ error: 'text is required' }, { status: 400 })

  const apiKey = process.env.MINIMAX_API_KEY
  const groupId = process.env.MINIMAX_GROUP_ID
  if (!apiKey || !groupId) return Response.json({ error: 'MiniMax credentials not configured' }, { status: 500 })

  const upstream = await fetch(`https://api.minimaxi.com/v1/t2a_v2?GroupId=${groupId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'speech-2.8-hd',
      text,
      stream: false,
      voice_setting: { voice_id: voice, speed, vol: 1.0, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
    }),
  })

  if (!upstream.ok) {
    const err = await upstream.text().catch(() => '')
    return Response.json({ error: `MiniMax error (${upstream.status}): ${err.slice(0, 200)}` }, { status: upstream.status })
  }

  const json = await upstream.json()
const hex: string = json?.data?.audio
  if (!hex) return Response.json({ error: 'no audio in response', detail: json }, { status: 502 })

  const buf = Buffer.from(hex, 'hex')
  return new Response(buf, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(buf.byteLength) } })
}
