import mongoose, { Schema, Document } from 'mongoose';
import { INode } from './Song';

export interface IKnotVersion extends Document {
  song_id: mongoose.Types.ObjectId;
  creator_id: mongoose.Types.ObjectId;
  name: string;
  junctions: INode[];
  is_public: boolean;
  total_plays: number;
  completion_rate: number;
  knotted_duration_ms: number;
  original_duration_ms: number;
  createdAt: Date;
  updatedAt: Date;
}

const KnotVersionSchema: Schema = new Schema(
  {
    song_id: { type: Schema.Types.ObjectId, ref: 'Song', required: true },
    creator_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    junctions: { type: [Schema.Types.Mixed], default: [] }, // Using Mixed or explicit schema if same as INode
    is_public: { type: Boolean, default: true },
    total_plays: { type: Number, default: 0 },
    completion_rate: { type: Number, default: 0 },
    knotted_duration_ms: { type: Number, required: true },
    original_duration_ms: { type: Number, required: true },
  },
  { timestamps: true }
);

export default mongoose.model<IKnotVersion>('KnotVersion', KnotVersionSchema);
