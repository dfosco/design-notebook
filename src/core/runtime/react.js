import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { createPrototypeRouteBinding } from './route.js'

/** Subscribe React to browser navigation and return Statefully's route binding shape. */
export function usePrototypeRoute({ basePath } = {}) {
  const binding = useMemo(() => createPrototypeRouteBinding({ basePath }), [basePath])
  const location = useSyncExternalStore(binding.subscribe, binding.getSnapshot, binding.getSnapshot)
  useEffect(() => () => binding.dispose(), [binding])
  return { ...location, navigate: binding.navigate, subscribe: binding.subscribe, getSnapshot: binding.getSnapshot }
}
