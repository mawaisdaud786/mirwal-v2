import { createContext } from 'react'

let routerNavigate = null
export const SiteChromeContext = createContext(false)

export function setRouterNavigate(navigate) {
  routerNavigate = navigate
}

export function navigateTo(path, options) {
  if (routerNavigate) routerNavigate(path, options)
}
