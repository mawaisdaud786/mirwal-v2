import { createContext, useEffect, useState } from 'react'

const ComparisonContext = createContext(null)
// v2: bumped because stored entries used to be mock-shaped (product.price as a string).
// Comparison now expects the API shape (product.price as {amount, currency, display}); an
// old v1 entry left in a returning visitor's sessionStorage would otherwise crash the render.
const STORAGE_KEY = 'mirwal-comparison-v2'

function readStoredProducts() {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(value) ? value.slice(0, 4) : []
  } catch {
    return []
  }
}

export function ComparisonProvider({ children }) {
  const [products, setProducts] = useState(readStoredProducts)
  useEffect(() => window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(products)), [products])
  const addProduct = (product) => setProducts((items) => product && !items.some((item) => item.id === product.id) && items.length < 4 ? [...items, product] : items)
  const removeProduct = (id) => setProducts((items) => items.filter((item) => item.id !== id))
  const clearProducts = () => setProducts([])
  return <ComparisonContext.Provider value={{ products, addProduct, removeProduct, clearProducts }}>{children}</ComparisonContext.Provider>
}

export { ComparisonContext }