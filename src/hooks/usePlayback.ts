import { useCallback, useEffect, useRef, useState } from 'react'

interface PlaybackOptions {
  durationMs: number
  audioUrl?: string | null
  onDuration?: (durationMs: number) => void
  refreshIntervalMs?: number
}

export function usePlayback({
  durationMs,
  audioUrl,
  onDuration,
  refreshIntervalMs = 16,
}: PlaybackOptions) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const currentMsRef = useRef(0)
  const lastPublishedMsRef = useRef(0)
  const [currentMs, setCurrentMs] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [rate, setRateState] = useState(1)
  const [volume, setVolumeState] = useState(0.86)
  const [audioDurationMs, setAudioDurationMs] = useState<number | null>(null)

  useEffect(() => {
    // A media source owns its own clock. Reset the rendered and synchronous
    // clocks together before exposing a replacement Audio element so a sync
    // action cannot briefly sample 0 from the new element while the UI still
    // points at the previous source's playhead.
    currentMsRef.current = 0
    lastPublishedMsRef.current = 0
    lastFrameRef.current = null
    setCurrentMs(0)
    setIsPlaying(false)

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
    const handleLoadedMetadata = () => {
      if (!Number.isFinite(audio.duration)) return
      const nextDurationMs = Math.round(audio.duration * 1000)
      setAudioDurationMs(nextDurationMs)
      onDuration?.(nextDurationMs)
    }
    const handleEnded = () => setIsPlaying(false)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('ended', handleEnded)
    audioRef.current = audio

    return () => {
      audio.pause()
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('ended', handleEnded)
      audio.removeAttribute('src')
      audio.load()
      if (audioRef.current === audio) audioRef.current = null
    }
  }, [audioUrl, onDuration])

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
      audio.currentTime = currentMsRef.current / 1000
      void audio.play().catch(() => setIsPlaying(false))
    }

    const tick = (timestamp: number) => {
      const activeAudio = audioRef.current
      let nextMs: number
      if (activeAudio && Number.isFinite(activeAudio.currentTime)) {
        nextMs = Math.max(0, Math.round(activeAudio.currentTime * 1000))
      } else {
        const previous = lastFrameRef.current ?? timestamp
        const elapsed = (timestamp - previous) * rate
        nextMs = Math.min(durationMs, currentMsRef.current + elapsed)
        if (nextMs >= durationMs) setIsPlaying(false)
        lastFrameRef.current = timestamp
      }
      currentMsRef.current = nextMs
      if (
        Math.abs(nextMs - lastPublishedMsRef.current) >= refreshIntervalMs ||
        nextMs === 0 ||
        nextMs >= durationMs
      ) {
        lastPublishedMsRef.current = nextMs
        setCurrentMs(nextMs)
      }
      frameRef.current = requestAnimationFrame(tick)
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [isPlaying, rate, durationMs, refreshIntervalMs])

  const seek = useCallback(
    (value: number) => {
      const next = Math.max(0, Math.min(audioDurationMs ?? durationMs, value))
      currentMsRef.current = next
      lastPublishedMsRef.current = next
      setCurrentMs(next)
      if (audioRef.current) audioRef.current.currentTime = next / 1000
    },
    [audioDurationMs, durationMs],
  )

  const getCurrentMs = useCallback(() => {
    const audio = audioRef.current
    const liveMs =
      audio && Number.isFinite(audio.currentTime)
        ? Math.round(audio.currentTime * 1000)
        : currentMsRef.current
    return Math.max(0, Math.min(audioDurationMs ?? durationMs, liveMs))
  }, [audioDurationMs, durationMs])

  const play = useCallback(() => setIsPlaying(true), [])
  const pause = useCallback(() => setIsPlaying(false), [])
  const toggle = useCallback(() => setIsPlaying((value) => !value), [])
  const setRate = useCallback(
    (value: number) => setRateState(Math.max(0.5, Math.min(1.5, value))),
    [],
  )
  const setVolume = useCallback(
    (value: number) => setVolumeState(Math.max(0, Math.min(1, value))),
    [],
  )

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
    getCurrentMs,
    setRate,
    setVolume,
  }
}
