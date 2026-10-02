import { create } from 'zustand'
import type { DropPoint } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'
import { scheduleStore } from '@/stores/scheduleStore'

export interface DropPointState {
  rows: DropPoint[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: DropPoint) => Promise<void>
  remove: (id: string) => Promise<void>
  removeByOrchard: (orchardId: string) => Promise<void>
}

export const droppointStore = create<DropPointState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<DropPoint>(db.dropPoints)
    rows.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    const prev = await db.dropPoints.get(row.id)
    await putRow<DropPoint>(db.dropPoints, row)
    // 托管队改了投放点容量 → 引用它的排程失效，需重算
    if (prev && prev.capacityBoxes !== row.capacityBoxes) {
      scheduleStore.getState().notifyHostingChange({
        kind: 'droppoint-capacity',
        refId: row.id,
        label: `投放点「${row.code}」容量改为 ${row.capacityBoxes} 箱`
      })
    }
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<DropPoint>(db.dropPoints, id)
    await get().hydrate()
  },
  removeByOrchard: async (orchardId) => {
    const targets = get().rows.filter((row) => row.orchardId === orchardId)
    await Promise.all(targets.map((row) => deleteRow<DropPoint>(db.dropPoints, row.id)))
    await get().hydrate()
  }
}))
