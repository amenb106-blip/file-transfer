import { request } from './api'
import type { RememberedDevice } from './api'

export type Invitation = { id: string; token: string; expires_at: string }
export type Pairing = { id: string; owner_name: string; claimant: RememberedDevice | null; status: 'waiting' | 'paired'; expires_at: string }
export type InboxFile = { id: string; filename: string; size_bytes: number; sender_name: string; expires_at: string }

function action<T>(path: string, body?: unknown, method = 'POST') {
  return request<T>(path, { method, headers: { 'Content-Type': 'application/json', 'X-Device-Action': '1' },
    body: body === undefined ? undefined : JSON.stringify(body) })
}

export const getPeers = (signal?: AbortSignal) => request<RememberedDevice[]>('/api/devices/peers', { signal, cache: 'no-store' })
export const createInvitation = () => action<Invitation>('/api/pairings')
export const inspectInvitation = (token: string) => action<Pairing>('/api/pairings/inspect', { token })
export const claimInvitation = (token: string) => action<Pairing>('/api/pairings/claim', { token })
export const getPairing = (id: string, signal?: AbortSignal) => request<Pairing>(`/api/pairings/${encodeURIComponent(id)}`, { signal, cache: 'no-store' })
export const confirmPairing = (id: string, claimantId: string) => action<Pairing>(`/api/pairings/${encodeURIComponent(id)}/confirm`, { claimant_id: claimantId })
export const cancelInvitation = (id: string) => action(`/api/pairings/${encodeURIComponent(id)}`, undefined, 'DELETE')
export const disconnectDevice = (id: string) => action(`/api/devices/peers/${encodeURIComponent(id)}`, undefined, 'DELETE')
export const getInbox = (signal?: AbortSignal) => request<InboxFile[]>('/api/inbox', { signal, cache: 'no-store' })
export const downloadInboxFile = (id: string) => action<{ url: string }>(`/api/inbox/${encodeURIComponent(id)}/download`)
export const problemMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.'
