# BigQuery Schema Migration

`@advename/bq-migrate` is a Node.JS library for managing BigQuery schema migrations. It provides an interface to create, run, and rollback migrations for your BigQuery schema.

Supported features:
- Migration locks + expiration time for time locks (in seconds)
- Migration Batches
- Timezone
- Uses query-jobs instead of streams

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
const path = require("path");

const config = {
  bigquery: bigqueryClient, // required: bigquery instance 
  datasetId: "your_dataset_id", // required: the ID of the dataset where migrations will be applied
  migrationsDir: path.resolve(__dirname, "migrations") // required: the directory of the migration files
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

## About `bq-migrations`

### Inspiration
Industry tools like [Flyway](https://flywaydb.org/documentation/database/big-query) or [Liquibase](https://github.com/liquibase/liquibase-bigquery) require you to install the CLI package + a JDCB driver which may require Java Engine on your machine.
Bit overkil, init?

I was looking for a pure Node.JS approach, but didn't find one. So I ended up making my own after doing LOTS of research how Flyway and Liquibase tackle BigQuery with schema migrations.

### Batches
Migrations are run in batches. Meaning if you have `001_init.js` and `002_person.js`, these are run together and are assigned the batch number `1`. When rolling back, these are then also rolled back together.

### Transactions
BigQuery recently introduced [Multi-statement transactions](https://cloud.google.com/bigquery/docs/reference/standard-sql/transactions). Unfortunately, DDL (`CREATE TABLE`) statements are only supported for [**temporary**](https://cloud.google.com/bigquery/docs/reference/standard-sql/transactions#statements_supported_in_transactions) entities, making them unusable for migrations.

### Query jobs vs stream & Quota Limitations
**Streaming Inserts:** You cannot modify data with `UPDATE`, `DELETE`, or `MERGE` for the first 30 minutes after inserting it using streaming `INSERT`s. It may take up to 90 minutes for the data to be ready for copy operations. Streaming inserts are limited to 50,000 rows per request.([1](https://cloud.google.com/bigquery/docs/reference/standard-sql/data-manipulation-language#limitations), [2](https://cloud.google.com/bigquery/quotas#streaming_inserts))

**Query Jobs**: [Jobs are actions that BigQuery](https://cloud.google.com/bigquery/docs/jobs-overview) runs on your behalf to [load data](https://cloud.google.com/bigquery/docs/loading-data), [export data](https://cloud.google.com/bigquery/exporting-data-from-bigquery), [query data](https://cloud.google.com/bigquery/docs/running-queries), or [copy data](https://cloud.google.com/bigquery/docs/managing-tables#copy-table). Query Jobs in particular are basically all _"vanilla"_ SQL queries that you run against BigQuery. [BigQuery's Node.JS library (`@google-cloud/bigquery`)](https://github.com/googleapis/nodejs-bigquery), which is used to run migrations uses a combination of streams and Query jobs. Only query jobs have been carefully selected for migrations to not run into the above mentioned limitations.

## Configuration
When creating a new instance of the `BQMigration` class, you must provide an configuration object with the following required and optional properties:

#### Required
- `bigquery` (Object): The BigQuery client instance.
- `datasetId` (string): The ID of the dataset where migrations will be applied.
- `migrationsDir` (string): The path to the directory containing migration files.

#### Optional
- `migrationTableName` (string, default: "schema_migrations"): The name of the table that stores the migration history.
- `migrationLockTableName` (string, default: "schema_migrations_lock"): The name of the table that stores the migration lock.
- `migrationLockExpirationTime` (number, default: 30): The duration (in seconds) after which a migration lock will expire.
- `timezone` (string, default: "Etc/UTC"): The timezone used for date and time operations. Must be a valid tz database timezone (https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).

## Migration Files

Migrations files should be created in the specified `migrationsDir` and should follow the naming convention `<3-digit number>_<migration_name>.js` (or `.ts`), for example `012_add_sales_attribute.js`. Each migration file should export an `up` and `down` function for applying and rolling back the migration, respectively. The `bigquery` and `datasetId` are automatically passed on to these methods.

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


## Todo
I've built this package for personal use. However, If it should ever gain traction then I would consider adding:
- tests
- CJS/ESM dual build
- rewrite in typescript and provide types
- improved error reporting
- repair failed migrations
- ...?

## Disclaimer
Please note that I am not responsible for any errors or issues that may arise from using this package. By using this package, you acknowledge that you are using it at your own risk and that I cannot be held accountable for any problems or damages that may occur as a result of using this v. Please ensure that you have adequate backups and precautions in place before implementing or using this package in any production or critical environments.

I myself have used it on one large Next.js client project and have not seen any issues yet.
