import mongoose, { Schema, Document } from 'mongoose';

export interface INode {
  start_ms: number;
  end_ms: number;
  skip_to_ms: number;
}

/** Per-user knot data stored inline on the song document. */
export interface IUserKnot {
  user_id: mongoose.Types.ObjectId;
  junctions: INode[];
  knot_name: string;
  updated_at: Date;
}

export interface ISong extends Document {
  youtube_id: string;
  jiosaavn_token: string;
  pagalworld_url: string;
  pagalfree_url: string;
  local_id: string;
  title: string;
  artist?: string;
  album?: string;
  genre?: string;
  duration_ms: number;
  play_count: number;
  tags: string[];
  thumbnail: string;
  nodes: INode[];
  source: string;
  /** Per-user knot data — allows each user to have their own knots on a song. */
  user_knots: IUserKnot[];
  createdAt: Date;
  updatedAt: Date;
}

const NodeSchema: Schema = new Schema({
  start_ms: { type: Number, required: true },
  end_ms: { type: Number, required: true },
  skip_to_ms: { type: Number },
});

const UserKnotSchema: Schema = new Schema({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  junctions: { type: [NodeSchema], default: [] },
  knot_name: { type: String, default: 'My Knot' },
  updated_at: { type: Date, default: Date.now },
});

const SongSchema: Schema = new Schema(
  {
    youtube_id: { type: String, required: false, sparse: true, unique: true },
    jiosaavn_token: { type: String, required: false, sparse: true, unique: true },
    pagalworld_url: { type: String, required: false, sparse: true, unique: true },
    pagalfree_url: { type: String, required: false, sparse: true, unique: true },
    local_id: { type: String, required: false, sparse: true, unique: true },
    title: { type: String, required: true },
    artist: { type: String },
    album: { type: String },
    genre: { type: String },
    duration_ms: { type: Number, default: 0 },
    play_count: { type: Number, default: 0 },
    tags: { type: [String], default: [] },
    thumbnail: { type: String, required: false },
    nodes: { type: [NodeSchema], default: [] },
    source: { type: String, enum: ['youtube', 'local', 'jiosaavn', 'pagalworld', 'pagalfree'], default: 'youtube' },
    user_knots: { type: [UserKnotSchema], default: [] },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<ISong>('Song', SongSchema);
