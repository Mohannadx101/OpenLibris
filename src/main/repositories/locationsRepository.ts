import type { Db } from '../db/connection'

/** The EPUB location index of each book (see `epub_locations_cache`). One row per book. */
export class LocationsRepository {
  private readonly selectOne
  private readonly upsert

  constructor(db: Db) {
    this.selectOne = db.prepare('SELECT data FROM epub_locations_cache WHERE book_id = ?')
    this.upsert = db.prepare(
      `INSERT INTO epub_locations_cache (book_id, data) VALUES (?, ?)
       ON CONFLICT (book_id) DO UPDATE SET data = excluded.data`,
    )
  }

  get(bookId: string): string | undefined {
    const row = this.selectOne.get(bookId) as { data: string } | undefined
    return row?.data
  }

  save(bookId: string, data: string): void {
    this.upsert.run(bookId, data)
  }
}
