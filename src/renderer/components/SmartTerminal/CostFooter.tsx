interface CostFooterProps {
  totalCostUsd: number
  inputTokens: number
  outputTokens: number
}

export function CostFooter({ totalCostUsd, inputTokens, outputTokens }: CostFooterProps) {
  const cost = totalCostUsd < 0.001 ? '<$0.001' : `$${totalCostUsd.toFixed(4)}`
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-t border-gray-800 bg-gray-950 text-xs text-gray-500 font-mono shrink-0 select-none">
      <span>{cost}</span>
      <span>↑ {fmt(inputTokens)}</span>
      <span>↓ {fmt(outputTokens)}</span>
      <span className="text-gray-600">tokens</span>
    </div>
  )
}
