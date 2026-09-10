import { useContext } from 'react'
import { ComparisonContext } from './ComparisonContext'

export function useComparison() {
  const context = useContext(ComparisonContext)
  if (!context) throw new Error('useComparison must be used within ComparisonProvider')
  return context
}