import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Buffer } from 'buffer/'
import './index.css'
import App from './App.tsx'

type PolyfilledGlobal = typeof globalThis & {
  Buffer?: unknown
  global?: unknown
  process?: unknown
}

const polyfilledGlobal = globalThis as PolyfilledGlobal

if (!('Buffer' in globalThis)) {
  Object.defineProperty(polyfilledGlobal, 'Buffer', {
    value: Buffer,
    configurable: true,
  })
}

if (!('global' in globalThis)) {
  Object.defineProperty(polyfilledGlobal, 'global', {
    value: globalThis,
    configurable: true,
  })
}

if (!('process' in globalThis)) {
  Object.defineProperty(polyfilledGlobal, 'process', {
    value: { env: {} satisfies Record<string, string> },
    configurable: true,
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
