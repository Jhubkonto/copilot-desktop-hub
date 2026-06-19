import { useEffect, useState } from 'react'

export function useRateLimitTimer() {
  const [rateLimitRemainingSec, setRateLimitRemainingSec] = useState(0)
  useEffect(() => {
    if (rateLimitRemainingSec <= 0) return
    const id = window.setInterval(() => {
      setRateLimitRemainingSec((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => window.clearInterval(id)
  }, [rateLimitRemainingSec])
  return { rateLimitRemainingSec, setRateLimitRemainingSec }
}
