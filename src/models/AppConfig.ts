import mongoose, { Schema, Document } from 'mongoose';

// ── Sub-document interfaces ──

interface IBanner {
  id: string;
  image_url: string;
  title?: string;
  action_type: 'link' | 'screen' | 'deeplink' | 'none';
  action_value?: string;
  enabled: boolean;
}

interface ISectionItem {
  id: string;
  title: string;
  artist?: string;
  thumbnail: string;
  duration?: string;
  badge?: string;
  action_type: 'play_youtube' | 'play_local' | 'link' | 'screen';
  action_value?: string;
}

interface ISection {
  id: string;
  type: 'trending' | 'featured' | 'playlist' | 'announcement' | 'custom';
  title: string;
  subtitle?: string;
  action_label?: string;
  action_route?: string;
  items: ISectionItem[];
  layout: 'horizontal_cards' | 'vertical_list' | 'grid';
  enabled: boolean;
}

interface IQuickAction {
  id: string;
  emoji: string;
  label: string;
  route: string;
  enabled: boolean;
}

export interface IAppConfig extends Document {
  hero: {
    kicker: string;
    title: string;
    subtitle?: string;
  };
  banners: IBanner[];
  sections: ISection[];
  quick_actions: IQuickAction[];
  theme: {
    enabled: boolean;
    name?: string;
    primary_color?: string;
    gradient_start?: string;
    gradient_end?: string;
    background_color?: string;
    banner_overlay_url?: string;
  };
  force_update: {
    enabled: boolean;
    min_version: string;
    update_url: string;
    message: string;
    title: string;
  };
  features: {
    downloads_enabled: boolean;
    community_enabled: boolean;
    auto_knot_enabled: boolean;
    payments_enabled: boolean;
  };
  announcement: {
    enabled: boolean;
    message: string;
    type: 'info' | 'warning' | 'maintenance';
    dismissible: boolean;
  };
  updated_at: Date;
  config_version: number;
}

// ── Schemas ──

const BannerSchema = new Schema<IBanner>({
  id: { type: String, required: true },
  image_url: { type: String, required: true },
  title: String,
  action_type: { type: String, enum: ['link', 'screen', 'deeplink', 'none'], default: 'none' },
  action_value: String,
  enabled: { type: Boolean, default: true },
}, { _id: false });

const SectionItemSchema = new Schema<ISectionItem>({
  id: { type: String, required: true },
  title: { type: String, required: true },
  artist: String,
  thumbnail: { type: String, default: '' },
  duration: String,
  badge: String,
  action_type: { type: String, enum: ['play_youtube', 'play_local', 'link', 'screen'], default: 'screen' },
  action_value: String,
}, { _id: false });

const SectionSchema = new Schema<ISection>({
  id: { type: String, required: true },
  type: { type: String, enum: ['trending', 'featured', 'playlist', 'announcement', 'custom'], default: 'custom' },
  title: { type: String, required: true },
  subtitle: String,
  action_label: String,
  action_route: String,
  items: [SectionItemSchema],
  layout: { type: String, enum: ['horizontal_cards', 'vertical_list', 'grid'], default: 'vertical_list' },
  enabled: { type: Boolean, default: true },
}, { _id: false });

const QuickActionSchema = new Schema<IQuickAction>({
  id: { type: String, required: true },
  emoji: { type: String, required: true },
  label: { type: String, required: true },
  route: { type: String, required: true },
  enabled: { type: Boolean, default: true },
}, { _id: false });

const AppConfigSchema = new Schema<IAppConfig>({
  hero: {
    kicker: { type: String, default: 'VIBRANT RESONANCE' },
    title: { type: String, default: 'Pulse of\nThe Street' },
    subtitle: String,
  },
  banners: [BannerSchema],
  sections: [SectionSchema],
  quick_actions: [QuickActionSchema],
  theme: {
    enabled: { type: Boolean, default: false },
    name: String,
    primary_color: String,
    gradient_start: String,
    gradient_end: String,
    background_color: String,
    banner_overlay_url: String,
  },
  force_update: {
    enabled: { type: Boolean, default: false },
    min_version: { type: String, default: '1.0.0' },
    update_url: { type: String, default: 'https://play.google.com/store/apps/details?id=com.ajay.knot' },
    message: { type: String, default: 'A new version of Knot is available. Please update to continue.' },
    title: { type: String, default: 'Update Required' },
  },
  features: {
    downloads_enabled: { type: Boolean, default: true },
    community_enabled: { type: Boolean, default: true },
    auto_knot_enabled: { type: Boolean, default: true },
    payments_enabled: { type: Boolean, default: false },
  },
  announcement: {
    enabled: { type: Boolean, default: false },
    message: { type: String, default: '' },
    type: { type: String, enum: ['info', 'warning', 'maintenance'], default: 'info' },
    dismissible: { type: Boolean, default: true },
  },
  updated_at: { type: Date, default: Date.now },
  config_version: { type: Number, default: 1 },
});

export const AppConfig = mongoose.model<IAppConfig>('AppConfig', AppConfigSchema);

// ── Default seed config matching the current hardcoded homepage ──
export function getDefaultAppConfig() {
  return {
    hero: {
      kicker: 'VIBRANT RESONANCE',
      title: 'Pulse of\nThe Street',
    },
    banners: [],
    sections: [
      {
        id: 'trending_knots',
        type: 'trending',
        title: 'Trending Knots',
        action_label: 'See All',
        action_route: '/community',
        items: [
          { id: 't1', title: 'Blinding Lights', artist: 'The Weeknd', thumbnail: 'https://i.ytimg.com/vi/4NRXx6U8ABQ/hqdefault.jpg', duration: '3:20', badge: 'Drop Only', action_type: 'play_youtube', action_value: '4NRXx6U8ABQ' },
          { id: 't2', title: 'Shape of You', artist: 'Ed Sheeran', thumbnail: 'https://i.ytimg.com/vi/JGwWNGJdvx8/hqdefault.jpg', duration: '3:54', badge: 'No Intro', action_type: 'play_youtube', action_value: 'JGwWNGJdvx8' },
          { id: 't3', title: 'Levitating', artist: 'Dua Lipa', thumbnail: 'https://i.ytimg.com/vi/TUVcZfQe-Kw/hqdefault.jpg', duration: '3:23', badge: 'Chorus Loop', action_type: 'play_youtube', action_value: 'TUVcZfQe-Kw' },
          { id: 't4', title: 'Stay', artist: 'The Kid LAROI, Justin Bieber', thumbnail: 'https://i.ytimg.com/vi/kTJczUoc26U/hqdefault.jpg', duration: '2:21', badge: 'Best Part', action_type: 'play_youtube', action_value: 'kTJczUoc26U' },
        ],
        layout: 'vertical_list',
        enabled: true,
      },
    ],
    quick_actions: [
      { id: 'qa1', emoji: '📥', label: 'Downloads', route: '/downloads', enabled: true },
      { id: 'qa2', emoji: '🌍', label: 'Community', route: '/community', enabled: true },
      { id: 'qa3', emoji: '📋', label: 'Queue', route: '/queue', enabled: true },
    ],
    theme: { enabled: false },
    force_update: {
      enabled: false,
      min_version: '1.0.0',
      update_url: 'https://play.google.com/store/apps/details?id=com.ajay.knot',
      message: 'A new version of Knot is available. Please update to continue.',
      title: 'Update Required',
    },
    features: {
      downloads_enabled: true,
      community_enabled: true,
      auto_knot_enabled: true,
      payments_enabled: false,
    },
    announcement: {
      enabled: false,
      message: '',
      type: 'info',
      dismissible: true,
    },
    config_version: 1,
    updated_at: new Date(),
  };
}
