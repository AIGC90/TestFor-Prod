import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { join } from 'node:path';
import { Pool } from 'pg';
import { config } from '../config';
import * as schema from './schema';

export const DB = Symbol('DB');
export type Db = NodePgDatabase<typeof schema>;
export const InjectDb = () => Inject(DB);

const POOL = Symbol('POOL');

@Global()
@Module({
  providers: [
    { provide: POOL, useFactory: () => new Pool({ connectionString: config.databaseUrl }) },
    {
      provide: DB,
      inject: [POOL],
      useFactory: async (pool: Pool) => {
        const db = drizzle(pool, { schema });
        await migrate(db, { migrationsFolder: join(__dirname, '..', '..', 'drizzle') });
        new Logger('Db').log('migrations applied');
        return db;
      },
    },
  ],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
