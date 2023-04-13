const fs = require("fs");
const path = require("path");

/**
 * Constructs a new BigQuery schema migration class instance.
 * @class
 * @classdesc A class for managing BigQuery schema migrations.
 */
class BQMigration {
    /**
     * @param {Object} config - The configuration object for the migration class.
     * @param {Object} config.bigquery - The BigQuery client instance.
     * @param {string} config.datasetId - The ID of the dataset where migrations will be applied.
     * @param {string} [config.migrationTableName="schema_migrations"] - The name of the table that stores the migration history.
     * @param {string} [config.migrationLockTableName="schema_migrations_lock"] - The name of the table that stores the migration lock.
     * @param {string} [config.migrationsDir="migrations"] - The path to the directory containing migration files.
     * @param {number} [config.migrationLockExpirationTime=30] - The duration (in seconds) after which a migration lock will expire.
     * @param {string} [config.timezone="Etc/UTC"] - The timezone used for date and time operations. Must be a valid tz database timezone (https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).
     */
    constructor(config) {
        this.bigquery = config.bigquery;
        this.datasetId = config.datasetId;
        this.migrationTableName =
            config.migrationTableName || "schema_migrations";
        this.migrationLockTableName =
            config.migrationLockTableName || "schema_migrations_lock";
        this.migrationsDir =
            config.migrationsDir || path.resolve(__dirname, "migrations");
        this.migrationLockExpirationTime =
            config.migrationLockExpirationTime || 30;
        this.timezone = config.timezone || "Etc/UTC";
    }

    /**
     * Create a migration table to store migration data in BigQuery.
     * The table will have the following schema:
     * - name (STRING): The name of the migration.
     * - batch (INT64): The batch number of the migration.
     * - migration_time (DATETIME): The time when the migration occurred.
     *
     * @method createMigrationTable
     * @memberof BigQuerySchemaMigration
     * @returns {Promise<void>} A promise that resolves when the migration table is created or already exists.
     */
    createMigrationTable = async () => {
        // Check if the migrations table exists
        const [migrationsTableExists] = await this.bigquery
            .dataset(this.datasetId)
            .table(this.migrationTableName)
            .exists();

        if (!migrationsTableExists) {
            // migrations table does not exist
            const migrationSchema = [
                { name: "name", type: "STRING" },
                { name: "batch", type: "INT64" },
                { name: "migration_time", type: "DATETIME" },
            ];

            // Create the bq_migrations table with the defined schema
            await this.bigquery
                .dataset(this.datasetId)
                .createTable(this.migrationTableName, {
                    schema: migrationSchema,
                });

            console.info(`Created ${this.migrationTableName} table.`);
        }
    };

    /**
     * Creates the migration lock table if it doesn't exist. This table prevents simultaneous schema migrations
     * by checking if a migration is already in progress. The table will have two columns: "is_locked" and "locked_at".
     * @returns {Promise<void>}
     */
    createMigrationLockTable = async () => {
        // Check if the migrations lock table exists.
        const [lockTableExists] = await bigquery
            .dataset(this.datasetId)
            .table(this.migrationLockTableName)
            .exists();

        if (!lockTableExists) {
            // the lock table doesn't exist
            const migrationLockSchema = [
                { name: "is_locked", type: "BOOL" },
                { name: "locked_at", type: "DATETIME" },
            ];

            // Create the bq_migrations_lock table with the specified schema.
            await this.bigquery
                .dataset(this.datasetId)
                .createTable(this.migrationLockTableName, {
                    schema: migrationLockSchema,
                });

            // Insert a default lock row with "is_locked" set to FALSE and "locked_at" set to the current datetime.
            const [rows] = await bigquery.query({
                query: `INSERT INTO \`${this.datasetId}.${this.migrationLockTableName}\` (is_locked, locked_at)
                        VALUES (FALSE, CURRENT_DATETIME('${this.timezone}'))`,
            });

            console.info(`Created ${this.migrationLockTableName} table.`);
        }
    };

    /**
     * Locks the migration process by updating the migration lock table.
     * @returns {Promise<void>} A promise that resolves when the lock is acquired, and rejects with an error if the lock fails.
     * @throws {Error} If the lock fails to be acquired.
     */
    lockMigration = async () => {
        // Can't use bigquery.query() as it doesn't expose affected rows in an UPDATE
        // Create a new query job to lock the migration by updating the migration lock table
        const [job] = await this.bigquery.createQueryJob({
            query: `UPDATE \`${this.datasetId}.${this.migrationLockTableName}\`
                    SET 
                        is_locked = TRUE, 
                        locked_at = CURRENT_DATETIME('${this.timezone}')
                    WHERE 
                        is_locked = FALSE
                        OR DATETIME_DIFF(
                            CURRENT_DATETIME('${this.timezone}'), 
                            locked_at, 
                            SECOND
                        ) >= @migrationLockExpirationTime;`,
            params: {
                migrationLockExpirationTime: this.migrationLockExpirationTime,
            },
        });

        // To get affected rows from an UPDATE, we have to get the
        // jobs metadata
        // Fetch the job metadata to get the number of affected rows from the lock update query
        const [jobMetadata] = await job.getMetadata();
        const affectedRows = Number(jobMetadata.statistics.numDmlAffectedRows);

        // If no rows are affected, the lock failed, so throw an error
        if (affectedRows === 0) {
            throw new Error(
                `Failed to lock ${this.migrationLockTableName} table`
            );
        }

        console.info("Received migration lock.");
    };

    /**
     * Unlocks the migration lock table.
     * This method updates the migration lock table by setting the is_locked field to FALSE.
     * It then checks the number of affected rows to ensure that the lock is removed.
     * If no rows were affected, an error is thrown.
     * @returns {Promise<void>}
     * @throws {Error} If the lock is not removed successfully.
     */
    unlockMigration = async () => {
        // Can't use bigquery.query() as it doesn't expose affected rows in an UPDATE
        // Create a query job to update the migration lock table and set the is_locked field to FALSE
        const [job] = await this.bigquery.createQueryJob({
            query: `UPDATE \`${this.datasetId}.${this.migrationLockTableName}\`
                    SET is_locked = FALSE
                    WHERE is_locked = TRUE;`,
        });

        // To get affected rows from an UPDATE, we have to get the job's metadata
        const [jobMetadata] = await job.getMetadata();
        // Extract the number of affected rows from the job metadata
        const affectedRows = Number(jobMetadata.statistics.numDmlAffectedRows);

        // If no rows were affected, throw an error
        if (affectedRows === 0) {
            throw new Error(
                `Failed to unlock ${this.migrationLockTableName} table`
            );
        }
        // Log the successful removal of the migration lock
        console.info("Removed migration lock.");
    };

    /**
     * Asynchronously reads the migration directory and returns a sorted list of Javascript or Typescript migration files.
     * A valid migration file should start with a 3-digit number followed by an underscore (e.g. 001_migration.ts).
     *
     * @returns {Promise<string[]>} A promise that resolves to an array of sorted migration file names.
     */
    getMigrationFiles = async () => {
        const migrationFiles = await fs.promises.readdir(this.migrationsDir);

        // Filter the migration files to include only valid file names and extensions
        // A valid file name should start with a 3-digit number followed by an underscore
        // A valid file extension should be either ".js" or ".ts"
        const validMigrationFiles = migrationFiles.filter(
            (file) =>
                /^\d{3}_/.test(file) &&
                (file.endsWith(".js") || file.endsWith(".ts"))
        );

        const sortedMigrationFiles = validMigrationFiles.sort();

        return sortedMigrationFiles;
    };

    /**
     * Get the list of applied migrations from the migration table.
     *
     * This method fetches the names of the migrations that have been applied to the BigQuery schema.
     * If a batch number is provided, only migrations from that batch will be fetched.
     *
     * @example
     * const appliedMigrations = await getAppliedMigrations();
     * console.log(appliedMigrations); // ['001_init', '002_person_table']
     *
     * @param {number} [batch=null] - Optional batch number to filter migrations by.
     * @returns {Promise<string[]>} - A promise that resolves to an array of migration names.
     */
    getAppliedMigrations = async (batch = null) => {
        // Build the query to fetch migration names from the migration table
        const query =
            `SELECT name FROM \`${this.datasetId}.${this.migrationTableName}\`` +
            (batch ? ` WHERE batch = ${batch}` : "") + // optional batch
            ";";

        // Execute the query using the BigQuery client
        const [rows] = await this.bigquery.query({
            query,
            params: {
                ...(batch ? { batch } : {}),
            },
        }); // retuns e.g. [ { name: '001_init' }, { name: '002_person_table' } ]

        // Extract "name" attribute from the query result and return them as an array
        return rows.map((row) => row.name);
    };

    /**
     * Asynchronously runs any pending migrations for the BigQuery schema.
     * This method does the following steps:
     * 1. Create the migration table and migration lock table, if they don't exist.
     * 2. Lock the migration to prevent concurrent executions.
     * 3. Fetch the list of applied migrations and migration files.
     * 4. Run pending migrations (if any) and insert their metadata into the migration table.
     * 5. Unlock the migration.
     * 
     * @returns {Promise<void>} A promise that resolves when all pending migrations have been executed.
     */
    runMigrations = async () => {
        try {
            // Step 1: Create migration and lock tables if they don't exist
            await this.createMigrationTable();
            await this.createMigrationLockTable();

            // Step 2: Lock the migration to prevent concurrent executions
            await this.lockMigration();

            // Step 3: Fetch the list of applied migrations and migration files
            const appliedMigrations = await this.getAppliedMigrations();
            const migrationFiles = await this.getMigrationFiles();

            // Step 4: Run pending migrations and insert their metadata into the migration table
            let ranMigrations = [];
            for (const file of migrationFiles) {
                const fileName = path.parse(file).name;
                const filePath = path.join(this.migrationsDir, file);

                if (!appliedMigrations.includes(fileName)) {
                    const migrationFile = require(filePath);
                    await migrationFile.up(this.bigquery, this.datasetId);

                    ranMigrations.push(fileName);
                }
            }

            // Add run & finished migrations to the migration table
            if (ranMigrations.length === 0) {
                console.info("No migrations to run.");
            } else {
                // Get the current highest batch number
                const [batchRows] = await bigquery.query({
                    query: `SELECT MAX(batch) as max_batch FROM \`${this.datasetId}.${this.migrationTableName}\`;`,
                });
                const currentBatch = Number(batchRows[0].max_batch) || 0;

                await this.bigquery.query({
                    query:
                        `INSERT INTO \`${this.datasetId}.${this.migrationTableName}\` (name, batch ,migration_time)
                    VALUES ` +
                        ranMigrations
                            .map(
                                (fileName, i) =>
                                    `('${fileName}', ${
                                        currentBatch + 1
                                    } , CURRENT_DATETIME('${this.timezone}'))`
                            )
                            .join(", "),
                });
                console.info(`Ran ${ranMigrations.length} migrations.`);
            }
        } catch (error) {
            console.error("Error running migrations:", error);
        } finally {
            // Step 5: Unlock the migration
            await this.unlockMigration();
        }
    };

    /**
     * Rolls back the latest batch of migrations applied to the BigQuery schema.
     * This method performs the following steps:
     * 1. Lock the migration to prevent concurrent migrations.
     * 2. Get the list of migration files.
     * 3. Retrieve the current highest batch number from the migration table.
     * 4. Get the migration names for the latest batch.
     * 5. Iterate through the migration files and roll back the migrations
     *    included in the latest batch by executing their 'down' method.
     * 6. Remove the rolled back migrations from the migration table.
     * 7. Unlock the migration.
     *
     * @returns {Promise<void>} A promise that resolves when all pending migrations have been rolled back.
     */
    rollbackMigrations = async () => {
        try {
            await this.lockMigration();
            const migrationFiles = await this.getMigrationFiles();

            // Get the current highest batch number
            const [batchRows] = await this.bigquery.query({
                query: `SELECT MAX(batch) as max_batch FROM \`${this.datasetId}.${this.migrationTableName}\`;`,
            });
            const currentBatch = Number(batchRows[0].max_batch) || 0;

            // Get the migration names for the latest batch
            const latestBatchMigrations = await this.getAppliedMigrations(
                currentBatch
            );

            let rolledBackMigrations = [];
            for (const file of migrationFiles) {
                const fileName = path.parse(file).name;
                const filePath = path.join(this.migrationsDir, file);

                if (latestBatchMigrations.includes(fileName)) {
                    const migrationFile = require(filePath);
                    await migrationFile.down(this.bigquery, this.datasetId);

                    rolledBackMigrations.push(fileName);
                }
            }

            // Add run & finished migrations to the migration table
            if (rolledBackMigrations.length === 0) {
                console.info("Nothing to rollback.");
            } else {
                const [rows] = await this.bigquery.query({
                    query:
                        `DELETE FROM \`${this.datasetId}.${this.migrationTableName}\`
                    WHERE name IN (` +
                        rolledBackMigrations
                            .map((fileName) => `'${fileName}'`)
                            .join(", ") +
                        `) AND batch = ${currentBatch};`, // Only delete the latest batch
                });
                console.info(
                    `Rolled back ${rolledBackMigrations.length} migrations.`
                );
            }
        } catch (error) {
            console.error("Error rolling back:", error);
        } finally {
            await this.unlockMigration();
        }
    };
}

module.exports = BQMigration;
