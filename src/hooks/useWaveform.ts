import { useEffect, useMemo, useState } from 'react'

function fallbackPeaks(count: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin(index * 0.29) * 0.22 + Math.sin(index * 0.071 + 1.2) * 0.32
    const envelope = 0.36 + Math.sin(index * 0.017) * 0.14 + (index % 37) / 130
    return Math.max(0.08, Math.min(0.92, Math.abs(wave) + envelope))
  })
}

export function useWaveform(audioUrl: string | null | undefined, bins = 900) {
  const fallback = useMemo(() => fallbackPeaks(bins), [bins])
  const [peaks, setPeaks] = useState<number[]>(fallback)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  useEffect(() => {
    if (!audioUrl) {
      setPeaks(fallback)
      return
    }

    let cancelled = false
    setIsAnalyzing(true)
    const context = new AudioContext()

    void fetch(audioUrl)
      .then((response) => response.arrayBuffer())
      .then((buffer) => context.decodeAudioData(buffer))
      .then((decoded) => {
        if (cancelled) return
        const channel = decoded.getChannelData(0)
        const block = Math.max(1, Math.floor(channel.length / bins))
        const next = Array.from({ length: bins }, (_, bin) => {
          const start = bin * block
          const end = Math.min(channel.length, start + block)
          let max = 0
          for (let index = start; index < end; index += Math.max(1, Math.floor(block / 32))) {
            max = Math.max(max, Math.abs(channel[index]))
          }
          return Math.max(0.04, max)
        })
        const ceiling = Math.max(...next, 0.01)
        setPeaks(next.map((peak) => Math.min(1, peak / ceiling)))
      })
      .catch(() => {
        if (!cancelled) setPeaks(fallback)
      })
      .finally(() => {
        if (!cancelled) setIsAnalyzing(false)
        void context.close()
      })

    return () => {
      cancelled = true
      void context.close()
    }
  }, [audioUrl, bins, fallback])

  return { peaks, isAnalyzing }
}
