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
