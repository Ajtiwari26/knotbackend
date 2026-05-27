import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  email?: string;
  password?: string;
  firebaseUid?: string;
  phoneNumber?: string;
  displayName: string;
  avatar?: string;
  bio?: string;
  wallet_balance: number;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    email: { type: String, unique: true, sparse: true },
    password: { type: String, select: false },
    firebaseUid: { type: String, unique: true, sparse: true },
    phoneNumber: { type: String, unique: true, sparse: true },
    displayName: { type: String, required: true },
    avatar: { type: String },
    bio: { type: String, maxlength: 500 },
    wallet_balance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model<IUser>('User', UserSchema);
