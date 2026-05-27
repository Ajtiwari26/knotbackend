import mongoose, { Schema, Document } from 'mongoose';

export interface IOtp extends Document {
  phoneNumber: string;
  otp: string;
  createdAt: Date;
}

const OtpSchema = new Schema<IOtp>({
  phoneNumber: { 
    type: String, 
    required: true 
  },
  otp: { 
    type: String, 
    required: true 
  },
  createdAt: { 
    type: Date, 
    default: Date.now, 
    expires: 300 // Document automatically deletes after 300 seconds (5 minutes)
  }
});

// Ensure a unique index on phoneNumber to allow only one active OTP session per number
OtpSchema.index({ phoneNumber: 1 }, { unique: true });

export default mongoose.model<IOtp>('Otp', OtpSchema);
