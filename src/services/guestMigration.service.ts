import mongoose from 'mongoose';
import KnotVersion from '../models/KnotVersion';
import Playlist from '../models/Playlist';
import Download from '../models/Download';
import User from '../models/User';

export async function migrateGuestData(
  guestUserId: string,
  targetUserId: string
): Promise<{
  knotsMigrated: number;
  playlistsMigrated: number;
  downloadsMigrated: number;
}> {
  if (!guestUserId || !targetUserId || guestUserId === targetUserId) {
    return { knotsMigrated: 0, playlistsMigrated: 0, downloadsMigrated: 0 };
  }

  try {
    let guestObjId: mongoose.Types.ObjectId | null = null;

    if (mongoose.Types.ObjectId.isValid(guestUserId)) {
      guestObjId = new mongoose.Types.ObjectId(guestUserId);
    } else {
      // Find guest user by guest_... email
      const guestUser = await User.findOne({
        $or: [
          { email: `guest_${guestUserId}@knot.local` },
          { email: guestUserId },
        ],
      });
      if (guestUser) {
        guestObjId = guestUser._id as mongoose.Types.ObjectId;
      }
    }

    if (!guestObjId) {
      console.log(`[Guest Migration] No guest user found for ID: ${guestUserId}`);
      return { knotsMigrated: 0, playlistsMigrated: 0, downloadsMigrated: 0 };
    }

    const targetObjId = new mongoose.Types.ObjectId(targetUserId);

    // 1. Re-assign Knot Versions
    const knotRes = await KnotVersion.updateMany(
      { creator_id: guestObjId },
      { $set: { creator_id: targetObjId } }
    );

    // 2. Re-assign Playlists & Saved Songs
    const playlistRes = await Playlist.updateMany(
      { owner_id: guestObjId },
      { $set: { owner_id: targetObjId } }
    );

    // 3. Re-assign Downloads
    const downloadRes = await Download.updateMany(
      { user_id: guestObjId },
      { $set: { user_id: targetObjId } }
    );

    // 4. Remove guest user record if it was a temporary guest account
    await User.deleteOne({ _id: guestObjId, email: /@knot\.local$/ });

    console.log(
      `[Guest Migration] Migrated guest ${guestUserId} -> account ${targetUserId}: ${knotRes.modifiedCount} knots, ${playlistRes.modifiedCount} playlists, ${downloadRes.modifiedCount} downloads.`
    );

    return {
      knotsMigrated: knotRes.modifiedCount,
      playlistsMigrated: playlistRes.modifiedCount,
      downloadsMigrated: downloadRes.modifiedCount,
    };
  } catch (error) {
    console.error(
      `[Guest Migration] Error migrating guest data from ${guestUserId} to ${targetUserId}:`,
      error
    );
    return { knotsMigrated: 0, playlistsMigrated: 0, downloadsMigrated: 0 };
  }
}
