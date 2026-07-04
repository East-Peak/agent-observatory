import { createContext, useContext, type ReactNode } from 'react'
import type { TrustSidecar } from '@/domain/trustSidecar'

const TrustSidecarContext = createContext<TrustSidecar | undefined>(undefined)

export function TrustSidecarProvider({
  children,
  trustSidecar,
}: {
  readonly children: ReactNode
  readonly trustSidecar?: TrustSidecar
}) {
  return (
    <TrustSidecarContext.Provider value={trustSidecar}>
      {children}
    </TrustSidecarContext.Provider>
  )
}

export function useTrustSidecar(): TrustSidecar | undefined {
  return useContext(TrustSidecarContext)
}
