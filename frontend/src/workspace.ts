import { createContext, useContext } from 'react'
import type { Dataset, Health, Run } from './api'
import type { FetchState } from './useFetch'

export interface Workspace {
  runs: FetchState<Run[]>
  sources: FetchState<Dataset[]>
  health: FetchState<Health>
}

export const WorkspaceContext = createContext<Workspace | null>(null)

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('Workspace provider is required')
  return context
}
