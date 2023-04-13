const bqMigration = require("./bqMigrate")

async function invoke(){
    await bqMigration.rollbackMigrations()
}
invoke()