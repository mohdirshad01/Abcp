const { MongoClient, ServerApiVersion } = require('mongodb');
const { mongo_url, bot_token } = require('./config');

// database client setup
const client = new MongoClient(mongo_url, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
    writeConcern: { w: 'majority' },
});

// connect to database
async function main() {
    try {
        await client.connect();
        console.log("Server connected to MongoDB");
        const dbName = bot_token.split(':')[0];
        exports.db = client.db(dbName);

        require('./bot');
    } catch (error) {
        console.error('Error while connecting to MongoDB:', error);
        process.exit(1);
    }
}

// Handle app shutdown 
const gracefulShutdown = async () => {
    try {
        await client.close();
        console.log('MongoDB connection closed...');
    } catch (error) {
        console.error('Error during MongoDB shutdown', error);
    } finally {
        process.exit(0);
    }
};

process.on('SIGINT', gracefulShutdown); process.on('SIGTERM', gracefulShutdown);

main();



