import { useContext } from 'react'
import { ToastContext } from '../lib/toastContext'
import type { ToastContextValue } from '../lib/toastContext'

export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}
