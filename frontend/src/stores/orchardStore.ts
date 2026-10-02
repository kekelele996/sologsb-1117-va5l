import { create } from 'zustand'
import type { Orchard } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'
import { scheduleStore } from '@/stores/scheduleStore'

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
    const prev = await db.orchards.get(row.id)
    await putRow<Orchard>(db.orchards, row)
    // 托管队改了地块可达性 → 引用它的排程失效，需重算
    if (prev && prev.accessibility !== row.accessibility) {
      scheduleStore.getState().notifyHostingChange({
        kind: 'orchard-accessibility',
        refId: row.id,
        label: `地块「${row.name}」可达性改为「${row.accessibility}」`
      })
    }
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<Orchard>(db.orchards, id)
    await get().hydrate()
  }
}))
