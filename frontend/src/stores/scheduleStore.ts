import { create } from 'zustand'
import type { DropPoint, Orchard } from '@/types'
import { db, loadAll, type ScheduleBasisRow } from '@/hooks/usePersistentStore'
import { snapshotBasis, type ScheduleBasis } from '@/utils/schedule'

const BASIS_KEY = 'basis'

export interface ScheduleState {
  /** 上次重算时托管队数据（可达性 / 容量）的修订号快照 */
  basis: ScheduleBasis | null
  loaded: boolean
  hydrate: () => Promise<void>
  /** 首次启动无基准时按当前数据写一版（避免既有数据一上线就全部失效） */
  ensureBasis: () => Promise<void>
  /** 重算排程：以两边最新数据重新校验，并把当前修订号快照为新基准 */
  recompute: () => Promise<ScheduleBasis>
}

export const scheduleStore = create<ScheduleState>((set, get) => ({
  basis: null,
  loaded: false,
  hydrate: async () => {
    const row = await db.scheduleMeta.get(BASIS_KEY)
    set({
      basis: row ? { computedAt: row.computedAt, orchardRevisions: row.orchardRevisions, dropRevisions: row.dropRevisions } : null,
      loaded: true
    })
  },
  ensureBasis: async () => {
    const row = await db.scheduleMeta.get(BASIS_KEY)
    if (row) return
    await get().recompute()
  },
  recompute: async () => {
    const orchards = await loadAll<Orchard>(db.orchards)
    const dropPoints = await loadAll<DropPoint>(db.dropPoints)
    const basis = snapshotBasis(orchards, dropPoints)
    await db.scheduleMeta.put({ key: BASIS_KEY, ...basis } satisfies ScheduleBasisRow)
    set({ basis, loaded: true })
    return basis
  }
}))
