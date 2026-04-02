const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo;

const connectTestDb = async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri();
  await mongoose.connect(uri, { dbName: 'jest' });
};

const disconnectTestDb = async () => {
  await mongoose.disconnect();
  if (mongo) {
    await mongo.stop();
    mongo = null;
  }
};

const clearTestDb = async () => {
  const collections = await mongoose.connection.db.collections();
  for (const collection of collections) {
    // eslint-disable-next-line no-await-in-loop
    await collection.deleteMany({});
  }
};

module.exports = {
  connectTestDb,
  disconnectTestDb,
  clearTestDb,
};
