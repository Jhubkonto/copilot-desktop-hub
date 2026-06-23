export function TabHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="pb-1 border-b border-gray-100 dark:border-gray-700/60">
      <p className="text-base font-semibold text-gray-900 dark:text-gray-50">{title}</p>
      <p className="text-xs text-gray-500 mt-0.5">{description}</p>
    </div>
  )
}
