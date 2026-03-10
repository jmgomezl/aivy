import { createContext } from 'react'

export type ToastType = 'success' | 'error' | 'info'

export type ToastContextValue = {
  addToast: (message: string, type?: ToastType) => void
}

export const ToastContext = createContext<ToastContextValue>({ addToast: () => {} })
