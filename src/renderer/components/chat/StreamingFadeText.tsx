import { useRef } from 'react'

/**
 * Renders growing plain text (streamed content) so only the newly-appended tail since the last
 * render fades in, instead of the whole string snapping to full opacity on every update. Safe
 * only for plain text (whitespace-pre-wrap) — never wrap markdown source with this, since
 * splitting mid-syntax (e.g. inside `**bold**`) would corrupt it once re-parsed.
 */
export function StreamingFadeText({ text }: { text: string }) {
  const prevLengthRef = useRef(0)
  const prevLength = text.length >= prevLengthRef.current ? prevLengthRef.current : 0
  prevLengthRef.current = text.length

  if (text.length <= prevLength) return <>{text}</>

  const settled = text.slice(0, prevLength)
  const fresh = text.slice(prevLength)
  return (
    <>
      {settled}
      <span className="stream-fade-in">{fresh}</span>
    </>
  )
}
