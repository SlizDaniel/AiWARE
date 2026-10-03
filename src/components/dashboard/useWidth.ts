import { useCallback, useRef, useState } from 'react'

/**
 * Szerokość kontenera w pikselach (wykresy SVG rysowane w rzeczywistym rozmiarze, czytelne
 * na telefonie). Pomiar od razu po podpięciu elementu, potem ResizeObserver.
 */
export function useWidth<T extends HTMLElement>(initial = 640) {
  const [width, setWidth] = useState(initial)
  const observerRef = useRef<ResizeObserver | null>(null)
  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return
    const measure = (value: number) => {
      const next = Math.floor(value)
      if (next > 0) setWidth(next)
    }
    measure(node.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => measure(entries[0]?.contentRect.width ?? 0))
    observer.observe(node)
    observerRef.current = observer
  }, [])
  return [ref, width] as const
}
