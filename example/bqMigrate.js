/**
 * Create bq-migrate instance
 */
const BQMigrate = require("@advename/bq-migrate")
const bigquery = require("/somewhere/bigquery.js")

const bqMigration = new BQMigration({
    bigquery, /* bigquery instance */
    datasetId: "birdy_posts",
});

module.exports = bqMigration;