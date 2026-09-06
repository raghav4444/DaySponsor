/*
# Add video reel fields to reviews

## Overview
Creators now post a reel or video on social media as part of their review.
This adds two columns to the reviews table:
- video_url: link to the social media reel/video (Instagram, TikTok, YouTube, etc.)
- video_platform: which platform the reel was posted on

## Security
No new policies needed — existing review policies cover these columns.
*/

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS video_url text;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS video_platform text CHECK (video_platform IN ('instagram', 'tiktok', 'youtube', 'x', 'other') OR video_platform IS NULL);
