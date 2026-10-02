import { create } from 'zustand'
import type { Orchard } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'

export interface OrchardState {
  rows: Orchard[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: Orchard) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const orchardStore = create<OrchardState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<Orchard>(db.orchards)
    rows.sort((a, b) => a.bloomStart.localeCompare(b.bloomStart))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    // 托管队改了可达性 → 修订号 +1，引用本地块的排程失效待重算
    const prev = await db.orchards.get(row.id)
    const revision = prev
      ? prev.accessibility !== row.accessibility
        ? (prev.revision ?? 1) + 1
        : prev.revision ?? 1
      : 1
    await putRow<Orchard>(db.orchards, { ...row, revision })
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<Orchard>(db.orchards, id)
    await get().hydrate()
  }
}))
