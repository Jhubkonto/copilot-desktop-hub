export function TabHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="pb-2 border-b-2 border-gray-300 dark:border-gray-600">
      <p className="text-base font-semibold nexy-panel-title text-gray-900 dark:text-gray-50">{title}</p>
      <p className="text-xs text-gray-500 mt-0.5">{description}</p>
    </div>
  )
}
