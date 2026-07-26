import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('jpeg')
Config.setOverwriteOutput(true)
// H.264 MP4 — the universal ad-platform format (TikTok / Reels / Meta / Shorts).
Config.setCodec('h264')
