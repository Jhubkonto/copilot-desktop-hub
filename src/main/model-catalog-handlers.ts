import { getCachedCatalog } from './model-catalog'
import { safeHandle } from './safe-handle'

export function registerModelCatalogHandlers(): void {
  safeHandle('model:list-catalog', async () => getCachedCatalog())
}
