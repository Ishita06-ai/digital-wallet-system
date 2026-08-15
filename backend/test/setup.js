const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongoReplSet;

// Start in-memory MongoDB replica set before all tests
beforeAll(async () => {
    mongoReplSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = mongoReplSet.getUri();
    await mongoose.connect(uri);
});

// Stop in-memory MongoDB after all tests
afterAll(async () => {
    await mongoose.connection.close();
    if (mongoReplSet) {
        await mongoReplSet.stop();
    }
});

// Clear all collections after each test
afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
        await collections[key].deleteMany({});
    }
});