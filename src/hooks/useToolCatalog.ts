import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ToolCatalogResponse, CapabilityGroupId } from '../types'
import { requestJson } from '../utils'

export function useToolCatalog() {
  const [catalog, setCatalog] = useState<ToolCatalogResponse | null>(null)
  const [activeToolGroupId, setActiveToolGroupId] = useState<CapabilityGroupId | ''>('')

  const refreshCatalog = useCallback(async () => {
    try {
      const payload = await requestJson<ToolCatalogResponse>('/api/tool-catalog')
      setCatalog(payload)
      setActiveToolGroupId((current) => current || payload.groups[0]?.id || '')
    } catch {
      // silently fail - catalog will be null
    }
  }, [])

  useEffect(() => {
    void refreshCatalog()
  }, [refreshCatalog])

  const toolGroups = useMemo(() => catalog?.groups ?? [], [catalog])
  const toolEntries = useMemo(() => catalog?.tools ?? [], [catalog])

  return {
    catalog,
    toolGroups,
    toolEntries,
    activeToolGroupId,
    setActiveToolGroupId,
    refreshCatalog,
  }
}
