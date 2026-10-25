import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrototypeProvider } from '@dfosco/statefully/react'
import { prototypeRouteBasePath } from 'design-notebook/runtime/route'
import { usePrototypeRoute } from 'design-notebook/runtime/react'
import App from './prototype.jsx'
import 'virtual:statefully-data-index'
import './style.css'

const routeBasePath = import.meta.env.PROD
  ? prototypeRouteBasePath('borrow-flow', {
      mode: 'static',
      base: import.meta.env.BASE_URL,
      baseIsPrototypePrefix: true,
    })
  : prototypeRouteBasePath('borrow-flow', { mode: 'local' })

function PrototypeApp() {
  const route = usePrototypeRoute({ basePath: routeBasePath })
  return (
    <PrototypeProvider
      prototype="borrow-flow"
      flow="default"
      flowSelection="route"
      route={route}
    >
      <App />
    </PrototypeProvider>
  )
}

const root = globalThis.__prototypeRoot ??= createRoot(document.getElementById('root'))
root.render(
  <StrictMode>
    <PrototypeApp />
  </StrictMode>,
)
