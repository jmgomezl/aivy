import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ToastContext } from '../lib/toastContext'
import type { ToastType } from '../lib/toastContext'
import './Toast.css'

type Toast = {
  id: number
  message: string
  type: ToastType
}

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  // Cleanup all pending timers on unmount
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
  }, [])

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++nextId
    setToasts((prev) => {
      const next = [...prev, { id, message, type }]
      return next.slice(-3) // keep max 3
    })
    const timer = setTimeout(() => {
      timersRef.current.delete(timer)
      removeToast(id)
    }, 4000)
    timersRef.current.add(timer)
  }, [removeToast])

  const icons: Record<ToastType, string> = {
    success: '\u2713',
    error: '\u2717',
    info: '\u25CF',
  }

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-item ${t.type}`}>
            <span className="toast-icon">{icons[t.type]}</span>
            <span>{t.message}</span>
            <button className="toast-dismiss" onClick={() => removeToast(t.id)}>&times;</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
