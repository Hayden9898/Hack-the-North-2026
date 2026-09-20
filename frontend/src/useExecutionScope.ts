import { useSearchParams } from 'react-router-dom'
import { useWorkspace } from './workspace'

export function useExecutionScope() {
  const { runs } = useWorkspace()
  const [params, setParams] = useSearchParams()
  const id = params.get('run') || runs.data?.[0]?.run_id || ''
  return { id, runs, setId: (value: string) => setParams({ run: value }), params, setParams }
}
