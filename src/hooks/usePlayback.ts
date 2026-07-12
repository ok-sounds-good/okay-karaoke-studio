import { useCallback, useEffect, useRef, useState } from 'react'

interface PlaybackOptions {
  durationMs: number
  audioUrl?: string | null
}

export function usePlayback({ durationMs, audioUrl }: PlaybackOptions) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const [currentMs, setCurrentMs] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [rate, setRateState] = useState(1)
  const [volume, setVolumeState] = useState(0.86)
  const [audioDurationMs, setAudioDurationMs] = useState<number | null>(null)

  useEffect(() => {
    if (!audioUrl) {
      audioRef.current?.pause()
      audioRef.current = null
      setAudioDurationMs(null)
      return
    }

    const audio = new Audio(audioUrl)
    audio.preload = 'metadata'
    audio.playbackRate = rate
    audio.volume = volume
    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration)) setAudioDurationMs(Math.round(audio.duration * 1000))
    })
    audio.addEventListener('ended', () => setIsPlaying(false))
    audioRef.current = audio

    return () => {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      if (audioRef.current === audio) audioRef.current = null
    }
  }, [audioUrl])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.playbackRate = rate
  }, [rate])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.volume = volume
  }, [volume])

  useEffect(() => {
    if (!isPlaying) {
      lastFrameRef.current = null
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      audioRef.current?.pause()
      return
    }

    const audio = audioRef.current
    if (audio) {
      audio.currentTime = currentMs / 1000
      void audio.play().catch(() => setIsPlaying(false))
    }

    const tick = (timestamp: number) => {
      const activeAudio = audioRef.current
      if (activeAudio && Number.isFinite(activeAudio.currentTime)) {
        setCurrentMs(Math.max(0, Math.round(activeAudio.currentTime * 1000)))
      } else {
        const previous = lastFrameRef.current ?? timestamp
        const elapsed = (timestamp - previous) * rate
        setCurrentMs((value) => {
          const next = Math.min(durationMs, value + elapsed)
          if (next >= durationMs) setIsPlaying(false)
          return next
        })
        lastFrameRef.current = timestamp
      }
      frameRef.current = requestAnimationFrame(tick)
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [isPlaying, rate, durationMs])

  const seek = useCallback(
    (value: number) => {
      const next = Math.max(0, Math.min(audioDurationMs ?? durationMs, value))
      setCurrentMs(next)
      if (audioRef.current) audioRef.current.currentTime = next / 1000
    },
    [audioDurationMs, durationMs],
  )

  const play = useCallback(() => setIsPlaying(true), [])
  const pause = useCallback(() => setIsPlaying(false), [])
  const toggle = useCallback(() => setIsPlaying((value) => !value), [])
  const setRate = useCallback((value: number) => setRateState(Math.max(0.5, Math.min(1.5, value))), [])
  const setVolume = useCallback((value: number) => setVolumeState(Math.max(0, Math.min(1, value))), [])

  return {
    currentMs,
    isPlaying,
    rate,
    volume,
    durationMs: audioDurationMs ?? durationMs,
    hasAudio: Boolean(audioUrl),
    play,
    pause,
    toggle,
    seek,
    setRate,
    setVolume,
  }
}
