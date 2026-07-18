import { useEffect, useRef, type RefObject } from 'react'

type OutsideRef = RefObject<HTMLElement | null>

/**
 * Calls `onOutside` when a mousedown lands outside every referenced element.
 * Pass an array when a trigger button lives outside the popover element.
 * `active` gates the listener so closed popovers cost nothing.
 * The callback is kept in a ref so an inline `() => ...` from the caller
 * doesn't re-bind the document listener on every parent render.
 */
export function useClickOutside(
  refOrRefs: OutsideRef | OutsideRef[],
  onOutside: () => void,
  active = true,
) {
  const onOutsideRef = useRef(onOutside)
  onOutsideRef.current = onOutside
  const refsRef = useRef(refOrRefs)
  refsRef.current = refOrRefs

  useEffect(() => {
    if (!active) return
    const handler = (e: MouseEvent) => {
      const refs = Array.isArray(refsRef.current) ? refsRef.current : [refsRef.current]
      const target = e.target as Node
      const attached = refs.filter((r) => r.current !== null)
      if (attached.length === 0) return
      if (attached.every((r) => !r.current!.contains(target))) {
        onOutsideRef.current()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [active])
}
