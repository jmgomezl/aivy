import { useCallback, useEffect, useState } from 'react'
import type { LiveAgent, ActivityEvent, NetworkStats, LivePayload, CoordinationEvent } from '../types'
import { requestJson } from '../utils'
import { applyLayout, emptyStats } from '../data'

export function useLiveData() {
  const [agents, setAgents] = useState<LiveAgent[]>([])
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [coordinations, setCoordinations] = useState<CoordinationEvent[]>([])
  const [stats, setStats] = useState<NetworkStats>(emptyStats)
  const [networkLabel, setNetworkLabel] = useState('Backend Offline')
  const [serverConfigured, setServerConfigured] = useState(false)
  const [serverMessage, setServerMessage] = useState(
    'Connect the backend to Hedera testnet to start using Aivy.',
  )
  const [operatorAccountId, setOperatorAccountId] = useState<string | null>(null)
  const [mirrorNodeUrl, setMirrorNodeUrl] = useState('')
  const [chatEnabled, setChatEnabled] = useState(false)
  const [demoMode, setDemoMode] = useState(false)

  const refreshLive = useCallback(async () => {
    try {
      const payload = await requestJson<LivePayload>('/api/live')
      setServerConfigured(payload.configured)
      setChatEnabled(payload.chatEnabled ?? false)
      setDemoMode(payload.demoMode ?? false)
      setStats(payload.stats)
      setAgents(applyLayout(payload.deployments))
      setEvents(payload.activity)
      setCoordinations(payload.coordinations ?? [])
      setOperatorAccountId(payload.operatorAccountId ?? null)
      setMirrorNodeUrl(payload.mirrorNodeUrl ?? '')

      if (payload.configured) {
        setNetworkLabel(`Hedera ${(payload.network ?? 'testnet').toUpperCase()}`)
        setServerMessage(
          payload.error ??
            'Launch templates, enable only the tools you need, then run live Hedera actions from a focused agent workspace.',
        )
      } else {
        setNetworkLabel('Config Required')
        setServerMessage(
          payload.error ??
            'Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in `.env` to enable live deployment.',
        )
      }
    } catch (error) {
      setServerConfigured(false)
      setNetworkLabel('Backend Offline')
      setStats(emptyStats)
      setAgents([])
      setEvents([])
      setMirrorNodeUrl('')
      setServerMessage(
        error instanceof Error ? error.message : 'Could not reach the Aivy backend.',
      )
    }
  }, [])

  useEffect(() => {
    void refreshLive()
    const interval = window.setInterval(() => {
      void refreshLive()
    }, 10000)
    return () => window.clearInterval(interval)
  }, [refreshLive])

  return {
    agents,
    events,
    coordinations,
    stats,
    networkLabel,
    serverConfigured,
    chatEnabled,
    demoMode,
    serverMessage,
    setServerMessage,
    operatorAccountId,
    mirrorNodeUrl,
    refreshLive,
  }
}
