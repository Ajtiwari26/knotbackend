import mongoose, { Schema, Document } from 'mongoose';

export interface INode {
  start_ms: number;
  end_ms: number;
  skip_to_ms: number;
}

export interface ISong extends Document {
  youtube_id: string;
  title: string;
  artist?: string;
  album?: string;
  genre?: string;
  duration_ms: number;
  play_count: number;
  tags: string[];
  thumbnail: string;
  nodes: INode[];
  createdAt: Date;
  updatedAt: Date;
}

const NodeSchema: Schema = new Schema({
  start_ms: { type: Number, required: true },
  end_ms: { type: Number, required: true },
  skip_to_ms: { type: Number, required: true },
});

const SongSchema: Schema = new Schema(
  {
    youtube_id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    artist: { type: String },
    album: { type: String },
    genre: { type: String },
    duration_ms: { type: Number, default: 0 },
    play_count: { type: Number, default: 0 },
    tags: { type: [String], default: [] },
    thumbnail: { type: String, required: false },
    nodes: { type: [NodeSchema], default: [] },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<ISong>('Song', SongSchema);
