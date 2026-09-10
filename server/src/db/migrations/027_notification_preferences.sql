ALTER TABLE users
  ADD COLUMN notification_channels JSON NULL,
  ADD COLUMN notification_preferences JSON NULL;