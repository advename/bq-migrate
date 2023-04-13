# BigQuery Schema Migration

`@advename/bq-migrate` is a library for managing BigQuery schema migrations. It provides a simple and easy-to-use interface to create, run, and rollback migrations for your BigQuery schema.

## Installation

```sh
npm install @advename/bq-migrate
```

## Quickstart

Create a `bqMigration` instance.

```js
// bqMigration.js
const BQMigrate = require("@advename/bq-migrate")
const bigquery = require("/somewhere/bigquery.js")

const config = {
  bigquery: bigqueryClient, // bigquery instance 
  datasetId: "your_dataset_id", // The ID of the dataset where migrations will be applied
};

const bqMigration = new BQMigration(config);

async function migrate(){
    await bqMigration.runMigrations();
}

async function rollback(){
    await bqMigration.rollbackMigrations();
}
```

Look inside `./example/migrations` how migration files should be structured. The `bigquery` instance with the `datasetId` is passed along to the `up` and `down` methods.

```js
// migrations/001_init.js
const tableId = "person";

exports.up = async function (bigquery, datasetId) {
    // Create table
    const [table] = await bigquery.dataset(datasetId).createTable(tableId, {
        schema: [
            { name: "name", type: "STRING" },
            { name: "age", type: "INTEGER" },
        ],
    });
};

exports.down = async function(bigquery,datasetId){
    await bigquery.dataset(datasetId).table(tableId).delete()
}
```

## Configuration

When creating a new instance of the `BQMigration` class, you can provide an optional configuration object with the following properties:

- `bigquery` (Object, required): The BigQuery client instance.
- `datasetId` (string, required): The ID of the dataset where migrations will be applied.
- `migrationTableName` (string, optional, default: "schema_migrations"): The name of the table that stores the migration history.
- `migrationLockTableName` (string, optional, default: "schema_migrations_lock"): The name of the table that stores the migration lock.
- `migrationsDir` (string, optional, default: "migrations"): The path to the directory containing migration files.
- `migrationLockExpirationTime` (number, optional, default: 30): The duration (in seconds) after which a migration lock will expire.
- `timezone` (string, optional, default: "Etc/UTC"): The timezone used for date and time operations. Must be a valid tz database timezone (https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).

## Migration Files

Migrations files should be created in the specified `migrationsDir` (default: "migrations") and should follow the naming convention `<3-digit number>_<migration_name>.js` or `<3-digit number>_<migration_name>.ts`. Each migration file should export an `up` and `down` function for applying and rolling back the migration, respectively.

```js
// Example migration file: 001_create_table.js

exports.up = async (bigquery, datasetId) => {
  // Code to apply the migration
};

exports.down = async (bigquery, datasetId) => {
  // Code to rollback the migration
};
```

## API Reference

### runMigrations()

Asynchronously runs any pending migrations for the BigQuery schema. Returns a Promise that resolves when all pending migrations have been executed.

### rollbackMigrations()

Rolls back the latest batch of migrations applied to the BigQuery schema. Returns a Promise that resolves when all pending migrations have been rolled back.

### getAppliedMigrations(batch = null)

Get the list of applied migrations from the migration table. If a batch number is provided, only migrations from that batch will be fetched. Returns a Promise that resolves to an array of migration names.

### createMigrationTable()

Create a migration table to store migration data in BigQuery. Returns a Promise that resolves when the migration table is created or already exists.

### createMigrationLockTable()

Creates the migration lock table if it doesn't exist. Returns a Promise that resolves when the lock table is created, or it already exists.

### lockMigration()

Locks the migration process by updating the migration lock table. Returns a Promise that resolves when the lock is acquired, and rejects with an error if the lock fails.

### unlockMigration()

Unlocks the migration lock table. Returns a Promise that resolves when the lock is removed, and rejects with an error if the lock is not removed successfully.

### getMigrationFiles()

Asynchronously reads the migration directory and returns a sorted list of Javascript or Typescript migration files. Returns a Promise that resolves to an array of sorted migration file names.


## Inspiration
Industry tools like [Flyway](https://flywaydb.org/documentation/database/big-query) or [Liquibase](https://github.com/liquibase/liquibase-bigquery) require you to install the CLI package + a JDCB driver which may require Java Engine on your machine.
Bit overkil, init?

I was looking for a pure Node.JS approach, but didn't find one. So I ended up making my own after doing LOTS of research how Flyway and Liquibase tackle BigQuery with schema migrations.

## Disclaimer
Please note that I am not responsible for any errors or issues that may arise from using this package. By using this package, you acknowledge that you are using it at your own risk and that I cannot be held accountable for any problems or damages that may occur as a result of using this v. Please ensure that you have adequate backups and precautions in place before implementing or using this package in any production or critical environments.

I myself have used it on one large Next.js client project and have not seen any issues yet.