-- Rename band_cache columns from Spotify-era names to source-agnostic names.
-- Genre data is now sourced from Last.fm instead of Spotify.
-- Run once in the Supabase SQL editor.

alter table band_cache rename column spotify_genres          to genre_tags;
alter table band_cache rename column spotify_jam_genre_score to jam_genre_score;
alter table band_cache rename column spotify_matched_genres  to matched_genre_tags;
alter table band_cache rename column spotify_found           to genre_found;

-- spotify_id and spotify_popularity are no longer populated — drop them.
alter table band_cache drop column if exists spotify_id;
alter table band_cache drop column if exists spotify_popularity;
