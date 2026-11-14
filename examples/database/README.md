# database

The code behind the Database guides in the docs. One contract, `UsersRepository`, implemented
on six libraries, with the same routes and the same tests run against each.

| Library   | File               | Database in tests                 |
| --------- | ------------------ | --------------------------------- |
| Drizzle   | `src/drizzle.ts`   | SQLite (`bun:sqlite`)             |
| Prisma    | `src/prisma.ts`    | SQLite through the libSQL adapter |
| TypeORM   | `src/typeorm.ts`   | SQLite (`sql.js`)                 |
| Sequelize | `src/sequelize.ts` | SQLite                            |
| sqlkit    | `src/sqlkit.ts`    | PostgreSQL (PGlite)               |
| Kysely    | `src/kysely.ts`    | PostgreSQL (PGlite)               |

```bash
bun install      # also generates the Prisma client
bun test
```

`src/shared.ts` holds the contract, the routes and the error mapping. `src/unit-of-work.ts` is
a middleware that runs a whole request in one transaction. No database server is needed.
