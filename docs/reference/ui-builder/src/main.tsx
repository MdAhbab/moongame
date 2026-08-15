import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// @react-three/fiber's render loop still constructs a THREE.Clock internally,
// which Three r185 flags as deprecated. It's harmless upstream noise we can't
// change without patching the library — filter just that one message.
const _warn = console.warn.bind(console)
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('THREE.Clock: This module has been deprecated')) return
  _warn(...args)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
