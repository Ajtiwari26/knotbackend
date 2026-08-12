import mongoose, { Connection } from 'mongoose';

export let storageDBConnection: Connection;

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/knot');
    console.log(`Primary MongoDB Connected: ${conn.connection.host}`);

    const storageUri = process.env.STORAGE_MONGODB_URI;
    if (storageUri) {
      try {
        storageDBConnection = await mongoose.createConnection(storageUri).asPromise();
        console.log(`Cloud Storage MongoDB Connected: ${storageDBConnection.host}`);
      } catch (err: any) {
        console.error(`Cloud Storage MongoDB Error: ${err.message}. Falling back to primary connection.`);
        storageDBConnection = conn.connection;
      }
    } else {
      console.log('STORAGE_MONGODB_URI not specified, falling back to primary connection for storage.');
      storageDBConnection = conn.connection;
    }
  } catch (error) {
    console.error(`Database Connection Error: ${(error as Error).message}`);
    process.exit(1);
  }
};

