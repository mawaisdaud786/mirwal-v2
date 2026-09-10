import { createContext, useEffect, useState } from 'react'

const ComparisonContext = createContext(null)
// v2: bumped because stored entries used to be mock-shaped (product.price as a string).
// Comparison now expects the API shape (product.price as {amount, currency, display}); an
// old v1 entry left in a returning visitor's sessionStorage would otherwise crash the render.
const STORAGE_KEY = 'mirwal-comparison-v2'
const HISTORY_KEY = 'mirwal-comparison-history-v1'

function readStoredProducts() {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(value) ? value.slice(0, 4) : []
  } catch {
    return []
  }
}
function readHistory() { try { const value = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]'); return Array.isArray(value) ? value : [] } catch { return [] } }

export function ComparisonProvider({ children }) {
  const [products, setProducts] = useState(readStoredProducts)
  const [history, setHistory] = useState(readHistory)
  useEffect(() => window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(products)), [products])
  useEffect(() => window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history)), [history])
  const addProduct = (product) => setProducts((items) => { const next = product && !items.some((item) => item.id === product.id) && items.length < 4 ? [...items, product] : items; if (next.length !== items.length) setHistory((entries) => [{ id: Date.now(), createdAt: new Date().toISOString(), products: next }, ...entries].slice(0, 20)); return next })
  const removeProduct = (id) => setProducts((items) => items.filter((item) => item.id !== id))
  const clearProducts = () => setProducts([])
  const loadProducts = (items) => setProducts(Array.isArray(items) ? items.slice(0, 4) : [])
  const clearHistory = () => setHistory([])
  return <ComparisonContext.Provider value={{ products, addProduct, removeProduct, clearProducts, loadProducts, history, clearHistory }}>{children}</ComparisonContext.Provider>
}

export { ComparisonContext }