import mongoose, { Schema, Document } from 'mongoose';

export interface IDownload extends Document {
  user_id: mongoose.Types.ObjectId;
  song_id: mongoose.Types.ObjectId;
  knot_version_id?: mongoose.Types.ObjectId;
  s3_key: string;
  file_size_bytes: number;
  downloaded_at: Date;
}

const DownloadSchema: Schema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    song_id: { type: Schema.Types.ObjectId, ref: 'Song', required: true },
    knot_version_id: { type: Schema.Types.ObjectId, ref: 'KnotVersion' },
    s3_key: { type: String, required: true },
    file_size_bytes: { type: Number, required: true },
    downloaded_at: { type: Date, default: Date.now },
  }
);

export default mongoose.model<IDownload>('Download', DownloadSchema);
