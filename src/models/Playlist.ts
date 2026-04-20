import mongoose, { Schema, Document } from 'mongoose';

export interface IPlaylistSong {
  song_id: mongoose.Types.ObjectId;
  knot_version_id?: mongoose.Types.ObjectId;
}

export interface IPlaylist extends Document {
  owner_id: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  cover_image?: string;
  songs: IPlaylistSong[];
  is_public: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PlaylistSongSchema = new Schema({
  song_id: { type: Schema.Types.ObjectId, ref: 'Song', required: true },
  knot_version_id: { type: Schema.Types.ObjectId, ref: 'KnotVersion' },
});

const PlaylistSchema: Schema = new Schema(
  {
    owner_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    description: { type: String },
    cover_image: { type: String },
    songs: { type: [PlaylistSongSchema], default: [] },
    is_public: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model<IPlaylist>('Playlist', PlaylistSchema);
